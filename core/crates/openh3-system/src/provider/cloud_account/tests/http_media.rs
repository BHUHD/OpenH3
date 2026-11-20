use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use wiremock::matchers::{body_json, header};

// Computed with Node's createHash against the desktop/service handoff contract.
const MEDIA: (&str, &str) = (
    CAP.0,
    "5d895b1e4f8dbc94207296ca92dad91cebffa4e1b3bf6b2f7e3cf15ff0d3e81f",
);
const POST_HEADERS: [(&str, &str); 4] = [MEDIA, CSRF[0], CSRF[1], CSRF[2]];

#[tokio::test]
async fn desktop_core_challenge_proves_only_its_loopback_connection() {
    use crate::provider::cloud_account::routes::CoreMediaSocket;
    use axum::extract::ConnectInfo;
    let route = format!("/media/challenge?nonce={}", "a".repeat(64));
    let probe = |headers: &[(&str, &str)], port| {
        let mut req = request("GET", &route, "", headers);
        req.extensions_mut().insert(ConnectInfo(CoreMediaSocket {
            local: Some(([127, 0, 0, 1], 31000).into()),
            peer: ([127, 0, 0, 1], port).into(),
        }));
        req
    };
    let (app, _, _, _) = router(true).await;
    let first = response(&app, probe(&[], 51000), StatusCode::OK).await;
    // Produced independently by Node's HMAC using the service's derived key.
    assert_eq!(
        first,
        json!({"signature":"fbluD/RTHw9bgWlb7QOZKLO+4n5BziPWU4X3vpIv1uY="})
    );
    assert_ne!(first, response(&app, probe(&[], 51001), StatusCode::OK).await);
    response(
        &app,
        probe(&[("origin", "https://web.example")], 51000),
        StatusCode::UNAUTHORIZED,
    )
    .await;
    response(&app, probe(&[CAP], 51000), StatusCode::UNAUTHORIZED).await;
    response(&app, request("GET", &route, "", &[]), StatusCode::UNAUTHORIZED).await;
    let (web, _, _, _) = router(false).await;
    response(&web, probe(&[], 51000), StatusCode::UNAUTHORIZED).await;
}

#[tokio::test]
async fn only_a_gateway_wallet_shortfall_is_reported_as_media_quota() {
    let (app, server, _, _) = router(true).await;
    login_app(&app, &server).await;
    catalog(&server).await;
    let view = response(&app, request("GET", "/media/session", "", &[MEDIA]), StatusCode::OK).await;
    let input = json!({"binding":view["data"]["binding"],"model":"img","prompt":"poster"}).to_string();
    for (wire_code, status, code) in [
        (
            "native_insufficient_balance",
            StatusCode::PAYMENT_REQUIRED,
            "CLOUD_MEDIA_QUOTA",
        ),
        ("native_request_failed", StatusCode::FORBIDDEN, "CLOUD_POLICY"),
    ] {
        let _mock = Mock::given(path("/v1/images/generations"))
            .respond_with(
                ResponseTemplate::new(402).set_body_json(json!({"error":{"code":wire_code,"message":"SENTINEL"}})),
            )
            .expect(1)
            .mount_as_scoped(&server)
            .await;
        let out = response(&app, request("POST", "/media/image", &input, &POST_HEADERS), status).await;
        assert_eq!(out["code"], code);
        assert!(!out.to_string().contains("SENTINEL"));
    }
}

async fn login_app(app: &Router, server: &MockServer) {
    mount_login(server).await;
    Mock::given(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(server)
        .await;
    response(
        app,
        request(
            "POST",
            "/login",
            r#"{"username":"alice","password":"fixture-password"}"#,
            &[CAP, CSRF[0], CSRF[1], CSRF[2]],
        ),
        StatusCode::OK,
    )
    .await;
}
fn models() -> Value {
    json!({"models":[{"model_id":"img","display_name":"I","kind":"image","capabilities":["text-to-image"]},
        {"model_id":"vid","display_name":"V","kind":"video","capabilities":["image-to-video"]}]})
}
async fn catalog(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/api/openh3/media-models"))
        .and(header("authorization", "Bearer desktop-secret"))
        .respond_with(ok(models()))
        .mount(server)
        .await;
}
async fn bytes(app: &Router, path: &str, body: Value, mime: &str) -> Vec<u8> {
    let r = app
        .clone()
        .oneshot(request("POST", path, &body.to_string(), &POST_HEADERS))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.headers()["content-type"], mime);
    assert_eq!(r.headers()["cache-control"], "no-store");
    to_bytes(r.into_body(), 65536).await.unwrap().to_vec()
}

