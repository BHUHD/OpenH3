use super::*;
mod http;
mod lifetime_tests;
#[path = "race_tests.rs"]
mod race_tests;
use openh3_api_types::*;
use openh3_db::{ICloudAccountRepository, SqliteCloudAccountRepository, init_database_memory};
use serde_json::{Value, json};
use std::sync::Arc;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

fn capabilities() -> Value {
    json!({"register":true,"login":true,"password_reset":true,"email_verification_required":true,"turnstile_required":false,"turnstile_supported":false,"passkey_supported":false,"mfa_methods":["totp","backup_code"],"password_min_length":8,"password_max_length":128,"password_encryption_required":false,"password_encryption_key_id":"","password_encryption_public_key":"","password_encryption_formats":["v2"]})
}
fn ok(data: Value) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({"success":true,"code":"ok","message":"ok","data":data}))
}
fn creds() -> Value {
    json!({"access_token":"desktop-secret","refresh_token":"refresh-secret","access_expires_at":now()+900,"session_expires_at":now()+300,"device_id":"device-1"})
}
fn account() -> Value {
    json!({"id":"42","username":"alice","display_name":"Alice","email":"alice@example.com"})
}
fn pending() -> Value {
    json!({"state":"pending","account":account(),"credentials":creds()})
}
fn active() -> Value {
    json!({"inference_key":"raw-inference-secret","device_id":"device-1","session_expires_at":now()+2592000})
}
fn login() -> CloudAccountLoginRequest {
    CloudAccountLoginRequest {
        username: "alice".into(),
        password: "not-persisted-password".into(),
    }
}
async fn fixture() -> (MockServer, openh3_db::Database, Arc<CloudAccountService>, String) {
    let server = MockServer::start().await;
    let db = init_database_memory().await.unwrap();
    let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let svc = service_for(&db, &server);
    Mock::given(method("GET"))
        .and(path("/api/openh3/capabilities"))
        .respond_with(ok(capabilities()))
        .mount(&server)
        .await;
    (server, db, svc, owner)
}
fn service_for(db: &openh3_db::Database, server: &MockServer) -> Arc<CloudAccountService> {
    Arc::new(
        CloudAccountService::new(
            Arc::new(SqliteCloudAccountRepository::new(db.pool().clone())),
            [7; 32],
            CloudAccountConfig {
                enabled: true,
                endpoint: Some(server.uri()),
                allow_insecure_loopback: true,
            },
        )
        .unwrap(),
    )
}
async fn mount_login(server: &MockServer) {
    Mock::given(method("POST"))
        .and(path("/api/openh3/login"))
        .respond_with(ok(pending()))
        .expect(1)
        .mount(server)
        .await;
}

#[tokio::test]
async fn pending_persisted_before_activation_encrypted_and_restart_recovers() {
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ResponseTemplate::new(503).set_body_json(
            json!({"success":false,"code":"temporarily_unavailable","message":"hidden raw error","data":null}),
        ))
        .up_to_n_times(1)
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        svc.login(&owner, login()).await.unwrap_err(),
        CloudAccountError::Transport
    );
    let repo = SqliteCloudAccountRepository::new(db.pool().clone());
    let row = repo
        .load(&owner, svc.gateway().unwrap().issuer())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.state, "pending");
    let ciphertext = row.encrypted.unwrap();
    for secret in ["desktop-secret", "refresh-secret", "not-persisted-password"] {
        assert!(!ciphertext.contains(secret));
    }
    let enabled: bool = sqlx::query_scalar("SELECT enabled FROM providers WHERE id=?")
        .bind(row.provider_id.as_ref())
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert!(!enabled);
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .expect(1)
        .mount(&server)
        .await;
    let restarted = service_for(&db, &server);
    let public = restarted.session(&owner).await.unwrap();
    assert!(matches!(public, CloudAccountSessionResponse::Connected { .. }));
    assert!(!serde_json::to_string(&public).unwrap().contains("secret"));
    let s = restarted.read(&owner).await.unwrap().unwrap();
    assert!(s.credentials.session_expires_at > now() + 2500000);
    assert_eq!(s.inference_key.as_deref(), Some("raw-inference-secret"));
}

