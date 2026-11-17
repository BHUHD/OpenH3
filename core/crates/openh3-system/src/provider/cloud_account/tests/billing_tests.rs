use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn connected() -> (MockServer, openh3_db::Database, Arc<CloudAccountService>, String) {
    let f = fixture().await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/login"))
        .respond_with(ok(pending()))
        .up_to_n_times(1)
        .expect(1)
        .mount(&f.0)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&f.0)
        .await;
    f.2.login(&f.3, login()).await.unwrap();
    f
}

fn quote() -> Value {
    json!({"group":"vip","kind":"dynamic_expression","unit":"USD_by_effective_expression","group_ratio":"2.5","cache_write_mode":"none","version":"version-1","quota_per_usd":"500000","expression":"p * 0.000001","expression_semantics":"mature_billing_engine_versioned_expression_then_group_ratio_and_quota_conversion","function_surcharges_usd_per_1000_calls":{"lookup":"6.5"},"implied_search_usd_per_request":"0.01","conditional_violation_surcharge":{"usd":"0.1","condition":"existing_violation_fee_signal_after_normal_refund_quota_rounding_applies"}})
}
pub(super) fn model(id: &str, protocol: &str) -> Value {
    json!({"model_id":id,"display_name":"Verified text","provider":"verified-provider","purpose":"text","protocol":protocol,"input_capabilities":["text"],"supports_tools":true,"context_limit":8192,"max_output_tokens":1024,"compatibility_version":"v1","evidence":"controlled evidence","quotes":[quote()]})
}
pub(super) fn catalog(models: Vec<Value>) -> Value {
    json!({"status":"available","quote_semantics":"observed_rules_not_frozen_final_charge","models":models})
}

#[tokio::test]
async fn catalog_preserves_quotes_and_excludes_ambiguous_ids_then_withdraws_reused_selection() {
    let (server, db, svc, owner) = connected().await;
    Mock::given(method("GET"))
        .and(path("/api/openh3/models"))
        .respond_with(ok(catalog(vec![
            model("chat", "ChatCompletions"),
            model("response", "Responses"),
            model("same", "ChatCompletions"),
            model("same", "Responses"),
        ])))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    let result = svc.models(&owner).await.unwrap();
    assert_eq!(result.models.len(), 4);
    assert_eq!(serde_json::to_value(&result.models[0].quotes[0]).unwrap(), quote());
    assert_eq!(
        result.models[2].selection_unavailable_reason.as_deref(),
        Some("ambiguous_model_protocol")
    );
    let stored = svc.read(&owner).await.unwrap().unwrap();
    let models: String = sqlx::query_scalar("SELECT models FROM providers WHERE id=?")
        .bind(&stored.provider_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Vec<String>>(&models).unwrap(),
        vec!["chat", "response"]
    );
    let settings: String = sqlx::query_scalar("SELECT model_settings FROM providers WHERE id=?")
        .bind(&stored.provider_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&settings).unwrap()["chat"]["supports_tools"],
        true
    );
    svc.authorize_model(&owner, &stored.provider_id, "response", "Responses")
        .await
        .unwrap();
    assert_eq!(
        svc.authorize_model(&owner, &stored.provider_id, "response", "ChatCompletions")
            .await,
        Err(CloudAccountError::Policy)
    );
    Mock::given(method("GET")).and(path("/api/openh3/models")).respond_with(ok(json!({"status":"unavailable","reason":"native_inference_unavailable","quote_semantics":"observed_rules_not_frozen_final_charge","models":[]}))).mount(&server).await;
    assert_eq!(svc.models(&owner).await.unwrap().status, "unavailable");
    assert_eq!(
        svc.authorize_model(&owner, &stored.provider_id, "response", "Responses")
            .await,
        Err(CloudAccountError::Policy)
    );
}

