//! Synthetic local wire fixtures; these do not claim live gateway compatibility.
use openh3_api_types::*;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

fn round_trip<T: DeserializeOwned + Serialize>(fixture: Value) {
    let dto: T = serde_json::from_value(fixture.clone()).unwrap();
    assert_eq!(serde_json::to_value(dto).unwrap(), fixture);
}

#[test]
fn session_states_are_explicit_and_do_not_carry_gateway_credentials() {
    for state in ["disabled", "unconfigured", "disconnected", "reauth_required"] {
        round_trip::<CloudAccountSessionResponse>(json!({"state": state}));
    }
    round_trip::<ApiResponse<CloudAccountSessionResponse>>(json!({
        "success": true,
        "data": {"state": "connected", "account": {
            "id": "42", "username": "alice", "display_name": "Alice", "email": "alice@example.com"
        }}
    }));
    round_trip::<CloudAccountSessionResponse>(json!({
        "state": "verification_required", "verification": {
            "challenge_id": "local-opaque-handle", "expires_at": 1800000000, "purpose":"login",
            "methods": ["totp", "backup_code"]
        }
    }));
    let invalid = json!({"state": "connected"});
    assert!(serde_json::from_value::<CloudAccountSessionResponse>(invalid).is_err());
}

#[test]
fn upstream_secrets_and_admin_fields_are_rejected_by_public_response_types() {
    for forbidden in [
        "access_token",
        "refresh_token",
        "inference_key",
        "role",
        "admin_permissions",
    ] {
        let mut fixture = json!({"state": "disconnected"});
        fixture[forbidden] = json!("must-not-pass-through");
        let error = serde_json::from_value::<CloudAccountSessionResponse>(fixture).unwrap_err();
        assert!(error.to_string().contains("unknown field"), "{error}");
    }
    let profile = json!({"id":"42", "username":"alice", "display_name":"Alice", "email":null, "role":100});
    assert!(serde_json::from_value::<CloudAccountProfile>(profile).is_err());
}

#[test]
fn capabilities_report_required_unsupported_bot_challenges() {
    round_trip::<CloudAccountCapabilitiesResponse>(json!({
        "availability":"available", "registration_enabled":true, "email_verification_required":true,
        "password_login_enabled":true, "password_reset_enabled":true, "anti_bot":"unsupported_required"
    }));
}

#[test]
fn registration_is_not_a_login_response() {
    round_trip::<CloudAccountRegisterResponse>(json!({"status":"registered"}));
    assert!(serde_json::from_value::<CloudAccountSessionResponse>(json!({"status":"registered"})).is_err());
    assert!(serde_json::from_value::<CloudAccountRegisterResponse>(json!({"state":"connected"})).is_err());
}

#[test]
fn logout_and_committed_password_reset_have_explicit_partial_outcomes() {
    for remote in ["confirmed", "unconfirmed", "not_needed"] {
        round_trip::<CloudAccountLogoutResponse>(json!({"remote_revocation": remote}));
    }
    for pending in [true, false] {
        round_trip::<CloudAccountPasswordResetCompleteResponse>(json!({"session_cleanup_pending":pending}));
    }
    assert!(serde_json::from_value::<CloudAccountLogoutResponse>(json!({})).is_err());
    assert!(serde_json::from_value::<CloudAccountPasswordResetCompleteResponse>(json!({})).is_err());
}

