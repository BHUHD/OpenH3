use super::*;

async fn connected_fixture() -> (MockServer, openh3_db::Database, Arc<CloudAccountService>, String) {
    let fixture = fixture().await;
    Mock::given(path("/api/openh3/login"))
        .respond_with(ok(pending()))
        .mount(&fixture.0)
        .await;
    Mock::given(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&fixture.0)
        .await;
    fixture.2.login(&fixture.3, login()).await.unwrap();
    fixture
}

#[tokio::test]
async fn self_revoke_direct_and_mfa_cancel_only_after_success() {
    for mfa in [false, true] {
        let (server, _, svc, owner) = connected_fixture().await;
        let grant = svc.read(&owner).await.unwrap().unwrap();
        let lifetime = svc.inference_lifetime(&owner, &grant.provider_id).await.unwrap();
        let response = if mfa {
            json!({"state":"verification_required","purpose":"openh3_revoke","flow_token":"synthetic-flow","expires_at":now()+600,"resend_at":0,"methods":["totp"]})
        } else {
            json!({"state":"revoked"})
        };
        Mock::given(path("/api/openh3/revoke"))
            .respond_with(ok(response))
            .mount(&server)
            .await;
        let response = svc
            .revoke_device(
                &owner,
                CloudAccountRevokeDeviceRequest {
                    device_id: grant.credentials.device_id,
                },
            )
            .await
            .unwrap();
        if let CloudAccountRevokeDeviceResponse::VerificationRequired { verification } = response {
            assert!(!*lifetime.borrow());
            Mock::given(path("/api/openh3/auth/verify"))
                .respond_with(ok(json!({"state":"revoked"})))
                .mount(&server)
                .await;
            svc.verify(
                &owner,
                CloudAccountVerifyRequest::Totp {
                    challenge_id: verification.challenge_id,
                    code: "123456".into(),
                },
            )
            .await
            .unwrap();
        }
        assert!(*lifetime.borrow());
    }
}

#[tokio::test]
async fn delayed_old_auth_failure_cannot_cancel_replacement_and_device_binding_is_checked() {
    let (server, db, svc, owner) = connected_fixture().await;
    let old = svc.read(&owner).await.unwrap().unwrap();
    let old_lifetime = svc.inference_lifetime(&owner, &old.provider_id).await.unwrap();
    svc.invalidate_local(&owner, &old.issuer, old.generation, true)
        .await
        .unwrap();
    svc.login(&owner, login()).await.unwrap();
    let new = svc.read(&owner).await.unwrap().unwrap();
    let lifetime = svc.inference_lifetime(&owner, &new.provider_id).await.unwrap();
    assert!(
        svc.invalidate_auth::<()>(&old, Err(CloudAccountError::Authentication))
            .await
            .is_err()
    );
    assert!(*old_lifetime.borrow());
    assert!(!*lifetime.borrow());
    assert!(svc.inference_credentials(&owner, &old.provider_id).await.is_err());
    sqlx::query("UPDATE cloud_accounts SET device_id='replacement-device' WHERE owner=?")
        .bind(&owner)
        .execute(db.pool())
        .await
        .unwrap();
    assert!(svc.inference_lifetime(&owner, &new.provider_id).await.is_err());
    assert!(*lifetime.borrow());
    assert!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .all(|r| !r.url.path().starts_with("/v1/"))
    );
}

#[tokio::test]
async fn logout_cancels_lifetime_before_remote_revocation_and_rejects_old_binding() {
    let (server, _db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    let old = svc.read(&owner).await.unwrap().unwrap();
    let mut lifetime = svc.inference_lifetime(&owner, &old.provider_id).await.unwrap();
    Mock::given(path("/api/openh3/revoke"))
        .respond_with(ok(json!({"state":"revoked"})).set_delay(std::time::Duration::from_secs(3)))
        .mount(&server)
        .await;
    let logout = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.logout(&owner).await }
    });
    tokio::time::timeout(std::time::Duration::from_secs(1), lifetime.changed())
        .await
        .unwrap()
        .unwrap();
    assert!(*lifetime.borrow());
    assert!(
        !logout.is_finished(),
        "local cancellation must precede remote completion"
    );
    assert!(svc.inference_lifetime(&owner, &old.provider_id).await.is_err());
    logout.await.unwrap().unwrap();
}