#[tokio::test]
async fn earlier_available_catalog_cannot_overwrite_later_withdrawal_in_same_generation() {
    let (server, _, svc, owner) = connected().await;
    Mock::given(path("/api/openh3/models"))
        .respond_with(
            ok(catalog(vec![model("chat", "ChatCompletions")])).set_delay(std::time::Duration::from_millis(150)),
        )
        .up_to_n_times(1)
        .mount(&server)
        .await;
    let first = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.models(&owner).await }
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if server
                .received_requests()
                .await
                .unwrap()
                .iter()
                .any(|r| r.url.path().ends_with("/models"))
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    Mock::given(path("/api/openh3/models")).respond_with(ok(json!({"status":"unavailable","reason":"native_inference_unavailable","quote_semantics":"observed_rules_not_frozen_final_charge","models":[]}))).mount(&server).await;
    svc.models(&owner).await.unwrap();
    first.await.unwrap().unwrap();
    let s = svc.read(&owner).await.unwrap().unwrap();
    assert_eq!(
        svc.authorize_model(&owner, &s.provider_id, "chat", "ChatCompletions")
            .await,
        Err(CloudAccountError::Policy)
    );
}

#[tokio::test]
async fn queued_catalog_request_keeps_original_account_before_waiting() {
    let (server, _, svc, owner) = connected().await;
    let gate = Arc::new(tokio::sync::Mutex::new(()));
    svc.catalog_flights.lock().await.insert(owner.clone(), gate.clone());
    let held = gate.lock().await;
    let queued = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.models(&owner).await }
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while Arc::strong_count(&gate) < 3 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    Mock::given(path("/api/openh3/revoke"))
        .respond_with(ok(json!({"state":"revoked"})))
        .mount(&server)
        .await;
    svc.logout(&owner).await.unwrap();
    Mock::given(path("/api/openh3/login"))
        .respond_with(ok(pending()))
        .mount(&server)
        .await;
    svc.login(&owner, login()).await.unwrap();
    drop(held);
    assert_eq!(queued.await.unwrap().unwrap_err(), CloudAccountError::Conflict);
    assert!(
        !server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .any(|r| r.url.path().ends_with("/models"))
    );
}

#[tokio::test]
async fn queued_catalog_reads_reload_same_grant_credentials_before_io() {
    for expire in [true, false] {
        tokio::time::timeout(std::time::Duration::from_secs(5), queued_catalog_credentials(expire))
            .await
            .unwrap();
    }
}

async fn queued_catalog_credentials(expire: bool) {
    let (server, db, svc, owner) = connected().await;
    let mut stored = svc.read(&owner).await.unwrap().unwrap();
    let gate = Arc::new(tokio::sync::Mutex::new(()));
    svc.catalog_flights.lock().await.insert(owner.clone(), gate.clone());
    let held = gate.lock().await;
    let first = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.models(&owner).await }
    });
    let second = tokio::spawn({
        let svc = svc.clone();
        let owner = owner.clone();
        async move { svc.models(&owner).await }
    });
    // Map + observer + two callers: both original credential reads completed
    // and both public calls are now waiting at the catalog mutex.
    while Arc::strong_count(&gate) != 4 {
        tokio::task::yield_now().await;
    }
    let mut fresh = creds();
    fresh["access_token"] = json!("synthetic-fresh-access");
    fresh["refresh_token"] = json!("synthetic-fresh-refresh");
    fresh["session_expires_at"] = json!(stored.credentials.session_expires_at);
    if expire {
        // Deterministically model elapsed expiry while the catalog is queued.
        stored.credentials.access_expires_at = now() - 1;
    } else {
        // A different operation rotated this same grant while it was queued.
        stored.credentials = serde_json::from_value(fresh.clone()).unwrap();
    }
    sqlx::query("UPDATE cloud_accounts SET encrypted=? WHERE owner=?")
        .bind(openh3_common::encrypt_string(&serde_json::to_string(&stored).unwrap(), &[7; 32]).unwrap())
        .bind(&owner)
        .execute(db.pool())
        .await
        .unwrap();
    Mock::given(method("POST"))
        .and(path("/api/openh3/token"))
        .respond_with(ok(json!({"credentials":fresh})))
        .mount(&server)
        .await;
    Mock::given(path("/api/openh3/models"))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(json!({"success":false,"code":"authentication_failed","message":"fixed fixture error"})),
        )
        .mount(&server)
        .await;
    Mock::given(path("/api/openh3/models"))
        .and(wiremock::matchers::header(
            "authorization",
            "Bearer synthetic-fresh-access",
        ))
        .respond_with(ok(catalog(vec![model("fresh", "Responses")])))
        .with_priority(1)
        .mount(&server)
        .await;
    drop(held);
    let (first, second) = tokio::join!(first, second);
    first.unwrap().unwrap();
    second.unwrap().unwrap();
    let (state, models): (String, String) = sqlx::query_as(
        "SELECT c.state,p.models FROM cloud_accounts c JOIN providers p ON p.id=c.provider_id WHERE c.owner=?",
    )
    .bind(&owner)
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(state, "active");
    assert_eq!(models, "[\"fresh\"]");
    let current = svc.read(&owner).await.unwrap().unwrap();
    assert_eq!(current.generation, stored.generation);
    assert_eq!(current.provider_id, stored.provider_id);
    assert_eq!(current.credentials.access_token, "synthetic-fresh-access");
    assert_eq!(current.credentials.refresh_token, "synthetic-fresh-refresh");
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests.iter().filter(|r| r.url.path().ends_with("/token")).count(),
        usize::from(expire)
    );
    let models: Vec<_> = requests.iter().filter(|r| r.url.path().ends_with("/models")).collect();
    assert_eq!(models.len(), 2);
    assert!(
        models
            .iter()
            .all(|r| r.headers["authorization"] == "Bearer synthetic-fresh-access")
    );
}

