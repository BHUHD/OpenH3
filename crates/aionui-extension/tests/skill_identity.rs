use std::path::Path;

use aionui_db::{ISkillRepository, SqliteSkillRepository, UpsertSkillParams, init_database_memory};
use aionui_extension::skill_service::{
    SkillPaths, list_available_skills_with_repo_for_user, materialize_skills_for_agent,
    materialize_skills_for_agent_with_repo_for_user, read_builtin_skill, sync_builtin_skill_catalog_into_repo,
};
use tempfile::TempDir;

fn paths(base: &Path) -> SkillPaths {
    SkillPaths {
        data_dir: base.to_path_buf(),
        user_skills_dir: base.join("skills"),
        cron_skills_dir: base.join("cron/skills"),
        builtin_skills_dir: base.join("builtin-skills"),
        builtin_rules_dir: base.join("rules"),
        assistant_rules_dir: base.join("assistant-rules"),
        assistant_skills_dir: base.join("assistant-skills"),
    }
}

fn skill(dir: &Path, name: &str) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: Test\n---\n{name}"),
    )
    .unwrap();
}

#[tokio::test]
async fn legacy_names_resolve_the_same_canonical_builtin_directory() {
    let temp = TempDir::new().unwrap();
    let paths = paths(temp.path());
    for suffix in ["config", "troubleshooting", "webui-setup", "webui-public"] {
        let canonical = format!("openh3-{suffix}");
        let legacy = format!("aionui-{suffix}");
        let root = if suffix == "config" {
            paths.builtin_skills_dir.join("auto-inject")
        } else {
            paths.builtin_skills_dir.clone()
        };
        skill(&root.join(&canonical), &canonical);
        let resolved = materialize_skills_for_agent(&paths, "conversation", &[legacy, canonical.clone()])
            .await
            .unwrap();
        assert_eq!(resolved.len(), 2, "both names must resolve for {suffix}");
        assert!(resolved.iter().all(|item| item.source_path == root.join(&canonical)));
    }
    let content = read_builtin_skill(&paths, "auto-inject/openh3-config/SKILL.md")
        .await
        .unwrap();
    assert!(content.contains("name: openh3-config"));
}

#[tokio::test]
async fn aliases_preserve_exact_user_skills_and_do_not_expose_other_users_skills() {
    let temp = TempDir::new().unwrap();
    let paths = paths(temp.path());
    let db = init_database_memory().await.unwrap();
    let repo = SqliteSkillRepository::new(db.pool().clone());
    let builtin = paths.builtin_skills_dir.join("auto-inject/openh3-config");
    skill(&builtin, "openh3-config");
    sync_builtin_skill_catalog_into_repo(&paths, &repo).await.unwrap();
    let custom = temp.path().join("owner-custom");
    skill(&custom, "aionui-config");
    repo.upsert_for_user(
        "system_default_user",
        UpsertSkillParams {
            name: "aionui-config",
            description: None,
            path: custom.to_str().unwrap(),
            source: "user",
            enabled: true,
        },
    )
    .await
    .unwrap();
    for (user, expected) in [("system_default_user", &custom), ("other", &builtin)] {
        let resolved = materialize_skills_for_agent_with_repo_for_user(
            &paths,
            &repo,
            user,
            "conversation",
            &["aionui-config".to_string()],
        )
        .await
        .unwrap();
        assert_eq!(resolved.len(), 1);
        assert_eq!(&resolved[0].source_path, expected);
    }
}

#[tokio::test]
async fn migrated_catalog_hides_stale_global_alias_but_preserves_user_alias() {
    let temp = TempDir::new().unwrap();
    let paths = paths(temp.path());
    let db = init_database_memory().await.unwrap();
    let repo = SqliteSkillRepository::new(db.pool().clone());
    let legacy = paths.builtin_skills_dir.join("auto-inject/aionui-config");
    repo.upsert_global(UpsertSkillParams {
        name: "aionui-config",
        description: None,
        path: legacy.to_str().unwrap(),
        source: "builtin",
        enabled: true,
    })
    .await
    .unwrap();
    skill(
        &paths.builtin_skills_dir.join("auto-inject/openh3-config"),
        "openh3-config",
    );
    sync_builtin_skill_catalog_into_repo(&paths, &repo).await.unwrap();
    let listed = list_available_skills_with_repo_for_user(&paths, &repo, "owner")
        .await
        .unwrap();
    assert_eq!(
        listed.iter().map(|item| item.name.as_str()).collect::<Vec<_>>(),
        ["openh3-config"]
    );
    let custom = temp.path().join("owner-custom");
    skill(&custom, "aionui-config");
    repo.upsert_for_user(
        "system_default_user",
        UpsertSkillParams {
            name: "aionui-config",
            description: None,
            path: custom.to_str().unwrap(),
            source: "user",
            enabled: true,
        },
    )
    .await
    .unwrap();
    let listed = list_available_skills_with_repo_for_user(&paths, &repo, "system_default_user")
        .await
        .unwrap();
    assert!(listed.iter().any(|item| item.name == "aionui-config" && item.is_custom));
    assert!(
        listed
            .iter()
            .any(|item| item.name == "openh3-config" && !item.is_custom)
    );
}