#[tokio::test]
async fn corrupt_storage_cancels_existing_lifetime() {
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    let old = svc.read(&owner).await.unwrap().unwrap();
    let lifetime = svc.inference_lifetime(&owner, &old.provider_id).await.unwrap();
    sqlx::query("UPDATE cloud_accounts SET encrypted='corrupt' WHERE owner=?")
        .bind(&owner)
        .execute(db.pool())
        .await
        .unwrap();
    assert!(svc.inference_credentials(&owner, &old.provider_id).await.is_err());
    assert!(*lifetime.borrow());
}

#[tokio::test]
async fn local_owners_have_independent_lifetimes() {
    let (server, db, svc, owner) = connected_fixture().await;
    sqlx::query("INSERT INTO users(id,user_type,username,password_hash,status,session_generation,created_at,updated_at) VALUES ('owner-b','local','owner-b','','active',0,1,1)").execute(db.pool()).await.unwrap();
    svc.login("owner-b", login()).await.unwrap();
    let a = svc.read(&owner).await.unwrap().unwrap();
    let b = svc.read("owner-b").await.unwrap().unwrap();
    let life_a = svc.inference_lifetime(&owner, &a.provider_id).await.unwrap();
    let life_b = svc.inference_lifetime("owner-b", &b.provider_id).await.unwrap();
    assert!(svc.inference_credentials("owner-b", &a.provider_id).await.is_err());
    Mock::given(path("/api/openh3/revoke"))
        .respond_with(ok(json!({"state":"revoked"})))
        .mount(&server)
        .await;
    svc.logout(&owner).await.unwrap();
    assert!(*life_a.borrow());
    assert!(!*life_b.borrow());
    assert!(svc.inference_credentials("owner-b", &b.provider_id).await.is_ok());
}

#[tokio::test]
async fn local_logout_is_not_blocked_behind_slow_refresh() {
    let (server, db, svc, owner) = connected_fixture().await;
    let grant = svc.read(&owner).await.unwrap().unwrap();
    let life = svc.inference_lifetime(&owner, &grant.provider_id).await.unwrap();
    let encrypted: String = sqlx::query_scalar("SELECT encrypted FROM cloud_accounts WHERE owner=?")
        .bind(&owner)
        .fetch_one(db.pool())
        .await
        .unwrap();
    let mut stored: Value =
        serde_json::from_str(&openh3_common::decrypt_string(&encrypted, &[7; 32]).unwrap()).unwrap();
    stored["credentials"]["access_expires_at"] = json!(now());
    let encrypted = openh3_common::encrypt_string(&stored.to_string(), &[7; 32]).unwrap();
    sqlx::query("UPDATE cloud_accounts SET encrypted=? WHERE owner=?")
        .bind(encrypted)
        .bind(&owner)
        .execute(db.pool())
        .await
        .unwrap();
    let started = Arc::new(tokio::sync::Notify::new());
    Mock::given(path("/api/openh3/token"))
        .respond_with({
            let started = started.clone();
            move |_: &wiremock::Request| {
                started.notify_one();
                ok(json!({"credentials":creds()})).set_delay(std::time::Duration::from_secs(2))
            }
        })
        .mount(&server)
        .await;
    Mock::given(path("/api/openh3/revoke"))
        .respond_with(ok(json!({"state":"revoked"})))
        .mount(&server)
        .await;
    let refresh = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        let provider = grant.provider_id.clone();
        async move { svc.inference_credentials(&owner, &provider).await.is_err() }
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(1), svc.logout(&owner))
        .await
        .unwrap()
        .unwrap();
    assert!(*life.borrow());
    assert!(!refresh.is_finished());
    assert!(refresh.await.unwrap());
}
