use super::*;
use crate::{
    agent_task::IAgentTask,
    manager::aionrs::AionrsAgentManager,
    types::{AionrsResolvedConfig, SendMessageData},
};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

#[path = "children_test.rs"]
mod children_test;

#[derive(Clone, Default)]
struct Logs(Arc<std::sync::Mutex<Vec<u8>>>);
impl std::io::Write for Logs {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

struct Resolver {
    endpoint: String,
    lifetime: watch::Sender<bool>,
    resolutions: AtomicUsize,
}

struct BlockedResolver {
    lifetime: watch::Sender<bool>,
    entered: tokio::sync::Notify,
}

#[tokio::test]
async fn forged_request_model_is_rejected_before_credential_resolution_or_http() {
    let resolver = Arc::new(Resolver {
        endpoint: "http://127.0.0.1:1".into(),
        lifetime: watch::channel(false).0,
        resolutions: AtomicUsize::new(0),
    });
    let provider = ManagedProvider::bind(
        resolver.clone(),
        "owner".into(),
        "original-provider".into(),
        "verified".into(),
        OpenAiApiMode::Responses,
    )
    .await
    .unwrap();
    let request = LlmRequest {
        model: "forged".into(),
        system: String::new(),
        messages: vec![],
        tools: vec![],
        max_tokens: None,
        thinking: None,
        reasoning_effort: None,
    };
    let error = provider.stream(&request).await.unwrap_err();
    assert!(matches!(error,ProviderError::Parse(message) if message=="Managed model differs from verified selection"));
    assert_eq!(resolver.resolutions.load(Ordering::SeqCst), 0);
}
#[async_trait::async_trait]
impl ManagedCredentialResolver for BlockedResolver {
    async fn subscribe(&self, _: &str, _: &str) -> Result<watch::Receiver<bool>, ProviderError> {
        Ok(self.lifetime.subscribe())
    }
    async fn resolve(&self, _: &str, _: &str, _: &str, _: OpenAiApiMode) -> Result<ManagedCredentials, ProviderError> {
        self.entered.notify_one();
        std::future::pending().await
    }
}

#[tokio::test]
async fn cancellation_interrupts_shared_provider_credential_resolution() {
    let resolver = Arc::new(BlockedResolver {
        lifetime: watch::channel(false).0,
        entered: tokio::sync::Notify::new(),
    });
    let provider = ManagedProvider::bind(
        resolver.clone(),
        "owner".into(),
        "original-provider".into(),
        "test-model".into(),
        OpenAiApiMode::ChatCompletions,
    )
    .await
    .unwrap();
    let running = tokio::spawn(async move {
        let request = LlmRequest {
            model: "test-model".into(),
            system: String::new(),
            messages: vec![],
            tools: vec![],
            max_tokens: None,
            thinking: None,
            reasoning_effort: None,
        };
        provider.clone().stream(&request).await
    });
    tokio::time::timeout(Duration::from_secs(2), resolver.entered.notified())
        .await
        .unwrap();
    resolver.lifetime.send_replace(true);
    let error = tokio::time::timeout(Duration::from_secs(2), running)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Connection error: Managed account invocation cancelled"
    );
}
#[async_trait::async_trait]
impl ManagedCredentialResolver for Resolver {
    async fn subscribe(&self, owner: &str, provider: &str) -> Result<watch::Receiver<bool>, ProviderError> {
        assert_eq!((owner, provider), ("owner", "original-provider"));
        Ok(self.lifetime.subscribe())
    }
    async fn resolve(
        &self,
        owner: &str,
        provider: &str,
        _: &str,
        _: OpenAiApiMode,
    ) -> Result<ManagedCredentials, ProviderError> {
        assert_eq!((owner, provider), ("owner", "original-provider"));
        let index = self.resolutions.fetch_add(1, Ordering::SeqCst);
        Ok(ManagedCredentials::new(
            self.endpoint.clone(),
            format!("synthetic-actor-{index}"),
        ))
    }
}

