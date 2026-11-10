use super::*;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use openh3_auth::{AuthIdentityMode, AuthState, CookieConfig, JwtService, RateLimiter};
use tower::ServiceExt;

async fn router(local: bool) -> (Router, MockServer, openh3_db::Database, Arc<JwtService>) {
    let (server, db, service, _) = fixture().await;
    let jwt = Arc::new(JwtService::new("synthetic-signing-key".into()));
    let router = routes::cloud_account_routes(state::CloudAccountRouterState {
        service,
        auth: AuthState {
            jwt_service: jwt.clone(),
            user_repo: Arc::new(openh3_db::SqliteUserRepository::new(db.pool().clone())),
            identity_mode: if local {
                AuthIdentityMode::Local
            } else {
                AuthIdentityMode::UserSession
            },
            runtime_token_verifier: None,
        },
        cookies: Arc::new(CookieConfig {
            secure: false,
            same_site: "Lax",
        }),
        capability: Some("synthetic-main-capability".into()),
        trusted_origins: Arc::new(vec!["https://web.example".into()]),
        limiter: Arc::new(RateLimiter::authenticated_action()),
    });
    (router, server, db, jwt)
}
fn request(method: &str, path: &str, body: &str, headers: &[(&str, &str)]) -> Request<Body> {
    let mut req = Request::builder()
        .method(method)
        .uri(format!("/api/cloud-account{path}"));
    for (key, value) in headers {
        req = req.header(*key, *value);
    }
    req.body(Body::from(body.to_owned())).unwrap()
}
const CAP: (&str, &str) = ("x-openh3-cloud-capability", "synthetic-main-capability");
const CSRF: [(&str, &str); 3] = [
    ("content-type", "application/json"),
    ("cookie", "aionui-csrf-token=csrf"),
    ("x-csrf-token", "csrf"),
];

#[tokio::test]
async fn gateway_failures_have_distinct_safe_codes_without_replay() {
    for (status, gateway_code, expected_status, expected_code) in [
        (
            401,
            "authentication_failed",
            StatusCode::UNAUTHORIZED,
            "CLOUD_AUTH_REQUIRED",
        ),
        (
            401,
            "verification_failed",
            StatusCode::UNAUTHORIZED,
            "CLOUD_VERIFICATION_FAILED",
        ),
        (403, "disabled", StatusCode::FORBIDDEN, "CLOUD_POLICY"),
        (
            503,
            "temporarily_unavailable",
            StatusCode::SERVICE_UNAVAILABLE,
            "CLOUD_TRANSPORT",
        ),
        (400, "invalid_request", StatusCode::BAD_REQUEST, "CLOUD_INPUT_INVALID"),
    ] {
        let (app, server, _db, _) = router(true).await;
        Mock::given(method("POST"))
            .and(path("/api/openh3/login"))
            .respond_with(
                ResponseTemplate::new(status)
                    .set_body_json(json!({"success":false,"code":gateway_code,"message":"SENTINEL-remote"})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let result = response(
            &app,
            request(
                "POST",
                "/login",
                r#"{"username":"alice","password":"valid-password"}"#,
                &[CAP, CSRF[0], CSRF[1], CSRF[2]],
            ),
            expected_status,
        )
        .await;
        assert_eq!(result["code"], expected_code);
    }
}
async fn response(router: &Router, req: Request<Body>, status: StatusCode) -> Value {
    let response = router.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), status);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    for secret in [
        "SENTINEL",
        "desktop-secret",
        "refresh-secret",
        "raw-inference-secret",
        "synthetic-main-capability",
    ] {
        assert!(!text.contains(secret));
    }
    serde_json::from_str(&text).unwrap()
}

#[tokio::test]
async fn local_native_login_session_logout_and_request_mapping() {
    let (app, server, _db, _) = router(true).await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/revoke"))
        .respond_with(ok(json!({"state":"revoked"})))
        .expect(1)
        .mount(&server)
        .await;
    let bootstrap = app
        .clone()
        .oneshot(request("GET", "/session", "", &[CAP]))
        .await
        .unwrap();
    assert!(
        bootstrap.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .starts_with("aionui-csrf-token=")
    );
    let headers = [CAP, CSRF[0], CSRF[1], CSRF[2]];
    let login = response(
        &app,
        request(
            "POST",
            "/login",
            r#"{"username":"alice","password":"SENTINEL-password"}"#,
            &headers,
        ),
        StatusCode::OK,
    )
    .await;
    assert_eq!(login["data"]["state"], "connected");
    assert_eq!(
        response(&app, request("GET", "/session", "", &[CAP]), StatusCode::OK).await["data"]["account"]["id"],
        "42"
    );
    let sent = server.received_requests().await.unwrap();
    let body: Value =
        serde_json::from_slice(&sent.iter().find(|r| r.url.path().ends_with("/login")).unwrap().body).unwrap();
    assert_eq!(body["username"], "alice");
    assert_eq!(body["password"], "SENTINEL-password");
    // Exhaust the sensitive-action budget without preventing local disconnect.
    for _ in 0..19 {
        response(&app, request("POST", "/login", "{}", &headers), StatusCode::BAD_REQUEST).await;
    }
    assert_eq!(
        response(
            &app,
            request("POST", "/login", "{}", &headers),
            StatusCode::TOO_MANY_REQUESTS
        )
        .await["code"],
        "CLOUD_RATE_LIMITED"
    );
    assert_eq!(
        response(&app, request("POST", "/logout", "{ }", &headers), StatusCode::OK).await["data"]["remote_revocation"],
        "confirmed"
    );
    assert_eq!(
        response(&app, request("GET", "/session", "", &[CAP]), StatusCode::OK).await["data"]["state"],
        "disconnected"
    );
}

