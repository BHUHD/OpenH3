//! Trusted per-request account resolution. No credential enters aion configuration.
use aion_config::compat::{OpenAiApiMode, ProviderCompat};
pub use aion_providers::ProviderError;
use aion_providers::{LlmProvider, openai::OpenAIProvider};
use aion_types::llm::{LlmEvent, LlmRequest};
use aion_types::message::StopReason;
use std::sync::Arc;
use tokio::sync::{mpsc, watch};

pub const MANAGED_KEY_PLACEHOLDER: &str = "openh3-managed-credential-resolver";

/// Deliberately neither Debug nor Serialize; scoped to one model request.
pub struct ManagedCredentials {
    endpoint: String,
    key: String,
}
impl ManagedCredentials {
    pub fn new(endpoint: String, key: String) -> Self {
        Self { endpoint, key }
    }
}

/// The composition root bridges this port to the account domain.
#[async_trait::async_trait]
pub trait ManagedCredentialResolver: Send + Sync {
    async fn subscribe(&self, owner: &str, provider: &str) -> Result<watch::Receiver<bool>, ProviderError>;
    async fn resolve(
        &self,
        owner: &str,
        provider: &str,
        model: &str,
        mode: OpenAiApiMode,
    ) -> Result<ManagedCredentials, ProviderError>;
}

/// Shared by the parent engine and native child agents. Its identity/model is immutable.
pub struct ManagedProvider {
    resolver: Arc<dyn ManagedCredentialResolver>,
    owner: String,
    provider: String,
    model: String,
    mode: OpenAiApiMode,
    lifetime: watch::Receiver<bool>,
}
impl ManagedProvider {
    pub async fn bind(
        resolver: Arc<dyn ManagedCredentialResolver>,
        owner: String,
        provider: String,
        model: String,
        mode: OpenAiApiMode,
    ) -> Result<Arc<Self>, ProviderError> {
        let lifetime = resolver.subscribe(&owner, &provider).await?;
        if *lifetime.borrow() {
            return Err(cancelled_error());
        }
        Ok(Arc::new(Self {
            resolver,
            owner,
            provider,
            model,
            mode,
            lifetime,
        }))
    }
    pub async fn cancelled(&self) {
        cancelled(self.lifetime.clone()).await
    }
}

fn cancelled_error() -> ProviderError {
    ProviderError::Connection("Managed account invocation cancelled".into())
}
async fn cancelled(mut lifetime: watch::Receiver<bool>) {
    loop {
        if *lifetime.borrow_and_update() {
            return;
        }
        if lifetime.changed().await.is_err() {
            return;
        }
    }
}

#[async_trait::async_trait]
impl LlmProvider for ManagedProvider {
    async fn stream(&self, request: &LlmRequest) -> Result<mpsc::Receiver<LlmEvent>, ProviderError> {
        if request.model != self.model {
            return Err(ProviderError::Parse(
                "Managed model differs from verified selection".into(),
            ));
        }
        let credentials = tokio::select! {
            biased;
            _ = self.cancelled() => return Err(cancelled_error()),
            result = self.resolver.resolve(&self.owner, &self.provider, &self.model, self.mode) => result?,
        };
        let provider = OpenAIProvider::new_managed(
            &credentials.key,
            &credentials.endpoint,
            self.mode,
            ProviderCompat::openai_defaults(),
        )?;
        let mut upstream = tokio::select! {
            biased;
            _ = self.cancelled() => return Err(cancelled_error()),
            result = provider.stream(request) => result?,
        };
        let (tx, rx) = mpsc::channel(64);
        let lifetime = self.lifetime.clone();
        tokio::spawn(async move {
            let forward_tx = tx.clone();
            let forwarding = async move {
                let tx = forward_tx;
                let mut terminal = None;
                let mut text = false;
                let mut tools = false;
                while let Some(event) = upstream.recv().await {
                    match event {
                        LlmEvent::Done { .. } => terminal = Some(event),
                        LlmEvent::Error(_) => {
                            let _ = tx.send(LlmEvent::Error("Managed provider stream failed".into())).await;
                            return;
                        }
                        event => {
                            match &event {
                                LlmEvent::TextDelta(delta) => text |= !delta.trim().is_empty(),
                                LlmEvent::ToolUse { id, name, input, .. } => {
                                    if id.trim().is_empty() || name.trim().is_empty() || !input.is_object() {
                                        let _ = tx
                                            .send(LlmEvent::Error(
                                                "Managed provider returned an invalid tool call".into(),
                                            ))
                                            .await;
                                        return;
                                    }
                                    tools = true;
                                }
                                _ => {}
                            }
                            if tx.send(event).await.is_err() {
                                return;
                            }
                        }
                    }
                }
                // Pinned engine consumes EOF as EndTurn and retries EmptyFinal.
                // Hold Done until clean provider-channel completion, protecting compaction
                // consumers that stop reading on Done. Never reparse SSE here.
                let terminal = match terminal {
                    Some(LlmEvent::Done {
                        stop_reason: StopReason::ToolUse,
                        ..
                    }) if !tools => LlmEvent::Error("Managed provider tool response is empty".into()),
                    Some(done) if text || tools => done,
                    _ => LlmEvent::Error("Managed provider response incomplete or empty".into()),
                };
                let _ = tx.send(terminal).await;
            };
            tokio::select! {
                biased;
                _ = cancelled(lifetime) => {
                    // The forwarding future (and upstream receiver) is already
                    // dropped. Deliver an error even if buffered text filled the channel.
                    let _ = tx.send(LlmEvent::Error("Managed account invocation cancelled".into())).await;
                }
                _ = tx.closed() => {}
                _ = forwarding => {}
            }
        });
        Ok(rx)
    }
}

#[cfg(test)]
mod tests;