#[tokio::test]
async fn persistence_failure_never_calls_activate_or_creates_provider() {
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    sqlx::query("CREATE TRIGGER reject_binding BEFORE UPDATE OF encrypted ON cloud_accounts WHEN NEW.encrypted IS NOT NULL BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END").execute(db.pool()).await.unwrap();
    assert_eq!(
        svc.login(&owner, login()).await.unwrap_err(),
        CloudAccountError::Storage
    );
    assert_eq!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .filter(|r| r.url.path().ends_with("activate"))
            .count(),
        0
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM providers WHERE managed_by IS NOT NULL")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn registration_email_bound_to_owner_and_not_a_login() {
    let (server, db, svc, owner) = fixture().await;
    Mock::given(method("POST")).and(path("/api/openh3/email-code")).respond_with(ok(json!({"state":"code_sent","purpose":"openh3_register_email","flow_token":"private-email-flow","expires_at":now()+600,"resend_at":now()+60,"methods":null}))).expect(1).mount(&server).await;
    svc.email_code(
        &owner,
        CloudAccountEmailCodeRequest {
            email: " ALICE@example.com ".into(),
            purpose: CloudAccountEmailCodePurpose::Registration,
        },
    )
    .await
    .unwrap();
    assert!(matches!(
        svc.email_code(
            &owner,
            CloudAccountEmailCodeRequest {
                email: "alice@example.com".into(),
                purpose: CloudAccountEmailCodePurpose::Registration
            }
        )
        .await,
        Err(CloudAccountError::RateLimited { .. })
    ));
    Mock::given(method("POST"))
        .and(path("/api/openh3/register"))
        .respond_with(ok(json!({"state":"registered"})))
        .expect(1)
        .mount(&server)
        .await;
    let req = || CloudAccountRegisterRequest {
        username: "alice".into(),
        email: "alice@example.com".into(),
        password: "password123".into(),
        verification_code: Some("123456".into()),
    };
    assert_eq!(
        svc.register("different-owner", req()).await.unwrap_err(),
        CloudAccountError::Input
    );
    assert!(matches!(
        svc.register(&owner, req()).await.unwrap(),
        CloudAccountRegisterResponse::Registered {}
    ));
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::Disconnected {}
    ));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM providers WHERE managed_by IS NOT NULL")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
    let requests = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(
        &requests
            .iter()
            .find(|r| r.url.path().ends_with("register"))
            .unwrap()
            .body,
    )
    .unwrap();
    let delivery: Value = serde_json::from_slice(
        &requests
            .iter()
            .find(|r| r.url.path().ends_with("email-code"))
            .unwrap()
            .body,
    )
    .unwrap();
    assert_eq!(body["request_id"], delivery["request_id"]);
    assert_eq!(body["flow_token"], "private-email-flow");
}

#[tokio::test]
async fn disabled_unconfigured_and_unsupported_turnstile_do_not_login() {
    let (server, db, _, owner) = fixture().await;
    let repo = Arc::new(SqliteCloudAccountRepository::new(db.pool().clone()));
    let disabled = CloudAccountService::new(repo.clone(), [7; 32], CloudAccountConfig::default()).unwrap();
    assert_eq!(
        disabled.capabilities().await.unwrap().availability,
        CloudAccountAvailability::Disabled
    );
    let unconfigured = CloudAccountService::new(
        repo,
        [7; 32],
        CloudAccountConfig {
            enabled: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(matches!(
        unconfigured.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::Unconfigured {}
    ));
    server.reset().await;
    let mut policy = capabilities();
    policy["turnstile_required"] = json!(true);
    Mock::given(method("GET"))
        .and(path("/api/openh3/capabilities"))
        .respond_with(ok(policy))
        .mount(&server)
        .await;
    let svc = service_for(&db, &server);
    assert_eq!(
        svc.capabilities().await.unwrap().anti_bot,
        CloudAccountAntiBot::UnsupportedRequired
    );
    assert_eq!(svc.login(&owner, login()).await.unwrap_err(), CloudAccountError::Policy);
    assert!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .all(|r| r.method == "GET")
    );
}

#[tokio::test]
async fn refresh_singleflight_and_logout_disable_without_remote_confirmation() {
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .expect(1)
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    let mut stored = svc.read(&owner).await.unwrap().unwrap();
    stored.credentials.access_expires_at = now() - 1;
    let ciphertext = openh3_common::encrypt_string(&serde_json::to_string(&stored).unwrap(), &[7; 32]).unwrap();
    sqlx::query("UPDATE cloud_accounts SET encrypted=? WHERE owner=?")
        .bind(ciphertext)
        .bind(&owner)
        .execute(db.pool())
        .await
        .unwrap();
    let mut rotated = creds();
    rotated["refresh_token"] = json!("rotated-secret");
    rotated["session_expires_at"] = json!(now() + 2592000);
    Mock::given(method("POST"))
        .and(path("/api/openh3/token"))
        .respond_with(ok(json!({"credentials":rotated})))
        .expect(1)
        .mount(&server)
        .await;
    let (a, b) = tokio::join!(svc.session(&owner), svc.session(&owner));
    assert!(a.is_ok() && b.is_ok());
    assert_eq!(
        svc.read(&owner).await.unwrap().unwrap().credentials.refresh_token,
        "rotated-secret"
    );
    assert_eq!(
        svc.logout(&owner).await.unwrap().remote_revocation,
        CloudAccountRemoteRevocation::Unconfirmed
    );
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::Disconnected {}
    ));
    let enabled: bool = sqlx::query_scalar("SELECT enabled FROM providers WHERE id=?")
        .bind(stored.provider_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert!(!enabled);
}

#[tokio::test]
async fn decryption_failure_requires_auth_and_clears_credentials() {
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    sqlx::query("UPDATE cloud_accounts SET encrypted='corrupt'")
        .execute(db.pool())
        .await
        .unwrap();
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::ReauthRequired {}
    ));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM providers WHERE managed_by IS NOT NULL AND enabled=1")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
    assert!(svc.read(&owner).await.unwrap().is_none());
}

