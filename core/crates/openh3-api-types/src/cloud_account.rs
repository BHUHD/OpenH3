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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountWalletBalance {
    Available { amount: CloudAccountQuota },
    Unavailable {},
}

/// An unlimited token limit is not an unlimited wallet balance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountAllowance {
    Limited { amount: CloudAccountQuota },
    Unlimited {},
    Unavailable {},
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountSubscription {
    pub id: String,
    pub remaining: CloudAccountAllowance,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountSubscriptions {
    Available { items: Vec<CloudAccountSubscription> },
    Unavailable {},
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountWalletResponse {
    /// Gateway snapshot time. Never replace a cached snapshot's time with now.
    pub as_of: i64,
    pub wallet_balance: CloudAccountWalletBalance,
    pub subscriptions: CloudAccountSubscriptions,
    pub device_limit: CloudAccountAllowance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountRate {
    pub label: String,
    pub price: CloudAccountMoney,
    pub per: CloudAccountQuota,
}

/// Display-only pricing. Never evaluate expressions or derive charges in the UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountModelPrice {
    Rates { rates: Vec<CloudAccountRate> },
    Expression { expression: String, description: String },
    Description { description: String },
    Unavailable {},
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountModel {
    pub id: String,
    pub name: String,
    pub price: CloudAccountModelPrice,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountModelsResponse {
    pub items: Vec<CloudAccountModel>,
}

/// Routes must enforce `page >= 1` and `1 <= page_size <= 100` before I/O.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
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
pub struct CloudAccountUsageQuantity {
    pub name: String,
    pub quantity: CloudAccountQuota,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountUsage {
    pub id: String,
    pub model: String,
    pub created_at: i64,
    pub charge: CloudAccountQuota,
    /// Only quantities present in the authoritative usage record are included.
    pub quantities: Vec<CloudAccountUsageQuantity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountUsageResponse {
    pub page: u32,
    pub page_size: u32,
    pub total: u64,
    pub items: Vec<CloudAccountUsage>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountTopupOption {
    pub id: String,
    pub label: String,
    pub payment_method: String,
    pub payable: CloudAccountMoney,
    pub credit: CloudAccountQuota,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountTopupOptionsResponse {
    pub items: Vec<CloudAccountTopupOption>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountCreateTopupRequest {
    pub option_id: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudAccountTopupStatus {
    Pending,
    Success,
    Failed,
    Expired,
}

/// A payment handoff supplied by the configured provider, never proof of payment.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudAccountCheckout {
    Url { url: String },
    Qr { payload: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountTopupOrder {
    pub id: String,
    pub status: CloudAccountTopupStatus,
    pub created_at: i64,
    pub payable: CloudAccountMoney,
    pub credit: CloudAccountQuota,
    /// Present only while a usable provider checkout is available.
    pub checkout: Option<CloudAccountCheckout>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CloudAccountTopupOrdersResponse {
    pub page: u32,
    pub page_size: u32,
    pub total: u64,
    pub items: Vec<CloudAccountTopupOrder>,
}
