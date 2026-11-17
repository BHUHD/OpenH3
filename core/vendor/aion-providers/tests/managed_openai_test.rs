//! OpenH3 managed transport contract. Synthetic loopback fixtures derive from
//! upstream provider_openai_test.rs and openai_responses_test.rs, not a live gateway.
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aion_config::compat::{OpenAiApiMode, ProviderCompat};
use aion_providers::openai::OpenAIProvider;
use aion_providers::{LlmProvider, ProviderError};
use aion_types::llm::{LlmEvent, LlmRequest};
use aion_types::message::StopReason;
use aion_types::tool::ToolDef;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

const SENTINEL: &str = "PRIVATE-UPSTREAM-SENTINEL";
const DEADLINE: Duration = Duration::from_secs(2);

fn provider(root: &str, mode: OpenAiApiMode) -> OpenAIProvider {
    let mut compat = ProviderCompat::openai_defaults();
    compat.transport.openai_api_mode = Some(match mode {
        OpenAiApiMode::ChatCompletions => OpenAiApiMode::Responses,
        OpenAiApiMode::Responses => OpenAiApiMode::ChatCompletions,
    });
    // Explicit mode and fixed endpoint must win over conflicting compat metadata.
    compat.transport.api_path = Some("/must-not-be-used".into());
    OpenAIProvider::new_managed("synthetic-credential", root, mode, compat).unwrap()
}

fn request() -> LlmRequest {
    LlmRequest {
        model: "opaque-catalog-model".into(),
        system: "Local protocol test".into(),
        messages: vec![],
        tools: vec![ToolDef {
            name: "read".into(),
            description: "Read a file".into(),
            input_schema: json!({"type":"object", "properties":{"path":{"type":"string"}}}),
            deferred: false,
        }],
        max_tokens: Some(64),
        thinking: None,
        reasoning_effort: None,
    }
}

fn sse(values: &[Value]) -> String {
    values.iter().map(|v| format!("data: {v}\n\n")).collect()
}

async fn collect(provider: &OpenAIProvider) -> Result<Vec<LlmEvent>, ProviderError> {
    let mut rx = provider.stream(&request()).await?;
    let mut events = vec![];
    while let Some(event) = rx.recv().await {
        events.push(event);
    }
    Ok(events)
}

async fn server(response: ResponseTemplate) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST")).respond_with(response).mount(&server).await;
    server
}

async fn assert_one(server: &MockServer) {
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

fn assert_safe(text: &str) {
    for forbidden in [SENTINEL, "synthetic-credential", "http://", "https://"] {
        assert!(!text.contains(forbidden), "leaked {forbidden}: {text}");
    }
}

#[tokio::test]
async fn managed_prefix_preserves_base_path_for_both_protocols() {
    for (mode, route) in [
        (OpenAiApiMode::ChatCompletions, "/v1/chat/completions"),
        (OpenAiApiMode::Responses, "/v1/responses"),
    ] {
        for prefix in ["", "/hhaiapi", "/hhaiapi/"] {
            let server = server(ResponseTemplate::new(401).set_body_string(SENTINEL)).await;
            let endpoint = format!("{}{prefix}", server.uri());
            assert!(collect(&provider(&endpoint, mode)).await.is_err());
            let requests = server.received_requests().await.unwrap();
            assert_eq!(requests.len(), 1);
            assert_eq!(
                requests[0].url.path(),
                format!("{}{route}", prefix.trim_end_matches('/'))
            );
            assert_eq!(requests[0].headers["authorization"], "Bearer synthetic-credential");
        }
    }
}

#[tokio::test]
async fn managed_http_errors_are_not_replayed_or_retained() {
    for status in [500, 502, 429, 401] {
        let server = server(ResponseTemplate::new(status).set_body_string(SENTINEL)).await;
        let result = timeout(
            DEADLINE,
            collect(&provider(&server.uri(), OpenAiApiMode::ChatCompletions)),
        )
        .await
        .expect("managed HTTP errors must return without retry backoff");
        assert_one(&server).await;
        let error = result.unwrap_err();
        assert_safe(&format!("{error:?} {error}"));
        assert!(
            matches!(error, ProviderError::Api { status: s, .. } if s == status)
                || matches!(error, ProviderError::RateLimited { body: None, .. }) && status == 429
        );
    }
}

#[tokio::test]
async fn managed_balance_error_requires_the_gateway_code_and_retains_no_payload() {
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let body =
            json!({"error":{"code":"native_insufficient_balance", "message":SENTINEL, "token":"synthetic-credential"}});
        let server = server(ResponseTemplate::new(402).set_body_json(body)).await;
        let error = timeout(DEADLINE, collect(&provider(&server.uri(), mode)))
            .await
            .unwrap()
            .unwrap_err();
        assert_eq!(error.to_string(), "Cloud account balance is insufficient");
        assert!(matches!(error, ProviderError::ManagedInsufficientBalance));
        assert!(!error.is_retryable());
        assert_safe(&format!("{error:?} {error}"));
        assert_one(&server).await;
    }
}