fn config(dir: &std::path::Path, mode: OpenAiApiMode) -> AionrsResolvedConfig {
    AionrsResolvedConfig {
        thought_level: None,
        provider: "openai".into(),
        api_key: MANAGED_KEY_PLACEHOLDER.into(),
        model: "test-model".into(),
        base_url: Some("http://127.0.0.1:1".into()),
        system_prompt: None,
        max_tokens: None,
        max_turns: None,
        max_tool_call_malformed_turns: None,
        max_tool_call_failure_turns: None,
        compat_overrides: crate::types::AionrsCompatOverrides {
            openai_api_mode: Some(mode),
            ..Default::default()
        },
        session_directory: dir.join("sessions"),
        session_mode: Some("yolo".into()),
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
        msg_id: "message".into(),
        turn_id: None,
        files: vec![],
        inject_skills: vec![],
    }
}
fn text(mode: OpenAiApiMode, value: &str) -> String {
    let data = if mode == OpenAiApiMode::Responses {
        json!({"type":"response.output_text.delta","delta":value})
    } else {
        json!({"choices":[{"delta":{"content":value},"finish_reason":null}]})
    };
    format!("data: {data}\n\n")
}
fn done(mode: OpenAiApiMode) -> &'static str {
    if mode == OpenAiApiMode::Responses {
        "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[],\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}}\n\n"
    } else {
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
    }
}

fn tool_round(mode: OpenAiApiMode, name: &str, input: Value) -> String {
    if mode == OpenAiApiMode::Responses {
        format!(
            "data: {}\n\n{}",
            json!({"type":"response.output_item.done","item":{"type":"function_call","id":"item-1","call_id":"call-1","name":name,"arguments":input.to_string()}}),
            done(mode)
        )
    } else {
        format!(
            "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":name,"arguments":input.to_string()}}]},"finish_reason":null}]}),
            json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]})
        )
    }
}

