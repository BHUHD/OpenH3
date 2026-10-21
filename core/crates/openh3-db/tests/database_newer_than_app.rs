//! Downgrade detection: opening a database written by a NEWER app version.
//!
//! When `_sqlx_migrations` contains a version this binary's embedded migrator
//! does not know, sqlx fails with `MigrateError::VersionMissing`. Startup must
//! surface the dedicated `database.newer_than_app` stage (Sentry ELECTRON-31Z)
//! instead of the generic `database.migration` one, and must NOT treat the
//! intact-but-newer database as corruption to back up and rebuild.

use openh3_db::{
    DATABASE_NEWER_THAN_APP_STAGE, DatabaseInitOptions, DbError, init_database_staged,
    init_database_staged_with_options, latest_known_migration_version,
};

/// A migration version far above anything this binary will ever ship.
const FUTURE_MIGRATION_VERSION: i64 = 999_999;

async fn seed_future_migration_row(path: &std::path::Path) {
    let db = init_database_staged(path).await.unwrap();
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, installed_on, success, checksum, execution_time)
         VALUES (?, 'from a newer app version', CURRENT_TIMESTAMP, TRUE, x'00', 0)",
    )
    .bind(FUTURE_MIGRATION_VERSION)
    .execute(db.pool())
    .await
    .unwrap();
    db.close().await;
}

#[tokio::test]
async fn newer_database_fails_with_dedicated_stage() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("aionui-backend.db");
    seed_future_migration_row(&path).await;

    let err = init_database_staged(&path).await.expect_err("downgrade must fail");
    assert_eq!(err.stage(), DATABASE_NEWER_THAN_APP_STAGE);

    let source = err.into_source();
    assert_eq!(source.missing_migration_version(), Some(FUTURE_MIGRATION_VERSION));
    assert!(
        matches!(
            &source,
            DbError::Migration(sqlx::migrate::MigrateError::VersionMissing(v)) if *v == FUTURE_MIGRATION_VERSION
        ),
        "unexpected source error: {source}"
    );
}

#[tokio::test]
async fn newer_database_is_not_recovered_as_corruption() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("aionui-backend.db");
    seed_future_migration_row(&path).await;

    // Even with the rebuild flag authorized, an intact newer database must not
    // be backed up and replaced — that would destroy the user's data when the
    // actual fix is upgrading the app.
    let err = init_database_staged_with_options(
        &path,
        DatabaseInitOptions {
            recover_corrupted_database: true,
        },
    )
    .await
    .expect_err("downgrade must fail even with recovery authorized");
    assert_eq!(err.stage(), DATABASE_NEWER_THAN_APP_STAGE);
    assert!(path.exists(), "database file must be left in place");

    let backups: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().contains(".backup."))
        .collect();
    assert!(backups.is_empty(), "no backup/rebuild for a newer database");
}

#[tokio::test]
async fn genuine_migration_failures_keep_generic_stage() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("aionui-backend.db");

    // Tamper with an applied migration's checksum: sqlx reports
    // VersionMismatch, which is not a downgrade and must keep the generic
    // migration stage.
    let db = init_database_staged(&path).await.unwrap();
    sqlx::query(
        "UPDATE _sqlx_migrations SET checksum = x'00' WHERE version = (SELECT MAX(version) FROM _sqlx_migrations)",
    )
    .execute(db.pool())
    .await
    .unwrap();
    db.close().await;

    let err = init_database_staged(&path)
        .await
        .expect_err("checksum mismatch must fail");
    assert_eq!(err.stage(), "database.migration");
    assert_eq!(err.into_source().missing_migration_version(), None);
}

#[test]
fn latest_known_migration_version_is_present_and_sane() {
    let version = latest_known_migration_version().expect("embedded migrations must not be empty");
    // 037 is the newest migration at the time this test was written; the
    // constant only moves forward.
    assert!(version >= 37, "unexpectedly low migration version: {version}");
    assert!(version < FUTURE_MIGRATION_VERSION);
}

// Historical Windows binaries embedded CRLF SQL while the monorepo embeds LF.
// Build fixtures by executing that SQL, rather than just forging history rows.
async fn build_line_ending_fixture(path: &std::path::Path, through: i64, mixed: bool) {
    use std::borrow::Cow;

    use sqlx::migrate::{Migration, Migrator};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(path).create_if_missing(true))
        .await
        .unwrap();
    sqlx::query("PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON")
        .execute(&pool)
        .await
        .unwrap();
    let full = Migrator::new(std::path::Path::new("migrations")).await.unwrap();
    let migrations = full
        .iter()
        .filter(|m| m.version <= through)
        .map(|m| {
            let lf = m.sql.replace("\r\n", "\n");
            let sql = if mixed && m.version % 2 == 0 {
                lf
            } else {
                lf.replace('\n', "\r\n")
            };
            Migration::new(
                m.version,
                m.description.clone(),
                m.migration_type,
                Cow::Owned(sql),
                m.no_tx,
            )
        })
        .collect::<Vec<_>>();
    let migrator = Migrator {
        migrations: Cow::Owned(migrations),
        ..full
    };
    migrator.run(&pool).await.unwrap();
    for sql in [
        "INSERT OR IGNORE INTO users (id, username, password_hash, jwt_secret, created_at, updated_at) \
         VALUES ('system_default_user', 'admin', '', 'preserved-secret', 1, 1)",
        "UPDATE users SET jwt_secret = 'preserved-secret' WHERE id = 'system_default_user'",
        "INSERT INTO conversations (id, user_id, name, type, extra, created_at, updated_at) \
         VALUES ('eol-upgrade', 'system_default_user', 'Preserved conversation', 'gemini', '{}', 1, 1)",
        "INSERT INTO providers (id, platform, name, base_url, api_key_encrypted, models, created_at, updated_at) \
         VALUES ('eol-provider', 'openai', 'Preserved provider', 'https://example.invalid', 'preserved-ciphertext', '[]', 1, 1)",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    pool.close().await;
}