#[tokio::test]
async fn replacement_requires_logout_and_fresh_provider_without_touching_byok() {
    let (server, db, svc, owner) = fixture().await;
    sqlx::query("INSERT INTO providers(id,user_id,platform,name,base_url,api_key_encrypted,models,enabled,capabilities,model_settings,is_full_url,created_at,updated_at) VALUES ('byok',?,'new-api','BYOK','https://byok.test','existing-ciphertext','[]',1,'[]','{}',0,1,1)").bind(&owner).execute(db.pool()).await.unwrap();
    Mock::given(method("POST"))
        .and(path("/api/openh3/login"))
        .respond_with(ok(pending()))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .expect(2)
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    let old = svc.read(&owner).await.unwrap().unwrap();
    assert_eq!(
        svc.login(&owner, login()).await.unwrap_err(),
        CloudAccountError::Conflict
    );
    assert_eq!(
        svc.logout(&owner).await.unwrap().remote_revocation,
        CloudAccountRemoteRevocation::Unconfirmed
    );
    svc.login(&owner, login()).await.unwrap();
    let new = svc.read(&owner).await.unwrap().unwrap();
    assert_ne!(old.provider_id, new.provider_id);
    assert!(matches!(
        svc.inference_credentials(&owner, &old.provider_id).await,
        Err(CloudAccountError::Conflict)
    ));
    assert_eq!(
        svc.inference_credentials(&owner, &new.provider_id).await.unwrap().key(),
        "raw-inference-secret"
    );
    let enabled: bool = sqlx::query_scalar("SELECT enabled FROM providers WHERE id=?")
        .bind(&old.provider_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert!(!enabled);
    let (key, enabled, managed): (String, bool, Option<String>) =
        sqlx::query_as("SELECT api_key_encrypted,enabled,managed_by FROM providers WHERE id='byok'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(key, "existing-ciphertext");
    assert!(enabled);
    assert!(managed.is_none());
}

#[tokio::test]
async fn stale_pending_deadline_recovers_activation_and_expired_access_refresh() {
    for expired_access in [false, true] {
        let (server, db, svc, owner) = fixture().await;
        mount_login(&server).await;
        let outage =
            Mock::given(method("POST"))
                .and(path("/api/openh3/activate"))
                .respond_with(ResponseTemplate::new(503).set_body_json(
                    json!({"success":false,"code":"temporarily_unavailable","message":"ok","data":null}),
                ))
                .expect(1)
                .mount_as_scoped(&server)
                .await;
        assert_eq!(
            svc.login(&owner, login()).await.unwrap_err(),
            CloudAccountError::Transport
        );
        drop(outage);
        let mut s = svc.read(&owner).await.unwrap().unwrap();
        s.credentials.session_expires_at = now() - 1;
        if expired_access {
            s.credentials.access_expires_at = now() - 1;
        }
        let encrypted = openh3_common::encrypt_string(&serde_json::to_string(&s).unwrap(), &[7; 32]).unwrap();
        sqlx::query("UPDATE cloud_accounts SET encrypted=?")
            .bind(encrypted)
            .execute(db.pool())
            .await
            .unwrap();
        Mock::given(method("POST"))
            .and(path("/api/openh3/token"))
            .respond_with(ok(json!({"credentials":creds()})))
            .expect(if expired_access { 1 } else { 0 })
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/openh3/activate"))
            .respond_with(ok(active()))
            .expect(1)
            .mount(&server)
            .await;
        let restarted = service_for(&db, &server);
        assert!(matches!(
            restarted.session(&owner).await.unwrap(),
            CloudAccountSessionResponse::Connected { .. }
        ));
        let active = restarted.read(&owner).await.unwrap().unwrap();
        assert_eq!(active.provider_id, s.provider_id);
        assert!(active.credentials.session_expires_at > now() + 2500000);
    }
}

#[tokio::test]
async fn copied_ciphertext_cannot_cross_owner_or_issuer() {
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    sqlx::query("INSERT INTO users(id,user_type,username,password_hash,status,session_generation,created_at,updated_at) VALUES ('owner-b','local','owner-b','','active',0,1,1)").execute(db.pool()).await.unwrap();
    assert!(matches!(
        svc.session("owner-b").await.unwrap(),
        CloudAccountSessionResponse::Disconnected {}
    ));
    sqlx::query("INSERT INTO cloud_accounts(owner,issuer,generation,subject,device_id,provider_id,encrypted,state) SELECT 'owner-b',issuer,generation,subject,device_id,provider_id,encrypted,state FROM cloud_accounts WHERE owner=?").bind(&owner).execute(db.pool()).await.unwrap();
    assert!(matches!(
        svc.session("owner-b").await.unwrap(),
        CloudAccountSessionResponse::ReauthRequired {}
    ));
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::Connected { .. }
    ));
    let repo = SqliteCloudAccountRepository::new(db.pool().clone());
    assert!(repo.load(&owner, "https://other-issuer.test/").await.unwrap().is_none());
}

