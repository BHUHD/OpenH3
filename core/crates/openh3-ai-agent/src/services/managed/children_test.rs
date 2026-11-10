use super::*;
use axum::{Json, Router, body::Body, response::IntoResponse, routing::post};

struct ChildBody {
    chunks: tokio::sync::mpsc::UnboundedReceiver<axum::body::Bytes>,
    closed: Arc<tokio::sync::Notify>,
}
impl futures_util::Stream for ChildBody {
    type Item = Result<axum::body::Bytes, std::io::Error>;
    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        self.chunks.poll_recv(cx).map(|chunk| chunk.map(Ok))
    }
}
impl Drop for ChildBody {
    fn drop(&mut self) {
        self.closed.notify_one();
    }
}

#[tokio::test]
async fn native_spawn_runs_children_concurrently_and_preserves_result_order() {
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let app = Router::new().route(
            "/{*path}",
            post({
                let requests = requests.clone();
                move |Json(body): Json<Value>| {
                    let mut requests = requests.lock().unwrap();
                    let n = requests.len();
                    requests.push(body.clone());
                    let barrier = barrier.clone();
                    async move {
                        let response = if n == 0 {
                            tool_round(
                                mode,
                                "Spawn",
                                json!({"tasks":[
                                    {"name":"first","prompt":"SYNTHETIC_CHILD_FIRST"},
                                    {"name":"second","prompt":"SYNTHETIC_CHILD_SECOND"}
                                ]}),
                            )
                        } else if n <= 2 {
                            let input = body.to_string();
                            let first = input.contains("SYNTHETIC_CHILD_FIRST");
                            assert!(first || input.contains("SYNTHETIC_CHILD_SECOND"));
                            // A serial implementation cannot reach this barrier twice.
                            barrier.wait().await;
                            format!(
                                "{}{}",
                                text(mode, if first { "FIRST_RESULT" } else { "SECOND_RESULT" }),
                                done(mode)
                            )
                        } else {
                            let input = body.to_string();
                            assert!(input.find("FIRST_RESULT").unwrap() < input.find("SECOND_RESULT").unwrap());
                            assert!(input.contains("first [OK]") && input.contains("second [OK]"));
                            format!("{}{}", text(mode, "PARENT_OK"), done(mode))
                        };
                        ([("content-type", "text/event-stream")], response)
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
            "spawn-parallel".into(),
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
        assert_eq!(requests.lock().unwrap().len(), 4);
        server.abort();
    }
}

#[tokio::test]
async fn native_spawn_user_cancel_closes_child_and_next_turn_cannot_revive_it() {
    for mode in [OpenAiApiMode::ChatCompletions, OpenAiApiMode::Responses] {
        let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
        let child_started = Arc::new(tokio::sync::Notify::new());
        let child_closed = Arc::new(tokio::sync::Notify::new());
        let (old_chunks, old_rx) = tokio::sync::mpsc::unbounded_channel();
        let old_rx = Arc::new(std::sync::Mutex::new(Some(old_rx)));
        let app = Router::new().route(
            "/{*path}",
            post({
                let requests = requests.clone();
                let child_started = child_started.clone();
                let child_closed = child_closed.clone();
                move |Json(body): Json<Value>| {
                    let mut requests = requests.lock().unwrap();
                    let n = requests.len();
                    requests.push(body.clone());
                    let child = if n == 1 {
                        assert!(body.to_string().contains("SYNTHETIC_CHILD_PROMPT"));
                        child_started.notify_one();
                        Some(ChildBody {
                            chunks: old_rx.lock().unwrap().take().unwrap(),
                            closed: child_closed.clone(),
                        })
                    } else {
                        None
                    };
                    let response = if n == 0 {
                        tool_round(
                            mode,
                            "Spawn",
                            json!({"tasks":[{"name":"child","prompt":"SYNTHETIC_CHILD_PROMPT"}]}),
                        )
                    } else {
                        format!("{}{}", text(mode, "NEW_TURN_OK"), done(mode))
                    };
                    async move {
                        if let Some(child) = child {
                            ([("content-type", "text/event-stream")], Body::from_stream(child)).into_response()
                        } else {
                            ([("content-type", "text/event-stream")], response).into_response()
                        }
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
            resolver.clone(),
            "owner".into(),
            "original-provider".into(),
            "test-model".into(),
            mode,
        )
        .await
        .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let manager = Arc::new(
            AionrsAgentManager::new_with_managed_provider(
                "spawn-cancel".into(),
                dir.path().to_string_lossy().into(),
                config(dir.path(), mode),
                None,
                vec![],
                Some(provider),
            )
            .await
            .unwrap(),
        );
        let running = tokio::spawn({
            let manager = manager.clone();
            async move { manager.send_message(message()).await }
        });
        tokio::time::timeout(Duration::from_secs(5), child_started.notified())
            .await
            .unwrap();
        manager.cancel().await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), running)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), child_closed.notified())
            .await
            .expect("user cancel must close native child HTTP body");
        assert!(!*resolver.lifetime.borrow(), "user stop must not revoke the account");
        let mut next = message();
        next.content = "SYNTHETIC_NEXT_TURN".into();
        tokio::time::timeout(Duration::from_secs(5), manager.send_message(next))
            .await
            .unwrap()
            .unwrap();
        // A late old completion cannot deliver a tool call that starts another paid request.
        assert!(
            old_chunks
                .send(tool_round(mode, "Read", json!({"file_path":"never-read"})).into())
                .is_err()
        );
        assert_eq!(requests.lock().unwrap().len(), 3);
        assert_eq!(resolver.resolutions.load(Ordering::SeqCst), 3);
        server.abort();
    }
}