#[tokio::test]
async fn managed_tools_and_continuation_resolve_each_request_and_keep_selected_model() {
    use axum::{Json, Router, http::HeaderMap, routing::post};
    let logs = Logs::default();
    let writer = logs.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("fixture.txt");
        std::fs::write(&file, "SYNTHETIC_TOOL_RESULT").unwrap();
        let tool = tool_round(mode, "Read", json!({"file_path": file.to_string_lossy()}));
        let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
        let app = Router::new().route(
            "/{*path}",
            post({
                let requests = requests.clone();
                move |headers: HeaderMap, Json(body): Json<Value>| {
                    let mut requests = requests.lock().unwrap();
                    let first = requests.is_empty();
                    requests.push((headers["authorization"].to_str().unwrap().to_owned(), body));
                    let response = if first {
                        tool.clone()
                    } else {
                        format!("{}{}", text(mode, "OK"), done(mode))
                    };
                    async move { ([("content-type", "text/event-stream")], response) }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let resolver = Arc::new(Resolver {
            endpoint,
            lifetime: watch::channel(false).0,
            resolutions: AtomicUsize::new(0),
        });
        let provider = ManagedProvider::bind(
            resolver.clone(),
            "owner".into(),
            "original-provider".into(),
            "test-model".into(),
            mode,
        )
        .await
        .unwrap();
        let manager = AionrsAgentManager::new_with_managed_provider(
            "tools".into(),
            dir.path().to_string_lossy().into(),
            config(dir.path(), mode),
            None,
            vec![],
            Some(provider.clone()),
        )
        .await
        .unwrap();
        manager.send_message(message()).await.unwrap();
        manager.send_message(message()).await.unwrap();
        assert_eq!(resolver.resolutions.load(Ordering::SeqCst), 3);
        let calls = requests.lock().unwrap();
        assert_eq!(calls.len(), 3);
        assert!(calls[1].1.to_string().contains("SYNTHETIC_TOOL_RESULT"));
        for (i, (auth, body)) in calls.iter().enumerate() {
            assert_eq!(auth, &format!("Bearer synthetic-actor-{i}"));
            assert_eq!(body["model"], "test-model");
        }
        drop(calls);
        let different = LlmRequest {
            model: "fork-override".into(),
            system: String::new(),
            messages: vec![],
            tools: vec![],
            max_tokens: None,
            thinking: None,
            reasoning_effort: None,
        };
        assert!(provider.stream(&different).await.is_err());
        assert_eq!(resolver.resolutions.load(Ordering::SeqCst), 3);
        resolver.lifetime.send_replace(true);
        let same = LlmRequest {
            model: "test-model".into(),
            ..different
        };
        assert!(provider.clone().stream(&same).await.is_err());
        assert_eq!(resolver.resolutions.load(Ordering::SeqCst), 3);
        server.abort();
    }
    let captured = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    assert!(captured.contains("provider request projected"));
    assert!(!captured.contains("synthetic-actor-"));
}

#[tokio::test]
async fn account_cancellation_stops_whole_turn_during_tool_approval() {
    use axum::{Router, routing::post};
    let dir = tempfile::tempdir().unwrap();
    let output = dir.path().join("must-not-exist.txt");
    let mode = OpenAiApiMode::ChatCompletions;
    let body = tool_round(
        mode,
        "Write",
        json!({"file_path":output.to_string_lossy(),"content":"must not write"}),
    );
    let calls = Arc::new(AtomicUsize::new(0));
    let app = Router::new().route(
        "/{*path}",
        post({
            let calls = calls.clone();
            move || {
                calls.fetch_add(1, Ordering::SeqCst);
                let body = body.clone();
                async move { ([("content-type", "text/event-stream")], body) }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let resolver = Arc::new(Resolver {
        endpoint,
        lifetime: watch::channel(false).0,
        resolutions: AtomicUsize::new(0),
    });
    let provider = ManagedProvider::bind(
        resolver.clone(),
        "owner".into(),
        "original-provider".into(),
        "test-model".into(),
        mode,
    )
    .await
    .unwrap();
    let mut cfg = config(dir.path(), mode);
    cfg.session_mode = Some("default".into());
    let manager = Arc::new(
        AionrsAgentManager::new_with_managed_provider(
            "tool-wait".into(),
            dir.path().to_string_lossy().into(),
            cfg,
            None,
            vec![],
            Some(provider),
        )
        .await
        .unwrap(),
    );
    let mut events = manager.subscribe();
    let running = tokio::spawn({
        let manager = manager.clone();
        async move { manager.send_message(message()).await }
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if !manager.get_confirmations().is_empty() {
                break;
            }
            events.recv().await.unwrap();
        }
    })
    .await
    .unwrap();
    assert!(!running.is_finished());
    resolver.lifetime.send_replace(true);
    tokio::time::timeout(Duration::from_secs(2), running)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(!output.exists());
    assert!(manager.get_confirmations().is_empty());
    server.abort();
}

#[tokio::test]
async fn partial_tcp_disconnect_after_text_or_terminal_is_not_replayed() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        for terminal in [false, true] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}", listener.local_addr().unwrap());
            let calls = Arc::new(AtomicUsize::new(0));
            let server = tokio::spawn({
                let calls = calls.clone();
                async move {
                    loop {
                        let (mut socket, _) = listener.accept().await.unwrap();
                        let mut received = Vec::new();
                        let mut buffer = [0; 8192];
                        while !received.windows(4).any(|w| w == b"\r\n\r\n") {
                            let n = socket.read(&mut buffer).await.unwrap();
                            if n == 0 {
                                break;
                            }
                            received.extend_from_slice(&buffer[..n]);
                        }
                        calls.fetch_add(1, Ordering::SeqCst);
                        let finish = if mode == OpenAiApiMode::ChatCompletions {
                            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n"
                        } else {
                            done(mode)
                        };
                        let body = format!("{}{}", text(mode, "partial"), if terminal { finish } else { "" });
                        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 999999\r\nConnection: close\r\n\r\n{body}").as_bytes()).await.unwrap();
                        socket.shutdown().await.unwrap();
                    }
                }
            });
            let resolver = Arc::new(Resolver {
                endpoint,
                lifetime: watch::channel(false).0,
                resolutions: AtomicUsize::new(0),
            });
            let provider = ManagedProvider::bind(
                resolver,
                "owner".into(),
                "original-provider".into(),
                "test-model".into(),
                mode,
            )
            .await
            .unwrap();
            let dir = tempfile::tempdir().unwrap();
            let manager = AionrsAgentManager::new_with_managed_provider(
                "disconnect".into(),
                dir.path().to_string_lossy().into(),
                config(dir.path(), mode),
                None,
                vec![],
                Some(provider),
            )
            .await
            .unwrap();
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(5), manager.send_message(message()))
                    .await
                    .unwrap()
                    .is_ok(),
                terminal && mode == OpenAiApiMode::Responses,
                "Responses terminal completes the model response; Chat finish_reason alone requires clean EOF"
            );
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            server.abort();
        }
    }
}