#[tokio::test]
async fn managed_status_or_untrusted_balance_text_is_not_account_balance_evidence() {
    for (status, body) in [
        (402, json!({"error":{"message":"native_insufficient_balance"}})),
        (402, json!({"code":"native_insufficient_balance"})),
        (402, json!({"error":{"code":"insufficient_quota", "message":SENTINEL}})),
        (
            403,
            json!({"error":{"code":"native_insufficient_balance", "message":SENTINEL}}),
        ),
    ] {
        let server = server(ResponseTemplate::new(status).set_body_json(body)).await;
        let error = collect(&provider(&server.uri(), OpenAiApiMode::ChatCompletions))
            .await
            .unwrap_err();
        assert!(matches!(error, ProviderError::Api { status: s, .. } if s == status));
        assert_safe(&format!("{error:?} {error}"));
        assert_one(&server).await;
    }
}

#[tokio::test]
async fn byok_does_not_adopt_the_native_account_balance_classification() {
    for status in [402, 403] {
        let server = server(ResponseTemplate::new(status).set_body_json(json!({
            "error":{"code":"native_insufficient_balance", "message":"BYOK provider error"}
        })))
        .await;
        let provider = OpenAIProvider::new("byok-key", &server.uri(), ProviderCompat::openai_defaults());
        let error = collect(&provider).await.unwrap_err();
        assert!(matches!(error, ProviderError::Api { status: s, .. } if s == status));
        assert_one(&server).await;
    }
}

#[tokio::test]
async fn managed_redirect_never_reaches_target() {
    let target = server(ResponseTemplate::new(200)).await;
    let origin = server(ResponseTemplate::new(307).insert_header("location", target.uri())).await;
    let result = collect(&provider(&origin.uri(), OpenAiApiMode::ChatCompletions)).await;
    assert_one(&origin).await;
    assert!(target.received_requests().await.unwrap().is_empty());
    assert!(matches!(result, Err(ProviderError::Api { status: 307, .. })));
}

#[tokio::test]
async fn managed_empty_malformed_partial_and_in_stream_errors_are_not_replayed() {
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let partial = match mode {
            OpenAiApiMode::ChatCompletions => json!({"choices":[{"delta":{"content":"partial"}}]}),
            OpenAiApiMode::Responses => json!({"type":"response.output_text.delta", "delta":"partial"}),
        };
        let error = match mode {
            OpenAiApiMode::ChatCompletions => json!({"error":{"code":503,"message":SENTINEL}}),
            OpenAiApiMode::Responses => json!({"type":"error", "error":{"message":SENTINEL}}),
        };
        for body in [
            String::new(),
            format!("data: {SENTINEL}\n\n"),
            sse(&[partial]),
            sse(&[error]),
        ] {
            let server = server(ResponseTemplate::new(200).set_body_raw(body, "text/event-stream")).await;
            let events = timeout(DEADLINE, collect(&provider(&server.uri(), mode)))
                .await
                .expect("managed stream failures must not enter retry backoff")
                .unwrap();
            assert_one(&server).await;
            assert!(events.iter().any(|e| matches!(e, LlmEvent::Error(_))), "{events:?}");
            assert!(!events.iter().any(|e| matches!(e, LlmEvent::Done { .. })));
            assert_safe(&format!("{events:?}"));
        }
    }
}

