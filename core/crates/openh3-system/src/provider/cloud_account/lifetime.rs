//! Local invocation lifetime. This gate is never held over a gateway request or refresh flight.
use super::{CloudAccountError as Error, CloudAccountService, Result};
use tokio::sync::watch;

/// Original authenticated grant identity and its cancellation signal, captured together.
pub struct CloudAccountInferenceBinding {
    pub lifetime: watch::Receiver<bool>,
    pub owner: String,
    pub issuer: String,
    pub subject: String,
    pub provider_id: String,
    pub generation: i64,
}

impl CloudAccountService {
    /// Subscribe to the original grant without refreshing it. Registration and
    /// local invalidation share a gate so logout cannot lose a new subscriber.
    pub async fn inference_lifetime(&self, owner: &str, provider_id: &str) -> Result<watch::Receiver<bool>> {
        Ok(self.inference_binding(owner, provider_id).await?.lifetime)
    }

    pub async fn inference_binding(&self, owner: &str, provider_id: &str) -> Result<CloudAccountInferenceBinding> {
        let mut lifetimes = self.lifetimes.lock().await;
        let row = self
            .repo
            .load(owner, self.gateway()?.issuer())
            .await?
            .ok_or(Error::Authentication)?;
        if row.encrypted.is_none() && matches!(row.state.as_str(), "disconnected" | "reauth_required") {
            return Err(Error::Authentication);
        }
        let stored = match self.decode(&row) {
            Ok(stored) => stored,
            Err(error) => {
                drop(lifetimes);
                self.invalidate_local(owner, &row.issuer, row.generation, true).await?;
                return Err(error);
            }
        };
        if stored.provider_id != provider_id || stored.inference_key.is_none() {
            return Err(Error::Conflict);
        }
        Ok(CloudAccountInferenceBinding {
            lifetime: lifetimes
                .entry((owner.into(), stored.generation))
                .or_insert_with(|| watch::channel(false).0)
                .subscribe(),
            owner: stored.owner,
            issuer: stored.issuer,
            subject: stored.account.id,
            provider_id: stored.provider_id,
            generation: stored.generation,
        })
    }

    pub(super) async fn invalidate_local(
        &self,
        owner: &str,
        issuer: &str,
        generation: i64,
        reauth: bool,
    ) -> Result<()> {
        let mut lifetimes = self.lifetimes.lock().await;
        // Cancel even if persistence fails; never target a replacement generation.
        if let Some(sender) = lifetimes.get(&(owner.into(), generation)) {
            sender.send_replace(true);
        }
        self.repo.invalidate(owner, issuer, Some(generation), reauth).await?;
        lifetimes.remove(&(owner.into(), generation));
        Ok(())
    }

    pub(super) async fn disconnect_local(&self, owner: &str, issuer: &str) -> Result<openh3_db::CloudAccountRow> {
        let mut lifetimes = self.lifetimes.lock().await;
        let row = self.repo.disconnect(owner, issuer).await?;
        if let Some(sender) = lifetimes.remove(&(owner.into(), row.generation)) {
            sender.send_replace(true);
        }
        Ok(row)
    }
}