#[tokio::test]
async fn cancellation_closes_upstream_even_when_shared_consumer_stops_reading() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let closed = Arc::new(tokio::sync::Notify::new());
    let server = tokio::spawn({
        let closed = closed.clone();
        async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 8192];
            let mut request = Vec::new();
            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = socket.read(&mut buffer).await.unwrap();
                request.extend_from_slice(&buffer[..n]);
            }
            let body = text(OpenAiApiMode::ChatCompletions, "buffered").repeat(300);
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 999999\r\n\r\n{body}"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            loop {
                match socket.read(&mut buffer).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
            closed.notify_one();
        }
    });
    let resolver = Arc::new(Resolver {
        endpoint,
        lifetime: watch::channel(false).0,
        resolutions: AtomicUsize::new(0),
    });
    let provider = ManagedProvider::bind(
        resolver.clone(),
        "owner".into(),
        "original-provider".into(),
        "test-model".into(),
        OpenAiApiMode::ChatCompletions,
    )
    .await
    .unwrap();
    let request = LlmRequest {
        model: "test-model".into(),
        system: String::new(),
        messages: vec![],
        tools: vec![],
        max_tokens: None,
        thinking: None,
        reasoning_effort: None,
    };
    let receiver = provider.stream(&request).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while receiver.len() < 64 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    resolver.lifetime.send_replace(true);
    tokio::time::timeout(Duration::from_secs(2), closed.notified())
        .await
        .unwrap();
    assert_eq!(resolver.resolutions.load(Ordering::SeqCst), 1);
    drop(receiver);
    server.await.unwrap();
}