#[tokio::test]
async fn managed_json_errors_are_safe_in_debug_and_display() {
    for body in [
        json!({"error":{"code":429,"message":SENTINEL}}).to_string(),
        json!({"error":{"code":503,"message":SENTINEL}}).to_string(),
        json!({"error":{"code":"native_insufficient_balance","status":402,"message":SENTINEL}}).to_string(),
        json!({"error":SENTINEL}).to_string(),
    ] {
        let server = server(ResponseTemplate::new(200).set_body_raw(body, "application/json")).await;
        let result = timeout(
            DEADLINE,
            collect(&provider(&server.uri(), OpenAiApiMode::ChatCompletions)),
        )
        .await
        .unwrap();
        let error = result.unwrap_err();
        assert!(!matches!(error, ProviderError::ManagedInsufficientBalance));
        assert_safe(&format!("{error:?} {error}"));
        assert_one(&server).await;
    }
}

#[tokio::test]
async fn managed_chat_preserves_tools_usage_and_finish_reason_at_clean_eof() {
    for sentinel in [false, true] {
        let mut body = sse(&[
            json!({"choices":[{"delta":{"content":"Hello"}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{\"path\":\"a.txt\"}"}}]}}]}),
            json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
            json!({"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":12,"prompt_tokens_details":{"cached_tokens":20}}}),
        ]);
        if sentinel {
            body.push_str("data: [DONE]\n\n");
        }
        let server = server(ResponseTemplate::new(200).set_body_raw(body, "text/event-stream")).await;
        let events = collect(&provider(&server.uri(), OpenAiApiMode::ChatCompletions))
            .await
            .unwrap();
        assert!(matches!(&events[0], LlmEvent::TextDelta(s) if s == "Hello"));
        assert!(matches!(&events[1], LlmEvent::ToolUse { id, name, input, .. }
            if id == "call_1" && name == "read" && input["path"] == "a.txt"));
        assert!(
            matches!(&events[2], LlmEvent::Done { stop_reason: StopReason::ToolUse, usage }
            if usage.input_tokens == 30 && usage.output_tokens == 12 && usage.cache_read_tokens == 20)
        );
        assert_eq!(events.len(), 3);
        let received = server.received_requests().await.unwrap();
        assert_eq!(received.len(), 1);
        assert_eq!(received[0].url.path(), "/v1/chat/completions");
        assert_eq!(received[0].headers["authorization"], "Bearer synthetic-credential");
        let body: Value = received[0].body_json().unwrap();
        assert_eq!(body["tools"][0]["function"]["name"], "read");
    }
}

#[tokio::test]
async fn managed_responses_preserves_typed_items_tools_and_usage() {
    let item =
        json!({"id":"fc_1","type":"function_call","call_id":"call_1","name":"read","arguments":"{\"path\":\"a.txt\"}"});
    let body = sse(&[
        json!({"type":"response.output_text.delta","delta":"Hello"}),
        json!({"type":"response.output_item.done","item":item.clone()}),
        json!({"type":"response.completed","response":{"output":[item],"usage":{"input_tokens":30,"output_tokens":12,"input_tokens_details":{"cached_tokens":20}}}}),
    ]);
    let server = server(ResponseTemplate::new(200).set_body_raw(body, "text/event-stream")).await;
    let events = collect(&provider(&server.uri(), OpenAiApiMode::Responses))
        .await
        .unwrap();
    assert!(matches!(&events[0], LlmEvent::TextDelta(s) if s == "Hello"));
    assert!(matches!(&events[1], LlmEvent::ToolUse { id, name, input, .. }
        if id == "call_1" && name == "read" && input["path"] == "a.txt"));
    assert!(
        matches!(&events[2], LlmEvent::Done { stop_reason: StopReason::ToolUse, usage }
        if usage.input_tokens == 30 && usage.output_tokens == 12 && usage.cache_read_tokens == 20)
    );
    assert_eq!(events.len(), 3);
    let received = server.received_requests().await.unwrap();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0].url.path(), "/v1/responses");
    let body: Value = received[0].body_json().unwrap();
    assert_eq!(body["tools"][0]["type"], "function");
    assert!(body.get("messages").is_none());
}