#[tokio::test]
async fn external_identity_adoption_does_not_transfer_cloud_grants_or_managed_provider() {
    use openh3_db::{ExternalUserProjection, IUserRepository, SqliteUserRepository, UserType};
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    let old = svc.read(&owner).await.unwrap().unwrap();
    sqlx::query("INSERT INTO providers(id,user_id,platform,name,base_url,api_key_encrypted,models,enabled,capabilities,model_settings,is_full_url,created_at,updated_at) VALUES ('adopt-byok',?,'new-api','BYOK','https://byok.test','existing-ciphertext','[]',1,'[]','{}',0,1,1)").bind(&owner).execute(db.pool()).await.unwrap();
    sqlx::query("INSERT INTO conversations(id,user_id,name,type,extra,status,created_at,updated_at) VALUES ('adopt-conversation',?,'Test','acp','{}','pending',1,1)").bind(&owner).execute(db.pool()).await.unwrap();
    let users = SqliteUserRepository::new(db.pool().clone());
    let user = users
        .ensure_external_user(
            UserType::Aionpro,
            "external-1",
            ExternalUserProjection {
                username: Some("external".into()),
                email: None,
                avatar_path: None,
            },
        )
        .await
        .unwrap();
    users.adopt_system_default_data(&user.id).await.unwrap();
    let managed_owner: String = sqlx::query_scalar("SELECT user_id FROM providers WHERE id=?")
        .bind(&old.provider_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(managed_owner, owner);
    let byok_owner: String = sqlx::query_scalar("SELECT user_id FROM providers WHERE id='adopt-byok'")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(byok_owner, user.id);
    let conversation_owner: String =
        sqlx::query_scalar("SELECT user_id FROM conversations WHERE id='adopt-conversation'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(conversation_owner, user.id);
    assert!(matches!(
        svc.inference_credentials(&user.id, &old.provider_id).await,
        Err(CloudAccountError::Authentication)
    ));
    assert_eq!(
        svc.inference_credentials(&owner, &old.provider_id).await.unwrap().key(),
        "raw-inference-secret"
    );
    assert!(svc.read(&user.id).await.unwrap().is_none());
    assert_eq!(
        svc.read(&owner).await.unwrap().unwrap().credentials.refresh_token,
        "refresh-secret"
    );
}

#[tokio::test]
async fn mfa_handles_are_owner_bound_invalidated_by_new_login_and_restart() {
    let (server, db, svc, owner) = fixture().await;
    Mock::given(method("POST")).and(path("/api/openh3/login")).respond_with(ok(json!({"state":"verification_required","purpose":"openh3_login","flow_token":"private-login-flow","expires_at":now()+600,"resend_at":0,"methods":["totp","backup_code"]}))).expect(2).mount(&server).await;
    let CloudAccountSessionResponse::VerificationRequired { verification: first } =
        svc.login(&owner, login()).await.unwrap()
    else {
        panic!()
    };
    assert_eq!(
        svc.verify(
            "another-owner",
            CloudAccountVerifyRequest::Totp {
                challenge_id: first.challenge_id.clone(),
                code: "123456".into()
            }
        )
        .await
        .unwrap_err(),
        CloudAccountError::Input
    );
    let CloudAccountSessionResponse::VerificationRequired { verification: second } =
        svc.login(&owner, login()).await.unwrap()
    else {
        panic!()
    };
    assert_ne!(first.challenge_id, second.challenge_id);
    assert_eq!(
        svc.verify(
            &owner,
            CloudAccountVerifyRequest::Totp {
                challenge_id: first.challenge_id,
                code: "123456".into()
            }
        )
        .await
        .unwrap_err(),
        CloudAccountError::Input
    );
    assert_eq!(
        service_for(&db, &server)
            .verify(
                &owner,
                CloudAccountVerifyRequest::Totp {
                    challenge_id: second.challenge_id.clone(),
                    code: "123456".into()
                }
            )
            .await
            .unwrap_err(),
        CloudAccountError::Input
    );
    Mock::given(method("POST"))
        .and(path("/api/openh3/auth/verify"))
        .respond_with(ok(pending()))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .expect(1)
        .mount(&server)
        .await;
    assert!(matches!(
        svc.verify(
            &owner,
            CloudAccountVerifyRequest::Totp {
                challenge_id: second.challenge_id,
                code: "123456".into()
            }
        )
        .await
        .unwrap(),
        CloudAccountVerifyResponse::Login {
            session: CloudAccountSessionResponse::Connected { .. }
        }
    ));
    let requests = server.received_requests().await.unwrap();
    let verify = requests.iter().find(|r| r.url.path().ends_with("auth/verify")).unwrap();
    let value: Value = serde_json::from_slice(&verify.body).unwrap();
    assert_eq!(value["purpose"], "openh3_login");
    assert_eq!(value["method"], "totp");
    assert!(value.get("password").is_none());
}

#[test]
fn trusted_endpoint_rejects_credentials_query_fragment_and_insecure_remote() {
    for endpoint in [
        "https://user:secret@example.com",
        "https://example.com?token=x",
        "https://example.com/#x",
        "http://example.com",
        "https://example.com/arbitrary",
    ] {
        assert!(matches!(
            client::Gateway::new(&CloudAccountConfig {
                enabled: true,
                endpoint: Some(endpoint.into()),
                allow_insecure_loopback: true
            }),
            Err(CloudAccountError::Policy)
        ));
    }
}

#[tokio::test]
async fn auth_failure_invalidates_but_transport_and_proof_failures_preserve_grant() {
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    let grant = svc.read(&owner).await.unwrap().unwrap();
    let lifetime = svc.inference_lifetime(&owner, &grant.provider_id).await.unwrap();
    for (status, code, expected) in [
        (503, "temporarily_unavailable", CloudAccountError::Transport),
        (401, "verification_failed", CloudAccountError::Verification),
        (401, "untrusted_unknown", CloudAccountError::Protocol),
        (401, "authentication_failed", CloudAccountError::Authentication),
    ] {
        let guard = Mock::given(method("POST"))
            .and(path("/api/openh3/revoke"))
            .respond_with(
                ResponseTemplate::new(status)
                    .set_body_json(json!({"success":false,"code":code,"message":"secret raw text","data":null})),
            )
            .expect(1)
            .mount_as_scoped(&server)
            .await;
        assert_eq!(
            svc.revoke_device(
                &owner,
                CloudAccountRevokeDeviceRequest {
                    device_id: "other-device".into()
                }
            )
            .await
            .unwrap_err(),
            expected
        );
        assert_eq!(
            svc.read(&owner).await.unwrap().is_some(),
            code != "authentication_failed"
        );
        drop(guard);
    }
    assert!(*lifetime.borrow());
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::ReauthRequired {}
    ));
    let enabled: i64 = sqlx::query_scalar("SELECT count(*) FROM providers WHERE enabled=1 AND managed_by IS NOT NULL")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(enabled, 0);
}

