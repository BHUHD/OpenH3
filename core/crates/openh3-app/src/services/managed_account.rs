//! Domain adapter, assembled only by AppServices.
use openh3_ai_agent::managed::{ManagedCredentialResolver, ManagedCredentials, ProviderError};
use openh3_system::provider::cloud_account::CloudAccountService;
use std::sync::Arc;
use tokio::sync::watch;

pub(super) struct AccountCredentials(pub Arc<CloudAccountService>);
fn account_error() -> ProviderError {
    ProviderError::Connection("Managed account authentication required".into())
}
#[async_trait::async_trait]
impl ManagedCredentialResolver for AccountCredentials {
    async fn subscribe(&self, owner: &str, provider: &str) -> Result<watch::Receiver<bool>, ProviderError> {
        self.0
            .inference_lifetime(owner, provider)
            .await
            .map_err(|_| account_error())
    }
    async fn resolve(&self, owner: &str, provider: &str) -> Result<ManagedCredentials, ProviderError> {
        let credentials = self
            .0
            .inference_credentials(owner, provider)
            .await
            .map_err(|_| account_error())?;
        Ok(ManagedCredentials::new(
            credentials.endpoint().into(),
            credentials.key().into(),
        ))
    }
}

#[cfg(test)]
#[path = "managed_account_test.rs"]
mod tests;