#[tokio::test]
async fn signed_wallet_and_refund_usage_remain_authoritative_and_filters_precede_io() {
    let (server, _, svc, owner) = connected().await;
    let wallet = json!({"read_started_at":100,"as_of":101,"wallet_balance":{"status":"available","amount":{"amount":"-12","unit":"new_api_quota","display_amount":{"amount":"-0.000024","currency":"USD"}}},"device_limit":{"status":"unlimited"},"billing_preference":"subscription_first","subscriptions":{"status":"available","items":[{"allowance_state":"reset_pending","id":"s1","remaining":{"amount":"-1","unit":"new_api_quota","display_amount":{"amount":"-0.000002","currency":"USD"}},"unlimited":false,"used":{"amount":"20","unit":"new_api_quota","display_amount":{"amount":"0.00004","currency":"USD"}},"expires_at":200,"next_reset_at":99,"allow_wallet_overflow":true}]}});
    Mock::given(method("GET"))
        .and(path("/api/openh3/wallet"))
        .respond_with(ok(wallet.clone()))
        .up_to_n_times(1)
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(serde_json::to_value(svc.wallet(&owner).await.unwrap()).unwrap(), wallet);
    for display in [
        json!({"amount":"0.5","currency":"CNY"}),
        json!({"amount":"NaN","currency":"USD"}),
        json!({"amount":"1e3","currency":"USD"}),
        json!({"amount":"--1","currency":"USD"}),
    ] {
        let mut invalid = wallet.clone();
        invalid["wallet_balance"]["amount"]["display_amount"] = display;
        Mock::given(path("/api/openh3/wallet"))
            .respond_with(ok(invalid))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        assert_eq!(svc.wallet(&owner).await.unwrap_err(), CloudAccountError::Protocol);
    }
    let usage = json!({"read_started_at":100,"as_of":101,"status":"available","completeness":"not_reconciled","items":[{"id":"99","created_at":90,"kind":"refund","direction":"credit","quota":null,"model":"chat","prompt_tokens":"9007199254740993","completion_tokens":"2","request_id":"request","token_id":"3","device_id":"device-1","funding":{"billing_source":"wallet","wallet_quota_deducted":"-12"}}],"page":1,"page_size":20,"has_more":false});
    Mock::given(method("POST"))
        .and(path("/api/openh3/usage"))
        .respond_with(ok(usage.clone()))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        serde_json::to_value(
            svc.usage(&owner, serde_json::from_value(json!({})).unwrap())
                .await
                .unwrap()
        )
        .unwrap(),
        usage
    );
    for input in [
        json!({"page":0}),
        json!({"page":1000001}),
        json!({"page_size":101}),
        json!({"start_time":2,"end_time":1}),
        json!({"model":"a".repeat(257)}),
    ] {
        assert_eq!(
            svc.usage(&owner, serde_json::from_value(input).unwrap())
                .await
                .unwrap_err(),
            CloudAccountError::Input
        );
    }
}

