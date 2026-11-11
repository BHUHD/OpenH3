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
    responses: AtomicBool,
    withdrawn: AtomicBool,
    read_once: Mutex<Option<String>>,
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
        if state.responses.load(Ordering::SeqCst) {
            assert_eq!(path, "/v1/responses");
            assert!(body.get("input").is_some());
            assert!(body.get("messages").is_none());
        } else {
            assert_eq!(path, "/v1/chat/completions");
            assert!(body.get("messages").is_some());
            assert!(body.get("input").is_none());
        }
        state.calls.lock().unwrap().push((auth, body));
        state.opened.notify_one();
        if state.silent.load(Ordering::SeqCst) {
            return (
                [("content-type", "text/event-stream")],
                Body::from_stream(Silent(state)),
            )
                .into_response();
        }
        if let Some(file_path) = state.read_once.lock().unwrap().take() {
            let arguments = json!({"file_path":file_path}).to_string();
            let stream = format!(
                "data: {}\n\ndata: {}\n\n",
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"fixture-read","type":"function","function":{"name":"Read","arguments":arguments}}]},"finish_reason":null}]}),
                json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]})
            );
            return ([("content-type", "text/event-stream")], stream).into_response();
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
        "/api/openh3/models" => {
            let protocol = if state.responses.load(Ordering::SeqCst) {
                "Responses"
            } else {
                "ChatCompletions"
            };
            let models = if state.withdrawn.load(Ordering::SeqCst) {
                vec![]
            } else {
                vec![
                    json!({"model_id":"verified-model","display_name":"Verified","provider":"Loopback","purpose":"text","protocol":protocol,"input_capabilities":["text"],"supports_tools":false,"context_limit":4096,"max_output_tokens":64,"compatibility_version":"fixture-v1","evidence":"loopback-only","quotes":[{"group":"default","kind":"request","unit":"USD_per_request","group_ratio":"1","cache_write_mode":"none","version":"v1","quota_per_usd":"500000","per_request":"0"}]}),
                ]
            };
            json!({"status":"available","quote_semantics":"observed_rules_not_frozen_final_charge","models":models})
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
    service.models(owner).await.unwrap();
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
        state
            .responses
            .store(mode == OpenAiApiMode::Responses, Ordering::SeqCst);
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
        // This engine retains its old model and mode. A locally observed
        // withdrawal must block its next invocation before HTTP is emitted.
        state.withdrawn.store(true, Ordering::SeqCst);
        service.models(&owner).await.unwrap();
        let error = manager.send_message(message()).await.unwrap_err();
        assert!(format!("{error:?}").contains("Managed account authentication required"));
        assert_eq!(state.calls.lock().unwrap().len(), 1);
        state.withdrawn.store(false, Ordering::SeqCst);
        service.models(&owner).await.unwrap();
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

struct HistorySkills;
#[async_trait::async_trait]
impl openh3_conversation::skill_resolver::SkillResolver for HistorySkills {
    async fn auto_inject_names(&self) -> Vec<String> {
        vec![]
    }
    async fn resolve_skills(&self, _: &[String]) -> Vec<openh3_conversation::skill_resolver::ResolvedAgentSkill> {
        vec![]
    }
}

#[derive(Default)]
struct HistoryEvents(Mutex<Vec<openh3_api_types::WebSocketMessage<Value>>>);
impl openh3_realtime::EventBroadcaster for HistoryEvents {
    fn broadcast(&self, event: openh3_api_types::WebSocketMessage<Value>) {
        self.0.lock().unwrap().push(event);
    }
}
async fn history_idle(service: &openh3_conversation::ConversationService, id: &str) {
    tokio::time::timeout(Duration::from_secs(15), async {
        while service.runtime_summary_for(id).await.is_processing {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn historical_source_actual_turns_reuse_reload_fork_and_account_replacement() {
    use openh3_ai_agent::{AgentInstance, IWorkerTaskManager, WorkerTaskManagerImpl};
    use openh3_common::HistoricalModelSource;
    use openh3_conversation::{ConversationAgentTurnRequest, ConversationService};
    use openh3_db::{
        ConversationRowUpdate, IConversationRepository, SqliteAcpSessionRepository, SqliteAgentMetadataRepository,
        SqliteConversationRepository,
    };
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let state = Arc::new(Gateway::default());
        state
            .responses
            .store(mode == OpenAiApiMode::Responses, Ordering::SeqCst);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new().route("/{*path}", any(gateway)).with_state(state.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let db = init_database_memory().await.unwrap();
        let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
            .fetch_one(db.pool())
            .await
            .unwrap();
        let account = Arc::new(
            CloudAccountService::new(
                Arc::new(SqliteCloudAccountRepository::new(db.pool().clone())),
                [7; 32],
                CloudAccountConfig {
                    enabled: true,
                    endpoint: Some(endpoint.clone()),
                    allow_insecure_loopback: true,
                },
            )
            .unwrap(),
        );
        login(&account, &owner).await;
        let provider: String = sqlx::query_scalar("SELECT provider_id FROM cloud_accounts WHERE owner=?")
            .bind(&owner)
            .fetch_one(db.pool())
            .await
            .unwrap();
        let binding = ManagedProvider::bind(
            Arc::new(AccountCredentials(account.clone())),
            owner.clone(),
            provider.clone(),
            "verified-model".into(),
            mode,
        )
        .await
        .unwrap();
        let source_a = binding.historical_source(&owner).unwrap();
        assert!(binding.historical_source("foreign-owner").is_none());
        let HistoricalModelSource::CloudAccount {
            ref subject,
            ref model,
            ref protocol,
            ..
        } = source_a
        else {
            panic!("managed source required")
        };
        assert_eq!(subject, "actor-0");
        assert_eq!(model, "verified-model");
        assert_eq!(
            protocol,
            if mode == OpenAiApiMode::Responses {
                "responses"
            } else {
                "chat_completions"
            }
        );
        let dir = tempfile::tempdir().unwrap();
        if mode == OpenAiApiMode::ChatCompletions {
            let file = dir.path().join("synthetic-source.txt");
            std::fs::write(&file, "synthetic source fixture").unwrap();
            *state.read_once.lock().unwrap() = Some(file.to_string_lossy().into());
        }
        let manager = Arc::new(
            AionrsAgentManager::new_with_managed_provider(
                "historical-turn".into(),
                dir.path().to_string_lossy().into(),
                config(dir.path(), mode),
                None,
                vec![],
                Some(binding.clone()),
            )
            .await
            .unwrap(),
        );
        let selected = Arc::new(Mutex::new(AgentInstance::Aionrs(manager)));
        let builds = Arc::new(AtomicUsize::new(0));
        let paused = Arc::new(AtomicBool::new(false));
        let build_opened = Arc::new(Notify::new());
        let build_release = Arc::new(Notify::new());
        let tasks: Arc<dyn IWorkerTaskManager> = Arc::new(WorkerTaskManagerImpl::new(Arc::new({
            let selected = selected.clone();
            let builds = builds.clone();
            let paused = paused.clone();
            let build_opened = build_opened.clone();
            let build_release = build_release.clone();
            move |_options| {
                builds.fetch_add(1, Ordering::SeqCst);
                let agent = selected.lock().unwrap().clone();
                let paused = paused.load(Ordering::SeqCst);
                let build_opened = build_opened.clone();
                let build_release = build_release.clone();
                Box::pin(async move {
                    if paused {
                        build_opened.notify_one();
                        build_release.notified().await;
                    }
                    Ok(agent)
                })
            }
        })));
        let events = Arc::new(HistoryEvents::default());
        let repo = Arc::new(SqliteConversationRepository::new(db.pool().clone()));
        let make_service = || {
            ConversationService::new(
                dir.path().into(),
                events.clone(),
                Arc::new(HistorySkills),
                tasks.clone(),
                repo.clone(),
                Arc::new(SqliteAgentMetadataRepository::new(db.pool().clone())),
                Arc::new(SqliteAcpSessionRepository::new(db.pool().clone())),
            )
        };
        let service = make_service();
        // Mutable selection intentionally disagrees with the actual prebuilt binding.
        let conv=service.create(&owner,serde_json::from_value(json!({"type":"aionrs","name":"History","extra":{"workspace":dir.path()},"model":{"provider_id":"unrelated-selection","model":"ui-only-model","use_model":null}})).unwrap()).await.unwrap();
        let sent = service
            .send_message(
                &owner,
                &conv.id,
                serde_json::from_value(json!({"content":"Reply OK","model_source":{"subject":"forged"}})).unwrap(),
                &tasks,
            )
            .await
            .unwrap();
        history_idle(&service, &conv.id).await;
        let first = service.get_message(&owner, &conv.id, &sent.msg_id).await.unwrap();
        assert_eq!(first.model_source.as_ref(), Some(&source_a));
        assert!(
            service
                .get_message("foreign-owner", &conv.id, &sent.msg_id)
                .await
                .is_err()
        );
        repo.update(
            &owner,
            &conv.id,
            &ConversationRowUpdate {
                model: Some(Some(
                    json!({"provider_id":"mutable-b","model":"mutable-model-b"}).to_string(),
                )),
                extra: Some(json!({"workspace":dir.path(),"model_source":{"subject":"forged"}}).to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let turn_request = || ConversationAgentTurnRequest {
            user_id: owner.clone(),
            conversation_id: conv.id.clone(),
            content: "Reply OK again".into(),
            files: vec![],
            inject_skills: vec![],
            required_runtime_mode: None,
            persist_user_message: true,
            user_message_hidden: false,
            on_started: None,
        };
        let outcome = service.run_agent_turn(turn_request()).await.unwrap();
        assert!(matches!(
            outcome.status,
            openh3_conversation::ConversationAgentTurnStatus::Completed
        ));
        assert_eq!(
            builds.load(Ordering::SeqCst),
            1,
            "second turn must reuse actual native binding"
        );
        let before: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT id,model_source FROM messages WHERE conversation_id=? ORDER BY created_at,id")
                .bind(&conv.id)
                .fetch_all(db.pool())
                .await
                .unwrap();
        assert!(before.len() >= 4);
        assert!(
            before
                .iter()
                .all(|(_, source)| source.as_deref() == Some(serde_json::to_string(&source_a).unwrap().as_str())),
            "both normal and internal persisted user rows and assistant rows need source"
        );
        if mode == OpenAiApiMode::ChatCompletions {
            let tools:i64=sqlx::query_scalar("SELECT count(*) FROM messages WHERE conversation_id=? AND type IN ('tool_call','tool_group','acp_tool_call')").bind(&conv.id).fetch_one(db.pool()).await.unwrap();
            assert!(tools > 0, "actual native tool continuation must persist tool output");
            assert!(
                state.calls.lock().unwrap().iter().any(|(_, body)| body["messages"]
                    .as_array()
                    .is_some_and(|messages| messages.iter().any(|message| message["role"] == "tool"))),
                "tool result must reach the follow-up native request"
            );
        }
        // Hold an actual A build across logout/B login; its later publication must not adopt B.
        let delayed_conv = service
            .create(
                &owner,
                serde_json::from_value(json!({"type":"aionrs","name":"Delayed A","extra":{"workspace":dir.path()}}))
                    .unwrap(),
            )
            .await
            .unwrap();
        paused.store(true, Ordering::SeqCst);
        let delayed = service
            .send_message(
                &owner,
                &delayed_conv.id,
                serde_json::from_value(json!({"content":"Delayed A"})).unwrap(),
                &tasks,
            )
            .await
            .unwrap();
        wait(&build_opened).await;
        let delayed_requests_before = state.calls.lock().unwrap().len();
        // Disconnect clears the current account subject/credentials, never message facts.
        let disconnect = tokio::spawn({
            let account = account.clone();
            let owner = owner.clone();
            async move { account.logout(&owner).await }
        });
        wait(&state.revoke_started).await;
        assert!(binding.historical_source(&owner).is_none());
        state.release_revoke.notify_one();
        disconnect.await.unwrap().unwrap();
        let cleared: (Option<String>, Option<String>) =
            sqlx::query_as("SELECT subject,encrypted FROM cloud_accounts WHERE owner=?")
                .bind(&owner)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(cleared, (None, None));
        state.actor.store(1, Ordering::SeqCst);
        login(&account, &owner).await;
        let provider_b: String = sqlx::query_scalar("SELECT provider_id FROM cloud_accounts WHERE owner=?")
            .bind(&owner)
            .fetch_one(db.pool())
            .await
            .unwrap();
        let binding_b = ManagedProvider::bind(
            Arc::new(AccountCredentials(account.clone())),
            owner.clone(),
            provider_b,
            "verified-model".into(),
            mode,
        )
        .await
        .unwrap();
        let source_b = binding_b.historical_source(&owner).unwrap();
        assert_ne!(source_a, source_b);
        build_release.notify_one();
        history_idle(&service, &delayed_conv.id).await;
        paused.store(false, Ordering::SeqCst);
        assert_eq!(state.calls.lock().unwrap().len(), delayed_requests_before);
        assert!(
            service
                .get_message(&owner, &delayed_conv.id, &delayed.msg_id)
                .await
                .unwrap()
                .model_source
                .is_none()
        );
        let requests_before = state.calls.lock().unwrap().len();
        // A cancelled reused binding cannot adopt B, and cannot publish a B source.
        service.run_agent_turn(turn_request()).await.unwrap();
        assert_eq!(state.calls.lock().unwrap().len(), requests_before);
        tasks.kill_and_wait(&conv.id, None).await;
        let manager_b = Arc::new(
            AionrsAgentManager::new_with_managed_provider(
                "historical-turn-b".into(),
                dir.path().to_string_lossy().into(),
                config(dir.path(), mode),
                None,
                vec![],
                Some(binding_b),
            )
            .await
            .unwrap(),
        );
        *selected.lock().unwrap() = AgentInstance::Aionrs(manager_b);
        paused.store(true, Ordering::SeqCst);
        let cancelled = service
            .send_message(
                &owner,
                &conv.id,
                serde_json::from_value(json!({"content":"Never send this"})).unwrap(),
                &tasks,
            )
            .await
            .unwrap();
        wait(&build_opened).await;
        service
            .cancel(&owner, &conv.id, &cancelled.turn_id, &tasks)
            .await
            .unwrap();
        build_release.notify_one();
        history_idle(&service, &conv.id).await;
        assert_eq!(state.calls.lock().unwrap().len(), requests_before);
        assert!(
            service
                .get_message(&owner, &conv.id, &cancelled.msg_id)
                .await
                .unwrap()
                .model_source
                .is_none(),
            "accepted queued but cancelled before send stays unavailable"
        );
        paused.store(false, Ordering::SeqCst);
        if mode == OpenAiApiMode::ChatCompletions {
            *state.read_once.lock().unwrap() = Some(dir.path().join("synthetic-source.txt").to_string_lossy().into());
        }
        service.run_agent_turn(turn_request()).await.unwrap();
        assert!(
            state
                .calls
                .lock()
                .unwrap()
                .iter()
                .skip(requests_before)
                .all(|(auth, _)| auth == "Bearer synthetic-billed-actor-1")
        );
        if mode == OpenAiApiMode::ChatCompletions {
            let tools: Vec<openh3_db::models::MessageRow> =
                sqlx::query_as("SELECT * FROM messages WHERE conversation_id=? AND type='tool_call'")
                    .bind(&conv.id)
                    .fetch_all(db.pool())
                    .await
                    .unwrap();
            assert_eq!(
                tools.len(),
                2,
                "same raw call ID in A and B turns must preserve both records"
            );
            assert_ne!(tools[0].id, tools[1].id);
            assert!(
                tools
                    .iter()
                    .all(|row| serde_json::from_str::<Value>(&row.content).unwrap()["call_id"] == "aionrs-fixture-read")
            );
            let b = tools
                .iter()
                .find(|row| row.model_source.as_deref() == Some(serde_json::to_string(&source_b).unwrap().as_str()))
                .unwrap();
            let mut late_a = b.clone();
            late_a.content = json!({"name":"late A"}).to_string();
            assert!(
                repo.upsert_runtime_message(&owner, &late_a, Some(&source_a))
                    .await
                    .is_err()
            );
            assert_eq!(repo.get_message(&owner, &conv.id, &b.id).await.unwrap().unwrap(), *b);
        }
        let reloaded = make_service();
        let public = serde_json::to_value(reloaded.get_message(&owner, &conv.id, &sent.msg_id).await.unwrap()).unwrap();
        assert_eq!(public["model_source"], serde_json::to_value(&source_a).unwrap());
        assert_eq!(public["content"]["content"], "Reply OK");
        let latest = reloaded
            .list_messages(
                &owner,
                &conv.id,
                openh3_api_types::ListMessagesQuery {
                    limit: Some(1),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(latest.has_more_before);
        let earlier = reloaded
            .list_messages(
                &owner,
                &conv.id,
                openh3_api_types::ListMessagesQuery {
                    limit: Some(200),
                    before: latest.oldest_cursor,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(
            earlier
                .items
                .iter()
                .any(|row| row.id == sent.msg_id && row.model_source.as_ref() == Some(&source_a))
        );
        let fork = reloaded
            .create(
                &owner,
                serde_json::from_value(json!({"type":"aionrs","name":"Fork","extra":{"workspace":dir.path()}}))
                    .unwrap(),
            )
            .await
            .unwrap();
        let (last_id, last_time): (String, i64) = sqlx::query_as(
            "SELECT id,created_at FROM messages WHERE conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
        )
        .bind(&conv.id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        repo.copy_messages_up_to(&owner, &conv.id, &fork.id, (last_time, &last_id))
            .await
            .unwrap();
        let fork_page = reloaded
            .list_messages(&owner, &fork.id, Default::default())
            .await
            .unwrap();
        assert!(
            fork_page
                .items
                .iter()
                .any(|row| row.model_source.as_ref() == Some(&source_a))
        );
        let after: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT id,model_source FROM messages WHERE conversation_id=? ORDER BY created_at,id")
                .bind(&conv.id)
                .fetch_all(db.pool())
                .await
                .unwrap();
        for original in &before {
            assert!(after.contains(original));
        }
        // Public/raw insertion preserves arbitrary content, but cannot mint a trusted source.
        let mut forged = repo.get_message(&owner, &conv.id, &sent.msg_id).await.unwrap().unwrap();
        forged.id = "forged-raw".into();
        forged.msg_id = Some("forged-raw".into());
        forged.r#type = "tool_group".into();
        forged.content = json!([{"call_id":"raw-forged","model_source":source_b}]).to_string();
        forged.model_source = Some(serde_json::to_string(&source_b).unwrap());
        service.insert_raw_message(&owner, &forged).await.unwrap();
        let raw_public =
            serde_json::to_value(reloaded.get_message(&owner, &conv.id, &forged.id).await.unwrap()).unwrap();
        assert!(raw_public["model_source"].is_null());
        assert_eq!(
            raw_public["content"],
            serde_json::from_str::<Value>(&forged.content).unwrap()
        );
        assert!(
            repo.get_message(&owner, &conv.id, &forged.id)
                .await
                .unwrap()
                .unwrap()
                .model_source
                .is_none()
        );
        let message_rows: Vec<openh3_db::models::MessageRow> =
            sqlx::query_as("SELECT * FROM messages WHERE conversation_id=?")
                .bind(&conv.id)
                .fetch_all(db.pool())
                .await
                .unwrap();
        let live = events.0.lock().unwrap().clone();
        assert!(live.iter().any(|event| event.name == "message.sourceBound"
            && event.data["msg_id"] == sent.msg_id
            && event.data["model_source"] == serde_json::to_value(&source_a).unwrap()));
        assert!(live.iter().any(|event| event.name == "message.stream"
            && event.data["type"] == "content"
            && event.data["model_source"] == serde_json::to_value(&source_a).unwrap()));
        let serialized = serde_json::to_string(&*live).unwrap()
            + &public.to_string()
            + &serde_json::to_string(&fork_page).unwrap()
            + &serde_json::to_string(&message_rows).unwrap();
        for secret in [
            "synthetic-billed",
            "synthetic-password",
            "synthetic-access",
            "synthetic-refresh",
            "api_key",
            "encrypted",
        ] {
            assert!(!serialized.contains(secret), "public source leaked {secret}");
        }
        tasks.clear().await;
        server.abort();
    }
}