#[tokio::test]
async fn managed_bootstrap_never_replays_ambiguous_paid_requests() {
    use axum::{Router, http::StatusCode, routing::post};
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let reasoning = if mode == OpenAiApiMode::Responses {
            json!({"type":"response.reasoning_summary_text.delta","delta":"think"})
        } else {
            json!({"choices":[{"delta":{"reasoning_content":"think"},"finish_reason":null}]})
        };
        let mut cases = vec![
            (503, "text/event-stream", "".into()),
            (
                200,
                "application/json",
                r#"{"error":{"message":"synthetic-secret failure"}}"#.into(),
            ),
            (200, "text/event-stream", "".into()),
            (200, "text/event-stream", "data: [DONE]\n\n".into()),
            (
                200,
                "text/event-stream",
                format!("{}{}", text(mode, " \n\t"), done(mode)),
            ),
            (200, "text/event-stream", text(mode, "partial")),
            (
                200,
                "text/event-stream",
                format!(
                    "{}data: {{\"type\":\"error\",\"error\":{{\"message\":\"upstream stream failed\"}}}}\n\n",
                    text(mode, "partial")
                ),
            ),
            (200, "text/event-stream", format!("data: {reasoning}\n\n{}", done(mode))),
            (200, "text/event-stream", format!("data: broken-json\n\n{}", done(mode))),
            (200, "text/event-stream", tool_round(mode, "", json!({}))),
            (
                200,
                "text/event-stream",
                format!("{}{}", text(mode, "partial"), tool_round(mode, "", json!({}))),
            ),
        ];
        if mode == OpenAiApiMode::ChatCompletions {
            cases.push((
                200,
                "text/event-stream",
                format!(
                    "{}data: {{\"choices\":[{{\"delta\":{{}},\"finish_reason\":\"tool_calls\"}}]}}\n\n",
                    text(mode, "partial")
                ),
            ));
        }
        for (status, content_type, body) in cases {
            let calls = Arc::new(AtomicUsize::new(0));
            let app = Router::new().route(
                "/{*path}",
                post({
                    let calls = calls.clone();
                    move || {
                        calls.fetch_add(1, Ordering::SeqCst);
                        let body = body.clone();
                        async move {
                            (
                                StatusCode::from_u16(status).unwrap(),
                                [("content-type", content_type)],
                                body,
                            )
                        }
                    }
                }),
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let resolver = Arc::new(Resolver {
                endpoint,
                lifetime: watch::channel(false).0,
                resolutions: AtomicUsize::new(0),
            });
            let provider = ManagedProvider::bind(
                resolver,
                "owner".into(),
                "original-provider".into(),
                "test-model".into(),
                mode,
            )
            .await
            .unwrap();
            let dir = tempfile::tempdir().unwrap();
            let manager = AionrsAgentManager::new_with_managed_provider(
                "managed".into(),
                dir.path().to_string_lossy().into(),
                config(dir.path(), mode),
                None,
                vec![],
                Some(provider),
            )
            .await
            .unwrap();
            let result = tokio::time::timeout(Duration::from_secs(10), manager.send_message(message()))
                .await
                .unwrap();
            assert!(result.is_err(), "ambiguous response must fail status={status}");
            assert_eq!(calls.load(Ordering::SeqCst), 1, "no hidden engine/provider replay");
            server.abort();
        }
    }
}

#[tokio::test]
async fn managed_malformed_payloads_fail_before_normalization() {
    use axum::{Router, routing::post};
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        for defect in ["invalid_json", "missing_id", "missing_arguments", "broken_frame"] {
            let malformed = if mode == OpenAiApiMode::Responses {
                let mut item =
                    json!({"type":"function_call","id":"item-bad","call_id":"call-bad","name":"Read","arguments":"{}"});
                if defect == "invalid_json" {
                    item["arguments"] = json!("{");
                }
                if defect == "missing_id" {
                    item.as_object_mut().unwrap().remove("call_id");
                }
                if defect == "missing_arguments" {
                    item.as_object_mut().unwrap().remove("arguments");
                }
                format!(
                    "data: {}\n\n{}",
                    json!({"type":"response.output_item.done","item":item}),
                    done(mode)
                )
            } else {
                let mut call =
                    json!({"index":0,"id":"call-bad","type":"function","function":{"name":"Read","arguments":"{}"}});
                if defect == "invalid_json" {
                    call["function"]["arguments"] = json!("{");
                }
                if defect == "missing_id" {
                    call.as_object_mut().unwrap().remove("id");
                }
                if defect == "missing_arguments" {
                    call["function"].as_object_mut().unwrap().remove("arguments");
                }
                format!(
                    "data: {}\n\ndata: {{\"choices\":[{{\"delta\":{{}},\"finish_reason\":\"tool_calls\"}}]}}\n\ndata: [DONE]\n\n",
                    json!({"choices":[{"delta":{"tool_calls":[call]},"finish_reason":null}]})
                )
            };
            let first = if defect == "broken_frame" {
                format!("{}data: broken-json\n\n{}", text(mode, "partial text"), done(mode))
            } else {
                format!("{}{}", text(mode, "partial text"), malformed)
            };
            let calls = Arc::new(AtomicUsize::new(0));
            let app = Router::new().route(
                "/{*path}",
                post({
                    let calls = calls.clone();
                    move || {
                        let n = calls.fetch_add(1, Ordering::SeqCst);
                        let body = if n == 0 {
                            first.clone()
                        } else {
                            format!("{}{}", text(mode, "OK"), done(mode))
                        };
                        async move { ([("content-type", "text/event-stream")], body) }
                    }
                }),
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let resolver = Arc::new(Resolver {
                endpoint,
                lifetime: watch::channel(false).0,
                resolutions: AtomicUsize::new(0),
            });
            let provider = ManagedProvider::bind(
                resolver,
                "owner".into(),
                "original-provider".into(),
                "test-model".into(),
                mode,
            )
            .await
            .unwrap();
            let dir = tempfile::tempdir().unwrap();
            let manager = AionrsAgentManager::new_with_managed_provider(
                format!("review-{defect}"),
                dir.path().to_string_lossy().into(),
                config(dir.path(), mode),
                None,
                vec![],
                Some(provider),
            )
            .await
            .unwrap();
            let result = tokio::time::timeout(Duration::from_secs(10), manager.send_message(message()))
                .await
                .unwrap();
            let error = result.expect_err("malformed payload must fail before normalization");
            assert_eq!(
                error.to_string(),
                "The upstream Agent failed while handling the request",
                "mode={mode:?} defect={defect}"
            );
            assert_eq!(
                calls.load(Ordering::SeqCst),
                1,
                "mode={mode:?} defect={defect} must never replay"
            );
            server.abort();
        }
    }
}