#[tokio::test]
async fn token_request_and_expression_quotes_keep_every_field_and_group_order() {
    let (server, _, svc, owner) = connected().await;
    let mut m = model("verified", "Responses");
    let token = json!({"group":"priority","kind":"token","unit":"USD_per_million_tokens","group_ratio":"2","input":"1.20","output":"5.7","cache_read":"0.1","cache_write":"1.3","cache_write_1h":"2.4","cache_write_12h":"3.5","cache_write_mode":"claude_ttl","version":"v-token","quota_per_usd":"500000","function_surcharges_usd_per_1000_calls":{"lookup":"0.4"},"implied_search_usd_per_request":"0.001"});
    let request = json!({"group":"fallback","kind":"request","unit":"USD_per_request","group_ratio":"0","per_request":"0","cache_write_mode":"none","version":"v-request","quota_per_usd":"500000"});
    let quotes = vec![token, request, quote()];
    m["quotes"] = json!(quotes);
    Mock::given(path("/api/openh3/models"))
        .respond_with(ok(catalog(vec![m])))
        .mount(&server)
        .await;
    assert_eq!(
        serde_json::to_value(&svc.models(&owner).await.unwrap().models[0].quotes).unwrap(),
        json!(quotes)
    );
}

#[tokio::test]
async fn unavailable_and_paged_usage_are_never_lifetime_reconciliation() {
    let (server, _, svc, owner) = connected().await;
    for reason in ["consume_logging_disabled", "unsupported_log_database"] {
        let value = json!({"read_started_at":50,"as_of":50,"status":"unavailable","reason":reason,"completeness":"not_reconciled","items":null,"page":1,"page_size":20,"has_more":false});
        Mock::given(path("/api/openh3/usage"))
            .respond_with(ok(value.clone()))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        assert_eq!(
            serde_json::to_value(
                svc.usage(&owner, serde_json::from_value(json!({})).unwrap())
                    .await
                    .unwrap()
            )
            .unwrap(),
            value
        );
    }
    for page in [1, 2, 1] {
        let value = json!({"read_started_at":50,"as_of":50,"status":"available","completeness":"not_reconciled","items":if page==1 {vec![json!({"id":"77","created_at":45,"kind":"consume","direction":"debit","quota":{"amount":"-2","unit":"new_api_quota","display_amount":{"amount":"-0.000004","currency":"USD"}},"model":"verified","prompt_tokens":"1","completion_tokens":"2","request_id":""})]}else{vec![]},"page":page,"page_size":1,"has_more":page==1});
        Mock::given(path("/api/openh3/usage")).and(wiremock::matchers::body_partial_json(json!({"page":page,"page_size":1,"start_time":40,"end_time":50,"model":"verified","device_id":"device-1"}))).respond_with(ok(value.clone())).up_to_n_times(1).mount(&server).await;
        let query = serde_json::from_value(
            json!({"page":page,"page_size":1,"start_time":40,"end_time":50,"model":"verified","device_id":"device-1"}),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(svc.usage(&owner, query).await.unwrap()).unwrap(),
            value
        );
    }
}

#[tokio::test]
async fn delayed_old_catalog_and_old_401_cannot_paint_or_disable_replacement() {
    for unauthorized in [false, true] {
        let (server, db, svc, owner) = connected().await;
        let response = if unauthorized {
            ResponseTemplate::new(401).set_body_json(
                json!({"success":false,"code":"authentication_failed","message":"private upstream detail"}),
            )
        } else {
            ok(catalog(vec![model("old", "Responses")]))
        };
        Mock::given(path("/api/openh3/models"))
            .respond_with(response.set_delay(std::time::Duration::from_millis(150)))
            .up_to_n_times(1)
            .expect(1)
            .mount(&server)
            .await;
        let old = tokio::spawn({
            let svc = svc.clone();
            let owner = owner.clone();
            async move { svc.models(&owner).await }
        });
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if server
                    .received_requests()
                    .await
                    .unwrap()
                    .iter()
                    .any(|r| r.url.path().ends_with("/models"))
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        Mock::given(path("/api/openh3/revoke"))
            .respond_with(ok(json!({"state":"revoked"})))
            .mount(&server)
            .await;
        svc.logout(&owner).await.unwrap();
        Mock::given(path("/api/openh3/login"))
            .respond_with(ok(pending()))
            .mount(&server)
            .await;
        svc.login(&owner, login()).await.unwrap();
        let new = svc.read(&owner).await.unwrap().unwrap();
        assert_eq!(old.await.unwrap().unwrap_err(), CloudAccountError::Conflict);
        let (enabled, models): (bool, String) = sqlx::query_as("SELECT enabled,models FROM providers WHERE id=?")
            .bind(new.provider_id)
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert!(enabled);
        assert_eq!(models, "[]");
        assert!(matches!(
            svc.session(&owner).await.unwrap(),
            CloudAccountSessionResponse::Connected { .. }
        ));
    }
}

