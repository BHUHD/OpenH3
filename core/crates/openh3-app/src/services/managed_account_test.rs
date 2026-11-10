use super::*;
use aion_config::compat::OpenAiApiMode;
use axum::{
    Json, Router,
    body::Body,
    extract::{Request, State},
    response::{IntoResponse, Response},
    routing::any,
};
use openh3_ai_agent::{
    agent_task::IAgentTask,
    managed::{MANAGED_KEY_PLACEHOLDER, ManagedProvider},
    manager::aionrs::AionrsAgentManager,
    types::{AionrsResolvedConfig, SendMessageData},
};
use openh3_api_types::CloudAccountLoginRequest;
use openh3_db::{SqliteCloudAccountRepository, init_database_memory};
use openh3_system::provider::cloud_account::CloudAccountConfig;
use serde_json::{Value, json};
use std::{
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::sync::Notify;

#[derive(Default)]
struct Gateway {
    actor: AtomicUsize,
    silent: AtomicBool,
    calls: Mutex<Vec<(String, Value)>>,
    refreshes: AtomicUsize,
    opened: Notify,
    closed: Notify,
    revoke_started: Notify,
    release_revoke: Notify,
}
struct Silent(Arc<Gateway>);
impl futures_util::Stream for Silent {
    type Item = Result<axum::body::Bytes, std::io::Error>;
    fn poll_next(
        self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::task::Poll::Pending
    }
}
impl Drop for Silent {
    fn drop(&mut self) {
        self.0.closed.notify_one();
    }
}
fn timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
fn credentials() -> Value {
    json!({"access_token":"synthetic-access","refresh_token":"synthetic-refresh","access_expires_at":timestamp()+900,"session_expires_at":timestamp()+99999,"device_id":"synthetic-device"})
}
async fn gateway(State(state): State<Arc<Gateway>>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    let auth = request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let bytes = axum::body::to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if path.starts_with("/v1/") {
        state.calls.lock().unwrap().push((auth, body));
        state.opened.notify_one();
        if state.silent.load(Ordering::SeqCst) {
            return (
                [("content-type", "text/event-stream")],
                Body::from_stream(Silent(state)),
            )
                .into_response();
        }
        let result = if path == "/v1/responses" {
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"OK\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[],\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}}\n\n"
        } else {
            "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n"
        };
        return ([("content-type", "text/event-stream")], result).into_response();
    }
    let data = match path.as_str() {
        "/api/openh3/capabilities" => {
            json!({"register":true,"login":true,"password_reset":true,"email_verification_required":false,"turnstile_required":false,"turnstile_supported":false,"passkey_supported":false,"mfa_methods":["totp"],"password_min_length":8,"password_max_length":128,"password_encryption_required":false,"password_encryption_key_id":"","password_encryption_public_key":"","password_encryption_formats":["v2"]})
        }
        "/api/openh3/login" => {
            json!({"state":"pending","account":{"id":format!("actor-{}",state.actor.load(Ordering::SeqCst)),"username":"synthetic","display_name":"Synthetic","email":"fixture@example.test"},"credentials":credentials()})
        }
        "/api/openh3/activate" => {
            json!({"inference_key":format!("synthetic-billed-actor-{}",state.actor.load(Ordering::SeqCst)),"device_id":"synthetic-device","session_expires_at":timestamp()+99999})
        }
        "/api/openh3/token" => {
            state.refreshes.fetch_add(1, Ordering::SeqCst);
            json!({"credentials":credentials()})
        }
        "/api/openh3/revoke" => {
            state.revoke_started.notify_one();
            state.release_revoke.notified().await;
            json!({"state":"revoked"})
        }
        _ => panic!("unexpected fixture route {path}"),
    };
    Json(json!({"success":true,"code":"ok","message":"ok","data":data})).into_response()
}
fn config(dir: &std::path::Path, _mode: OpenAiApiMode) -> AionrsResolvedConfig {
    AionrsResolvedConfig {
        thought_level: None,
        provider: "openai".into(),
        api_key: MANAGED_KEY_PLACEHOLDER.into(),
        model: "verified-model".into(),
        base_url: Some("http://127.0.0.1:1".into()),
        system_prompt: None,
        max_tokens: None,
        max_turns: None,
        max_tool_call_malformed_turns: None,
        max_tool_call_failure_turns: None,
        compat_overrides: Default::default(),
        session_directory: dir.join("sessions"),
        session_mode: None,
        skills: vec![],
        extra_mcp_servers: Default::default(),
        bedrock_config: None,
        runtime_env: vec![],
        prompt_dump_dir: None,
    }
}
fn message() -> SendMessageData {
    SendMessageData {
        content: "Reply OK".into(),
        msg_id: "synthetic-message".into(),
        turn_id: None,
        files: vec![],
        inject_skills: vec![],
    }
}
async fn login(service: &CloudAccountService, owner: &str) {
    service
        .login(
            owner,
            CloudAccountLoginRequest {
                username: "synthetic".into(),
                password: "synthetic-password".into(),
            },
        )
        .await
        .unwrap();
}
async fn wait(notify: &Notify) {
    tokio::time::timeout(Duration::from_secs(5), notify.notified())
        .await
        .unwrap();
}

#[tokio::test]
async fn real_account_refresh_logout_closes_silent_socket_before_revoke_and_never_adopts_replacement() {
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let state = Arc::new(Gateway::default());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new().route("/{*path}", any(gateway)).with_state(state.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let db = init_database_memory().await.unwrap();
        let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
            .fetch_one(db.pool())
            .await
            .unwrap();
        let service = Arc::new(
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
        login(&service, &owner).await;
        let provider: String = sqlx::query_scalar("SELECT provider_id FROM cloud_accounts WHERE owner=?")
            .bind(&owner)
            .fetch_one(db.pool())
            .await
            .unwrap();
        let managed = ManagedProvider::bind(
            Arc::new(AccountCredentials(service.clone())),
            owner.clone(),
            provider.clone(),
            "verified-model".into(),
            mode,
        )
        .await
        .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let cfg = config(dir.path(), mode);
        assert!(!format!("{cfg:?}").contains("synthetic-billed"));
        let manager = Arc::new(
            AionrsAgentManager::new_with_managed_provider(
                "account-integration".into(),
                dir.path().to_string_lossy().into(),
                cfg,
                None,
                vec![],
                Some(managed),
            )
            .await
            .unwrap(),
        );
        manager.send_message(message()).await.unwrap();
        wait(&state.opened).await;
        let encrypted: String = sqlx::query_scalar("SELECT encrypted FROM cloud_accounts WHERE owner=?")
            .bind(&owner)
            .fetch_one(db.pool())
            .await
            .unwrap();
        let mut stored: Value =
            serde_json::from_str(&openh3_common::decrypt_string(&encrypted, &[7; 32]).unwrap()).unwrap();
        stored["credentials"]["access_expires_at"] = json!(timestamp());
        let encrypted = openh3_common::encrypt_string(&stored.to_string(), &[7; 32]).unwrap();
        sqlx::query("UPDATE cloud_accounts SET encrypted=? WHERE owner=?")
            .bind(encrypted)
            .bind(&owner)
            .execute(db.pool())
            .await
            .unwrap();
        manager.send_message(message()).await.unwrap();
        wait(&state.opened).await;
        assert_eq!(state.refreshes.load(Ordering::SeqCst), 1);
        state.silent.store(true, Ordering::SeqCst);
        let cancelled = tokio::spawn({
            let manager = manager.clone();
            async move { manager.send_message(message()).await }
        });
        wait(&state.opened).await;
        manager.cancel().await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), cancelled)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        wait(&state.closed).await;
        let running = tokio::spawn({
            let manager = manager.clone();
            async move { manager.send_message(message()).await }
        });
        wait(&state.opened).await;
        let logout = tokio::spawn({
            let service = service.clone();
            let owner = owner.clone();
            async move { service.logout(&owner).await }
        });
        wait(&state.revoke_started).await;
        wait(&state.closed).await;
        tokio::time::timeout(Duration::from_secs(2), running)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(!logout.is_finished());
        state.actor.store(1, Ordering::SeqCst);
        login(&service, &owner).await;
        state.silent.store(false, Ordering::SeqCst);
        manager.send_message(message()).await.unwrap();
        assert_eq!(state.calls.lock().unwrap().len(), 4);
        assert!(service.inference_credentials(&owner, &provider).await.is_err());
        state.release_revoke.notify_one();
        logout.await.unwrap().unwrap();
        let next: String = sqlx::query_scalar("SELECT provider_id FROM cloud_accounts WHERE owner=?")
            .bind(&owner)
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_ne!(provider, next);
        let managed = ManagedProvider::bind(
            Arc::new(AccountCredentials(service.clone())),
            owner,
            next,
            "verified-model".into(),
            mode,
        )
        .await
        .unwrap();
        let manager = AionrsAgentManager::new_with_managed_provider(
            "replacement".into(),
            dir.path().to_string_lossy().into(),
            config(dir.path(), mode),
            None,
            vec![],
            Some(managed),
        )
        .await
        .unwrap();
        manager.send_message(message()).await.unwrap();
        let calls = state.calls.lock().unwrap();
        assert_eq!(calls.len(), 5);
        for (authorization, body) in &calls[..4] {
            assert_eq!(authorization, "Bearer synthetic-billed-actor-0");
            assert_eq!(body["model"], "verified-model");
        }
        assert_eq!(calls[4].0, "Bearer synthetic-billed-actor-1");
        // Pinned session.rs stores actual histories in sessions/<id>/state.json,
        // separately from the top-level index. Inspect both persisted sessions.
        let mut histories = 0;
        for entry in std::fs::read_dir(dir.path().join("sessions/sessions")).unwrap() {
            let path = entry.unwrap().path().join("state.json");
            let history = std::fs::read_to_string(path).unwrap();
            assert!(history.contains("Reply OK"));
            assert!(!history.contains("synthetic-billed"));
            histories += 1;
        }
        assert_eq!(histories, 2);
        server.abort();
    }
}