// Raw TCP lets the fixture prove that the client actually closes the socket,
// including when no additional SSE chunk ever arrives.
async fn read_request(socket: &mut tokio::net::TcpStream) {
    let mut bytes = vec![];
    let mut buf = [0u8; 4096];
    loop {
        let n = socket.read(&mut buf).await.unwrap();
        assert!(n > 0);
        bytes.extend_from_slice(&buf[..n]);
        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
            let size: usize = headers
                .lines()
                .find_map(|line| line.strip_prefix("content-length: "))
                .unwrap()
                .parse()
                .unwrap();
            if bytes.len() >= end + 4 + size {
                return;
            }
        }
    }
}

async fn silent_server(status: u16, content_type: &str) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", listener.local_addr().unwrap());
    let response =
        format!("HTTP/1.1 {status} Test\r\ncontent-type: {content_type}\r\ncontent-length: 999999999\r\n\r\n");
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let mut buf = [0u8; 4096];
        socket.write_all(response.as_bytes()).await.unwrap();
        match timeout(DEADLINE, socket.read(&mut buf))
            .await
            .expect("server must observe prompt client disconnect")
        {
            Ok(0) | Err(_) => {}
            Ok(n) => panic!("unexpected {n} bytes after request"),
        }
        assert!(
            timeout(Duration::from_millis(150), listener.accept()).await.is_err(),
            "request replayed"
        );
    });
    (root, task)
}

#[tokio::test]
async fn managed_consumer_drop_disconnects_silent_upstream() {
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let (root, observed_disconnect) = silent_server(200, "text/event-stream").await;
        let provider = provider(&root, mode);
        let receiver = provider.stream(&request()).await.unwrap();
        drop(receiver);
        observed_disconnect.await.unwrap();
    }
}

#[tokio::test]
async fn managed_non_success_body_is_discarded_without_reading() {
    let (root, observed_disconnect) = silent_server(500, "application/json").await;
    let result = timeout(DEADLINE, collect(&provider(&root, OpenAiApiMode::ChatCompletions)))
        .await
        .unwrap();
    assert!(matches!(result, Err(ProviderError::Api { status: 500, .. })));
    observed_disconnect.await.unwrap();
}

#[tokio::test]
async fn managed_partial_socket_failure_is_not_replayed() {
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let partial = match mode {
            OpenAiApiMode::ChatCompletions => json!({"choices":[{"delta":{"content":"partial"}}]}),
            OpenAiApiMode::Responses => json!({"type":"response.output_text.delta","delta":"partial"}),
        };
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            read_request(&mut socket).await;
            let body = sse(&[partial]);
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: 999999\r\n\r\n{body}"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            // Ensure the visible delta reaches the client before truncating HTTP.
            tokio::time::sleep(Duration::from_millis(30)).await;
            drop(socket);
            assert!(
                timeout(Duration::from_millis(400), listener.accept()).await.is_err(),
                "request replayed"
            );
        });
        let events = timeout(DEADLINE, collect(&provider(&root, mode)))
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(&events[0], LlmEvent::TextDelta(s) if s == "partial"));
        assert!(matches!(events.last(), Some(LlmEvent::Error(_))));
        assert_safe(&format!("{events:?}"));
        task.await.unwrap();
    }
}

#[tokio::test]
async fn managed_connection_error_values_omit_url() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let error = timeout(
        Duration::from_secs(5),
        collect(&provider(&root, OpenAiApiMode::ChatCompletions)),
    )
    .await
    .expect("bounded connection failure")
    .unwrap_err();
    assert!(matches!(error, ProviderError::Connection(_)));
    assert_safe(&format!("{error:?} {error}"));
}

