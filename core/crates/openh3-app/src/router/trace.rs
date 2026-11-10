//! HTTP request access-log layer.

use std::time::Instant;

use axum::Router;
use axum::extract::Request;
use axum::middleware::{self, Next};
use axum::response::Response;
use openh3_common::{ApiErrorLogContext, generate_short_id};

const REQUEST_ID_HEADER: &str = "x-request-id";
const MAX_QUERY_KEYS: usize = 16;

pub(super) fn with_access_log(router: Router) -> Router {
    router.layer(middleware::from_fn(access_log))
}

async fn access_log(request: Request, next: Next) -> Response {
    let started = Instant::now();
    let method = if openh3_system::provider::cloud_account::routes::is_cloud_path(request.uri().path()) {
        match request.method().as_str() {
            "GET" => "GET",
            "POST" => "POST",
            _ => "OTHER",
        }
        .to_owned()
    } else {
        request.method().to_string()
    };
    let cloud = openh3_system::provider::cloud_account::routes::is_cloud_path(request.uri().path());
    let path = if cloud {
        openh3_system::provider::cloud_account::routes::route_label(request.uri().path()).to_owned()
    } else {
        request.uri().path().to_owned()
    };
    let query_keys = if cloud {
        String::new()
    } else {
        query_keys(request.uri().query())
    };
    let request_id = if cloud {
        generate_short_id()
    } else {
        request
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(generate_short_id)
    };

    let mut response = next.run(request).await;
    if cloud {
        response
            .headers_mut()
            .insert(axum::http::header::CACHE_CONTROL, "no-store".parse().unwrap());
    }
    let status = response.status().as_u16();
    let latency_ms = started.elapsed().as_millis() as u64;
    let error_context = response.extensions().get::<ApiErrorLogContext>();
    let error_code = error_context.map(|context| context.code).unwrap_or("");
    let error_message = error_context.map(|context| context.message.as_str()).unwrap_or("");

    if status >= 500 {
        tracing::error!(
            request_id = %request_id,
            method = %method,
            path = %path,
            query_keys = %query_keys,
            status,
            latency_ms,
            error_code,
            error_message,
            "http response"
        );
    } else if status >= 400 {
        tracing::warn!(
            request_id = %request_id,
            method = %method,
            path = %path,
            query_keys = %query_keys,
            status,
            latency_ms,
            error_code,
            error_message,
            "http response"
        );
    } else {
        tracing::info!(
            request_id = %request_id,
            method = %method,
            path = %path,
            query_keys = %query_keys,
            status,
            latency_ms,
            "http response"
        );
    }

    response
}

fn query_keys(query: Option<&str>) -> String {
    query
        .into_iter()
        .flat_map(|query| query.split('&'))
        .filter_map(|pair| {
            let key = pair.split_once('=').map_or(pair, |(key, _)| key).trim();
            (!key.is_empty()).then_some(key)
        })
        .take(MAX_QUERY_KEYS)
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone)]
    struct LogBuffer(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);
    impl std::io::Write for LogBuffer {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn cloud_failures_never_log_caller_fields_or_rejected_json() {
        use axum::{
            body::{Body, to_bytes},
            http::{Request, StatusCode},
        };
        use base64::Engine as _;
        use tower::ServiceExt;
        use tracing::instrument::WithSubscriber;
        let db = openh3_db::init_database_memory().await.unwrap();
        let config = crate::AppConfig {
            local: true,
            cloud_account: crate::CloudAccountTransportConfig {
                capability: Some("synthetic-capability".into()),
                trusted_origins: vec!["https://web.example".into()],
                ..Default::default()
            },
            ..Default::default()
        };
        let services = crate::AppServices::from_config(db, &config).await.unwrap();
        let app = with_access_log(openh3_system::provider::cloud_account::routes::cloud_account_routes(
            crate::router::state::build_cloud_account_state(&services),
        ));
        let output = LogBuffer(Default::default());
        let writer = output.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_ansi(false)
            .without_time()
            .with_writer(move || writer.clone())
            .finish();
        let subscriber = tracing::Dispatch::new(subscriber);
        for (path, body) in [
            (
                "/api/cloud-account/login",
                r#"{"SENTINEL-unknown":"SENTINEL-password"}"#,
            ),
            (
                "/api/cloud-account/SENTINEL-path?SENTINEL-key=SENTINEL-value",
                "{SENTINEL-malformed",
            ),
            ("/api/cloud-accountSENTINEL-suffix", "{}"),
        ] {
            let req = Request::builder()
                .method("POST")
                .uri(path)
                .header("x-request-id", "SENTINEL-request-id")
                .header("x-openh3-cloud-capability", "synthetic-capability")
                .header("content-type", "application/json")
                .header("cookie", "aionui-csrf-token=csrf")
                .header("x-csrf-token", "csrf")
                .body(Body::from(body))
                .unwrap();
            let response = app
                .clone()
                .oneshot(req)
                .with_subscriber(subscriber.clone())
                .await
                .unwrap();
            assert!(response.status().is_client_error());
        }
        // Decoder errors can embed attacker-controlled JWT header fields.
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"alg":"SENTINEL-jwt-secret"}"#);
        let token = format!("{header}.e30.AA");
        let request = Request::get("/api/cloud-account/session")
            .header("origin", "https://web.example")
            .header("x-openh3-webui-request", "1")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(request).with_subscriber(subscriber).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = to_bytes(response.into_body(), 65536).await.unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body).unwrap()["code"],
            "LOCAL_AUTH_REQUIRED"
        );
        assert!(!body.contains("SENTINEL"));
        assert!(!body.contains(&token));
        let log = String::from_utf8(output.0.lock().unwrap().clone()).unwrap();
        assert!(log.contains("cloud.login"));
        assert!(log.contains("cloud.unknown"));
        assert!(!log.contains("SENTINEL"));
        assert!(!log.contains("synthetic-capability"));
        assert!(!log.contains(&token));
        assert!(log.contains("Token verification failed"));
        assert!(log.contains("reason=\"invalid\""));
    }

    #[test]
    fn query_keys_omit_values() {
        assert_eq!(
            query_keys(Some("path=/Users/alice/project&token=secret&flag&empty=")),
            "path,token,flag,empty"
        );
    }
}