#[tokio::test]
async fn redirects_and_transient_mutations_are_never_retried() {
    let (server, _, svc, owner) = fixture().await;
    let target = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/login"))
        .respond_with(ResponseTemplate::new(307).insert_header("Location", format!("{}/stolen", target.uri())))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        svc.login(&owner, login()).await.unwrap_err(),
        CloudAccountError::Protocol
    );
    assert!(target.received_requests().await.unwrap().is_empty());
    for request in server.received_requests().await.unwrap() {
        assert!(!request.headers.contains_key("cookie"));
        assert!(!request.headers.contains_key("origin"));
        assert!(!request.headers.contains_key("referer"));
    }
}

#[tokio::test]
async fn recovery_mfa_reset_cleanup_and_devices_keep_private_fields_private() {
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    let grant = svc.read(&owner).await.unwrap().unwrap();
    let lifetime = svc.inference_lifetime(&owner, &grant.provider_id).await.unwrap();
    Mock::given(method("GET")).and(path("/api/openh3/devices")).respond_with(ok(json!({"devices":[{"device_id":"device-1","current":true,"created_at":1,"last_active_at":2,"expires_at":now()+300,"user_agent":"OpenH3","ip":"private-ip"}]}))).expect(1).mount(&server).await;
    let devices = svc.devices(&owner).await.unwrap();
    assert_eq!(devices.items[0].label, "OpenH3");
    assert!(!serde_json::to_string(&devices).unwrap().contains("private-ip"));
    Mock::given(method("POST")).and(path("/api/openh3/password/reset")).respond_with(ok(json!({"state":"code_sent","purpose":"openh3_recovery_email","flow_token":"recovery-email-secret","expires_at":now()+600,"resend_at":0,"methods":null}))).expect(1).mount(&server).await;
    svc.email_code(
        &owner,
        CloudAccountEmailCodeRequest {
            email: "alice@example.com".into(),
            purpose: CloudAccountEmailCodePurpose::PasswordReset,
        },
    )
    .await
    .unwrap();
    let first=Mock::given(method("POST")).and(path("/api/openh3/auth/verify")).respond_with(ok(json!({"state":"verification_required","purpose":"openh3_recovery_mfa","flow_token":"mfa-secret","expires_at":now()+600,"resend_at":0,"methods":["totp","backup_code"]}))).expect(1).mount_as_scoped(&server).await;
    let reset = svc
        .password_reset(
            &owner,
            CloudAccountPasswordResetRequest {
                email: "alice@example.com".into(),
                code: "123456".into(),
            },
        )
        .await
        .unwrap();
    let CloudAccountPasswordResetResponse::VerificationRequired { verification } = reset else {
        panic!()
    };
    drop(first);
    assert_ne!(verification.challenge_id, "mfa-secret");
    assert_eq!(
        svc.verify(
            &owner,
            CloudAccountVerifyRequest::Password {
                challenge_id: verification.challenge_id.clone(),
                password: "unoffered".into()
            }
        )
        .await
        .unwrap_err(),
        CloudAccountError::Policy
    );
    Mock::given(method("POST")).and(path("/api/openh3/auth/verify")).respond_with(ok(json!({"state":"reset_ready","purpose":"openh3_reset_ready","flow_token":"reset-secret","expires_at":now()+600,"resend_at":0,"methods":null}))).expect(1).mount(&server).await;
    let verified = svc
        .verify(
            &owner,
            CloudAccountVerifyRequest::Totp {
                challenge_id: verification.challenge_id.clone(),
                code: "654321".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        svc.verify(
            &owner,
            CloudAccountVerifyRequest::Totp {
                challenge_id: verification.challenge_id,
                code: "654321".into()
            }
        )
        .await
        .unwrap_err(),
        CloudAccountError::Input
    );
    let CloudAccountVerifyResponse::PasswordResetReady { challenge_id, .. } = verified else {
        panic!()
    };
    assert!(
        service_for(&db, &server)
            .password_reset_complete(
                &owner,
                CloudAccountPasswordResetCompleteRequest {
                    challenge_id: challenge_id.clone(),
                    new_password: "password-new".into()
                }
            )
            .await
            .is_err()
    );
    Mock::given(method("POST"))
        .and(path("/api/openh3/password/reset/complete"))
        .respond_with(ok(json!({"state":"password_reset","session_cleanup_pending":true})))
        .expect(1)
        .mount(&server)
        .await;
    assert!(
        svc.password_reset_complete(
            &owner,
            CloudAccountPasswordResetCompleteRequest {
                challenge_id: challenge_id.clone(),
                new_password: "password-new".into()
            }
        )
        .await
        .unwrap()
        .session_cleanup_pending
    );
    assert!(*lifetime.borrow());
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::ReauthRequired {}
    ));
    assert_eq!(
        svc.password_reset_complete(
            &owner,
            CloudAccountPasswordResetCompleteRequest {
                challenge_id,
                new_password: "password-new".into()
            }
        )
        .await
        .unwrap_err(),
        CloudAccountError::Input
    );
}

