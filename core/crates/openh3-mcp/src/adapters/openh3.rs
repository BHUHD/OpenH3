use std::sync::Arc;

use openh3_common::McpSource;
use openh3_db::IMcpServerRepository;

use crate::adapter::{DetectedServer, McpAgentAdapter};
use crate::error::McpError;
use crate::types::{McpServer, McpServerTransport};

/// MCP Agent adapter for OpenH3 itself.
///
/// Unlike CLI-based adapters, this adapter reads/writes directly to the
/// local database. It is always "installed" since OpenH3 is the host
/// application.
///
/// # Behavior
///
/// - `is_installed()` → always `true`
/// - `detect_existing()` → reads all MCP servers from the DB
/// - `install_server()` → no-op (DB writes are handled by `McpConfigService`)
/// - `remove_server()` → no-op (configuration is managed via the frontend)
pub struct Openh3Adapter {
    repo: Arc<dyn IMcpServerRepository>,
}

impl Openh3Adapter {
    pub fn new(repo: Arc<dyn IMcpServerRepository>) -> Self {
        Self { repo }
    }
}

#[async_trait::async_trait]
impl McpAgentAdapter for Openh3Adapter {
    fn source(&self) -> McpSource {
        McpSource::Aionui
    }

    async fn is_installed(&self) -> Result<bool, McpError> {
        Ok(true)
    }

    async fn detect_existing(&self, user_id: &str) -> Result<Vec<DetectedServer>, McpError> {
        let rows = self.repo.list(user_id).await?;

        let mut servers = Vec::new();
        for row in rows {
            let server = McpServer::from_row(row)?;
            servers.push(DetectedServer {
                name: server.name,
                transport: server.transport,
                importable: true,
                import_skip_reason: None,
            });
        }

        Ok(servers)
    }

    async fn install_server(&self, _name: &str, _transport: &McpServerTransport) -> Result<(), McpError> {
        // No-op: DB writes are handled by McpConfigService.
        // The sync service calls install_server on all adapters, but for
        // OpenH3 the server is already in the DB.
        Ok(())
    }

    async fn remove_server(&self, _name: &str) -> Result<(), McpError> {
        // No-op: configuration is managed via the frontend/REST API.
        // Removing from the DB is done through McpConfigService.delete_server().
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::types::McpServerTransport;
    use openh3_db::models::McpServerRow;

    const TEST_USER_ID: &str = "user-1";

    /// In-memory mock repository for testing.
    struct MockRepo {
        servers: Vec<McpServerRow>,
    }

    impl MockRepo {
        fn new(servers: Vec<McpServerRow>) -> Self {
            Self { servers }
        }
    }

    #[async_trait::async_trait]
    impl IMcpServerRepository for MockRepo {
        async fn list(&self, user_id: &str) -> Result<Vec<McpServerRow>, openh3_db::DbError> {
            Ok(self
                .servers
                .iter()
                .filter(|server| server.user_id == user_id)
                .cloned()
                .collect())
        }

        async fn find_by_id(&self, user_id: &str, id: &str) -> Result<Option<McpServerRow>, openh3_db::DbError> {
            Ok(self
                .servers
                .iter()
                .find(|s| s.user_id == user_id && s.id == id)
                .cloned())
        }

        async fn find_by_name(&self, user_id: &str, name: &str) -> Result<Option<McpServerRow>, openh3_db::DbError> {
            Ok(self
                .servers
                .iter()
                .find(|s| s.user_id == user_id && s.name == name)
                .cloned())
        }

        async fn create(
            &self,
            _params: openh3_db::CreateMcpServerParams<'_>,
        ) -> Result<McpServerRow, openh3_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }

        async fn update(
            &self,
            _user_id: &str,
            _id: &str,
            _params: openh3_db::UpdateMcpServerParams<'_>,
        ) -> Result<McpServerRow, openh3_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }

        async fn delete(&self, _user_id: &str, _id: &str) -> Result<(), openh3_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }

        async fn batch_upsert(
            &self,
            _user_id: &str,
            _servers: &[openh3_db::CreateMcpServerParams<'_>],
        ) -> Result<Vec<McpServerRow>, openh3_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }

        async fn update_status(
            &self,
            _user_id: &str,
            _id: &str,
            _status: &str,
            _last_connected: Option<openh3_common::TimestampMs>,
        ) -> Result<(), openh3_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }

        async fn update_tools(
            &self,
            _user_id: &str,
            _id: &str,
            _tools: Option<&str>,
        ) -> Result<(), openh3_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }
    }

    fn make_row(name: &str, transport_type: &str, transport_config: &str) -> McpServerRow {
        McpServerRow {
            id: format!("mcp_{name}"),
            user_id: "user-1".into(),
            name: name.to_owned(),
            description: None,
            enabled: true,
            transport_type: transport_type.into(),
            transport_config: transport_config.into(),
            tools: None,
            last_test_status: "disconnected".into(),
            last_connected: None,
            original_json: None,
            builtin: false,
            deleted_at: None,
            created_at: 1000,
            updated_at: 1000,
        }
    }

    #[test]
    fn source_is_aionui() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter = Openh3Adapter::new(repo);
        assert_eq!(adapter.source(), McpSource::Aionui);
    }

    #[tokio::test]
    async fn is_always_installed() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter = Openh3Adapter::new(repo);
        assert!(adapter.is_installed().await.unwrap());
    }

    #[tokio::test]
    async fn detect_existing_returns_db_servers() {
        let rows = vec![
            make_row("srv-a", "stdio", r#"{"command":"npx","args":[]}"#),
            make_row("srv-b", "http", r#"{"url":"https://b.com/mcp","headers":{}}"#),
        ];
        let repo = Arc::new(MockRepo::new(rows));
        let adapter = Openh3Adapter::new(repo);

        let servers = adapter.detect_existing(TEST_USER_ID).await.unwrap();
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "srv-a");
        assert_eq!(servers[1].name, "srv-b");
        assert!(matches!(servers[0].transport, McpServerTransport::Stdio { .. }));
        assert!(matches!(servers[1].transport, McpServerTransport::Http { .. }));
    }

    #[tokio::test]
    async fn detect_existing_empty_db() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter = Openh3Adapter::new(repo);

        let servers = adapter.detect_existing(TEST_USER_ID).await.unwrap();
        assert!(servers.is_empty());
    }

    #[tokio::test]
    async fn install_server_is_noop() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter = Openh3Adapter::new(repo);

        let transport = McpServerTransport::Stdio {
            command: "npx".into(),
            args: vec![],
            env: HashMap::new(),
        };
        // Should succeed without side effects
        adapter.install_server("test", &transport).await.unwrap();
    }

    #[tokio::test]
    async fn remove_server_is_noop() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter = Openh3Adapter::new(repo);

        // Should succeed without side effects
        adapter.remove_server("test").await.unwrap();
    }

    #[tokio::test]
    async fn trait_is_object_safe() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter: Arc<dyn McpAgentAdapter> = Arc::new(Openh3Adapter::new(repo));
        assert_eq!(adapter.source(), McpSource::Aionui);
        assert!(adapter.is_installed().await.unwrap());
    }
}
