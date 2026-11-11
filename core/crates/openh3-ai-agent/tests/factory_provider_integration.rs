use std::path::PathBuf;
use std::sync::Arc;

use openh3_ai_agent::AcpSessionSyncService;
use openh3_ai_agent::AcpSkillManager;
use openh3_ai_agent::factory::{AgentFactoryDeps, build_agent_factory};
use openh3_ai_agent::registry::AgentRegistry;
use openh3_ai_agent::session_context::{
    AgentSessionContext, AgentSessionKind, AionrsSessionBuildContext, ConversationContext, WorkspaceContext,
};
use openh3_ai_agent::types::BuildTaskOptions;
use openh3_api_types::AionrsBuildExtra;
use openh3_common::{AgentType, ProviderWithModel, encrypt_string};
use openh3_db::{
    CreateProviderParams, IAcpSessionRepository, IProviderRepository, SqliteAcpSessionRepository,
    SqliteAgentMetadataRepository, SqliteProviderRepository, init_database_memory,
};
use openh3_realtime::BroadcastEventBus;

const TEST_USER_ID: &str = "system_default_user";

fn test_encryption_key() -> [u8; 32] {
    [0xABu8; 32]
}

async fn setup() -> (
    Arc<dyn IProviderRepository>,
    Arc<AgentRegistry>,
    Arc<AcpSessionSyncService>,
    openh3_db::Database,
) {
    let db = init_database_memory().await.unwrap();
    let pool = db.pool().clone();
    let provider_repo: Arc<dyn IProviderRepository> = Arc::new(SqliteProviderRepository::new(pool.clone()));
    let metadata_repo = Arc::new(SqliteAgentMetadataRepository::new(pool.clone()));
    let registry = AgentRegistry::new(metadata_repo);
    registry.hydrate().await.unwrap();
    let session_repo: Arc<dyn IAcpSessionRepository> = Arc::new(SqliteAcpSessionRepository::new(pool));
    let acp_agent_service = AcpSessionSyncService::new(session_repo);
    (provider_repo, registry, acp_agent_service, db)
}

async fn insert_test_provider(repo: &dyn IProviderRepository, id: &str, platform: &str) {
    let key = test_encryption_key();
    let encrypted_api_key = encrypt_string("sk-test-key-12345", &key).unwrap();
    repo.create(CreateProviderParams {
        id: Some(id),
        user_id: TEST_USER_ID,
        platform,
        name: "Test Provider",
        base_url: "https://api.example.com/v1",
        api_key_encrypted: &encrypted_api_key,
        models: r#"["gpt-4o","gpt-5.4"]"#,
        enabled: true,
        capabilities: "[]",
        context_limit: None,
        model_protocols: None,
        model_enabled: None,
        model_health: None,
        model_settings: "{}",
        bedrock_config: None,
        is_full_url: false,
    })
    .await
    .unwrap();
}

fn make_factory(
    provider_repo: Arc<dyn IProviderRepository>,
    agent_registry: Arc<AgentRegistry>,
    acp_agent_service: Arc<AcpSessionSyncService>,
    managed_credentials: Option<Arc<dyn openh3_ai_agent::managed::ManagedCredentialResolver>>,
) -> openh3_ai_agent::task_manager::AgentFactory {
    let tmp = tempfile::TempDir::new().unwrap();
    let skill_paths = Arc::new(openh3_extension::resolve_skill_paths(tmp.path(), tmp.path()));
    // These provider integration tests only build aionrs tasks, which never touch
    // the session spawner. It just has to be constructable (the field is no longer
    // optional now that claude/codex always use the direct-CLI session path).
    let process_registry = Arc::new(openh3_process::FileRegistryStore::new(tmp.path()));
    let session_spawner: Arc<dyn openh3_process::Spawner> = Arc::new(openh3_process::RealSpawner::new(
        process_registry,
        uuid::Uuid::now_v7(),
        openh3_process::local_machine_id(tmp.path()),
    ));
    build_agent_factory(AgentFactoryDeps {
        managed_credentials,
        skill_manager: AcpSkillManager::new(skill_paths),
        provider_repo,
        encryption_key: test_encryption_key(),
        agent_registry,
        acp_agent_service,
        data_dir: PathBuf::from("/tmp/aionrs-test"),
        dump_prompts: false,
        broadcaster: Arc::new(BroadcastEventBus::new(16)),
        backend_binary_path: Arc::new(PathBuf::from("/tmp/aionrs-test/aioncore")),
        mcp_server_repo: None,
        session_spawner,
        // No hook bridge in this test: it exercises provider wiring, not the
        // Antigravity permission path.
        antigravity_hook_base_url: None,
        antigravity_hook_tokens: Arc::new(openh3_ai_agent::antigravity_hook::HookTokenRegistry::new()),
    })
}