struct Exchange {
    path: String,
    respond: tokio::sync::oneshot::Sender<Value>,
}
async fn barrier_gateway() -> (
    String,
    tokio::sync::mpsc::Receiver<Exchange>,
    tokio::task::JoinHandle<()>,
) {
    let (tx, rx) = tokio::sync::mpsc::channel::<Exchange>(16);
    let app = axum::Router::new()
        .fallback(axum::routing::any(
            |axum::extract::State(tx): axum::extract::State<tokio::sync::mpsc::Sender<Exchange>>,
             uri: axum::http::Uri| async move {
                let (respond, response) = tokio::sync::oneshot::channel();
                tx.send(Exchange {
                    path: uri.path().into(),
                    respond,
                })
                .await
                .unwrap();
                axum::Json(json!({"success":true,"code":"ok","message":"ok","data":response.await.unwrap()}))
            },
        ))
        .with_state(tx);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (endpoint, rx, task)
}
async fn exchange(rx: &mut tokio::sync::mpsc::Receiver<Exchange>, path: &str) -> Exchange {
    let e = tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(e.path, format!("/api/openh3/{path}"));
    e
}

#[tokio::test]
async fn delayed_login_activation_and_refresh_cannot_resurrect_logout() {
    for blocked in ["login", "activate", "token"] {
        let (endpoint, mut rx, server) = barrier_gateway().await;
        let db = init_database_memory().await.unwrap();
        let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
            .fetch_one(db.pool())
            .await
            .unwrap();
        let svc = Arc::new(
            CloudAccountService::new(
                Arc::new(SqliteCloudAccountRepository::new(db.pool().clone())),
                [7; 32],
                CloudAccountConfig {
                    enabled: true,
                    endpoint: Some(endpoint),
                    allow_insecure_loopback: true,
                },
            )
            .unwrap(),
        );
        let worker = {
            let svc = svc.clone();
            let owner = owner.clone();
            tokio::spawn(async move { svc.login(&owner, login()).await })
        };
        exchange(&mut rx, "capabilities")
            .await
            .respond
            .send(capabilities())
            .unwrap();
        let mut held = exchange(&mut rx, "login").await;
        let worker = if blocked != "login" {
            held.respond.send(pending()).unwrap();
            held = exchange(&mut rx, "activate").await;
            if blocked == "token" {
                held.respond.send(active()).unwrap();
                worker.await.unwrap().unwrap();
                let mut s = svc.read(&owner).await.unwrap().unwrap();
                s.credentials.access_expires_at = now() - 1;
                let encrypted = openh3_common::encrypt_string(&serde_json::to_string(&s).unwrap(), &[7; 32]).unwrap();
                sqlx::query("UPDATE cloud_accounts SET encrypted=?")
                    .bind(encrypted)
                    .execute(db.pool())
                    .await
                    .unwrap();
                let worker = {
                    let svc = svc.clone();
                    let owner = owner.clone();
                    tokio::spawn(async move { svc.session(&owner).await })
                };
                held = exchange(&mut rx, "token").await;
                worker
            } else {
                worker
            }
        } else {
            worker
        };
        let logout = {
            let svc = svc.clone();
            let owner = owner.clone();
            tokio::spawn(async move { svc.logout(&owner).await })
        };
        if blocked != "login" {
            exchange(&mut rx, "revoke")
                .await
                .respond
                .send(json!({"state":"revoked"}))
                .unwrap();
        }
        logout.await.unwrap().unwrap();
        held.respond
            .send(match blocked {
                "login" => pending(),
                "activate" => active(),
                _ => json!({"credentials":creds()}),
            })
            .unwrap();
        assert_eq!(worker.await.unwrap().unwrap_err(), CloudAccountError::Conflict);
        assert!(matches!(
            svc.session(&owner).await.unwrap(),
            CloudAccountSessionResponse::Disconnected {}
        ));
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM providers WHERE managed_by IS NOT NULL AND enabled=1")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(count, 0);
        server.abort();
    }
}

#[tokio::test]
async fn email_delivery_waiting_for_policy_cannot_restore_handles_after_logout() {
    let (endpoint, mut rx, server) = barrier_gateway().await;
    let db = init_database_memory().await.unwrap();
    let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let svc = Arc::new(
        CloudAccountService::new(
            Arc::new(SqliteCloudAccountRepository::new(db.pool().clone())),
            [7; 32],
            CloudAccountConfig {
                enabled: true,
                endpoint: Some(endpoint),
                allow_insecure_loopback: true,
            },
        )
        .unwrap(),
    );
    let worker = {
        let svc = svc.clone();
        let owner = owner.clone();
        tokio::spawn(async move {
            svc.email_code(
                &owner,
                CloudAccountEmailCodeRequest {
                    email: "alice@example.com".into(),
                    purpose: CloudAccountEmailCodePurpose::Registration,
                },
            )
            .await
        })
    };
    let held = exchange(&mut rx, "capabilities").await;
    assert_eq!(
        svc.logout(&owner).await.unwrap().remote_revocation,
        CloudAccountRemoteRevocation::NotNeeded
    );
    held.respond.send(capabilities()).unwrap();
    assert_eq!(worker.await.unwrap().unwrap_err(), CloudAccountError::Conflict);
    assert!(svc.flows.lock().await.is_empty());
    server.abort();
}

