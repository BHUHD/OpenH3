//! Strict local transport boundary. Never log rejected input or upstream bodies.
#![allow(clippy::disallowed_types)]
use super::{CloudAccountError, state::CloudAccountRouterState};
use axum::{
    Json, Router,
    body::to_bytes,
    extract::{Request, State},
    http::{Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use openh3_api_types::*;
use openh3_auth::CurrentUser;
use serde::{Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::net::{Ipv4Addr, SocketAddr};

/// TCP addresses observed by Core, independent of HTTP Host and forwarded headers.
#[derive(Clone)]
pub struct CoreMediaSocket {
    pub local: Option<SocketAddr>,
    pub peer: SocketAddr,
}
impl axum::extract::connect_info::Connected<axum::serve::IncomingStream<'_, tokio::net::TcpListener>>
    for CoreMediaSocket
{
    fn connect_info(stream: axum::serve::IncomingStream<'_, tokio::net::TcpListener>) -> Self {
        Self {
            local: stream.io().local_addr().ok(),
            peer: *stream.remote_addr(),
        }
    }
}

pub const CAPABILITY_HEADER: &str = "x-openh3-cloud-capability";
pub const PREFIX: &str = "/api/cloud-account";

/// Includes malformed suffix boundaries for safe diagnostics and rejection.
pub fn is_cloud_path(path: &str) -> bool {
    path.starts_with(PREFIX)
}

/// Return only literal labels; never include caller-controlled suffixes.
pub fn route_label(path: &str) -> &'static str {
    match path {
        "/api/cloud-account/capabilities" => "cloud.capabilities",
        "/api/cloud-account/session" => "cloud.session",
        "/api/cloud-account/me" => "cloud.me",
        "/api/cloud-account/devices" => "cloud.devices",
        "/api/cloud-account/wallet" => "cloud.wallet",
        "/api/cloud-account/models" => "cloud.models",
        "/api/cloud-account/media-models" => "cloud.media-models",
        "/api/cloud-account/media/session" => "cloud.media-session",
        "/api/cloud-account/media/challenge" => "cloud.media-challenge",
        "/api/cloud-account/media/image" => "cloud.media-image",
        "/api/cloud-account/media/video" => "cloud.media-video",
        "/api/cloud-account/media/video/status" => "cloud.media-status",
        "/api/cloud-account/media/video/content" => "cloud.media-content",
        "/api/cloud-account/topup/options" => "cloud.topup-options",
        "/api/cloud-account/topup/quote" => "cloud.topup-quote",
        "/api/cloud-account/topup/create" => "cloud.topup-create",
        "/api/cloud-account/topup/orders" => "cloud.topup-orders",
        "/api/cloud-account/usage" => "cloud.usage",
        "/api/cloud-account/email-code" => "cloud.email-code",
        "/api/cloud-account/register" => "cloud.register",
        "/api/cloud-account/login" => "cloud.login",
        "/api/cloud-account/auth/verify" => "cloud.verify",
        "/api/cloud-account/password/reset" => "cloud.password-reset",
        "/api/cloud-account/password/reset/complete" => "cloud.password-complete",
        "/api/cloud-account/logout" => "cloud.logout",
        "/api/cloud-account/devices/revoke" => "cloud.revoke",
        _ => "cloud.unknown",
    }
}

/// Mount separately from generic local authentication and permissive CORS.
pub fn cloud_account_routes(state: CloudAccountRouterState) -> Router {
    Router::new()
        .fallback(dispatch)
        .layer(middleware::from_fn_with_state(
            state.cookies.clone(),
            openh3_auth::csrf_middleware,
        ))
        .layer(middleware::from_fn_with_state(state.clone(), authenticate))
        .layer(middleware::from_fn(openh3_auth::security_headers_middleware))
        .layer(middleware::from_fn(no_store))
        .with_state(state)
}

async fn no_store(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}
fn failure(status: StatusCode, code: &'static str) -> Response {
    let mut response = (status, Json(ErrorResponse::new("Cloud account request failed", code))).into_response();
    response.extensions_mut().insert(openh3_common::ApiErrorLogContext {
        code,
        message: "Cloud account request failed".into(),
    });
    response
}

fn media_capability(main: &str) -> String {
    let media = Sha256::new()
        .chain_update(b"openh3:media:v1\0")
        .chain_update(main.as_bytes())
        .finalize();
    format!("{media:x}")
}

fn native_capability_matches(expected: &str, actual: &str, label: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    let supplied = Sha256::digest(actual.as_bytes());
    // Accumulate over fixed-length digests to avoid credential-prefix timing leaks.
    let matches = |candidate: &str| {
        Sha256::digest(candidate.as_bytes())
            .iter()
            .zip(supplied)
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
    };
    if matches(expected) {
        return true;
    }
    if !matches!(
        label,
        "cloud.media-session"
            | "cloud.media-models"
            | "cloud.media-image"
            | "cloud.media-video"
            | "cloud.media-status"
            | "cloud.media-content"
    ) {
        return false;
    }
    matches(&media_capability(expected))
}

async fn core_media_challenge(state: &CloudAccountRouterState, request: Request) -> Response {
    use axum::extract::ConnectInfo;
    use base64::{Engine, engine::general_purpose::STANDARD};
    use hmac::{Hmac, Mac};
    let invalid = || failure(StatusCode::BAD_REQUEST, "CLOUD_INPUT_INVALID");
    let Some(main) = state.capability.as_deref().filter(|value| !value.is_empty()) else {
        return failure(StatusCode::UNAUTHORIZED, "LOCAL_AUTH_REQUIRED");
    };
    let Some(ConnectInfo(socket)) = request.extensions().get::<ConnectInfo<CoreMediaSocket>>() else {
        return failure(StatusCode::UNAUTHORIZED, "LOCAL_AUTH_REQUIRED");
    };
    let Some(local) = socket.local else { return invalid() };
    if state.auth.identity_mode != openh3_auth::AuthIdentityMode::Local
        || local.ip().to_canonical() != Ipv4Addr::LOCALHOST
        || socket.peer.ip().to_canonical() != Ipv4Addr::LOCALHOST
        || [
            header::ORIGIN.as_str(),
            header::REFERER.as_str(),
            header::AUTHORIZATION.as_str(),
            header::COOKIE.as_str(),
            CAPABILITY_HEADER,
            "x-openh3-webui-request",
        ]
        .iter()
        .any(|key| request.headers().contains_key(*key))
    {
        return failure(StatusCode::UNAUTHORIZED, "LOCAL_AUTH_REQUIRED");
    }
    if request.method() != Method::GET {
        return failure(StatusCode::METHOD_NOT_ALLOWED, "CLOUD_METHOD_INVALID");
    }
    let Some(nonce) = request
        .uri()
        .query()
        .and_then(|q| q.strip_prefix("nonce="))
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f')))
    else {
        return invalid();
    };
    // Domain separation confines the proof to this operation. Binding both
    // observed ports prevents another listener from forwarding the challenge.
    let message = format!(
        "openh3:media:core:v1\0{nonce}\0{}\0{}",
        local.port(),
        socket.peer.port()
    );
    if to_bytes(request.into_body(), 0).await.is_err() {
        return invalid();
    }
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(media_capability(main).as_bytes()) else {
        return invalid();
    };
    mac.update(message.as_bytes());
    Json(serde_json::json!({"signature": STANDARD.encode(mac.finalize().into_bytes())})).into_response()
}

async fn authenticate(State(state): State<CloudAccountRouterState>, request: Request, next: Next) -> Response {
    use openh3_auth::*;
    let h = request.headers();
    if [
        RUNTIME_TOKEN_HEADER,
        LEGACY_RUNTIME_TOKEN_HEADER,
        RUNTIME_USER_ID_HEADER,
        LEGACY_RUNTIME_USER_ID_HEADER,
        RUNTIME_CONVERSATION_ID_HEADER,
        LEGACY_RUNTIME_CONVERSATION_ID_HEADER,
    ]
    .iter()
    .any(|key| h.contains_key(*key))
    {
        return failure(StatusCode::UNAUTHORIZED, "LOCAL_AUTH_REQUIRED");
    }
    if request.uri().path() == "/api/cloud-account/media/challenge" {
        return core_media_challenge(&state, request).await;
    }
    let web = h.contains_key("x-openh3-webui-request");
    let capability = h.get(CAPABILITY_HEADER);
    let mut auth = state.auth.clone();
    auth.runtime_token_verifier = None;
    if web && capability.is_some() {
        return failure(StatusCode::UNAUTHORIZED, "LOCAL_AUTH_REQUIRED");
    }
    if auth.identity_mode == AuthIdentityMode::Local && !web {
        let valid = state
            .capability
            .as_deref()
            .zip(capability.and_then(|v| v.to_str().ok()))
            .is_some_and(|(expected, actual)| {
                native_capability_matches(expected, actual, route_label(request.uri().path()))
            });
        if !valid || h.contains_key(header::ORIGIN) || h.contains_key(header::REFERER) {
            return failure(StatusCode::UNAUTHORIZED, "LOCAL_AUTH_REQUIRED");
        }
    } else {
        // Desktop IPC is deliberately local-only. A capability never replaces a session.
        if capability.is_some() {
            return failure(StatusCode::UNAUTHORIZED, "LOCAL_AUTH_REQUIRED");
        }
        if auth.identity_mode == AuthIdentityMode::Local {
            auth.identity_mode = AuthIdentityMode::UserSession;
        }
        let origin = if let Some(origin) = h.get(header::ORIGIN) {
            origin.to_str().ok().map(str::to_owned)
        } else if request.method() == Method::GET {
            h.get(header::REFERER)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| reqwest::Url::parse(v).ok())
                .map(|u| u.origin().ascii_serialization())
        } else {
            None
        };
        if !origin.is_some_and(|origin| state.trusted_origins.contains(&origin)) {
            return failure(StatusCode::FORBIDDEN, "CLOUD_ORIGIN_INVALID");
        }
    }
    match openh3_auth::auth_middleware(State(auth), request, next).await {
        Ok(response) => response,
        Err(_) => failure(StatusCode::UNAUTHORIZED, "LOCAL_AUTH_REQUIRED"),
    }
}

fn decode<T: DeserializeOwned>(body: &[u8]) -> Result<T, CloudAccountError> {
    serde_json::from_slice(body).map_err(|_| CloudAccountError::Input)
}
fn result<T: Serialize>(value: Result<T, CloudAccountError>) -> Response {
    match value {
        Ok(value) => Json(ApiResponse::ok(value)).into_response(),
        Err(error) => {
            use CloudAccountError::*;
            let (status, code) = match error {
                Input => (StatusCode::BAD_REQUEST, "CLOUD_INPUT_INVALID"),
                Authentication => (StatusCode::UNAUTHORIZED, "CLOUD_AUTH_REQUIRED"),
                Verification => (StatusCode::UNAUTHORIZED, "CLOUD_VERIFICATION_FAILED"),
                Policy => (StatusCode::FORBIDDEN, "CLOUD_POLICY"),
                RateLimited { .. } => (StatusCode::TOO_MANY_REQUESTS, "CLOUD_RATE_LIMITED"),
                Transport => (StatusCode::SERVICE_UNAVAILABLE, "CLOUD_TRANSPORT"),
                Protocol => (StatusCode::BAD_GATEWAY, "CLOUD_PROTOCOL"),
                MediaCatalogMissing => (StatusCode::SERVICE_UNAVAILABLE, "CLOUD_MEDIA_UNAVAILABLE"),
                MediaModelUnavailable => (StatusCode::FORBIDDEN, "CLOUD_MEDIA_MODEL_UNAVAILABLE"),
                MediaCapabilityUnsupported => (StatusCode::UNPROCESSABLE_ENTITY, "CLOUD_MEDIA_CAPABILITY_UNSUPPORTED"),
                MediaJobNotFound => (StatusCode::NOT_FOUND, "CLOUD_MEDIA_JOB_NOT_FOUND"),
                MediaQuota => (StatusCode::PAYMENT_REQUIRED, "CLOUD_MEDIA_QUOTA"),
                Conflict => (StatusCode::CONFLICT, "CLOUD_CONFLICT"),
                TopupConflict => (StatusCode::CONFLICT, "CLOUD_TOPUP_CONFLICT"),
                WalletCapacity => (StatusCode::CONFLICT, "CLOUD_WALLET_CAPACITY"),
                TopupUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "CLOUD_TOPUP_UNAVAILABLE"),
                Storage => (StatusCode::INTERNAL_SERVER_ERROR, "CLOUD_STORAGE"),
            };
            let mut response = failure(status, code);
            if let RateLimited {
                retry_after: Some(seconds),
            } = error
            {
                response
                    .headers_mut()
                    .insert(header::RETRY_AFTER, seconds.to_string().parse().unwrap());
            }
            response
        }
    }
}
async fn dispatch(State(state): State<CloudAccountRouterState>, request: Request) -> Response {
    let Some(user) = request.extensions().get::<CurrentUser>() else {
        return failure(StatusCode::UNAUTHORIZED, "LOCAL_AUTH_REQUIRED");
    };
    let owner = user.id.clone();
    let label = route_label(request.uri().path());
    let read = matches!(
        label,
        "cloud.capabilities"
            | "cloud.session"
            | "cloud.me"
            | "cloud.devices"
            | "cloud.wallet"
            | "cloud.models"
            | "cloud.media-models"
            | "cloud.media-session"
    );
    if label == "cloud.unknown" {
        return failure(StatusCode::NOT_FOUND, "CLOUD_NOT_FOUND");
    }
    if request.method() != if read { Method::GET } else { Method::POST } {
        return failure(StatusCode::METHOD_NOT_ALLOWED, "CLOUD_METHOD_INVALID");
    }
    if request.uri().query().is_some() {
        return failure(StatusCode::BAD_REQUEST, "CLOUD_INPUT_INVALID");
    }
    // Disconnect must remain available even after failed sensitive attempts.
    // The service clears local state first; only the first logout can revoke remotely.
    if !read
        && !matches!(
            label,
            "cloud.logout"
                | "cloud.usage"
                | "cloud.topup-options"
                | "cloud.topup-quote"
                | "cloud.topup-orders"
                | "cloud.media-status"
                | "cloud.media-content"
        )
        && state.limiter.check_and_increment(&owner).is_err()
    {
        return result::<()>(Err(CloudAccountError::RateLimited { retry_after: Some(60) }));
    }
    if !read
        && request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_none_or(|v| v.split(';').next() != Some("application/json"))
    {
        return failure(StatusCode::BAD_REQUEST, "CLOUD_INPUT_INVALID");
    }
    let body_limit = match label {
        "cloud.media-video" => 12 * 1024 * 1024,
        "cloud.media-image" => 1024 * 1024,
        _ => 16384,
    };
    let Ok(body) = to_bytes(request.into_body(), body_limit).await else {
        return failure(StatusCode::PAYLOAD_TOO_LARGE, "CLOUD_INPUT_INVALID");
    };
    if read && !body.is_empty() {
        return failure(StatusCode::BAD_REQUEST, "CLOUD_INPUT_INVALID");
    }
    let service = &state.service;
    macro_rules! call {
        ($method:ident) => {
            match decode(&body) {
                Ok(input) => result(service.$method(&owner, input).await),
                Err(error) => result::<()>(Err(error)),
            }
        };
    }
    match label {
        "cloud.capabilities" => result(service.capabilities().await),
        "cloud.session" => result(service.session(&owner).await),
        "cloud.me" => result(service.me(&owner).await),
        "cloud.devices" => result(service.devices(&owner).await),
        "cloud.wallet" => result(service.wallet(&owner).await),
        "cloud.models" => result(service.models(&owner).await),
        "cloud.media-models" => result(service.media_models(&owner).await),
        "cloud.media-session" => result(service.media_session(&owner).await),
        "cloud.media-image" => match decode(&body) {
            Ok(input) => binary(service.generate_image(&owner, input).await),
            Err(error) => result::<()>(Err(error)),
        },
        "cloud.media-video" => call!(create_video),
        "cloud.media-status" => call!(video_status),
        "cloud.media-content" => match decode(&body) {
            Ok(input) => binary(service.video_content(&owner, input).await),
            Err(error) => result::<()>(Err(error)),
        },
        "cloud.usage" => call!(usage),
        "cloud.topup-quote" => call!(topup_quote),
        "cloud.topup-create" => call!(topup_create),
        "cloud.topup-orders" => call!(topup_orders),
        "cloud.topup-options" if decode::<Empty>(&body).is_ok() => result(service.topup_options(&owner).await),
        "cloud.email-code" => call!(email_code),
        "cloud.register" => call!(register),
        "cloud.login" => call!(login),
        "cloud.verify" => call!(verify),
        "cloud.password-reset" => call!(password_reset),
        "cloud.password-complete" => call!(password_reset_complete),
        "cloud.revoke" => call!(revoke_device),
        "cloud.logout"
            if decode::<serde_json::Value>(&body).is_ok_and(|v| v.as_object().is_some_and(|o| o.is_empty())) =>
        {
            result(service.logout(&owner).await)
        }
        _ => failure(StatusCode::BAD_REQUEST, "CLOUD_INPUT_INVALID"),
    }
}

fn binary(output: Result<(&'static str, Vec<u8>), CloudAccountError>) -> Response {
    match output {
        Ok((mime, bytes)) => ([(header::CONTENT_TYPE, mime)], bytes).into_response(),
        Err(error) => result::<()>(Err(error)),
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