#[tokio::test]
async fn guard_denies_capability_helper_csrf_and_hostile_input() {
    let (app, _server, _db, _) = router(true).await;
    for headers in [
        vec![],
        vec![(CAP.0, "wrong")],
        vec![CAP, ("origin", "https://evil.example")],
        vec![CAP, ("x-openh3-webui-request", "1")],
    ] {
        assert_eq!(
            response(&app, request("GET", "/session", "", &headers), StatusCode::UNAUTHORIZED).await["code"],
            "LOCAL_AUTH_REQUIRED"
        );
    }
    for helper in [
        "x-openh3-runtime-token",
        "x-aionui-runtime-token",
        "x-openh3-user-id",
        "x-aionui-user-id",
        "x-openh3-conversation-id",
        "x-aionui-conversation-id",
    ] {
        assert_eq!(
            response(
                &app,
                request("POST", "/login", "{}", &[CAP, (helper, "SENTINEL")]),
                StatusCode::UNAUTHORIZED
            )
            .await["code"],
            "LOCAL_AUTH_REQUIRED"
        );
    }
    for headers in [vec![CAP], vec![CAP, CSRF[0], CSRF[1], ("x-csrf-token", "wrong")]] {
        assert_eq!(
            response(&app, request("POST", "/login", "{}", &headers), StatusCode::FORBIDDEN).await["code"],
            "CSRF_INVALID"
        );
    }
    let headers = [CAP, CSRF[0], CSRF[1], CSRF[2]];
    for body in [
        "{SENTINEL",
        r#"{"username":"alice","password":"valid-password","SENTINEL-unknown":"SENTINEL"}"#,
        r#"{"username":1,"password":"SENTINEL"}"#,
    ] {
        assert_eq!(
            response(&app, request("POST", "/login", body, &headers), StatusCode::BAD_REQUEST).await["code"],
            "CLOUD_INPUT_INVALID"
        );
    }
    response(
        &app,
        request("POST", "/login", &"SENTINEL".repeat(3000), &headers),
        StatusCode::PAYLOAD_TOO_LARGE,
    )
    .await;
    for path in ["", "/", "/login/SENTINEL", "SENTINEL"] {
        response(&app, request("GET", path, "", &[CAP]), StatusCode::NOT_FOUND).await;
    }
    response(
        &app,
        request("GET", "/login", "", &[CAP]),
        StatusCode::METHOD_NOT_ALLOWED,
    )
    .await;
    response(
        &app,
        request("GET", "/session?SENTINEL=SENTINEL", "", &[CAP]),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn webui_marker_forces_real_session_origin_and_user_isolation() {
    let (app, server, db, jwt) = router(true).await;
    mount_login(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    let local = [CAP, CSRF[0], CSRF[1], CSRF[2]];
    response(
        &app,
        request(
            "POST",
            "/login",
            r#"{"username":"alice","password":"valid-password"}"#,
            &local,
        ),
        StatusCode::OK,
    )
    .await;
    sqlx::query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES('other-user','other','unused',0,0)").execute(db.pool()).await.unwrap();
    let token = format!("Bearer {}", jwt.sign("other-user", "other").unwrap());
    let headers = [
        ("x-openh3-webui-request", "1"),
        ("origin", "https://web.example"),
        ("authorization", token.as_str()),
    ];
    assert_eq!(
        response(&app, request("GET", "/session", "", &headers), StatusCode::OK).await["data"]["state"],
        "disconnected"
    );
    response(
        &app,
        request("GET", "/session", "", &headers[..2]),
        StatusCode::UNAUTHORIZED,
    )
    .await;
    response(
        &app,
        request(
            "GET",
            "/session",
            "",
            &[
                ("x-openh3-webui-request", "1"),
                ("authorization", &token),
                ("referer", "https://web.example/settings"),
            ],
        ),
        StatusCode::OK,
    )
    .await;
    response(
        &app,
        request(
            "GET",
            "/session",
            "",
            &[
                ("x-openh3-webui-request", "1"),
                ("authorization", &token),
                ("origin", "https://evil.example"),
                ("x-forwarded-host", "web.example"),
            ],
        ),
        StatusCode::FORBIDDEN,
    )
    .await;
    response(&app, request("POST", "/logout", "{}", &headers), StatusCode::FORBIDDEN).await;
    let (nonlocal, _, _, _) = router(false).await;
    response(
        &nonlocal,
        request("GET", "/session", "", &[CAP]),
        StatusCode::UNAUTHORIZED,
    )
    .await;
}

#[tokio::test]
async fn reads_do_not_spend_sensitive_action_budget_and_errors_keep_codes() {
    let (app, server, _db, _) = router(true).await;
    for _ in 0..25 {
        response(&app, request("GET", "/session", "", &[CAP]), StatusCode::OK).await;
    }
    Mock::given(method("POST"))
        .and(path("/api/openh3/login"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "17")
                .set_body_json(json!({"success":false,"code":"rate_limited","message":"SENTINEL"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let r = app
        .oneshot(request(
            "POST",
            "/login",
            r#"{"username":"alice","password":"valid-password"}"#,
            &[CAP, CSRF[0], CSRF[1], CSRF[2]],
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(r.headers()["retry-after"], "17");
}
