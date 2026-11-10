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
    let web = h.contains_key("x-openh3-webui-request");
    let capability = h.get(CAPABILITY_HEADER);
    let mut auth = state.auth.clone();
    auth.runtime_token_verifier = None;
    if web && capability.is_some() {
        return failure(StatusCode::UNAUTHORIZED, "LOCAL_AUTH_REQUIRED");
    }
    if auth.identity_mode == AuthIdentityMode::Local && !web {
        // Compare fixed-length digests to avoid credential-prefix timing leaks.
        use sha2::{Digest, Sha256};
        let valid = state
            .capability
            .as_deref()
            .zip(capability.and_then(|v| v.to_str().ok()))
            .is_some_and(|(expected, actual)| {
                !expected.is_empty()
                    && Sha256::digest(expected.as_bytes())
                        .iter()
                        .zip(Sha256::digest(actual.as_bytes()))
                        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
                        == 0
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
                Conflict => (StatusCode::CONFLICT, "CLOUD_CONFLICT"),
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
        "cloud.capabilities" | "cloud.session" | "cloud.me" | "cloud.devices"
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
    if !read && label != "cloud.logout" && state.limiter.check_and_increment(&owner).is_err() {
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
    let Ok(body) = to_bytes(request.into_body(), 16384).await else {
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
