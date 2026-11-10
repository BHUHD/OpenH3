use super::cloud_account::*;
use crate::init_database_memory;

#[tokio::test]
async fn association_is_atomic_owner_scoped_and_logout_fences_old_work() {
    let db = init_database_memory().await.unwrap();
    let repo = SqliteCloudAccountRepository::new(db.pool().clone());
    // Use the actual initialized local owner rather than a mock repository.
    let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let generation = repo
        .invalidate(&owner, "https://issuer.test", None, false)
        .await
        .unwrap();
    let pending = SaveCloudAccount {
        owner: &owner,
        issuer: "https://issuer.test",
        generation,
        subject: "subject-a",
        device_id: "device-a",
        provider_id: "fresh-provider",
        encrypted: "sealed",
        state: "pending",
    };
    repo.save_pending(pending).await.unwrap();
    assert!(repo.load(&owner, "https://different.test").await.unwrap().is_none());
    assert!(
        repo.load("another-owner", "https://issuer.test")
            .await
            .unwrap()
            .is_none()
    );
    let row = repo.load(&owner, "https://issuer.test").await.unwrap().unwrap();
    repo.invalidate(&owner, "https://issuer.test", None, false)
        .await
        .unwrap();
    assert!(matches!(
        repo.save_active(SaveCloudAccount {
            generation: row.generation,
            state: "active",
            ..pending
        })
        .await,
        Err(crate::DbError::Conflict(_))
    ));
    let enabled: bool = sqlx::query_scalar("SELECT enabled FROM providers WHERE id = 'fresh-provider'")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert!(!enabled);
    assert!(
        repo.load(&owner, "https://issuer.test")
            .await
            .unwrap()
            .unwrap()
            .encrypted
            .is_none()
    );
    assert!(matches!(
        repo.save_pending(SaveCloudAccount {
            provider_id: "rolled-back-provider",
            ..pending
        })
        .await,
        Err(crate::DbError::Conflict(_))
    ));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM providers WHERE id='rolled-back-provider'")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn activation_provider_failure_rolls_back_ciphertext_and_state() {
    let db = init_database_memory().await.unwrap();
    let repo = SqliteCloudAccountRepository::new(db.pool().clone());
    let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let generation = repo
        .invalidate(&owner, "https://issuer.test", None, false)
        .await
        .unwrap();
    let pending = SaveCloudAccount {
        owner: &owner,
        issuer: "https://issuer.test",
        generation,
        subject: "42",
        device_id: "device",
        provider_id: "provider",
        encrypted: "pending-ciphertext",
        state: "pending",
    };
    repo.save_pending(pending).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_enable BEFORE UPDATE OF enabled ON providers WHEN NEW.enabled=1 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").execute(db.pool()).await.unwrap();
    assert!(matches!(
        repo.save_active(SaveCloudAccount {
            encrypted: "active-ciphertext",
            state: "active",
            ..pending
        })
        .await,
        Err(crate::DbError::Query(_))
    ));
    let row = repo.load(&owner, "https://issuer.test").await.unwrap().unwrap();
    assert_eq!(row.state, "pending");
    assert_eq!(row.encrypted.as_deref(), Some("pending-ciphertext"));
}