async fn assert_line_ending_upgrade(through: i64, mixed: bool) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("aionui-backend.db");
    build_line_ending_fixture(&path, through, mixed).await;

    for _ in 0..2 {
        let db = init_database_staged(&path)
            .await
            .expect("equivalent LF/CRLF migration history must open without rebuilding");
        let name: String = sqlx::query_scalar("SELECT name FROM conversations WHERE id = 'eol-upgrade'")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(name, "Preserved conversation");
        let encrypted: String = sqlx::query_scalar("SELECT api_key_encrypted FROM providers WHERE id = 'eol-provider'")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(encrypted, "preserved-ciphertext");
        let secret: String = sqlx::query_scalar("SELECT jwt_secret FROM users WHERE id = 'system_default_user'")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(secret, "preserved-secret");
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 1")
            .fetch_one(db.pool())
            .await
            .unwrap();
        let expected = sqlx::migrate::Migrator::new(std::path::Path::new("migrations"))
            .await
            .unwrap();
        assert_eq!(count, expected.iter().count() as i64);
        for migration in expected.iter() {
            let checksum: Vec<u8> = sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = ?")
                .bind(migration.version)
                .fetch_one(db.pool())
                .await
                .unwrap();
            assert_eq!(checksum, migration.checksum.as_ref(), "migration {}", migration.version);
        }
        db.close().await;
    }
    assert!(
        std::fs::read_dir(dir.path())
            .unwrap()
            .all(|entry| { !entry.unwrap().file_name().to_string_lossy().contains(".backup.") })
    );
}

#[tokio::test]
async fn crlf_migration_history_preserves_data_on_upgrade_and_reopen() {
    assert_line_ending_upgrade(i64::MAX, false).await;
}

#[tokio::test]
async fn crlf_migration_history_applies_pending_migrations() {
    assert_line_ending_upgrade(28, false).await;
}

#[tokio::test]
async fn mixed_line_ending_migration_history_preserves_data() {
    assert_line_ending_upgrade(i64::MAX, true).await;
}

#[tokio::test]
async fn unknown_initial_migration_checksum_is_rejected_and_preserved() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("aionui-backend.db");
    let db = init_database_staged(&path).await.unwrap();
    sqlx::query("UPDATE _sqlx_migrations SET checksum = x'00' WHERE version = 1")
        .execute(db.pool())
        .await
        .unwrap();
    db.close().await;

    let error = init_database_staged(&path)
        .await
        .expect_err("unknown SQL changes must still fail");
    assert!(matches!(
        error.into_source(),
        DbError::Migration(sqlx::migrate::MigrateError::VersionMismatch(1))
    ));
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&path))
        .await
        .unwrap();
    let checksum: Vec<u8> = sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(checksum, vec![0]);
    pool.close().await;
}

#[tokio::test]
async fn dirty_or_newer_crlf_history_is_rejected_without_checksum_updates() {
    for newer in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("aionui-backend.db");
        build_line_ending_fixture(&path, i64::MAX, false).await;
        let options = sqlx::sqlite::SqliteConnectOptions::new().filename(&path);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .unwrap();
        if newer {
            sqlx::query(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
                 VALUES (?, 'newer app', 1, x'00', 0)",
            )
            .bind(FUTURE_MIGRATION_VERSION)
            .execute(&pool)
            .await
            .unwrap();
        } else {
            sqlx::query("UPDATE _sqlx_migrations SET success = 0 WHERE version = 1")
                .execute(&pool)
                .await
                .unwrap();
        }
        let checksums: Vec<(i64, Vec<u8>)> =
            sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .unwrap();
        pool.close().await;

        let error = init_database_staged(&path)
            .await
            .expect_err("invalid history must fail");
        match error.into_source() {
            DbError::Migration(sqlx::migrate::MigrateError::VersionMissing(version)) if newer => {
                assert_eq!(version, FUTURE_MIGRATION_VERSION);
            }
            DbError::Migration(sqlx::migrate::MigrateError::Dirty(version)) if !newer => {
                assert_eq!(version, 1);
            }
            error => panic!("unexpected error: {error}"),
        }
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let unchanged: Vec<(i64, Vec<u8>)> =
            sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(unchanged, checksums);
        pool.close().await;
    }
}