#[tokio::test]
#[ignore = "requires task-local actual Go gateway password fixture via OPENH3_PASSWORD_INTEROP_METADATA"]
async fn rust_password_envelope_decrypts_with_actual_gateway_common() {
    let metadata: Value =
        serde_json::from_slice(&std::fs::read(std::env::var("OPENH3_PASSWORD_INTEROP_METADATA").unwrap()).unwrap())
            .unwrap();
    let mut p: wire::Capabilities = serde_json::from_value(capabilities()).unwrap();
    p.password_encryption_required = true;
    p.password_encryption_key_id = metadata["key_id"].as_str().unwrap().into();
    p.password_encryption_public_key = metadata["public_key"].as_str().unwrap().into();
    for expected in ["ordinary-password".to_owned(), "复杂密码🙂".repeat(20)] {
        let body = password::password_fields(&expected, &p, true).unwrap();
        assert!(body.get("password").is_none());
        let response: Value = reqwest::Client::new()
            .post(format!("{}/verify", metadata["url"].as_str().unwrap()))
            .json(
                &json!({"envelope":body["password_encrypted"],"key_id":body["encryption_key_id"],"expected":expected}),
            )
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response, json!({"accepted":true,"matches":true}));
    }
}

#[tokio::test]
async fn failed_delivery_keeps_request_id_without_a_usable_proof() {
    let (server, _, svc, owner) = fixture().await;
    let request = || CloudAccountEmailCodeRequest {
        email: "alice@example.com".into(),
        purpose: CloudAccountEmailCodePurpose::PasswordReset,
    };
    let failed = Mock::given(method("POST"))
        .and(path("/api/openh3/password/reset"))
        .respond_with(ResponseTemplate::new(503).set_body_json(
            json!({"success":false,"code":"temporarily_unavailable","message":"no delivery","data":null}),
        ))
        .expect(1)
        .mount_as_scoped(&server)
        .await;
    assert_eq!(
        svc.email_code(&owner, request()).await.unwrap_err(),
        CloudAccountError::Transport
    );
    assert_eq!(
        svc.password_reset(
            &owner,
            CloudAccountPasswordResetRequest {
                email: "alice@example.com".into(),
                code: "123456".into()
            }
        )
        .await
        .unwrap_err(),
        CloudAccountError::Input
    );
    drop(failed);
    Mock::given(method("POST")).and(path("/api/openh3/password/reset")).respond_with(ok(json!({"state":"code_sent","purpose":"openh3_recovery_email","flow_token":"flow","expires_at":now()+600,"resend_at":now()+60,"methods":null}))).expect(1).mount(&server).await;
    svc.email_code(&owner, request()).await.unwrap();
    let requests = server.received_requests().await.unwrap();
    let deliveries: Vec<Value> = requests
        .iter()
        .filter(|r| r.url.path() == "/api/openh3/password/reset")
        .map(|r| serde_json::from_slice(&r.body).unwrap())
        .collect();
    assert_eq!(deliveries.len(), 2);
    assert_eq!(deliveries[0]["request_id"], deliveries[1]["request_id"]);
}

#[tokio::test]
async fn final_minute_email_resend_keeps_original_expiry_and_independent_cooldown() {
    let (server, _, svc, owner) = fixture().await;
    let expires_at = now() + 30;
    let resend_at = now() + 60;
    let request = || CloudAccountEmailCodeRequest {
        email: "alice@example.com".into(),
        purpose: CloudAccountEmailCodePurpose::PasswordReset,
    };
    let initial = Mock::given(method("POST"))
        .and(path("/api/openh3/password/reset"))
        .respond_with(ok(json!({"state":"code_sent","purpose":"openh3_recovery_email","flow_token":"old-flow","expires_at":expires_at,"resend_at":0,"methods":null})))
        .expect(1)
        .mount_as_scoped(&server)
        .await;
    svc.email_code(&owner, request()).await.unwrap();
    drop(initial);
    Mock::given(method("POST"))
        .and(path("/api/openh3/password/reset"))
        .respond_with(ok(json!({"state":"code_sent","purpose":"openh3_recovery_email","flow_token":"renewed-flow","expires_at":expires_at,"resend_at":resend_at,"methods":null})))
        .expect(1)
        .mount(&server)
        .await;
    svc.email_code(&owner, request()).await.unwrap();
    {
        let flows = svc.flows.lock().await;
        let stored = flows.values().find(|flow| flow.owner == owner).unwrap();
        assert_eq!(stored.flow.expires_at, expires_at);
        assert_eq!(stored.flow.resend_at, resend_at);
    }
    assert!(matches!(
        svc.email_code(&owner, request()).await,
        Err(CloudAccountError::RateLimited { retry_after: Some(seconds) }) if seconds > 0 && seconds <= 60
    ));
    Mock::given(method("POST"))
        .and(path("/api/openh3/auth/verify"))
        .respond_with(ok(json!({"state":"reset_ready","purpose":"openh3_reset_ready","flow_token":"ready-flow","expires_at":now()+600,"resend_at":0,"methods":null})))
        .expect(1)
        .mount(&server)
        .await;
    assert!(matches!(
        svc.password_reset(
            &owner,
            CloudAccountPasswordResetRequest {
                email: "alice@example.com".into(),
                code: "123456".into(),
            }
        )
        .await
        .unwrap(),
        CloudAccountPasswordResetResponse::Ready { .. }
    ));
    let requests = server.received_requests().await.unwrap();
    let deliveries: Vec<Value> = requests
        .iter()
        .filter(|r| r.url.path() == "/api/openh3/password/reset")
        .map(|r| serde_json::from_slice(&r.body).unwrap())
        .collect();
    assert_eq!(deliveries.len(), 2);
    assert_eq!(deliveries[0]["request_id"], deliveries[1]["request_id"]);
    let verify: Value = serde_json::from_slice(
        &requests
            .iter()
            .find(|r| r.url.path() == "/api/openh3/auth/verify")
            .unwrap()
            .body,
    )
    .unwrap();
    assert_eq!(verify["request_id"], deliveries[1]["request_id"]);
    assert_eq!(verify["flow_token"], "renewed-flow");
    assert_eq!(verify["proof"], "123456");
}

