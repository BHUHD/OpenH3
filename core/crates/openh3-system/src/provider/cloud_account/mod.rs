//! Native account lifecycle and strict authenticated transport.
mod client;
mod flows;
mod lifetime;
mod password;
pub mod routes;
mod service;
pub mod state;
#[cfg(test)]
mod tests;
mod wire;

pub use client::CloudAccountConfig;
pub use lifetime::CloudAccountInferenceBinding;
pub use service::{CloudAccountInferenceCredentials, CloudAccountService};

/// Sanitized errors only: never retains an upstream body, URL or credential.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CloudAccountError {
    #[error("Invalid account input")]
    Input,
    #[error("Account authentication required")]
    Authentication,
    #[error("Account verification failed")]
    Verification,
    #[error("Account operation unavailable under gateway policy")]
    Policy,
    #[error("Account request rate limited")]
    RateLimited { retry_after: Option<u64> },
    #[error("Account gateway temporarily unavailable")]
    Transport,
    #[error("Invalid account gateway response")]
    Protocol,
    #[error("Media catalog unavailable")]
    MediaCatalogMissing,
    #[error("Selected media model unavailable")]
    MediaModelUnavailable,
    #[error("Selected media model does not support this input")]
    MediaCapabilityUnsupported,
    #[error("Media job not found")]
    MediaJobNotFound,
    #[error("Insufficient media quota")]
    MediaQuota,
    #[error("Account state changed; retry the operation")]
    Conflict,
    #[error("Top-up quote or idempotency terms conflict")]
    TopupConflict,
    #[error("Wallet capacity exceeded")]
    WalletCapacity,
    #[error("Top-up verification or configuration temporarily unavailable")]
    TopupUnavailable,
    #[error("Account storage unavailable")]
    Storage,
}
impl From<openh3_db::DbError> for CloudAccountError {
    fn from(value: openh3_db::DbError) -> Self {
        if matches!(value, openh3_db::DbError::Conflict(_)) {
            Self::Conflict
        } else {
            Self::Storage
        }
    }
}
type Result<T> = std::result::Result<T, CloudAccountError>;

fn nonce() -> Result<String> {
    use base64::Engine;
    let mut bytes = [0; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| CloudAccountError::Storage)?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
