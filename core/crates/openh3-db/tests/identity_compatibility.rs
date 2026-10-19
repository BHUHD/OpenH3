use std::{borrow::Cow, path::Path};

use openh3_db::{IAssistantDefinitionRepository, SqliteAssistantDefinitionRepository};
use sqlx::{Row, migrate::Migrator, sqlite::SqlitePoolOptions};

#[tokio::test]
async fn upgrade_044_preserves_old_identity_history_preferences_and_cron_payloads() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    // Match the production startup migration connection's table-rebuild mode.
    sqlx::query("PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON")
        .execute(&pool)
        .await
        .unwrap();
    let full = Migrator::new(Path::new("migrations")).await.unwrap();
    Migrator {
        migrations: Cow::Owned(full.iter().filter(|m| m.version <= 44).cloned().collect()),
        ignore_missing: false,
        locking: true,
        no_tx: false,
    }
    .run(&pool)
    .await
    .unwrap();
    sqlx::query("PRAGMA foreign_keys = ON; PRAGMA legacy_alter_table = OFF")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT OR IGNORE INTO users (id, username, password_hash, created_at, updated_at) VALUES ('system_default_user', 'admin', '', 1, 1)")
        .execute(&pool).await.unwrap();
    for (id, user_id, source, owner) in [
        ("old-butler-definition", None, "builtin", "system"),
        ("custom-definition", Some("system_default_user"), "user", "user"),
    ] {
        sqlx::query("INSERT INTO assistant_definitions (id, user_id, assistant_id, source, owner_type, source_ref, name, agent_id, rule_resource_type, rule_resource_ref, default_model_mode, default_permission_mode, default_skills_mode, default_mcps_mode, created_at, updated_at) VALUES (?, ?, 'aionui-assistant', ?, ?, 'aionui-assistant', 'Original name', '632f31d2', 'builtin_asset', 'aionui-assistant', 'auto', 'auto', 'auto', 'auto', 1, 1)")
            .bind(id).bind(user_id).bind(source).bind(owner).execute(&pool).await.unwrap();
    }
    sqlx::raw_sql(r#"
        INSERT INTO assistant_overlays (assistant_definition_id, enabled, sort_order, created_at, updated_at)
        VALUES ('old-butler-definition', 0, 17, 1, 1);
        INSERT INTO assistant_preferences (assistant_definition_id, last_model_id, last_skill_ids, created_at, updated_at)
        VALUES ('old-butler-definition', 'user-model', '["user-skill"]', 1, 1);
        INSERT INTO assistant_overrides (assistant_id, enabled, sort_order, updated_at)
        VALUES ('aionui-assistant', 0, 17, 1);
        INSERT INTO conversations (id, user_id, name, type, created_at, updated_at)
        VALUES ('old-chat', 'system_default_user', 'Original conversation', 'aionrs', 1, 1);
        INSERT INTO conversation_assistant_snapshots (conversation_id, assistant_definition_id, assistant_id, assistant_source, agent_id, rules_content, default_model_mode, default_permission_mode, default_skills_mode, default_mcps_mode, created_at, updated_at)
        VALUES ('old-chat', 'old-butler-definition', 'aionui-assistant', 'builtin', '632f31d2', 'Original rules', 'auto', 'auto', 'auto', 'auto', 1, 1);
        INSERT INTO cron_jobs (id, name, schedule_kind, schedule_value, payload_message, agent_config, conversation_id, created_by, created_at, updated_at)
        VALUES ('old-cron', 'Original schedule', 'every', '60000', 'Original prompt', '{"assistant_id":"aionui-assistant","model":"my-model"}', 'old-chat', 'user', 1, 1);
    "#).execute(&pool).await.unwrap();

    // Compare complete persisted rows so metadata-only migration cannot quietly
    // rewrite prompts, settings, IDs, timestamps or future fields.
    let tables = [
        "assistant_definitions",
        "assistant_overlays",
        "assistant_preferences",
        "assistant_overrides",
        "conversations",
        "conversation_assistant_snapshots",
        "cron_jobs",
    ];
    let mut original = Vec::new();
    for table in tables {
        original.push(table_contents(&pool, table).await);
    }
    full.run(&pool).await.unwrap();
    full.run(&pool).await.unwrap();
    for (table, expected) in tables.into_iter().zip(original) {
        assert_eq!(table_contents(&pool, table).await, expected, "{table}");
    }
    let (name, icon, agent_type): (String, String, String) =
        sqlx::query_as("SELECT name, icon, agent_type FROM agent_metadata WHERE id='632f31d2'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(name, "OpenH3 Core");
    assert_eq!(icon, "/api/assets/logos/brand/openh3.png");
    assert_eq!(agent_type, "aionrs");
    let repo = SqliteAssistantDefinitionRepository::new(pool.clone());
    assert_eq!(
        repo.get_by_assistant_id("aionui-assistant").await.unwrap().unwrap().id,
        "custom-definition"
    );
    assert_eq!(
        repo.get_by_assistant_id("openh3-assistant").await.unwrap().unwrap().id,
        "old-butler-definition"
    );
    let violations = sqlx::query("PRAGMA foreign_key_check").fetch_all(&pool).await.unwrap();
    assert!(violations.is_empty());
}

async fn table_contents(pool: &sqlx::SqlitePool, table: &str) -> Vec<Vec<Option<String>>> {
    let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info(?) ORDER BY cid")
        .bind(table)
        .fetch_all(pool)
        .await
        .unwrap();
    let projection = columns
        .iter()
        .map(|name| format!("CAST(\"{name}\" AS TEXT)"))
        .collect::<Vec<_>>()
        .join(", ");
    sqlx::query(&format!("SELECT {projection} FROM {table} ORDER BY rowid"))
        .fetch_all(pool)
        .await
        .unwrap()
        .iter()
        .map(|row| (0..row.len()).map(|i| row.get::<Option<String>, _>(i)).collect())
        .collect()
}
