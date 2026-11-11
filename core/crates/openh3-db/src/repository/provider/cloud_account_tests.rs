use super::cloud_account::*;
use crate::init_database_memory;

#[tokio::test]
async fn catalog_cas_binds_every_identity_and_rejects_duplicate_ids_atomically() {
    let db = init_database_memory().await.unwrap();
    let repo = SqliteCloudAccountRepository::new(db.pool().clone());
    let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let generation = repo.begin_login(&owner, "https://issuer.test").await.unwrap();
    let pending = SaveCloudAccount {
        owner: &owner,
        issuer: "https://issuer.test",
        generation,
        subject: "42",
        device_id: "device",
        provider_id: "bound",
        encrypted: "sealed",
        state: "pending",
    };
    repo.save_pending(pending).await.unwrap();
    repo.save_active(SaveCloudAccount {
        state: "active",
        ..pending
    })
    .await
    .unwrap();
    let models = vec![
        ("actual-id".into(), "Responses".into(), true),
        ("gpt-4o".into(), "ChatCompletions".into(), false),
    ];
    let input = || SaveCloudCatalog {
        owner: &owner,
        issuer: "https://issuer.test",
        generation,
        subject: "42",
        provider_id: "bound",
        models: &models,
    };
    repo.replace_catalog(input()).await.unwrap();
    let settings: String = sqlx::query_scalar("SELECT model_settings FROM providers WHERE id='bound'")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let settings: serde_json::Value = serde_json::from_str(&settings).unwrap();
    assert_eq!(settings["actual-id"]["supports_tools"], true);
    assert_eq!(settings["gpt-4o"]["supports_tools"], false);
    assert_eq!(settings["gpt-4o"]["image_input"], "unsupported");
    for wrong in [
        SaveCloudCatalog {
            owner: "other",
            ..input()
        },
        SaveCloudCatalog {
            issuer: "https://other.test",
            ..input()
        },
        SaveCloudCatalog {
            generation: generation + 1,
            ..input()
        },
        SaveCloudCatalog {
            subject: "43",
            ..input()
        },
        SaveCloudCatalog {
            provider_id: "forged",
            ..input()
        },
    ] {
        assert!(matches!(
            repo.replace_catalog(wrong).await,
            Err(crate::DbError::Conflict(_))
        ));
    }
    let duplicates = vec![
        ("same".into(), "Responses".into(), true),
        ("same".into(), "ChatCompletions".into(), false),
    ];
    assert!(matches!(
        repo.replace_catalog(SaveCloudCatalog {
            models: &duplicates,
            ..input()
        })
        .await,
        Err(crate::DbError::Conflict(_))
    ));
    assert!(repo.model_allowed(input(), "actual-id", "Responses").await.unwrap());
    assert!(
        !repo
            .model_allowed(input(), "actual-id", "ChatCompletions")
            .await
            .unwrap()
    );
    repo.disconnect(&owner, "https://issuer.test").await.unwrap();
    assert!(matches!(
        repo.replace_catalog(input()).await,
        Err(crate::DbError::Conflict(_))
    ));
    assert!(!repo.model_allowed(input(), "actual-id", "Responses").await.unwrap());
}

#[tokio::test]
async fn atomic_login_admission_checks_state_not_only_generation() {
    let db = init_database_memory().await.unwrap();
    let repo = SqliteCloudAccountRepository::new(db.pool().clone());
    let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let issuer = "https://issuer.test";
    assert_eq!(repo.ensure_generation(&owner, issuer).await.unwrap(), 0);
    let first = repo.begin_login(&owner, issuer).await.unwrap();
    let latest = repo.begin_login(&owner, issuer).await.unwrap();
    let pending = SaveCloudAccount {
        owner: &owner,
        issuer,
        generation: first,
        subject: "42",
        device_id: "device",
        provider_id: "provider",
        encrypted: "pending-ciphertext",
        state: "pending",
    };
    assert!(matches!(
        repo.save_pending(pending).await,
        Err(crate::DbError::Conflict(_))
    ));
    let pending = SaveCloudAccount {
        generation: latest,
        ..pending
    };
    repo.save_pending(pending).await.unwrap();
    for state in ["pending", "active"] {
        if state == "active" {
            repo.save_active(SaveCloudAccount {
                state,
                encrypted: "active-ciphertext",
                ..pending
            })
            .await
            .unwrap();
        }
        assert_eq!(repo.ensure_generation(&owner, issuer).await.unwrap(), latest);
        assert!(matches!(
            repo.begin_login(&owner, issuer).await,
            Err(crate::DbError::Conflict(_))
        ));
        let row = repo.load(&owner, issuer).await.unwrap().unwrap();
        assert_eq!(row.generation, latest);
        assert_eq!(row.state, state);
        assert_eq!(row.provider_id.as_deref(), Some("provider"));
        assert_eq!(
            row.encrypted.as_deref(),
            Some(if state == "active" {
                "active-ciphertext"
            } else {
                "pending-ciphertext"
            })
        );
    }
    let reauth = repo.invalidate(&owner, issuer, Some(latest), true).await.unwrap();
    assert_eq!(repo.ensure_generation(&owner, issuer).await.unwrap(), reauth);
    assert_eq!(repo.begin_login(&owner, issuer).await.unwrap(), reauth + 1);
}

#[tokio::test]
async fn atomic_disconnect_captures_committed_grant_or_fences_later_persistence() {
    for persist_first in [false, true] {
        let db = init_database_memory().await.unwrap();
        let repo = SqliteCloudAccountRepository::new(db.pool().clone());
        let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
            .fetch_one(db.pool())
            .await
            .unwrap();
        let issuer = "https://issuer.test";
        let generation = repo.begin_login(&owner, issuer).await.unwrap();
        let pending = SaveCloudAccount {
            owner: &owner,
            issuer,
            generation,
            subject: "42",
            device_id: "device",
            provider_id: "provider",
            encrypted: "ciphertext-for-revocation",
            state: "pending",
        };
        if persist_first {
            repo.save_pending(pending).await.unwrap();
        }
        let removed = repo.disconnect(&owner, issuer).await.unwrap();
        assert_eq!(removed.generation, generation);
        if persist_first {
            assert_eq!(removed.encrypted.as_deref(), Some("ciphertext-for-revocation"));
            assert_eq!(removed.device_id.as_deref(), Some("device"));
            assert_eq!(removed.state, "pending");
            let enabled: bool = sqlx::query_scalar("SELECT enabled FROM providers WHERE id='provider'")
                .fetch_one(db.pool())
                .await
                .unwrap();
            assert!(!enabled);
        } else {
            assert!(removed.encrypted.is_none());
            assert_eq!(removed.state, "disconnected");
            assert!(matches!(
                repo.save_pending(pending).await,
                Err(crate::DbError::Conflict(_))
            ));
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM providers WHERE id='provider'")
                .fetch_one(db.pool())
                .await
                .unwrap();
            assert_eq!(count, 0);
        }
        let current = repo.load(&owner, issuer).await.unwrap().unwrap();
        assert_eq!(current.generation, generation + 1);
        assert!(current.encrypted.is_none());
        assert_eq!(repo.ensure_generation(&owner, issuer).await.unwrap(), generation + 1);
    }
}

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
