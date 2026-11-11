//! Renderer-safe contracts for authenticated `/api/cloud-account/*` routes.
//!
//! Wrap responses in `ApiResponse<T>`. Remote credentials belong to Core's
//! private adapter and must never be added here. Times are Unix seconds.
//! Amount strings are server values for display, never frontend calculations.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudAccountAvailability {
    Disabled,
    Unconfigured,
    Available,
}

/// A required anti-bot ceremony cannot be skipped by native authentication.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudAccountAntiBot {
    NotRequired,
    UnsupportedRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountCapabilitiesResponse {
    pub availability: CloudAccountAvailability,
    pub registration_enabled: bool,
    pub email_verification_required: bool,
    pub password_login_enabled: bool,
    pub password_reset_enabled: bool,
    pub anti_bot: CloudAccountAntiBot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountProfile {
    pub id: String,
    pub username: String,
    pub display_name: String,
    /// Accounts created without verified email may have no email address.
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudAccountVerificationMethod {
    Totp,
    BackupCode,
    Password,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudAccountVerificationPurpose {
    Login,
    PasswordReset,
    DeviceRevocation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountVerification {
    pub purpose: CloudAccountVerificationPurpose,
    /// Local opaque handle bound to the authenticated local user and attempt.
    /// This is not the gateway's flow token.
    pub challenge_id: String,
    pub expires_at: i64,
    pub methods: Vec<CloudAccountVerificationMethod>,
}

/// Returned by session, me and login. Registration has its own result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountSessionResponse {
    Disabled {},
    Unconfigured {},
    Disconnected {},
    VerificationRequired { verification: CloudAccountVerification },
    Connected { account: CloudAccountProfile },
    ReauthRequired {},
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudAccountEmailCodePurpose {
    Registration,
    PasswordReset,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountEmailCodeRequest {
    pub email: String,
    pub purpose: CloudAccountEmailCodePurpose,
}

/// Password-bearing input intentionally has neither `Debug` nor `Serialize`.
///
/// ```compile_fail
/// use openh3_api_types::CloudAccountRegisterRequest;
/// fn log_password(request: CloudAccountRegisterRequest) { println!("{request:?}"); }
/// ```
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountRegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
    /// Required by the service when email verification is enabled.
    pub verification_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountRegisterResponse {
    Registered {},
}

/// ```compile_fail
/// use openh3_api_types::CloudAccountLoginRequest;
/// fn log_password(request: CloudAccountLoginRequest) { println!("{request:?}"); }
/// ```
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountLoginRequest {
    pub username: String,
    pub password: String,
}

/// Password is never interpreted as a verification code.
///
/// ```compile_fail
/// use openh3_api_types::CloudAccountVerifyRequest;
/// fn log_password(request: CloudAccountVerifyRequest) { println!("{request:?}"); }
/// ```
#[derive(Deserialize)]
#[serde(tag = "method", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountVerifyRequest {
    Totp { challenge_id: String, code: String },
    BackupCode { challenge_id: String, code: String },
    Password { challenge_id: String, password: String },
}

/// The server-bound challenge purpose determines the result, never caller input.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "result", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountVerifyResponse {
    Login { session: CloudAccountSessionResponse },
    PasswordResetReady { challenge_id: String, expires_at: i64 },
    DeviceRevoked {},
}

/// Verify email ownership first. A new password is accepted only on completion.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountPasswordResetRequest {
    pub email: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountPasswordResetResponse {
    Ready { challenge_id: String, expires_at: i64 },
    VerificationRequired { verification: CloudAccountVerification },
}

/// ```compile_fail
/// use openh3_api_types::CloudAccountPasswordResetCompleteRequest;
/// fn log_password(request: CloudAccountPasswordResetCompleteRequest) { println!("{request:?}"); }
/// ```
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountPasswordResetCompleteRequest {
    pub challenge_id: String,
    pub new_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountPasswordResetCompleteResponse {
    pub session_cleanup_pending: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudAccountRemoteRevocation {
    Confirmed,
    Unconfirmed,
    NotNeeded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountLogoutResponse {
    pub remote_revocation: CloudAccountRemoteRevocation,
}

/// Exact decimal monetary amount with an explicit ISO 4217 currency code.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountMoney {
    pub amount: String,
    pub currency: String,
}

/// Exact quantity and its server-defined unit, e.g. `new_api_quota` or `tokens`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountQuota {
    pub amount: String,
    pub unit: String,
}

// Gateway billing observations are exact server values, never a local ledger.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountQuotaView {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<CloudAccountQuota>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountSubscription {
    pub allowance_state: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<CloudAccountQuota>,
    pub unlimited: bool,
    pub used: CloudAccountQuota,
    pub expires_at: i64,
    pub next_reset_at: i64,
    pub allow_wallet_overflow: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountSubscriptions {
    pub status: String,
    pub items: Vec<CloudAccountSubscription>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountWalletResponse {
    pub read_started_at: i64,
    pub as_of: i64,
    pub wallet_balance: CloudAccountQuotaView,
    pub subscriptions: CloudAccountSubscriptions,
    pub device_limit: CloudAccountQuotaView,
    pub billing_preference: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountConditionalSurcharge {
    pub usd: String,
    pub condition: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountPriceQuote {
    pub group: String,
    pub kind: String,
    pub unit: String,
    pub group_ratio: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_1h: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_12h: Option<String>,
    pub cache_write_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_request: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_surcharges_usd_per_1000_calls: Option<std::collections::BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implied_search_usd_per_request: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
    pub quota_per_usd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expression_semantics: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditional_violation_surcharge: Option<CloudAccountConditionalSurcharge>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountModel {
    pub model_id: String,
    pub display_name: String,
    pub provider: String,
    pub purpose: String,
    pub protocol: String,
    pub input_capabilities: Vec<String>,
    pub supports_tools: bool,
    pub context_limit: i64,
    pub max_output_tokens: u64,
    pub compatibility_version: String,
    pub evidence: String,
    pub quotes: Vec<CloudAccountPriceQuote>,
    /// Local supported intersection; never changes the authoritative model ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_unavailable_reason: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountModelsResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub quote_semantics: String,
    pub models: Vec<CloudAccountModel>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountPageQuery {
    #[serde(default = "first_page")]
    pub page: u32,
    #[serde(default = "default_page_size")]
    pub page_size: u32,
}
fn first_page() -> u32 {
    1
}
fn default_page_size() -> u32 {
    20
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountUsageQuery {
    #[serde(default = "first_page")]
    pub page: u32,
    #[serde(default = "default_page_size")]
    pub page_size: u32,
    #[serde(default)]
    pub start_time: i64,
    #[serde(default)]
    pub end_time: i64,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub device_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountUsage {
    pub id: String,
    pub created_at: i64,
    pub kind: String,
    pub quota: Option<CloudAccountQuota>,
    pub direction: String,
    pub model: String,
    pub prompt_tokens: String,
    pub completion_tokens: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funding: Option<std::collections::BTreeMap<String, String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountUsageResponse {
    pub read_started_at: i64,
    pub as_of: i64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub completeness: String,
    /// Disabled logging may return null; never convert it into reconciled zero spend.
    pub items: Option<Vec<CloudAccountUsage>>,
    pub page: u32,
    pub page_size: u32,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudAccountDeviceStatus {
    Active,
    Revoked,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountDevice {
    pub id: String,
    pub label: String,
    pub current: bool,
    pub status: CloudAccountDeviceStatus,
    pub created_at: i64,
    pub last_active_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountDevicesResponse {
    pub items: Vec<CloudAccountDevice>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountRevokeDeviceRequest {
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountRevokeDeviceResponse {
    Revoked {},
    VerificationRequired { verification: CloudAccountVerification },
}

/// Frozen gateway terms. Monetary strings are never locally recomputed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountTopupQuote {
    pub amount: i64,
    pub amount_unit: String,
    pub payment_method: String,
    pub provider: String,
    pub payable_money: String,
    pub currency: String,
    pub credited_quota: String,
    pub quota_unit: String,
    pub conversion_version: String,
    pub quote_version: String,
    pub fee_scope: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountTopupOptionsResponse {
    pub options: Vec<CloudAccountTopupQuote>,
    pub status: String,
    pub unsupported_providers: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountTopupQuoteRequest {
    pub amount: i64,
    pub payment_method: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountCreateTopupRequest {
    pub amount: i64,
    pub payment_method: String,
    pub quote_version: String,
    pub idempotency_key: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudAccountTopupStatus {
    Pending,
    Paid,
    Failed,
    Expired,
}
/// Transient create/replay result. Never Debug, persist, log or copy checkout_url.
/// Local handoff expiry does not cancel a previously opened remote checkout.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountTopupOrder {
    pub amount: i64,
    pub amount_unit: String,
    pub payment_method: String,
    pub provider: String,
    pub payable_money: String,
    pub currency: String,
    pub credited_quota: String,
    pub quota_unit: String,
    pub conversion_version: String,
    pub quote_version: String,
    pub fee_scope: String,
    pub order_id: String,
    pub owner_id: String,
    pub status: CloudAccountTopupStatus,
    pub created_at: i64,
    pub completed_at: i64,
    pub handoff_expires_at: i64,
    pub handoff_status: String,
    pub expiry_scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkout_url: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountTopupOrdersQuery {
    #[serde(default)]
    pub order_id: String,
    #[serde(default)]
    pub before_id: i64,
    #[serde(default)]
    pub page_size: u32,
    #[serde(default)]
    pub status: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountTopupOrdersResponse {
    pub items: Vec<CloudAccountTopupOrder>,
    pub has_more: bool,
    pub next_before_id: i64,
}
