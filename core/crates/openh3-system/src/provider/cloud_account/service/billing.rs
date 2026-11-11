use super::validation::*;
use super::*;
use openh3_db::SaveCloudCatalog;

impl Stored {
    fn catalog<'a>(&'a self, models: &'a [(String, String, bool)]) -> SaveCloudCatalog<'a> {
        SaveCloudCatalog {
            owner: &self.owner,
            issuer: &self.issuer,
            generation: self.generation,
            subject: &self.account.id,
            provider_id: &self.provider_id,
            models,
        }
    }
}
impl CloudAccountService {
    pub async fn wallet(&self, owner: &str) -> Result<CloudAccountWalletResponse> {
        let s = self.connected(owner).await?;
        let response = self
            .gateway()?
            .get::<Wallet>("wallet", Some(&s.credentials.access_token))
            .await;
        let wallet = self.invalidate_auth(&s, response).await?.0;
        validate_wallet(&wallet)?;
        self.check_generation(owner, s.generation).await?;
        Ok(wallet)
    }
    pub async fn usage(&self, owner: &str, query: CloudAccountUsageQuery) -> Result<CloudAccountUsageResponse> {
        if !(1..=1_000_000).contains(&query.page)
            || !(1..=100).contains(&query.page_size)
            || query.start_time < 0
            || query.end_time < 0
            || query.end_time != 0 && query.end_time < query.start_time
            || query.model.len() > 256
            || query.device_id.len() > 64
        {
            return Err(Error::Input);
        }
        let s = self.connected(owner).await?;
        let response = self
            .gateway()?
            .post::<Usage>("usage", &query, Some(&s.credentials.access_token))
            .await;
        let usage = self.invalidate_auth(&s, response).await?.0;
        validate_usage(&usage, &query)?;
        self.check_generation(owner, s.generation).await?;
        Ok(usage)
    }
    /// Refresh local admission only. The gateway rechecks policy and prices on
    /// every inference; this observation is never charging authority.
    pub async fn models(&self, owner: &str) -> Result<CloudAccountModelsResponse> {
        let s = self.connected(owner).await?;
        // Capture identity before waiting. A queued request from A cannot read B
        // after logout/login, while responses within one grant commit in order.
        let flight = self
            .catalog_flights
            .lock()
            .await
            .entry(owner.into())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let _flight = flight.lock().await;
        self.check_generation(owner, s.generation).await?;
        let response = self
            .gateway()?
            .get::<Catalog>("models", Some(&s.credentials.access_token))
            .await;
        let response = self.invalidate_auth(&s, response).await;
        let catalog = response.and_then(validate_catalog);
        let catalog = match catalog {
            Ok(catalog) => catalog,
            Err(error) => {
                // Authentication invalidation already disabled the provider and
                // advanced this grant; do not mask its error with a second CAS.
                if error == Error::Authentication {
                    return Err(error);
                }
                // A failed read cannot retain stale admission. The CAS may fail
                // after logout/replacement, in which case it never touches B.
                self.repo.replace_catalog(s.catalog(&[])).await?;
                self.check_generation(owner, s.generation).await?;
                return Err(error);
            }
        };
        let selections: Vec<_> = catalog
            .models
            .iter()
            .filter(|m| m.selection_unavailable_reason.is_none())
            .map(|m| (m.model_id.clone(), m.protocol.clone(), m.supports_tools))
            .collect();
        self.repo.replace_catalog(s.catalog(&selections)).await?;
        self.check_generation(owner, s.generation).await?;
        Ok(catalog)
    }
    /// Called for each reused managed invocation, using the model and protocol
    /// already immutably bound to that engine. Never polls the gateway.
    pub async fn authorize_model(&self, owner: &str, provider: &str, model: &str, protocol: &str) -> Result<()> {
        let s = self.connected(owner).await?;
        if s.provider_id != provider {
            return Err(Error::Conflict);
        }
        if !self.repo.model_allowed(s.catalog(&[]), model, protocol).await? {
            return Err(Error::Policy);
        }
        self.check_generation(owner, s.generation).await
    }
}
