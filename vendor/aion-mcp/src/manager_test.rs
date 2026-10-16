use super::*;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::JsonRpcResponse;
    use async_trait::async_trait;
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::sync::Barrier;

    // -----------------------------------------------------------------------
    // MockTransport: returns pre-configured JSON-RPC responses
    // -----------------------------------------------------------------------

    struct MockTransport {
        /// Responses returned in order for each request call
        responses: Mutex<Vec<serde_json::Value>>,
    }

    impl MockTransport {
        fn new(responses: Vec<serde_json::Value>) -> Self {
            Self {
                responses: Mutex::new(responses),
            }
        }
    }

    #[async_trait]
    impl McpTransport for MockTransport {
        async fn request(&self, _req: &JsonRpcRequest) -> Result<JsonRpcResponse, McpError> {
            let mut guard = self.responses.lock().unwrap();
            let value = if guard.is_empty() { json!(null) } else { guard.remove(0) };
            Ok(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: Some(1),
                result: Some(value),
                error: None,
            })
        }

        async fn notify(&self, _req: &JsonRpcRequest) -> Result<(), McpError> {
            Ok(())
        }

        async fn close(&self) -> Result<(), McpError> {
            Ok(())
        }
    }

    struct ErrorTransport;

    #[async_trait]
    impl McpTransport for ErrorTransport {
        async fn request(&self, _req: &JsonRpcRequest) -> Result<JsonRpcResponse, McpError> {
            Err(McpError::Transport("mock transport error".into()))
        }

        async fn notify(&self, _req: &JsonRpcRequest) -> Result<(), McpError> {
            Ok(())
        }

        async fn close(&self) -> Result<(), McpError> {
            Ok(())
        }
    }

    struct RecordingTransport {
        ids: Arc<Mutex<Vec<u64>>>,
    }

    #[async_trait]
    impl McpTransport for RecordingTransport {
        async fn request(&self, req: &JsonRpcRequest) -> Result<JsonRpcResponse, McpError> {
            self.ids.lock().unwrap().push(req.id.expect("tool calls need an id"));
            Ok(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: req.id,
                result: Some(json!({"content": [{"type": "text", "text": "ok"}]})),
                error: None,
            })
        }

        async fn notify(&self, _req: &JsonRpcRequest) -> Result<(), McpError> {
            Ok(())
        }

        async fn close(&self) -> Result<(), McpError> {
            Ok(())
        }
    }

    struct ConcurrentRecordingTransport {
        ids: Arc<Mutex<Vec<u64>>>,
        barrier: Arc<Barrier>,
    }

    #[async_trait]
    impl McpTransport for ConcurrentRecordingTransport {
        async fn request(&self, req: &JsonRpcRequest) -> Result<JsonRpcResponse, McpError> {
            let id = req.id.expect("tool calls need an id");
            self.ids.lock().unwrap().push(id);
            self.barrier.wait().await;
            Ok(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: Some(id),
                result: Some(json!({"content": [{"type": "text", "text": id.to_string()}]})),
                error: None,
            })
        }

        async fn notify(&self, _req: &JsonRpcRequest) -> Result<(), McpError> {
            Ok(())
        }

        async fn close(&self) -> Result<(), McpError> {
            Ok(())
        }
    }

    // -----------------------------------------------------------------------
    // Test helpers: build McpManager with pre-configured servers
    // -----------------------------------------------------------------------

    fn make_manager_with_servers(entries: Vec<(&str, bool, Box<dyn McpTransport>)>) -> McpManager {
        McpManager::new_for_test(entries)
    }

    fn delayed_config(delay_ms: u64, startup_timeout_ms: Option<u64>) -> McpServerConfig {
        McpServerConfig {
            transport: TransportType::Stdio,
            command: None,
            args: Some(vec![delay_ms.to_string()]),
            env: None,
            url: None,
            headers: None,
            deferred: None,
            startup_timeout_ms,
        }
    }

    fn successful_test_server(name: &str) -> McpServer {
        McpServer {
            name: name.to_string(),
            transport: Box::new(MockTransport::new(vec![])),
            tools: vec![],
            supports_resources: false,
        }
    }

    async fn delayed_test_connect(name: String, config: McpServerConfig) -> Result<McpServer, McpError> {
        let delay_ms = config
            .args
            .as_ref()
            .and_then(|args| args.first())
            .and_then(|arg| arg.parse::<u64>().ok())
            .unwrap_or(0);
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        Ok(successful_test_server(&name))
    }

    #[tokio::test]
    async fn connect_all_attempts_servers_concurrently() {
        let configs = HashMap::from([
            ("slow-a".to_string(), delayed_config(0, None)),
            ("slow-b".to_string(), delayed_config(0, None)),
            ("slow-c".to_string(), delayed_config(0, None)),
        ]);
        let all_connectors_started = Arc::new(Barrier::new(4));
        let connector_barrier = Arc::clone(&all_connectors_started);

        let manager_task = tokio::spawn(async move {
            McpManager::connect_all_with_connector(&configs, move |name, _config| {
                let connector_barrier = Arc::clone(&connector_barrier);
                async move {
                    connector_barrier.wait().await;
                    Ok(successful_test_server(&name))
                }
            })
            .await
            .unwrap()
        });

        tokio::time::timeout(Duration::from_millis(100), all_connectors_started.wait())
            .await
            .expect("connect_all should start every connector before awaiting the first result");
        let manager = manager_task.await.unwrap();

        assert_eq!(manager.server_names().len(), 3);
    }

    #[tokio::test]
    async fn connect_all_applies_per_server_startup_timeout() {
        let configs = HashMap::from([
            ("fast".to_string(), delayed_config(10, None)),
            ("too-slow".to_string(), delayed_config(200, Some(20))),
        ]);

        let started_at = tokio::time::Instant::now();
        let manager = McpManager::connect_all_with_connector(&configs, delayed_test_connect)
            .await
            .unwrap();
        let elapsed = started_at.elapsed();

        assert_eq!(manager.server_names(), vec!["fast".to_string()]);
        assert!(
            elapsed < Duration::from_millis(150),
            "timed out server should not block connect_all; elapsed={elapsed:?}"
        );
    }

    #[tokio::test]
    async fn connect_all_retains_safe_status_for_failed_and_timed_out_servers() {
        let configs = HashMap::from([
            ("broken".to_string(), delayed_config(0, None)),
            ("slow".to_string(), delayed_config(200, Some(20))),
        ]);
        let manager = McpManager::connect_all_with_connector(&configs, |name, config| async move {
            if name == "broken" {
                return Err(McpError::Transport("secret endpoint and bearer token".into()));
            }
            delayed_test_connect(name, config).await
        })
        .await
        .unwrap();

        let mut statuses = manager.server_statuses();
        statuses.sort_by(|left, right| left.name.cmp(&right.name));
        assert_eq!(statuses.len(), 2);
        assert_eq!(statuses[0].name, "broken");
        assert_eq!(statuses[0].state, McpConnectionState::Failed);
        assert_eq!(statuses[0].reason.as_deref(), Some("transport_error"));
        assert_eq!(statuses[1].name, "slow");
        assert_eq!(statuses[1].state, McpConnectionState::TimedOut);
        assert_eq!(statuses[1].reason.as_deref(), Some("transport_error"));
        assert!(statuses.iter().all(|status| !status.reason.as_deref().unwrap_or_default().contains("secret")));
    }

    #[test]
    fn runtime_status_serialization_is_safe_and_structured() {
        let status = McpServerStatus {
            name: "media".into(),
            state: McpConnectionState::Failed,
            tool_count: 0,
            reason: Some("transport_error".into()),
        };
        let value = serde_json::to_value(&status).expect("status should serialize");
        assert_eq!(value["name"], "media");
        assert_eq!(value["state"], "failed");
        assert_eq!(value["reason"], "transport_error");
        assert!(!value.to_string().contains("token"));
    }

    // -----------------------------------------------------------------------
    // TC-2.x: server_supports_resources [黑盒 + 白盒]
    // -----------------------------------------------------------------------

    #[test]
    fn tc_2_1_server_supports_resources_true() {
        // [黑盒] TC-2.1: server with resources capability returns true
        let manager = make_manager_with_servers(vec![("test-server", true, Box::new(MockTransport::new(vec![])))]);

        assert!(manager.server_supports_resources("test-server"));
    }

    #[test]
    fn tc_2_2_server_supports_resources_false() {
        // [黑盒] TC-2.2: server without resources capability returns false
        let manager = make_manager_with_servers(vec![(
            "no-resources-server",
            false,
            Box::new(MockTransport::new(vec![])),
        )]);

        assert!(!manager.server_supports_resources("no-resources-server"));
    }

    #[test]
    fn tc_2_3_server_supports_resources_unknown_server() {
        // [黑盒] TC-2.3: unknown server name returns false (not error)
        let manager = make_manager_with_servers(vec![]);

        assert!(!manager.server_supports_resources("unknown-server"));
    }

    #[test]
    fn tc_2_wb_supports_resources_from_capabilities_null_value() {
        // [白盒] capabilities.get("resources") = null → supports_resources = false
        // This is tested via the parsed field; we verify via make_manager helper
        let manager = make_manager_with_servers(vec![(
            "server",
            false, // null resources → false per impl: !v.is_null() = false
            Box::new(MockTransport::new(vec![])),
        )]);

        assert!(!manager.server_supports_resources("server"));
    }

    // -----------------------------------------------------------------------
    // TC-2.10/2.11: server_names [黑盒]
    // -----------------------------------------------------------------------

    #[test]
    fn tc_2_10_server_names_returns_all() {
        // [黑盒] TC-2.10: server_names returns all connected server names
        let manager = make_manager_with_servers(vec![
            ("server-a", false, Box::new(MockTransport::new(vec![]))),
            ("server-b", true, Box::new(MockTransport::new(vec![]))),
        ]);

        let mut names = manager.server_names();
        names.sort();
        assert_eq!(names, vec!["server-a", "server-b"]);
    }

    #[test]
    fn tc_2_11_server_names_empty_manager() {
        // [黑盒] TC-2.11: no connected servers → empty vec
        let manager = make_manager_with_servers(vec![]);

        assert!(manager.server_names().is_empty());
    }

    #[test]
    fn tc_2_wb_server_names_returns_owned_strings() {
        // [白盒] Decision 1: server_names() returns Vec<String> not Vec<&str>
        let manager = make_manager_with_servers(vec![("my-server", false, Box::new(MockTransport::new(vec![])))]);

        let names: Vec<String> = manager.server_names();
        assert_eq!(names, vec!["my-server"]);
    }

    // -----------------------------------------------------------------------
    // TC-2.4/2.5: list_resources [黑盒]
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn tc_2_4_list_resources_normal() {
        // [黑盒] TC-2.4: list_resources returns resources from server
        let resources_response = json!({
            "resources": [
                {"uri": "skill://skill-a"},
                {"uri": "skill://skill-b", "name": "Skill B"}
            ]
        });

        let manager = make_manager_with_servers(vec![(
            "test-server",
            true,
            Box::new(MockTransport::new(vec![resources_response])),
        )]);

        let result = manager.list_resources("test-server").await.unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].uri, "skill://skill-a");
        assert_eq!(result[1].uri, "skill://skill-b");
    }

    #[tokio::test]
    async fn tc_2_5_list_resources_empty() {
        // [黑盒] TC-2.5: list_resources returns empty list when server has no resources
        let resources_response = json!({"resources": []});

        let manager = make_manager_with_servers(vec![(
            "test-server",
            true,
            Box::new(MockTransport::new(vec![resources_response])),
        )]);

        let result = manager.list_resources("test-server").await.unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn tc_2_6_list_resources_server_not_found() {
        // [黑盒] TC-2.6: list_resources returns error when server does not exist
        let manager = make_manager_with_servers(vec![]);

        let result = manager.list_resources("nonexistent").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            McpError::ServerNotFound(name) => assert_eq!(name, "nonexistent"),
            e => panic!("expected ServerNotFound, got {:?}", e),
        }
    }

    // -----------------------------------------------------------------------
    // TC-2.7/2.8/2.9: read_resource [黑盒 + 白盒]
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn tc_2_7_read_resource_returns_text() {
        // [黑盒] TC-2.7: read_resource returns text content
        let read_response = json!({
            "contents": [{"uri": "skill://my-skill", "mimeType": "text/plain", "text": "---\ndescription: A skill\n---\n# My Skill\n"}]
        });

        let manager = make_manager_with_servers(vec![(
            "test-server",
            true,
            Box::new(MockTransport::new(vec![read_response])),
        )]);

        let result = manager.read_resource("test-server", "skill://my-skill").await.unwrap();
        assert!(result.contains("description: A skill"));
    }

    #[tokio::test]
    async fn tc_2_8_read_resource_transport_error() {
        // [黑盒] TC-2.8: read_resource returns error when server returns transport error
        let manager = make_manager_with_servers(vec![("test-server", true, Box::new(ErrorTransport))]);

        let result = manager.read_resource("test-server", "skill://nonexistent").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn tc_2_9_read_resource_server_not_found() {
        // [黑盒] TC-2.9: read_resource returns error when server does not exist
        let manager = make_manager_with_servers(vec![]);

        let result = manager.read_resource("nonexistent", "skill://my-skill").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            McpError::ServerNotFound(name) => assert_eq!(name, "nonexistent"),
            e => panic!("expected ServerNotFound, got {:?}", e),
        }
    }

    #[tokio::test]
    async fn call_tool_uses_unique_monotonic_request_ids() {
        let ids = Arc::new(Mutex::new(Vec::new()));
        let manager = make_manager_with_servers(vec![
            (
                "test-server",
                false,
                Box::new(RecordingTransport { ids: Arc::clone(&ids) }),
            ),
        ]);

        manager
            .call_tool("test-server", "first", json!({}))
            .await
            .unwrap();
        manager
            .call_tool("test-server", "second", json!({}))
            .await
            .unwrap();

        assert_eq!(*ids.lock().unwrap(), vec![10, 11]);
    }

    #[tokio::test]
    async fn concurrent_tool_calls_keep_unique_ids_and_match_out_of_order_responses() {
        let ids = Arc::new(Mutex::new(Vec::new()));
        let manager = make_manager_with_servers(vec![
            (
                "test-server",
                false,
                Box::new(ConcurrentRecordingTransport {
                    ids: Arc::clone(&ids),
                    barrier: Arc::new(Barrier::new(2)),
                }),
            ),
        ]);

        let (first, second) = tokio::join!(
            manager.call_tool("test-server", "first", json!({})),
            manager.call_tool("test-server", "second", json!({})),
        );

        let mut observed_ids = ids.lock().unwrap().clone();
        observed_ids.sort_unstable();
        assert_eq!(observed_ids, vec![10, 11]);
        let mut responses = vec![first.unwrap(), second.unwrap()];
        responses.sort();
        assert_eq!(responses, vec!["10", "11"]);
    }

    #[tokio::test]
    async fn tc_2_wb_read_resource_no_text_content_returns_error() {
        // [白盒] Decision 3: find_map returns None when all contents have text=None → error
        let read_response = json!({
            "contents": [{"uri": "skill://binary", "mimeType": "application/octet-stream"}]
        });

        let manager = make_manager_with_servers(vec![(
            "test-server",
            true,
            Box::new(MockTransport::new(vec![read_response])),
        )]);

        let result = manager.read_resource("test-server", "skill://binary").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn tc_2_wb_read_resource_find_map_first_text() {
        // [白盒] Decision 3: find_map returns first content with non-None text
        let read_response = json!({
            "contents": [
                {"uri": "skill://x"},
                {"uri": "skill://x", "text": "actual content"}
            ]
        });

        let manager = make_manager_with_servers(vec![(
            "test-server",
            true,
            Box::new(MockTransport::new(vec![read_response])),
        )]);

        let result = manager.read_resource("test-server", "skill://x").await.unwrap();
        assert_eq!(result, "actual content");
    }

    #[test]
    fn tc_2_wb_next_id_starts_at_10() {
        // [白盒] Decision 4: AtomicU64 counter starts at 10 to avoid conflict with connect_server IDs 1/2
        let manager = make_manager_with_servers(vec![]);
        // next_id is private — we verify by doing two fetch_adds and checking values are 10 and 11
        let id1 = manager.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let id2 = manager.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(id1, 10, "first ID should be 10");
        assert_eq!(id2, 11, "second ID should be 11");
    }
}