#[test]
fn secret_requests_accept_native_fields_and_reject_caller_identity() {
    let login = json!({"username":"alice", "password":"password"});
    let parsed: CloudAccountLoginRequest = serde_json::from_value(login.clone()).unwrap();
    assert_eq!(parsed.password, "password");
    let register =
        json!({"username":"alice", "email":"alice@example.com", "password":"password", "verification_code":"123456"});
    let parsed: CloudAccountRegisterRequest = serde_json::from_value(register.clone()).unwrap();
    assert_eq!(parsed.verification_code.as_deref(), Some("123456"));
    let verify = json!({"method":"totp", "challenge_id":"local-handle", "code":"123456"});
    let parsed: CloudAccountVerifyRequest = serde_json::from_value(verify.clone()).unwrap();
    assert!(matches!(parsed, CloudAccountVerifyRequest::Totp {code, ..} if code == "123456"));
    let reset = json!({"email":"alice@example.com", "code":"123456"});
    let parsed: CloudAccountPasswordResetRequest = serde_json::from_value(reset.clone()).unwrap();
    assert_eq!(parsed.code, "123456");
    for identity in ["user_id", "account_id", "role", "gateway_url"] {
        let mut bad = login.clone();
        bad[identity] = json!("other-user");
        assert!(serde_json::from_value::<CloudAccountLoginRequest>(bad).is_err());
        let mut bad = register.clone();
        bad[identity] = json!("other-user");
        assert!(serde_json::from_value::<CloudAccountRegisterRequest>(bad).is_err());
        let mut bad = verify.clone();
        bad[identity] = json!("other-user");
        assert!(serde_json::from_value::<CloudAccountVerifyRequest>(bad).is_err());
        let mut bad = reset.clone();
        bad[identity] = json!("other-user");
        assert!(serde_json::from_value::<CloudAccountPasswordResetRequest>(bad).is_err());
    }
    let error = serde_json::from_value::<CloudAccountLoginRequest>(json!({"username":"alice"}))
        .err()
        .unwrap();
    assert!(error.to_string().contains("missing field `password`"));
}

#[test]
fn email_code_is_purpose_bound() {
    for purpose in ["registration", "password_reset"] {
        let request: CloudAccountEmailCodeRequest =
            serde_json::from_value(json!({"email":"alice@example.com", "purpose":purpose})).unwrap();
        assert_eq!(request.email, "alice@example.com");
    }
    let error =
        serde_json::from_value::<CloudAccountEmailCodeRequest>(json!({"email":"alice@example.com", "purpose":"login"}))
            .err()
            .unwrap();
    assert!(error.to_string().contains("unknown variant `login`"));
}

#[test]
fn billing_observations_preserve_unavailability_and_no_total() {
    round_trip::<CloudAccountWalletResponse>(
        json!({"read_started_at":100,"as_of":101,"wallet_balance":{"status":"available","amount":{"amount":"-42","unit":"new_api_quota"}},"device_limit":{"status":"unlimited"},"billing_preference":"wallet_only","subscriptions":{"status":"available","items":[]}}),
    );
    round_trip::<CloudAccountModelsResponse>(
        json!({"status":"unavailable","reason":"native_inference_unavailable","quote_semantics":"observed_rules_not_frozen_final_charge","models":[]}),
    );
    round_trip::<CloudAccountUsageResponse>(
        json!({"read_started_at":100,"as_of":101,"status":"unavailable","reason":"consume_logging_disabled","completeness":"not_reconciled","page":1,"page_size":20,"has_more":false,"items":null}),
    );
    assert!(
        serde_json::from_value::<CloudAccountUsageResponse>(json!({"page":1,"page_size":20,"total":0,"items":[]}))
            .is_err()
    );
    let q: CloudAccountUsageQuery = serde_json::from_value(json!({})).unwrap();
    assert_eq!((q.page, q.page_size), (1, 20));
    for input in [
        r#"{"page":1,"page":2}"#,
        r#"{"page":"1"}"#,
        r#"{"page":null}"#,
        r#"{"start_time":-1,"owner":"bad"}"#,
    ] {
        assert!(serde_json::from_str::<CloudAccountUsageQuery>(input).is_err());
    }
}

#[test]
fn devices_expose_metadata_without_inference_keys() {
    round_trip::<CloudAccountDevicesResponse>(json!({"items":[{
        "id":"grant-1", "label":"Desktop", "current":true, "status":"active",
        "created_at":1800000000, "last_active_at":1800000000, "expires_at":1800001000
    }]}));
    let request: CloudAccountRevokeDeviceRequest = serde_json::from_value(json!({"device_id":"grant-1"})).unwrap();
    assert_eq!(request.device_id, "grant-1");
}