#[tokio::test]
async fn managed_failure_before_response_headers_does_not_replay_received_request() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", listener.local_addr().unwrap());
    let observed_requests = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        drop(socket);
        // Observe the listener through the original connect-retry delay as well.
        assert!(timeout(Duration::from_millis(700), listener.accept()).await.is_err());
        1
    });
    let error = timeout(DEADLINE, collect(&provider(&root, OpenAiApiMode::ChatCompletions)))
        .await
        .unwrap()
        .unwrap_err();
    assert!(matches!(error, ProviderError::Connection(_)));
    assert_safe(&format!("{error:?} {error}"));
    assert_eq!(observed_requests.await.unwrap(), 1);
}

#[tokio::test]
async fn dropping_initial_request_future_disconnects_before_headers() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", listener.local_addr().unwrap());
    let (arrived, received) = tokio::sync::oneshot::channel();
    let observed_disconnect = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        arrived.send(()).unwrap();
        let mut buf = [0u8; 1];
        assert!(matches!(
            timeout(DEADLINE, socket.read(&mut buf)).await.unwrap(),
            Ok(0) | Err(_)
        ));
        assert!(timeout(Duration::from_millis(150), listener.accept()).await.is_err());
    });
    let provider = provider(&root, OpenAiApiMode::ChatCompletions);
    let request = request();
    let mut future = Box::pin(provider.stream(&request));
    tokio::select! {
        _ = &mut future => panic!("server has not sent headers"),
        _ = received => {}
    }
    drop(future);
    observed_disconnect.await.unwrap();
}

#[tokio::test]
async fn managed_done_without_finish_reason_does_not_invent_terminal_event() {
    let server = server(ResponseTemplate::new(200).set_body_raw("data: [DONE]\n\n", "text/event-stream")).await;
    let events = collect(&provider(&server.uri(), OpenAiApiMode::ChatCompletions))
        .await
        .unwrap();
    assert!(
        events.is_empty(),
        "the higher-level wrapper must reject a missing terminal: {events:?}"
    );
    assert_one(&server).await;
}

#[derive(Clone)]
struct Logs(Arc<Mutex<Vec<u8>>>);
impl std::io::Write for Logs {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn managed_debug_logs_and_parser_errors_omit_upstream_text() {
    let logs = Logs(Arc::new(Mutex::new(vec![])));
    let writer = logs.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);
    let http = server(ResponseTemplate::new(503).set_body_string(SENTINEL)).await;
    let error = timeout(
        DEADLINE,
        collect(&provider(&http.uri(), OpenAiApiMode::ChatCompletions)),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert_safe(&format!("{error:?} {error}"));
    assert_one(&http).await;
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let errors = match mode {
            OpenAiApiMode::ChatCompletions => vec![json!({"error":{"code":503,"message":SENTINEL}})],
            OpenAiApiMode::Responses => vec![
                json!({"type":"error","error":{"message":SENTINEL}}),
                json!({"type":"response.failed","response":{"error":{"message":SENTINEL}}}),
                json!({"type":"response.incomplete","response":{"incomplete_details":{"reason":SENTINEL}}}),
            ],
        };
        for error in errors {
            let body = format!("event: {SENTINEL}\ndata: {error}\n\n");
            let server = server(
                ResponseTemplate::new(200)
                    .insert_header("x-request-id", SENTINEL)
                    .set_body_raw(body, "text/event-stream"),
            )
            .await;
            let events = timeout(DEADLINE, collect(&provider(&server.uri(), mode)))
                .await
                .unwrap()
                .unwrap();
            assert!(events.iter().any(|e| matches!(e, LlmEvent::Error(_))));
            assert_safe(&format!("{events:?}"));
            assert_one(&server).await;
        }
    }
    let text = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    assert!(
        text.contains("provider stream response shape"),
        "must capture actual provider diagnostics: {text}"
    );
    assert!(!text.contains(SENTINEL), "upstream text leaked to DEBUG logs: {text}");
}