#[tokio::test]
async fn managed_empty_object_tools_and_lifecycle_frames_are_valid() {
    use axum::{Json, Router, routing::post};
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let first = if mode == OpenAiApiMode::Responses {
            let item = json!({"type":"function_call","id":"item-1","call_id":"call-1","name":"EnterPlanMode","arguments":"{}"});
            [
                json!({"type":"response.created","response":{"status":"in_progress"}}),
                json!({"type":"response.output_item.added","item":{"type":"function_call","id":"item-1","call_id":"call-1","name":"EnterPlanMode","arguments":""}}),
                json!({"type":"response.function_call_arguments.delta","item_id":"item-1","delta":"{"}),
                json!({"type":"response.function_call_arguments.delta","item_id":"item-1","delta":"}"}),
                json!({"type":"response.output_item.done","item":item}),
                json!({"type":"response.completed","response":{"status":"completed","output":[item]}}),
            ].iter().map(|event| format!("data: {event}\n\n")).collect::<String>()
        } else {
            [
                json!({"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}),
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"EnterPlanMode","arguments":"{"}}]},"finish_reason":null}]}),
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"","arguments":"}"}}]},"finish_reason":null}]}),
                json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
                json!({"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}),
            ].iter().map(|event| format!("data: {event}\n\n")).collect::<String>() // finish_reason + clean EOF
        };
        let calls = Arc::new(AtomicUsize::new(0));
        let app = Router::new().route(
            "/{*path}",
            post({
                let calls = calls.clone();
                move |Json(body): Json<Value>| {
                    let n = calls.fetch_add(1, Ordering::SeqCst);
                    let response = if n == 0 {
                        first.clone()
                    } else {
                        assert!(
                            body.to_string().contains("Entered plan mode"),
                            "valid no-argument tool must actually execute"
                        );
                        format!("{}{}", text(mode, "OK"), done(mode))
                    };
                    async move { ([("content-type", "text/event-stream")], response) }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let resolver = Arc::new(Resolver {
            endpoint,
            lifetime: watch::channel(false).0,
            resolutions: AtomicUsize::new(0),
        });
        let provider = ManagedProvider::bind(
            resolver,
            "owner".into(),
            "original-provider".into(),
            "test-model".into(),
            mode,
        )
        .await
        .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let manager = AionrsAgentManager::new_with_managed_provider(
            "no-args".into(),
            dir.path().to_string_lossy().into(),
            config(dir.path(), mode),
            None,
            vec![],
            Some(provider),
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), manager.send_message(message()))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        server.abort();
    }
}