fn make_aionrs_options(
    conversation_id: &str,
    workspace: &str,
    model: ProviderWithModel,
    config: AionrsBuildExtra,
) -> BuildTaskOptions {
    BuildTaskOptions::new(AgentSessionContext {
        conversation: ConversationContext {
            conversation_id: conversation_id.to_owned(),
            user_id: "system_default_user".to_owned(),
            agent_type: AgentType::Aionrs,
            source: None,
        },
        workspace: WorkspaceContext {
            path: workspace.to_owned(),
            stored_path: workspace.to_owned(),
            is_custom: !workspace.is_empty(),
        },
        model,
        skills: vec![],
        runtime_env: vec![],
        team: None,
        kind: AgentSessionKind::Aionrs(Box::new(AionrsSessionBuildContext {
            config,
            team: None,
            belongs_to_team: false,
        })),
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn aionrs_factory_returns_error_for_missing_provider() {
    let (provider_repo, agent_registry, acp_agent_service, _db) = setup().await;
    let factory = make_factory(provider_repo, agent_registry, acp_agent_service, None);

    let options = make_aionrs_options(
        "conv-test-1",
        "",
        ProviderWithModel {
            provider_id: "nonexistent-provider".into(),
            model: "gpt-4o".into(),
            use_model: None,
        },
        AionrsBuildExtra::default(),
    );

    let result = factory(options).await;
    match result {
        Ok(_) => panic!("Expected error for missing provider, got Ok"),
        Err(e) => {
            let err_msg = e.to_string();
            assert!(
                err_msg.contains("not found"),
                "Expected 'not found' error, got: {err_msg}"
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn aionrs_factory_resolves_provider_from_db() {
    let (provider_repo, agent_registry, acp_agent_service, _db) = setup().await;
    insert_test_provider(&*provider_repo, "prov-001", "openai").await;
    let factory = make_factory(provider_repo, agent_registry, acp_agent_service, None);

    let options = make_aionrs_options(
        "conv-test-2",
        "/tmp/test-workspace",
        ProviderWithModel {
            provider_id: "prov-001".into(),
            model: "gpt-4o".into(),
            use_model: None,
        },
        AionrsBuildExtra::default(),
    );

    let result = factory(options).await;
    assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn aionrs_factory_respects_use_model_override() {
    let (provider_repo, agent_registry, acp_agent_service, _db) = setup().await;
    insert_test_provider(&*provider_repo, "prov-002", "openai").await;
    let factory = make_factory(provider_repo, agent_registry, acp_agent_service, None);

    let options = make_aionrs_options(
        "conv-test-3",
        "/tmp/test-workspace",
        ProviderWithModel {
            provider_id: "prov-002".into(),
            model: "gpt-4o".into(),
            use_model: Some("gpt-5.4".into()),
        },
        AionrsBuildExtra::default(),
    );

    let result = factory(options).await;
    assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
}

struct AccountResolver {
    endpoint: String,
    lifetime: tokio::sync::watch::Sender<bool>,
    mode: aion_config::compat::OpenAiApiMode,
}
#[async_trait::async_trait]
impl openh3_ai_agent::managed::ManagedCredentialResolver for AccountResolver {
    async fn subscribe(
        &self,
        owner: &str,
        provider: &str,
    ) -> Result<tokio::sync::watch::Receiver<bool>, openh3_ai_agent::managed::ProviderError> {
        assert_eq!(owner, TEST_USER_ID);
        assert_eq!(provider, "managed-factory");
        Ok(self.lifetime.subscribe())
    }
    async fn resolve(
        &self,
        owner: &str,
        provider: &str,
        model: &str,
        mode: aion_config::compat::OpenAiApiMode,
    ) -> Result<openh3_ai_agent::managed::ManagedCredentials, openh3_ai_agent::managed::ProviderError> {
        assert_eq!(owner, TEST_USER_ID);
        assert_eq!(provider, "managed-factory");
        assert_eq!(model, "gpt-5.4");
        assert_eq!(mode, self.mode);
        Ok(openh3_ai_agent::managed::ManagedCredentials::new(
            self.endpoint.clone(),
            "synthetic-managed-factory".into(),
        ))
    }
}

#[tokio::test]
async fn managed_factory_requires_verified_row_and_preserves_actual_selected_model() {
    use aion_config::compat::OpenAiApiMode;
    use axum::{Json, Router, http::HeaderMap, routing::post};
    for (mode, stored_mode, path, stream) in [
        (
            OpenAiApiMode::ChatCompletions,
            "chat_completions",
            "/v1/chat/completions",
            "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"},\"finish_reason\":\"stop\"}]}\n\n",
        ),
        (
            OpenAiApiMode::Responses,
            "responses",
            "/v1/responses",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"OK\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[],\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n",
        ),
    ] {
        let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
        let app = Router::new().route(
            path,
            post({
                let requests = requests.clone();
                move |headers: HeaderMap, Json(body): Json<serde_json::Value>| {
                    requests.lock().unwrap().push((headers, body));
                    async move { ([("content-type", "text/event-stream")], stream) }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let (repo, registry, sessions, db) = setup().await;
        insert_test_provider(&*repo, "managed-factory", "new-api").await;
        sqlx::query("UPDATE providers SET managed_by='cloud_account', api_key_encrypted='must not decrypt', base_url='http://127.0.0.1:1' WHERE id='managed-factory'").execute(db.pool()).await.unwrap();
        let resolver = Arc::new(AccountResolver {
            endpoint,
            lifetime: tokio::sync::watch::channel(false).0,
            mode,
        });
        let factory = make_factory(repo.clone(), registry.clone(), sessions.clone(), Some(resolver));
        let dir = tempfile::tempdir().unwrap();
        let options = |use_model| {
            make_aionrs_options(
                &format!("managed-{}", uuid::Uuid::now_v7()),
                dir.path().to_str().unwrap(),
                ProviderWithModel {
                    provider_id: "managed-factory".into(),
                    model: "gpt-5.4".into(),
                    use_model,
                },
                Default::default(),
            )
        };
        // Even redirecting to the same admitted ID is forbidden for managed rows.
        assert!(
            factory(options(Some("gpt-5.4".into())))
                .await
                .err()
                .unwrap()
                .to_string()
                .contains("selection is unavailable")
        );
        assert!(
            factory(options(None))
                .await
                .err()
                .unwrap()
                .to_string()
                .contains("protocol is unverified")
        );
        sqlx::query("UPDATE providers SET model_settings=? WHERE id='managed-factory'")
            .bind(r#"{"gpt-5.4":{"openaiApiMode":"chat_completions"}}"#)
            .execute(db.pool())
            .await
            .unwrap();
        // Persisted API types use snake_case; a misspelled catalog field must fail closed.
        assert!(factory(options(None)).await.is_err());
        sqlx::query("UPDATE providers SET model_settings=? WHERE id='managed-factory'")
            .bind(serde_json::json!({"gpt-5.4":{"openai_api_mode":stored_mode}}).to_string())
            .execute(db.pool())
            .await
            .unwrap();
        let missing = make_factory(repo, registry, sessions, None);
        assert!(
            missing(options(None))
                .await
                .err()
                .unwrap()
                .to_string()
                .contains("resolver unavailable")
        );
        sqlx::query("UPDATE providers SET models='[]' WHERE id='managed-factory'")
            .execute(db.pool())
            .await
            .unwrap();
        assert!(
            factory(options(None))
                .await
                .err()
                .unwrap()
                .to_string()
                .contains("selection is unavailable")
        );
        assert!(requests.lock().unwrap().is_empty());
        sqlx::query("UPDATE providers SET models='[\"gpt-5.4\"]' WHERE id='managed-factory'")
            .execute(db.pool())
            .await
            .unwrap();
        let agent = factory(options(None)).await.unwrap();
        agent
            .send_message(openh3_ai_agent::types::SendMessageData {
                content: "Reply OK".into(),
                msg_id: "factory-message".into(),
                turn_id: None,
                files: vec![],
                inject_skills: vec![],
            })
            .await
            .unwrap();
        let calls = requests.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0["authorization"], "Bearer synthetic-managed-factory");
        assert_eq!(calls[0].1["model"], "gpt-5.4");
        assert_eq!(calls[0].1.get("input").is_some(), mode == OpenAiApiMode::Responses);
        assert_eq!(
            calls[0].1.get("messages").is_some(),
            mode == OpenAiApiMode::ChatCompletions
        );
        server.abort();
    }
}