#[test]
fn reset_waits_for_proof_before_accepting_a_new_password() {
    round_trip::<CloudAccountPasswordResetResponse>(
        json!({"status":"ready", "challenge_id":"local-reset", "expires_at":1800000000}),
    );
    round_trip::<CloudAccountPasswordResetResponse>(json!({"status":"verification_required", "verification":{
        "purpose":"password_reset", "challenge_id":"local-mfa", "expires_at":1800000000, "methods":["totp","backup_code"]
    }}));
    assert!(
        serde_json::from_value::<CloudAccountPasswordResetRequest>(
            json!({"email":"a@example.com","code":"123456","new_password":"never-store-pending"})
        )
        .is_err()
    );
    let request: CloudAccountPasswordResetCompleteRequest =
        serde_json::from_value(json!({"challenge_id":"local-reset", "new_password":"new-password"})).unwrap();
    assert_eq!(request.new_password, "new-password");
    round_trip::<CloudAccountVerifyResponse>(
        json!({"result":"password_reset_ready", "challenge_id":"local-reset", "expires_at":1800000000}),
    );
}

#[test]
fn sensitive_device_revoke_has_purpose_bound_reauthentication() {
    round_trip::<CloudAccountRevokeDeviceResponse>(json!({"status":"verification_required", "verification":{
        "purpose":"device_revocation", "challenge_id":"local-revoke", "expires_at":1800000000, "methods":["password"]
    }}));
    let request: CloudAccountVerifyRequest = serde_json::from_value(
        json!({"method":"password", "challenge_id":"local-revoke", "password":"current-password"}),
    )
    .unwrap();
    assert!(matches!(request, CloudAccountVerifyRequest::Password {password, ..} if password == "current-password"));
    assert!(
        serde_json::from_value::<CloudAccountVerifyRequest>(
            json!({"method":"password", "challenge_id":"local-revoke", "code":"not-a-password"})
        )
        .is_err()
    );
    round_trip::<CloudAccountVerifyResponse>(json!({"result":"device_revoked"}));
    round_trip::<CloudAccountRevokeDeviceResponse>(json!({"status":"revoked"}));
    round_trip::<CloudAccountVerifyResponse>(json!({"result":"login", "session":{"state":"connected","account":{
        "id":"42","username":"alice","display_name":"Alice","email":null
    }}}));
}

#[test]
fn topups_use_server_options_and_authoritative_order_amounts() {
    round_trip::<CloudAccountTopupOptionsResponse>(json!({"items":[{
        "id":"option-1", "label":"Credit pack", "payment_method":"stripe",
        "payable":{"amount":"10.00","currency":"USD"}, "credit":{"amount":"5000000","unit":"new_api_quota"}
    }]}));
    let request: CloudAccountCreateTopupRequest =
        serde_json::from_value(json!({"option_id":"option-1","idempotency_key":"operation-1"})).unwrap();
    assert_eq!(request.option_id, "option-1");
    assert!(
        serde_json::from_value::<CloudAccountCreateTopupRequest>(
            json!({"option_id":"option-1","idempotency_key":"operation-1","amount":"0.01"})
        )
        .is_err()
    );
    let order = json!({
        "id":"order-1", "status":"pending", "created_at":1800000000,
        "payable":{"amount":"10.00","currency":"USD"}, "credit":{"amount":"5000000","unit":"new_api_quota"},
        "checkout":{"kind":"url", "url":"https://pay.example/checkout/1"}
    });
    round_trip::<CloudAccountTopupOrder>(order.clone());
    round_trip::<CloudAccountTopupOrdersResponse>(json!({"page":1,"page_size":20,"total":1,"items":[order]}));
}

#[test]
fn provider_checkout_can_supply_a_qr_payload_without_a_url() {
    round_trip::<CloudAccountTopupOrder>(json!({
        "id":"order-qr", "status":"pending", "created_at":1800000000,
        "payable":{"amount":"10.00","currency":"CNY"}, "credit":{"amount":"500000","unit":"new_api_quota"},
        "checkout":{"kind":"qr", "payload":"provider-issued-payment-payload"}
    }));
}