#[tokio::test]
async fn corrupt_grant_logout_clears_locally_and_reports_unconfirmed() {
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    sqlx::query("UPDATE cloud_accounts SET encrypted='corrupt'")
        .execute(db.pool())
        .await
        .unwrap();
    assert_eq!(
        svc.logout(&owner).await.unwrap().remote_revocation,
        CloudAccountRemoteRevocation::Unconfirmed
    );
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::Disconnected {}
    ));
    assert_eq!(
        svc.logout(&owner).await.unwrap().remote_revocation,
        CloudAccountRemoteRevocation::NotNeeded
    );
}

#[tokio::test]
async fn active_absolute_expiry_disables_even_while_access_token_is_fresh() {
    let (server, db, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .expect(1)
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    let mut s = svc.read(&owner).await.unwrap().unwrap();
    s.credentials.session_expires_at = now() - 1;
    let encrypted = openh3_common::encrypt_string(&serde_json::to_string(&s).unwrap(), &[7; 32]).unwrap();
    sqlx::query("UPDATE cloud_accounts SET encrypted=?")
        .bind(encrypted)
        .execute(db.pool())
        .await
        .unwrap();
    let before = server.received_requests().await.unwrap().len();
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::ReauthRequired {}
    ));
    assert_eq!(server.received_requests().await.unwrap().len(), before);
    let enabled: bool = sqlx::query_scalar("SELECT enabled FROM providers WHERE id=?")
        .bind(&s.provider_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert!(!enabled);
    assert!(svc.read(&owner).await.unwrap().is_none());
}

#[tokio::test]
async fn new_recovery_attempt_invalidates_ready_handle_and_expired_handle_is_rejected() {
    let (server, _, svc, owner) = fixture().await;
    Mock::given(method("POST")).and(path("/api/openh3/password/reset")).respond_with(ok(json!({"state":"code_sent","purpose":"openh3_recovery_email","flow_token":"flow","expires_at":now()+600,"resend_at":0,"methods":null}))).expect(2).mount(&server).await;
    let request = || CloudAccountEmailCodeRequest {
        email: "alice@example.com".into(),
        purpose: CloudAccountEmailCodePurpose::PasswordReset,
    };
    svc.email_code(&owner, request()).await.unwrap();
    Mock::given(method("POST")).and(path("/api/openh3/auth/verify")).respond_with(ok(json!({"state":"reset_ready","purpose":"openh3_reset_ready","flow_token":"ready","expires_at":now()+600,"resend_at":0,"methods":null}))).expect(1).mount(&server).await;
    let CloudAccountPasswordResetResponse::Ready { challenge_id, .. } = svc
        .password_reset(
            &owner,
            CloudAccountPasswordResetRequest {
                email: "alice@example.com".into(),
                code: "123456".into(),
            },
        )
        .await
        .unwrap()
    else {
        panic!()
    };
    svc.email_code(&owner, request()).await.unwrap();
    assert_eq!(
        svc.password_reset_complete(
            &owner,
            CloudAccountPasswordResetCompleteRequest {
                challenge_id,
                new_password: "password-new".into()
            }
        )
        .await
        .unwrap_err(),
        CloudAccountError::Input
    );
    for f in svc.flows.lock().await.values_mut() {
        f.flow.expires_at = now() - 1;
    }
    assert_eq!(
        svc.password_reset(
            &owner,
            CloudAccountPasswordResetRequest {
                email: "alice@example.com".into(),
                code: "123456".into()
            }
        )
        .await
        .unwrap_err(),
        CloudAccountError::Input
    );
}

#[tokio::test]
async fn device_password_verification_is_target_bound_and_never_puts_password_in_proof() {
    let (server, _, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    Mock::given(method("POST")).and(path("/api/openh3/revoke")).respond_with(ok(json!({"state":"verification_required","purpose":"openh3_revoke","flow_token":"revoke-secret","expires_at":now()+600,"resend_at":0,"methods":["password"]}))).expect(1).mount(&server).await;
    let CloudAccountRevokeDeviceResponse::VerificationRequired { verification } = svc
        .revoke_device(
            &owner,
            CloudAccountRevokeDeviceRequest {
                device_id: "target-device".into(),
            },
        )
        .await
        .unwrap()
    else {
        panic!()
    };
    Mock::given(method("POST"))
        .and(path("/api/openh3/auth/verify"))
        .respond_with(ok(json!({"state":"revoked"})))
        .expect(1)
        .mount(&server)
        .await;
    assert!(matches!(
        svc.verify(
            &owner,
            CloudAccountVerifyRequest::Password {
                challenge_id: verification.challenge_id,
                password: "reauth-password".into()
            }
        )
        .await
        .unwrap(),
        CloudAccountVerifyResponse::DeviceRevoked {}
    ));
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::Connected { .. }
    ));
    let requests = server.received_requests().await.unwrap();
    let req = requests.iter().find(|r| r.url.path().ends_with("auth/verify")).unwrap();
    let body: Value = serde_json::from_slice(&req.body).unwrap();
    assert_eq!(body["purpose"], "openh3_revoke");
    assert_eq!(body["password"], "reauth-password");
    assert!(body.get("proof").is_none());
    assert_eq!(req.headers.get("authorization").unwrap(), "Bearer desktop-secret");
}