#[tokio::test]
async fn scoped_catalog_and_single_submit_through_image_and_video_content() {
    let (app, server, _, _) = router(true).await;
    login_app(&app, &server).await;
    catalog(&server).await;
    let view = response(&app, request("GET", "/media-models", "", &[MEDIA]), StatusCode::OK).await;
    assert_eq!(view["data"]["models"], models()["models"]);
    assert_eq!(view["data"]["account_id"], "42");
    let bound = view["data"]["binding"].as_str().unwrap();
    assert_eq!(bound.len(), 64);
    let count = server.received_requests().await.unwrap().len();
    let session = response(&app, request("GET", "/media/session", "", &[MEDIA]), StatusCode::OK).await;
    let account_key = view["data"]["account_key"].as_str().unwrap();
    assert_eq!(account_key.len(), 64);
    assert_ne!(account_key, bound);
    assert_eq!(
        session["data"],
        json!({"binding":bound,"account_id":"42","account_key":account_key})
    );
    assert_eq!(server.received_requests().await.unwrap().len(), count);
    let png = b"\x89PNG\r\n\x1a\nopaque fixture";
    let b64 = STANDARD.encode(png);
    Mock::given(method("POST"))
        .and(path("/v1/images/generations"))
        .and(header("authorization", "Bearer raw-inference-secret"))
        .and(body_json(
            json!({"model":"img","prompt":"a flower","size":"1024x1024","n":1,"response_format":"b64_json"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data":[{"b64_json":b64}]})))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        bytes(
            &app,
            "/media/image",
            json!({"binding":bound,"model":"img","prompt":"a flower","size":"1024x1024"}),
            "image/png"
        )
        .await,
        png
    );
    let upstream = json!({"model":"vid","prompt":"a flower moves","seconds":"4",
        "input_reference":format!("data:image/png;base64,{b64}")});
    let submit = json!({"binding":bound,"model":"vid","prompt":"a flower moves","seconds":4,
        "reference":{"data":b64,"mime_type":"image/png"}});
    Mock::given(method("POST"))
        .and(path("/v1/videos"))
        .and(header("authorization", "Bearer raw-inference-secret"))
        .and(body_json(upstream))
        .respond_with(
            ResponseTemplate::new(201).set_body_json(json!({"id":"task_ab","status":"queued","url":"SENTINEL"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let created = response(
        &app,
        request("POST", "/media/video", &submit.to_string(), &POST_HEADERS),
        StatusCode::OK,
    )
    .await;
    let handle = created["data"]["job_id"].as_str().unwrap();
    assert_ne!(handle, "task_ab");
    assert_eq!(created["data"]["status"], "queued");
    Mock::given(method("GET"))
        .and(path("/v1/videos/task_ab"))
        .and(header("authorization", "Bearer raw-inference-secret"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"id":"task_ab","status":"completed","download_url":"SENTINEL"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let lookup = json!({"job_id":handle,"binding":bound});
    let status = response(
        &app,
        request("POST", "/media/video/status", &lookup.to_string(), &POST_HEADERS),
        StatusCode::OK,
    )
    .await;
    assert_eq!(status["data"], json!({"job_id":handle,"status":"completed"}));
    let mp4 = b"\x00\x00\x00\x18ftypisomcontent";
    Mock::given(method("GET"))
        .and(path("/v1/videos/task_ab/content"))
        .and(header("authorization", "Bearer raw-inference-secret"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(mp4))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(bytes(&app, "/media/video/content", lookup, "video/mp4").await, mp4);
}

#[tokio::test]
async fn redirects_and_url_only_images_are_never_followed_or_retried() {
    let (app, server, _, _) = router(true).await;
    login_app(&app, &server).await;
    catalog(&server).await;
    let view = response(&app, request("GET", "/media/session", "", &[MEDIA]), StatusCode::OK).await;
    let target = MockServer::start().await;
    let location = format!("{}/SENTINEL", target.uri());
    for upstream in [
        ResponseTemplate::new(307).insert_header("location", location.as_str()),
        ResponseTemplate::new(200).set_body_json(json!({"data":[{"url":location}]})),
        ResponseTemplate::new(200)
            .set_body_json(json!({"data":[{"b64_json":STANDARD.encode(b"<html>SENTINEL</html>")}]})),
    ] {
        Mock::given(path("/v1/images/generations"))
            .respond_with(upstream)
            .up_to_n_times(1)
            .expect(1)
            .mount(&server)
            .await;
        let input = json!({"binding":view["data"]["binding"],"model":"img","prompt":"fixture"});
        let out = response(
            &app,
            request("POST", "/media/image", &input.to_string(), &POST_HEADERS),
            StatusCode::BAD_GATEWAY,
        )
        .await;
        assert_eq!(out["code"], "CLOUD_PROTOCOL");
    }
    assert!(target.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn invalid_or_secret_catalog_metadata_is_rejected_as_a_whole() {
    let (app, server, _, _) = router(true).await;
    login_app(&app, &server).await;
    for (name, capabilities) in [
        ("Desktop desktop-secret", json!(["text-to-image"])),
        ("Image", json!(["text-to-video"])),
        ("Image", json!(["text-to-image", "text-to-image"])),
    ] {
        let catalog =
            json!({"models":[{"model_id":"image","display_name":name,"kind":"image","capabilities":capabilities}]});
        Mock::given(path("/api/openh3/media-models"))
            .respond_with(ok(catalog))
            .up_to_n_times(1)
            .expect(1)
            .mount(&server)
            .await;
        let denied = response(
            &app,
            request("GET", "/media-models", "", &[MEDIA]),
            StatusCode::BAD_GATEWAY,
        )
        .await;
        assert_eq!(denied["code"], "CLOUD_PROTOCOL");
    }
}

#[tokio::test]
async fn complete_2048_model_catalog_fits_the_transport() {
    let (server, _, svc, owner) = fixture().await;
    mount_login(&server).await;
    Mock::given(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    let models: Vec<_> = (0..2048)
        .map(|i| {
            json!({
                "model_id": format!("{}-{i:04}", "a".repeat(250)),
                "display_name":"b".repeat(256), "kind":"video","capabilities":["text-to-video","image-to-video"]
            })
        })
        .collect();
    Mock::given(path("/api/openh3/media-models"))
        .respond_with(ok(json!({"models": models})))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(svc.media_models(&owner).await.unwrap().models.len(), 2048);
}

#[tokio::test]
async fn inference_401_checks_the_native_grant_before_invalidating_and_never_replays() {
    let (app, server, _, _) = router(true).await;
    login_app(&app, &server).await;
    catalog(&server).await;
    let view = response(&app, request("GET", "/media/session", "", &[MEDIA]), StatusCode::OK).await;
    let input = json!({"binding":view["data"]["binding"],"model":"img","prompt":"fixture"}).to_string();
    Mock::given(path("/v1/images/generations"))
        .respond_with(ResponseTemplate::new(401))
        .expect(2)
        .mount(&server)
        .await;
    for (upstream, status, code) in [
        (ok(json!({"account":account()})), StatusCode::FORBIDDEN, "CLOUD_POLICY"),
        (
            ResponseTemplate::new(401)
                .set_body_json(json!({"success":false,"code":"authentication_failed","message":"SENTINEL"})),
            StatusCode::UNAUTHORIZED,
            "CLOUD_AUTH_REQUIRED",
        ),
    ] {
        Mock::given(path("/api/openh3/me"))
            .and(header("authorization", "Bearer desktop-secret"))
            .respond_with(upstream)
            .up_to_n_times(1)
            .expect(1)
            .mount(&server)
            .await;
        let denied = response(&app, request("POST", "/media/image", &input, &POST_HEADERS), status).await;
        assert_eq!(denied["code"], code);
    }
    let denied = response(
        &app,
        request("GET", "/media/session", "", &[MEDIA]),
        StatusCode::UNAUTHORIZED,
    )
    .await;
    assert_eq!(denied["code"], "CLOUD_AUTH_REQUIRED");
}

#[tokio::test]
async fn logout_cancels_in_flight_inference_and_closes_local_artifact_access() {
    use tokio::time::{Duration, timeout};
    let (app, server, _, _) = router(true).await;
    login_app(&app, &server).await;
    catalog(&server).await;
    let view = response(&app, request("GET", "/media/session", "", &[MEDIA]), StatusCode::OK).await;
    let input = json!({"binding":view["data"]["binding"],"model":"img","prompt":"fixture"});
    let started = Arc::new(tokio::sync::Notify::new());
    let notify = started.clone();
    Mock::given(path("/v1/images/generations"))
        .respond_with(move |_: &wiremock::Request| {
            notify.notify_one();
            ResponseTemplate::new(200)
                .set_delay(Duration::from_secs(20))
                .set_body_json(json!({"data":[{"b64_json":"unused"}]}))
        })
        .expect(1)
        .mount(&server)
        .await;
    let submitting =
        tokio::spawn(
            app.clone()
                .oneshot(request("POST", "/media/image", &input.to_string(), &POST_HEADERS)),
        );
    timeout(Duration::from_secs(10), started.notified()).await.unwrap();
    response(
        &app,
        request("POST", "/logout", "{}", &[CAP, CSRF[0], CSRF[1], CSRF[2]]),
        StatusCode::OK,
    )
    .await;
    let denied = timeout(Duration::from_secs(5), submitting)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(denied.status(), StatusCode::CONFLICT);
    let denied = response(
        &app,
        request("GET", "/media/session", "", &[MEDIA]),
        StatusCode::UNAUTHORIZED,
    )
    .await;
    assert_eq!(denied["code"], "CLOUD_AUTH_REQUIRED");
}

#[tokio::test]
async fn encrypted_video_receipts_survive_restart_but_cannot_cross_grants_or_local_owners() {
    let (server, db, svc, alice) = fixture().await;
    sqlx::query(
        "INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES('bob','bob','unused',0,0)",
    )
    .execute(db.pool())
    .await
    .unwrap();
    Mock::given(path("/api/openh3/login"))
        .respond_with(ok(pending()))
        .expect(3)
        .mount(&server)
        .await;
    Mock::given(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&server)
        .await;
    Mock::given(path("/api/openh3/media-models"))
        .respond_with(ok(json!({"models":[{
            "model_id":"vid","kind":"video","display_name":"Video","capabilities":["text-to-video"]
        }]})))
        .mount(&server)
        .await;
    Mock::given(path("/v1/videos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":"task_public1","status":"queued"})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(path("/v1/videos/task_public1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":"task_public1","status":"in_progress"})))
        .expect(1)
        .mount(&server)
        .await;
    svc.login(&alice, login()).await.unwrap();
    let a = svc.media_session(&alice).await.unwrap();
    let video = svc
        .create_video(
            &alice,
            CloudMediaVideoRequest {
                binding: a.binding.clone(),
                model: "vid".into(),
                prompt: "fixture".into(),
                size: None,
                seconds: None,
                reference: None,
            },
        )
        .await
        .unwrap();
    let job = |binding: &str| CloudMediaJobRequest {
        binding: binding.into(),
        job_id: video.job_id.clone(),
    };
    let restarted = service_for(&db, &server);
    assert_eq!(
        restarted.video_status(&alice, job(&a.binding)).await.unwrap().status,
        CloudMediaStatus::InProgress
    );
    restarted.login("bob", login()).await.unwrap();
    let b = restarted.media_session("bob").await.unwrap();
    assert_ne!(b.binding, a.binding);
    assert_ne!(b.account_key, a.account_key);
    assert!(matches!(
        restarted.video_status("bob", job(&a.binding)).await,
        Err(CloudAccountError::Conflict)
    ));
    assert!(matches!(
        restarted.video_status("bob", job(&b.binding)).await,
        Err(CloudAccountError::MediaJobNotFound)
    ));
    restarted.logout(&alice).await.unwrap();
    restarted.login(&alice, login()).await.unwrap();
    let replacement = restarted.media_session(&alice).await.unwrap();
    assert_ne!(replacement.binding, a.binding);
    assert_eq!(replacement.account_key, a.account_key);
    assert!(matches!(
        restarted.video_status(&alice, job(&a.binding)).await,
        Err(CloudAccountError::Conflict)
    ));
    assert!(matches!(
        restarted.video_status(&alice, job(&replacement.binding)).await,
        Err(CloudAccountError::MediaJobNotFound)
    ));
}

#[tokio::test]
async fn scoped_media_key_cannot_access_account_management_and_browser_cannot_use_it() {
    let (app, server, _, _) = router(true).await;
    for (path, method_name, headers, status, code) in [
        (
            "/login",
            "POST",
            vec![MEDIA, CSRF[0], CSRF[1], CSRF[2]],
            StatusCode::UNAUTHORIZED,
            "LOCAL_AUTH_REQUIRED",
        ),
        (
            "/wallet",
            "GET",
            vec![MEDIA],
            StatusCode::UNAUTHORIZED,
            "LOCAL_AUTH_REQUIRED",
        ),
        (
            "/media-models",
            "GET",
            vec![],
            StatusCode::UNAUTHORIZED,
            "LOCAL_AUTH_REQUIRED",
        ),
        (
            "/media-models",
            "GET",
            vec![MEDIA, ("origin", "https://evil.example")],
            StatusCode::UNAUTHORIZED,
            "LOCAL_AUTH_REQUIRED",
        ),
        (
            "/media-models",
            "GET",
            vec![MEDIA, ("x-openh3-runtime-token", "helper")],
            StatusCode::UNAUTHORIZED,
            "LOCAL_AUTH_REQUIRED",
        ),
        (
            "/media/image",
            "POST",
            vec![MEDIA, CSRF[0]],
            StatusCode::FORBIDDEN,
            "CSRF_INVALID",
        ),
        (
            "/media/video/status",
            "GET",
            vec![MEDIA],
            StatusCode::METHOD_NOT_ALLOWED,
            "CLOUD_METHOD_INVALID",
        ),
        (
            "/media-models",
            "GET",
            vec![MEDIA],
            StatusCode::UNAUTHORIZED,
            "CLOUD_AUTH_REQUIRED",
        ),
    ] {
        let out = response(
            &app,
            request(
                method_name,
                path,
                if method_name == "POST" { "{}" } else { "" },
                &headers,
            ),
            status,
        )
        .await;
        assert_eq!(out["code"], code);
    }
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn empty_or_legacy_catalog_and_wrong_grant_never_submit_or_fetch() {
    let (app, server, _, _) = router(true).await;
    login_app(&app, &server).await;
    // No matching wiremock route returns a plain 404, without an account envelope.
    let empty = response(&app, request("GET", "/media-models", "", &[MEDIA]), StatusCode::OK).await;
    assert_eq!(empty["data"]["models"], json!([]));
    let binding = empty["data"]["binding"].as_str().unwrap();
    for (path, input, status, code) in [
        (
            "/media/image",
            json!({"binding":binding,"model":"img","prompt":"p"}),
            StatusCode::FORBIDDEN,
            "CLOUD_MEDIA_MODEL_UNAVAILABLE",
        ),
        (
            "/media/image",
            json!({"binding":"old","model":"img","prompt":"p"}),
            StatusCode::CONFLICT,
            "CLOUD_CONFLICT",
        ),
        (
            "/media/image",
            json!({"binding":binding,"model":"img","prompt":"p","key":"secret"}),
            StatusCode::BAD_REQUEST,
            "CLOUD_INPUT_INVALID",
        ),
        (
            "/media/video",
            json!({"binding":binding,"model":"vid","prompt":"p","seconds":0}),
            StatusCode::BAD_REQUEST,
            "CLOUD_INPUT_INVALID",
        ),
        (
            "/media/video",
            json!({"binding":binding,"model":"vid","prompt":"p","reference":{"mime_type":"image/png","data":"data:evil"}}),
            StatusCode::BAD_REQUEST,
            "CLOUD_INPUT_INVALID",
        ),
        (
            "/media/video/status",
            json!({"binding":binding,"job_id":"../wallet"}),
            StatusCode::NOT_FOUND,
            "CLOUD_MEDIA_JOB_NOT_FOUND",
        ),
    ] {
        let out = response(&app, request("POST", path, &input.to_string(), &POST_HEADERS), status).await;
        assert_eq!(out["code"], code);
    }
    catalog(&server).await;
    for (model, status, code) in [
        (
            "vid",
            StatusCode::UNPROCESSABLE_ENTITY,
            "CLOUD_MEDIA_CAPABILITY_UNSUPPORTED",
        ),
        ("absent", StatusCode::FORBIDDEN, "CLOUD_MEDIA_MODEL_UNAVAILABLE"),
        ("img", StatusCode::FORBIDDEN, "CLOUD_MEDIA_MODEL_UNAVAILABLE"),
    ] {
        let input = json!({"binding":binding,"model":model,"prompt":"text only"});
        let out = response(
            &app,
            request("POST", "/media/video", &input.to_string(), &POST_HEADERS),
            status,
        )
        .await;
        assert_eq!(out["code"], code);
    }
    assert!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .all(|r| !r.url.path().starts_with("/v1/"))
    );
}
