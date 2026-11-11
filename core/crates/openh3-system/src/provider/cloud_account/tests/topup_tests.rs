use super::*;

pub(super) fn quote() -> Value {
    json!({"amount":10,"amount_unit":"USD","payment_method":"alipay","provider":"epay_v1","payable_money":"71.23","currency":"CNY","credited_quota":"5000000","quota_unit":"new_api_quota","conversion_version":"a".repeat(64),"quote_version":"b".repeat(64),"fee_scope":"gateway_payable_total"})
}
pub(super) fn order(status: &str, handoff: &str, issue: bool) -> Value {
    let mut o = quote();
    for (key,value) in json!({"order_id":"NATIVEoriginal","owner_id":"42","status":status,"created_at":100,"completed_at":if status == "paid" { 200 } else { 0 },"handoff_expires_at":1800000000_i64,"handoff_status":handoff,"expiry_scope":"local_handoff_only"}).as_object().unwrap() { o[key] = value.clone(); }
    if issue {
        o["checkout_url"] = json!(
            "https://pay.example/submit.php?out_trade_no=NATIVEoriginal&sign=SIGNED_SENTINEL&notify_url=https%3A%2F%2Fgateway.example%2Fnotify"
        );
    }
    o
}
fn create() -> CloudAccountCreateTopupRequest {
    serde_json::from_value(json!({"amount":10,"payment_method":"alipay","quote_version":"b".repeat(64),"idempotency_key":"stable-original-key"})).unwrap()
}
async fn connected() -> (MockServer, openh3_db::Database, Arc<CloudAccountService>, String) {
    let f = fixture().await;
    mount_login(&f.0).await;
    Mock::given(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .mount(&f.0)
        .await;
    f.2.login(&f.3, login()).await.unwrap();
    f
}
#[tokio::test]
async fn topup_exact_options_quote_cursor_and_late_paid_have_no_local_accounting() {
    let (server, db, svc, owner) = connected().await;
    for available in [false, true] {
        let options = if available {
            ["alipay", "wxpay", "qqpay"]
                .into_iter()
                .flat_map(|method| {
                    (1..=32).map(move |amount| {
                        let mut q = quote();
                        q["payment_method"] = json!(method);
                        q["amount"] = json!(amount);
                        q
                    })
                })
                .collect::<Vec<_>>()
        } else {
            vec![]
        };
        let data = json!({"options":options,"status":if available {"available"} else {"unavailable"},"unsupported_providers":["stripe","creem","waffo","waffo_pancake"]});
        Mock::given(method("POST"))
            .and(path("/api/openh3/topup/options"))
            .respond_with(ok(data.clone()))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        assert_eq!(
            serde_json::to_value(svc.topup_options(&owner).await.unwrap()).unwrap(),
            data
        );
    }
    Mock::given(method("POST"))
        .and(path("/api/openh3/topup/quote"))
        .respond_with(ok(quote()))
        .expect(1)
        .mount(&server)
        .await;
    let q = svc
        .topup_quote(
            &owner,
            serde_json::from_value(json!({"amount":10,"payment_method":"alipay"})).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(serde_json::to_value(q).unwrap(), quote());
    for (status, handoff) in [
        ("pending", "available"),
        ("pending", "expired"),
        ("failed", "expired"),
        ("expired", "expired"),
        ("paid", "expired"),
    ] {
        let data = json!({"items":[order(status,handoff,false)],"has_more":true,"next_before_id":19});
        Mock::given(method("POST"))
            .and(path("/api/openh3/topup/orders"))
            .respond_with(ok(data.clone()))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        let response = svc
            .topup_orders(
                &owner,
                serde_json::from_value(json!({"before_id":20,"page_size":1})).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(serde_json::to_value(response).unwrap(), data);
    }
    let row = svc.read(&owner).await.unwrap().unwrap();
    let encrypted: String = sqlx::query_scalar("SELECT encrypted FROM cloud_accounts WHERE owner=?")
        .bind(&owner)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert!(!encrypted.contains("SIGNED_SENTINEL"));
    assert!(row.inference_key.is_some());
    let requests = server.received_requests().await.unwrap();
    for r in requests.iter().filter(|r| r.url.path().contains("/topup/")) {
        assert_eq!(r.headers["authorization"], "Bearer desktop-secret");
    }
}
#[tokio::test]
async fn topup_explicit_retry_keeps_exact_key_terms_and_original_order_after_ambiguous_response() {
    let (server, _, svc, owner) = connected().await;
    // A committed remote order whose first response was lost/invalid. There is
    // no client retry, pending credit or synthesized replacement key.
    Mock::given(path("/api/openh3/topup/create"))
        .respond_with(ResponseTemplate::new(200).set_body_string("truncated"))
        .up_to_n_times(1)
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        svc.topup_create(&owner, create()).await.err().unwrap(),
        CloudAccountError::Protocol
    );
    let frozen = order("pending", "unavailable", false);
    Mock::given(path("/api/openh3/topup/create"))
        .respond_with(ok(frozen.clone()))
        .expect(2)
        .mount(&server)
        .await;
    for _ in 0..2 {
        assert_eq!(
            serde_json::to_value(svc.topup_create(&owner, create()).await.unwrap()).unwrap(),
            frozen
        );
    }
    let requests = server.received_requests().await.unwrap();
    let bodies: Vec<_> = requests
        .iter()
        .filter(|r| r.url.path().ends_with("topup/create"))
        .map(|r| r.body.clone())
        .collect();
    assert_eq!(bodies.len(), 3);
    assert_eq!(bodies[0], bodies[1]);
    assert_eq!(bodies[1], bodies[2]);
}
#[tokio::test]
async fn topup_errors_are_distinct_and_never_replayed_or_treated_as_empty_history() {
    for (status, code, error) in [
        (409, "quote_or_idempotency_conflict", CloudAccountError::TopupConflict),
        (409, "wallet_capacity_exceeded", CloudAccountError::WalletCapacity),
        (503, "temporarily_unavailable", CloudAccountError::TopupUnavailable),
        (401, "authentication_failed", CloudAccountError::Authentication),
    ] {
        let (server, _, svc, owner) = connected().await;
        Mock::given(path("/api/openh3/topup/create"))
            .respond_with(
                ResponseTemplate::new(status)
                    .set_body_json(json!({"success":false,"code":code,"message":"SIGNED_SENTINEL"})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let result = svc.topup_create(&owner, create()).await.err().unwrap();
        assert_eq!(result, error);
        assert!(!format!("{result:?} {result}").contains("SIGNED_SENTINEL"));
        if status == 401 {
            assert!(svc.read(&owner).await.unwrap().is_none());
        }
    }
    let (server, _, svc, owner) = connected().await;
    Mock::given(path("/api/openh3/topup/orders"))
        .respond_with(
            ResponseTemplate::new(503)
                .set_body_json(json!({"success":false,"code":"temporarily_unavailable","message":"fixed"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        svc.topup_orders(&owner, serde_json::from_value(json!({})).unwrap())
            .await
            .err()
            .unwrap(),
        CloudAccountError::TopupUnavailable
    );
}
#[tokio::test]
async fn topup_rejects_invalid_original_inputs_before_any_gateway_io() {
    let (server, _, svc, owner) = fixture().await;
    for amount in [-1, 0, 9_007_199_254_740_992] {
        let mut r = create();
        r.amount = amount;
        assert_eq!(
            svc.topup_create(&owner, r).await.err().unwrap(),
            CloudAccountError::Input
        );
    }
    for key in [
        "short",
        "bad key with spaces",
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234",
    ] {
        let mut r = create();
        r.idempotency_key = key.into();
        assert_eq!(
            svc.topup_create(&owner, r).await.err().unwrap(),
            CloudAccountError::Input
        );
    }
    let mut r = create();
    r.quote_version = "短".repeat(64);
    assert_eq!(
        svc.topup_create(&owner, r).await.err().unwrap(),
        CloudAccountError::Input
    );
    for q in [
        json!({"before_id":-1}),
        json!({"before_id":9_007_199_254_740_992_i64}),
        json!({"page_size":51}),
        json!({"status":"success"}),
    ] {
        assert_eq!(
            svc.topup_orders(&owner, serde_json::from_value(q).unwrap())
                .await
                .err()
                .unwrap(),
            CloudAccountError::Input
        );
    }
    assert!(server.received_requests().await.unwrap().is_empty());
}
#[tokio::test]
async fn topup_strict_private_wire_rejects_sensitive_or_invalid_checkout_and_cross_owner_orders() {
    let (server, _, svc, owner) = connected().await;
    for url in [
        "https:pay.example/",
        "https://@pay.example/",
        "http://pay.example/?sign=SIGNED_SENTINEL",
        "https://u:p@pay.example/",
        "https://pay.example/#SIGNED_SENTINEL",
        "https://pay.example/\\evil",
        "https://pay.example/?key=merchant-secret",
        "https://pay.example/?access_token=desktop-secret",
        "https://pay.example/?x=refresh-secret",
        "https://pay.example/?x=%0A",
        "https://pay.example/desktop-secret/x?sign=SIGNED_SENTINEL",
        "https://refresh-secret.example/",
        "https://pay.example/raw-inference-secret",
        "not a url",
    ] {
        let mut o = order("pending", "available", true);
        o["checkout_url"] = json!(url);
        Mock::given(path("/api/openh3/topup/create"))
            .respond_with(ok(o))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        let error = svc.topup_create(&owner, create()).await.err().unwrap();
        assert_eq!(error, CloudAccountError::Protocol);
        assert!(!format!("{error:?}").contains("SIGNED_SENTINEL"));
    }
    for mut bad in [
        order("pending", "available", true),
        order("pending", "available", false),
        order("paid", "expired", false),
    ] {
        bad["owner_id"] = json!("99");
        Mock::given(path("/api/openh3/topup/create"))
            .respond_with(ok(bad))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        assert_eq!(
            svc.topup_create(&owner, create()).await.err().unwrap(),
            CloudAccountError::Protocol
        );
    }
    Mock::given(path("/api/openh3/topup/create"))
        .respond_with(ok(order("pending", "available", true)))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    let o = svc.topup_create(&owner, create()).await.unwrap();
    assert!(o.checkout_url.unwrap().contains("sign=SIGNED_SENTINEL"));
    Mock::given(path("/api/openh3/topup/orders"))
        .respond_with(ok(
            json!({"items":[order("pending","available",true)],"has_more":false,"next_before_id":1}),
        ))
        .mount(&server)
        .await;
    assert_eq!(
        svc.topup_orders(&owner, serde_json::from_value(json!({})).unwrap())
            .await
            .err()
            .unwrap(),
        CloudAccountError::Protocol
    );
}
#[tokio::test]
async fn topup_delayed_a_response_cannot_return_as_or_disable_replacement_b() {
    for fail in [false, true] {
        let (server, db, svc, owner) = connected().await;
        let response = if fail {
            ResponseTemplate::new(401)
                .set_body_json(json!({"success":false,"code":"authentication_failed","message":"fixed"}))
        } else {
            ok(order("pending", "available", true))
        };
        Mock::given(path("/api/openh3/topup/create"))
            .respond_with(response.set_delay(std::time::Duration::from_millis(200)))
            .expect(1)
            .mount(&server)
            .await;
        let pending = tokio::spawn({
            let svc = svc.clone();
            let owner = owner.clone();
            async move { svc.topup_create(&owner, create()).await }
        });
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !server
                .received_requests()
                .await
                .unwrap()
                .iter()
                .any(|r| r.url.path().ends_with("topup/create"))
            {
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
        let mut b_pending = super::pending();
        b_pending["account"]["id"] = json!("99");
        Mock::given(method("POST"))
            .and(path("/api/openh3/login"))
            .respond_with(ok(b_pending))
            .with_priority(1)
            .mount(&server)
            .await;
        svc.login(&owner, login()).await.unwrap();
        let b = svc.read(&owner).await.unwrap().unwrap();
        let generation = b.generation;
        let error = pending.await.unwrap().err().unwrap();
        assert!(matches!(
            error,
            CloudAccountError::Conflict | CloudAccountError::Authentication
        ));
        let current = svc.read(&owner).await.unwrap().unwrap();
        assert_eq!(current.account.id, "99");
        assert_eq!(current.generation, generation);
        let enabled: bool = sqlx::query_scalar("SELECT enabled FROM providers WHERE id=?")
            .bind(&b.provider_id)
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert!(enabled);
    }
}

#[tokio::test]
async fn topup_private_wire_rejects_unknown_duplicate_and_nondecimal_terms_with_fixed_errors() {
    let (server, _, svc, owner) = connected().await;
    for (field, value) in [
        ("access_token", json!("SIGNED_SENTINEL")),
        ("merchant_key", json!("SIGNED_SENTINEL")),
        ("checkout", json!({"kind":"qr","payload":"SIGNED_SENTINEL"})),
        ("payable_money", json!(71.23)),
        ("payable_money", json!("7.123e1")),
        ("currency", json!("USD")),
        ("credited_quota", json!("-1")),
        ("fee_scope", json!("merchant_estimate")),
    ] {
        let mut bad = order("pending", "available", false);
        bad[field] = value;
        Mock::given(path("/api/openh3/topup/create"))
            .respond_with(ok(bad))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        let error = svc.topup_create(&owner, create()).await.err().unwrap();
        assert_eq!(error, CloudAccountError::Protocol);
        assert!(!format!("{error:?} {error}").contains("SIGNED_SENTINEL"));
    }
    let duplicate = json!({"success":true,"code":"ok","message":"ok","data":order("pending","available",false)})
        .to_string()
        .replacen("\"amount\":10", "\"amount\":10,\"amount\":11", 1);
    Mock::given(path("/api/openh3/topup/create"))
        .respond_with(ResponseTemplate::new(200).set_body_string(duplicate))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    assert_eq!(
        svc.topup_create(&owner, create()).await.err().unwrap(),
        CloudAccountError::Protocol
    );
}

#[tokio::test]
async fn topup_encoded_current_grant_secrets_cannot_cross_public_checkout_components() {
    let (server, _, svc, owner) = connected().await;
    for encoded in ["desktop%2Dsecret", "refresh%2Dsecret", "raw%2Dinference%2Dsecret"] {
        for url in [
            format!("https://pay.example/{encoded}/submit?sign=controlled-signature"),
            format!("https://{encoded}.example/submit?sign=controlled-signature"),
            format!("https://pay.example/submit?{encoded}=1&sign=controlled-signature"),
            format!("https://pay.example/submit?value={encoded}&sign=controlled-signature"),
        ] {
            let mut response = order("pending", "available", true);
            response["checkout_url"] = json!(url);
            Mock::given(method("POST"))
                .and(path("/api/openh3/topup/create"))
                .respond_with(ok(response))
                .up_to_n_times(1)
                .mount(&server)
                .await;
            let result = svc.topup_create(&owner, create()).await;
            assert!(
                matches!(result, Err(CloudAccountError::Protocol)),
                "known credential escaped its URL component"
            );
        }
    }
    // The same exclusion retains the existing raw and decoded-value controls.
    for url in [
        "https://pay.example/desktop-secret/submit?sign=controlled-signature",
        "https://pay.example/submit?value=desktop%2Dsecret&sign=controlled-signature",
    ] {
        let mut response = order("pending", "available", true);
        response["checkout_url"] = json!(url);
        Mock::given(method("POST"))
            .and(path("/api/openh3/topup/create"))
            .respond_with(ok(response))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        assert!(matches!(
            svc.topup_create(&owner, create()).await,
            Err(CloudAccountError::Protocol)
        ));
    }
    // Valid signed bytes, including escapes and a secret-like but unknown value,
    // remain exactly as issued. The boundary knows only this grant's credentials.
    let url = "https://pay.example/signed%2Dsubmit?sign=A%2Bb%2F%3D&notify_url=https%3A%2F%2Fgateway.example%2Fnotify&other%2Dfield=unrelated%2Dtoken";
    let mut response = order("pending", "available", true);
    response["checkout_url"] = json!(url);
    Mock::given(method("POST"))
        .and(path("/api/openh3/topup/create"))
        .respond_with(ok(response))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    let result = svc.topup_create(&owner, create()).await.unwrap();
    assert_eq!(result.checkout_url.as_deref(), Some(url));
}