#[tokio::test]
async fn large_valid_catalog_and_oversized_or_malformed_catalog_fail_closed() {
    let (server, db, svc, owner) = connected().await;
    let mut m = model("chat", "ChatCompletions");
    m["evidence"] = json!("e".repeat(100000));
    Mock::given(path("/api/openh3/models"))
        .respond_with(ok(catalog(vec![m])))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    assert_eq!(svc.models(&owner).await.unwrap().models[0].evidence.len(), 100000);
    for bad in [
        ok(catalog(vec![json!({"inference_key":"private-fixture"})])),
        ResponseTemplate::new(200).set_body_bytes(vec![b'x'; 8 * 1024 * 1024 + 1]),
    ] {
        Mock::given(path("/api/openh3/models"))
            .respond_with(bad)
            .up_to_n_times(1)
            .mount(&server)
            .await;
        assert_eq!(svc.models(&owner).await.unwrap_err(), CloudAccountError::Protocol);
        let models: String = sqlx::query_scalar("SELECT models FROM providers WHERE managed_by='cloud_account'")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(models, "[]");
    }
}

#[tokio::test]
async fn gateway_enforces_success_operation_caps_and_strict_error_caps_for_declared_and_chunked_bodies() {
    for (operation, status, size, declared, accepted) in [
        ("models", 200, 100_000, false, true),
        ("wallet", 200, 100_000, false, true),
        ("usage", 200, 100_000, false, true),
        ("models", 200, 8 * 1024 * 1024 + 1, true, false),
        ("models", 200, 8 * 1024 * 1024 + 1, false, false),
        ("wallet", 200, 512 * 1024 + 1, false, false),
        ("usage", 200, 2 * 1024 * 1024 + 1, false, false),
        ("topup/options", 200, 100_000, false, true),
        ("topup/orders", 200, 128 * 1024 + 1, true, false),
        ("topup/orders", 200, 128 * 1024 + 1, false, false),
        ("topup/create", 200, 65537, true, false),
        ("topup/options", 503, 65537, true, false),
        ("topup/options", 503, 65537, false, false),
        ("login", 200, 70_000, false, false),
        ("models", 401, 70_000, false, false),
    ] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut part = [0; 1024];
            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let count = socket.read(&mut part).await.unwrap();
                assert!(count > 0, "fixture request ended before its headers");
                request.extend_from_slice(&part[..count]);
                assert!(request.len() <= 16384);
            }
            if declared {
                socket
                    .write_all(
                        format!("HTTP/1.1 {status} OK\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n")
                            .as_bytes(),
                    )
                    .await
                    .unwrap();
                // No body: the declared bound must reject before waiting on data.
            } else {
                socket
                    .write_all(
                        format!("HTTP/1.1 {status} OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
                            .as_bytes(),
                    )
                    .await
                    .unwrap();
                let body = if status == 200 {
                    json!({"success":true,"code":"ok","message":"ok","data":"x".repeat(size)})
                } else {
                    json!({"success":false,"code":"authentication_failed","message":"x".repeat(size),"data":null})
                }
                .to_string();
                for chunk in body.as_bytes().chunks(8192) {
                    let frame = format!("{:x}\r\n", chunk.len());
                    if socket.write_all(frame.as_bytes()).await.is_err()
                        || socket.write_all(chunk).await.is_err()
                        || socket.write_all(b"\r\n").await.is_err()
                    {
                        return;
                    }
                }
                let _ = socket.write_all(b"0\r\n\r\n").await;
            }
        });
        let gateway = client::Gateway::new(&CloudAccountConfig {
            enabled: true,
            endpoint: Some(endpoint),
            allow_insecure_loopback: true,
        })
        .unwrap()
        .unwrap();
        let result = gateway.get::<Value>(operation, None).await;
        if accepted {
            assert_eq!(result.unwrap().as_str().unwrap().len(), size);
        } else {
            assert_eq!(result.unwrap_err(), CloudAccountError::Protocol);
        }
        server.await.unwrap();
    }
}
