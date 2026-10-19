use std::sync::Arc;

use openh3_ai_agent::{ActiveLeaseRegistry, AgentError, IWorkerTaskManager};
use openh3_api_types::{CreateConversationRequest, WebSocketMessage};
use openh3_common::{AgentKillReason, TimestampMs};
use openh3_conversation::skill_resolver::SkillResolver;
use openh3_conversation::{ConversationError, ConversationService};
use openh3_db::{SqliteConversationRepository, init_database_memory};
use openh3_realtime::EventBroadcaster;
use serde_json::json;

struct NoopBroadcaster;

impl EventBroadcaster for NoopBroadcaster {
    fn broadcast(&self, _event: WebSocketMessage<serde_json::Value>) {}
}

struct NoopTaskManager;

#[async_trait::async_trait]
impl IWorkerTaskManager for NoopTaskManager {
    fn get_task(&self, _: &str) -> Option<openh3_ai_agent::AgentInstance> {
        None
    }

    async fn get_or_build_task(
        &self,
        _: &str,
        _: openh3_ai_agent::types::BuildTaskOptions,
    ) -> Result<openh3_ai_agent::AgentInstance, AgentError> {
        Err(AgentError::internal("noop"))
    }

    fn kill(&self, _: &str, _: Option<AgentKillReason>) -> Result<(), AgentError> {
        Ok(())
    }

    fn kill_and_wait(
        &self,
        _: &str,
        _: Option<AgentKillReason>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        Box::pin(std::future::ready(()))
    }

    async fn clear(&self) {}

    fn active_count(&self) -> usize {
        0
    }

    fn collect_idle(&self, _: TimestampMs) -> Vec<String> {
        vec![]
    }
}

struct EmptySkillResolver;

#[async_trait::async_trait]
impl SkillResolver for EmptySkillResolver {
    async fn auto_inject_names(&self) -> Vec<String> {
        Vec::new()
    }

    async fn resolve_skills(&self, _names: &[String]) -> Vec<openh3_extension::ResolvedAgentSkill> {
        Vec::new()
    }
}

const USER_ID: &str = "system_default_user";
const OTHER_USER_ID: &str = "other-user";

async fn setup() -> ConversationService {
    let db = init_database_memory().await.unwrap();
    let repo = Arc::new(SqliteConversationRepository::new(db.pool().clone()));
    let agent_metadata_repo: Arc<dyn openh3_db::IAgentMetadataRepository> =
        Arc::new(openh3_db::SqliteAgentMetadataRepository::new(db.pool().clone()));
    let acp_session_repo: Arc<dyn openh3_db::IAcpSessionRepository> =
        Arc::new(openh3_db::SqliteAcpSessionRepository::new(db.pool().clone()));

    ConversationService::new(
        std::env::temp_dir(),
        Arc::new(NoopBroadcaster),
        Arc::new(EmptySkillResolver),
        Arc::new(NoopTaskManager),
        repo,
        agent_metadata_repo,
        acp_session_repo,
    )
}

fn make_create_req() -> CreateConversationRequest {
    serde_json::from_value(json!({
        "type": "acp",
        "extra": { "workspace": std::env::temp_dir().to_string_lossy() }
    }))
    .unwrap()
}

#[tokio::test]
async fn renew_active_lease_records_owned_conversation() {
    let service = setup().await;
    let conversation = service.create(USER_ID, make_create_req()).await.unwrap();
    let active_leases = ActiveLeaseRegistry::new();

    service
        .renew_active_lease(USER_ID, &conversation.id, &active_leases)
        .await
        .unwrap();

    assert!(active_leases.is_active(&conversation.id));
}

#[tokio::test]
async fn renew_active_lease_rejects_other_users_conversation() {
    let service = setup().await;
    let conversation = service.create(USER_ID, make_create_req()).await.unwrap();
    let active_leases = ActiveLeaseRegistry::new();

    let err = service
        .renew_active_lease(OTHER_USER_ID, &conversation.id, &active_leases)
        .await
        .unwrap_err();

    assert!(matches!(err, ConversationError::NotFound { .. }));
    assert!(!active_leases.is_active(&conversation.id));
}

#[tokio::test]
async fn renew_active_lease_rejects_missing_conversation() {
    let service = setup().await;
    let active_leases = ActiveLeaseRegistry::new();

    let err = service
        .renew_active_lease(USER_ID, "missing-conversation", &active_leases)
        .await
        .unwrap_err();

    assert!(matches!(err, ConversationError::NotFound { .. }));
    assert!(!active_leases.is_active("missing-conversation"));
}
