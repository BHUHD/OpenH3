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
    async fn binding(
        &self,
        owner: &str,
        provider: &str,
    ) -> Result<openh3_ai_agent::managed::ManagedAccountBinding, ProviderError> {
        let binding = self
            .0
            .inference_binding(owner, provider)
            .await
            .map_err(|_| account_error())?;
        Ok(openh3_ai_agent::managed::ManagedAccountBinding {
            lifetime: binding.lifetime,
            identity: Some(openh3_ai_agent::managed::ManagedAccountIdentity {
                owner: binding.owner,
                issuer: binding.issuer,
                subject: binding.subject,
                provider_id: binding.provider_id,
                generation: binding.generation,
            }),
        })
    }
    async fn resolve(
        &self,
        owner: &str,
        provider: &str,
        model: &str,
        mode: aion_config::compat::OpenAiApiMode,
    ) -> Result<ManagedCredentials, ProviderError> {
        let protocol = match mode {
            aion_config::compat::OpenAiApiMode::ChatCompletions => "ChatCompletions",
            aion_config::compat::OpenAiApiMode::Responses => "Responses",
        };
        let credentials = self
            .0
            .inference_credentials(owner, provider)
            .await
            .map_err(|_| account_error())?;
        self.0
            .authorize_model(owner, provider, model, protocol)
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
