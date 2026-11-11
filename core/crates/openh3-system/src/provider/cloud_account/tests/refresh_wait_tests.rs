use super::*;
use axum::{
    Json, Router,
    extract::{Request, State},
    routing::any,
};
use std::{
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::sync::Notify;

#[derive(Default)]
struct RefreshGateway {
    actor: AtomicUsize,
    refreshes: AtomicUsize,
    activated: Mutex<Vec<String>>,
    reads: Mutex<Vec<String>>,
    started: Notify,
    release: Notify,
}
async fn gateway(State(f): State<Arc<RefreshGateway>>, request: Request) -> Json<Value> {
    let path = request.uri().path();
    let auth = request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let actor = f.actor.load(Ordering::SeqCst);
    let mut credentials = creds();
    credentials["access_token"] = json!(format!("synthetic-access-{actor}"));
    let data = match path {
        "/api/openh3/capabilities" => capabilities(),
        "/api/openh3/login" => {
            let mut profile = account();
            profile["id"] = json!(format!("actor-{actor}"));
            json!({"state":"pending","account":profile,"credentials":credentials})
        }
        "/api/openh3/activate" => {
            f.activated.lock().unwrap().push(auth);
            active()
        }
        "/api/openh3/token" => {
            f.refreshes.fetch_add(1, Ordering::SeqCst);
            f.started.notify_one();
            f.release.notified().await;
            credentials["access_token"] = json!("synthetic-rotated-A");
            json!({"credentials":credentials})
        }
        "/api/openh3/revoke" => json!({"state":"revoked"}),
        "/api/openh3/models" => {
            f.reads.lock().unwrap().push(auth);
            super::billing_tests::catalog(vec![super::billing_tests::model("verified", "Responses")])
        }
        "/api/openh3/wallet" => {
            f.reads.lock().unwrap().push(auth);
            json!({"read_started_at":1,"as_of":1,"wallet_balance":{"status":"available","amount":{"amount":"222","unit":"new_api_quota"}},"device_limit":{"status":"unlimited"},"billing_preference":"wallet_only","subscriptions":{"status":"available","items":[]}})
        }
        "/api/openh3/usage" => {
            f.reads.lock().unwrap().push(auth);
            json!({"read_started_at":1,"as_of":1,"status":"available","completeness":"not_reconciled","items":[],"page":1,"page_size":20,"has_more":false})
        }
        "/api/openh3/topup/options" => {
            f.reads.lock().unwrap().push(auth);
            json!({"options":[],"status":"unavailable","unsupported_providers":["stripe"]})
        }
        "/api/openh3/topup/quote" => {
            f.reads.lock().unwrap().push(auth);
            super::topup_tests::quote()
        }
        "/api/openh3/topup/create" => {
            f.reads.lock().unwrap().push(auth);
            let mut o = super::topup_tests::order("pending", "available", true);
            o["owner_id"] = json!(format!("actor-{actor}"));
            o
        }
        "/api/openh3/topup/orders" => {
            f.reads.lock().unwrap().push(auth);
            json!({"items":[],"has_more":false,"next_before_id":0})
        }
        _ => panic!("unexpected fixture route"),
    };
    Json(json!({"success":true,"code":"ok","message":"ok","data":data}))
}

async fn fixture_with_refresh() -> (
    Arc<RefreshGateway>,
    openh3_db::Database,
    Arc<CloudAccountService>,
    String,
    tokio::task::JoinHandle<()>,
) {
    let f = Arc::new(RefreshGateway::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new().route("/{*path}", any(gateway)).with_state(f.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let db = init_database_memory().await.unwrap();
    let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let svc = Arc::new(
        CloudAccountService::new(
            Arc::new(SqliteCloudAccountRepository::new(db.pool().clone())),
            [7; 32],
            CloudAccountConfig {
                enabled: true,
                endpoint: Some(endpoint),
                allow_insecure_loopback: true,
            },
        )
        .unwrap(),
    );
    svc.login(&owner, login()).await.unwrap();
    let encrypted: String = sqlx::query_scalar("SELECT encrypted FROM cloud_accounts WHERE owner=?")
        .bind(&owner)
        .fetch_one(db.pool())
        .await
        .unwrap();
    let mut stored: Value =
        serde_json::from_str(&openh3_common::decrypt_string(&encrypted, &[7; 32]).unwrap()).unwrap();
    stored["credentials"]["access_expires_at"] = json!(now());
    sqlx::query("UPDATE cloud_accounts SET encrypted=? WHERE owner=?")
        .bind(openh3_common::encrypt_string(&stored.to_string(), &[7; 32]).unwrap())
        .bind(&owner)
        .execute(db.pool())
        .await
        .unwrap();
    (f, db, svc, owner, server)
}
#[tokio::test]
async fn billing_reads_queued_behind_refresh_keep_original_grant() {
    for replace in [true, false] {
        tokio::time::timeout(Duration::from_secs(15), queued_reads(replace))
            .await
            .unwrap();
    }
}
async fn queued_reads(replace: bool) {
    let (f, db, svc, owner, server) = fixture_with_refresh().await;
    let refresh = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.session(&owner).await }
    });
    f.started.notified().await;
    let models = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.models(&owner).await }
    });
    let wallet = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.wallet(&owner).await }
    });
    let usage = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.usage(&owner, serde_json::from_value(json!({})).unwrap()).await }
    });
    let session = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.session(&owner).await }
    });
    let topup = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move {
            svc.topup_create(&owner,serde_json::from_value(json!({"amount":10,"payment_method":"alipay","quote_version":"b".repeat(64),"idempotency_key":"stable-original-key"})).unwrap()).await
        }
    });
    let options = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.topup_options(&owner).await }
    });
    let quote = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move {
            svc.topup_quote(
                &owner,
                serde_json::from_value(json!({"amount":10,"payment_method":"alipay"})).unwrap(),
            )
            .await
        }
    });
    let orders = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move {
            svc.topup_orders(&owner, serde_json::from_value(json!({})).unwrap())
                .await
        }
    });
    let flight = svc.flights.lock().await.get(&owner).unwrap().clone();
    // The map, refresh holder and this observation own three handles.
    // Eight more prove every spawned call reached the held refresh
    // mutex, after its original SQL snapshot completed in usable().
    while Arc::strong_count(&flight) != 11 {
        tokio::task::yield_now().await;
    }
    if replace {
        svc.logout(&owner).await.unwrap();
        f.actor.store(1, Ordering::SeqCst);
        let login_b = tokio::spawn({
            let svc = svc.clone();
            let owner = owner.clone();
            async move { svc.login(&owner, login()).await }
        });
        loop {
            let subject: Option<String> = sqlx::query_scalar("SELECT subject FROM cloud_accounts WHERE owner=?")
                .bind(&owner)
                .fetch_one(db.pool())
                .await
                .unwrap();
            if subject.as_deref() == Some("actor-1") {
                break;
            }
            tokio::task::yield_now().await;
        }
        // Leave B pending: an A operation must not activate it, even
        // when the legitimate B login continuation is no longer running.
        login_b.abort();
        let _ = login_b.await;
    }
    f.release.notify_one();
    let refreshed = refresh.await.unwrap();
    let (models, wallet, usage, session) = tokio::join!(models, wallet, usage, session);
    let (models, wallet, usage, session) = (models.unwrap(), wallet.unwrap(), usage.unwrap(), session.unwrap());
    let (topup, options, quote, orders) = tokio::join!(topup, options, quote, orders);
    let (topup, options, quote, orders) = (topup.unwrap(), options.unwrap(), quote.unwrap(), orders.unwrap());
    server.abort();
    let _ = server.await;
    assert_eq!(f.refreshes.load(Ordering::SeqCst), 1);
    if replace {
        assert_eq!(refreshed.unwrap_err(), CloudAccountError::Conflict);
        assert_eq!(models.unwrap_err(), CloudAccountError::Conflict);
        assert_eq!(wallet.unwrap_err(), CloudAccountError::Conflict);
        assert_eq!(usage.unwrap_err(), CloudAccountError::Conflict);
        assert_eq!(session.unwrap_err(), CloudAccountError::Conflict);
        assert_eq!(topup.err().unwrap(), CloudAccountError::Conflict);
        assert_eq!(options.unwrap_err(), CloudAccountError::Conflict);
        assert_eq!(quote.unwrap_err(), CloudAccountError::Conflict);
        assert_eq!(orders.err().unwrap(), CloudAccountError::Conflict);
        assert!(f.reads.lock().unwrap().is_empty());
        assert_eq!(*f.activated.lock().unwrap(), vec!["Bearer synthetic-access-0"]);
        let (state, models): (String, String) = sqlx::query_as(
            "SELECT c.state,p.models FROM cloud_accounts c JOIN providers p ON p.id=c.provider_id WHERE c.owner=?",
        )
        .bind(&owner)
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(state, "pending");
        assert_eq!(models, "[]");
    } else {
        assert!(matches!(
            refreshed.unwrap(),
            CloudAccountSessionResponse::Connected { .. }
        ));
        models.unwrap();
        wallet.unwrap();
        usage.unwrap();
        session.unwrap();
        topup.unwrap();
        options.unwrap();
        quote.unwrap();
        orders.unwrap();
        assert_eq!(*f.reads.lock().unwrap(), vec!["Bearer synthetic-rotated-A"; 7]);
        assert_eq!(*f.activated.lock().unwrap(), vec!["Bearer synthetic-access-0"]);
    }
}
