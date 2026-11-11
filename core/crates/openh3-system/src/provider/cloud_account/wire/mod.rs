use openh3_api_types::CloudAccountProfile;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Envelope<T> {
    pub success: bool,
    pub code: String,
    pub message: String,
    pub data: Option<T>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Capabilities {
    pub register: bool,
    pub login: bool,
    pub password_reset: bool,
    pub email_verification_required: bool,
    pub turnstile_required: bool,
    pub turnstile_supported: bool,
    pub passkey_supported: bool,
    pub mfa_methods: Vec<String>,
    pub password_min_length: usize,
    pub password_max_length: usize,
    pub password_encryption_required: bool,
    pub password_encryption_key_id: String,
    pub password_encryption_public_key: String,
    pub password_encryption_formats: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Credentials {
    pub access_token: String,
    pub refresh_token: String,
    pub access_expires_at: i64,
    pub session_expires_at: i64,
    pub device_id: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Flow {
    pub state: String,
    pub purpose: String,
    pub flow_token: String,
    pub expires_at: i64,
    pub resend_at: i64,
    pub methods: Option<Vec<String>>,
}
#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum AuthResult {
    Pending(Pending),
    Flow(Flow),
    Revoked(State),
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Pending {
    pub state: String,
    pub account: CloudAccountProfile,
    pub credentials: Credentials,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct State {
    pub state: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Activated {
    pub inference_key: String,
    pub device_id: String,
    pub session_expires_at: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Refreshed {
    pub credentials: Credentials,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Me {
    pub account: CloudAccountProfile,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Reset {
    pub state: String,
    pub session_cleanup_pending: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Devices {
    pub devices: Vec<Device>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Device {
    pub device_id: String,
    pub current: bool,
    pub created_at: i64,
    pub last_active_at: i64,
    pub expires_at: i64,
    pub user_agent: String,
    #[serde(rename = "ip")]
    pub _ip: String,
}

mod billing;
pub(super) use billing::*;

// Strict private wrappers intentionally have no Debug implementation.
#[derive(Deserialize)]
#[serde(transparent)]
pub(super) struct TopupOptions(pub openh3_api_types::CloudAccountTopupOptionsResponse);
#[derive(Deserialize)]
#[serde(transparent)]
pub(super) struct TopupQuote(pub openh3_api_types::CloudAccountTopupQuote);
#[derive(Deserialize)]
#[serde(transparent)]
pub(super) struct TopupOrder(pub openh3_api_types::CloudAccountTopupOrder);
#[derive(Deserialize)]
#[serde(transparent)]
pub(super) struct TopupOrders(pub openh3_api_types::CloudAccountTopupOrdersResponse);
