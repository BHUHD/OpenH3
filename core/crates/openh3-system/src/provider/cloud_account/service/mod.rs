use super::{
    CloudAccountError as Error, Result,
    client::{CloudAccountConfig, Gateway},
    flows::LocalFlow,
    nonce, now,
    password::password_fields,
    wire::*,
};
use openh3_api_types::*;
use openh3_common::{decrypt_string, encrypt_string};
use openh3_db::{CloudAccountRow, ICloudAccountRepository, SaveCloudAccount};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

/// Construct only in AppServices; this domain has no HTTP/renderer dependency.
pub struct CloudAccountService {
    pub(super) repo: Arc<dyn ICloudAccountRepository>,
    encryption_key: [u8; 32],
    pub(super) gateway: Option<Gateway>,
    enabled: bool,
    pub(super) flows: Mutex<HashMap<String, LocalFlow>>,
    pub(super) flights: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    pub(super) catalog_flights: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    ceremonies: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    pub(super) lifetimes: Mutex<HashMap<(String, i64), tokio::sync::watch::Sender<bool>>>,
}

/// Core inference handoff only. Intentionally neither Debug nor serializable.
pub struct CloudAccountInferenceCredentials {
    endpoint: String,
    key: String,
}
impl CloudAccountInferenceCredentials {
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
    pub fn key(&self) -> &str {
        &self.key
    }
}

/// Ownership metadata is authenticated inside the encrypted payload as well as
/// compared against the indexed SQL columns before any credential is accepted.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Stored {
    pub owner: String,
    pub issuer: String,
    pub generation: i64,
    pub provider_id: String,
    pub account: CloudAccountProfile,
    pub credentials: Credentials,
    pub inference_key: Option<String>,
}
impl CloudAccountService {
    pub fn new(
        repo: Arc<dyn ICloudAccountRepository>,
        encryption_key: [u8; 32],
        config: CloudAccountConfig,
    ) -> Result<Self> {
        let gateway = if config.enabled { Gateway::new(&config)? } else { None };
        Ok(Self {
            repo,
            encryption_key,
            gateway,
            enabled: config.enabled,
            flows: Mutex::new(HashMap::new()),
            flights: Mutex::new(HashMap::new()),
            catalog_flights: Mutex::new(HashMap::new()),
            ceremonies: Mutex::new(HashMap::new()),
            lifetimes: Mutex::new(HashMap::new()),
        })
    }
    pub(super) async fn ceremony(&self, owner: &str) -> tokio::sync::OwnedMutexGuard<()> {
        let lock = self
            .ceremonies
            .lock()
            .await
            .entry(owner.into())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        lock.lock_owned().await
    }
    pub(super) fn gateway(&self) -> Result<&Gateway> {
        self.gateway.as_ref().filter(|_| self.enabled).ok_or(Error::Policy)
    }
    pub(super) async fn policy(&self) -> Result<Capabilities> {
        let policy: Capabilities = self.gateway()?.get("capabilities", None).await?;
        Self::validate_policy(&policy)?;
        Ok(policy)
    }
    fn validate_policy(policy: &Capabilities) -> Result<()> {
        if policy.turnstile_required
            || policy.turnstile_supported
            || policy.passkey_supported
            || policy.password_min_length == 0
            || policy.password_max_length > 128
            || policy.password_min_length > policy.password_max_length
            || policy
                .mfa_methods
                .iter()
                .any(|v| !matches!(v.as_str(), "totp" | "backup_code"))
        {
            return Err(Error::Policy);
        }
        Ok(())
    }
    pub async fn capabilities(&self) -> Result<CloudAccountCapabilitiesResponse> {
        let availability = if !self.enabled {
            CloudAccountAvailability::Disabled
        } else if self.gateway.is_none() {
            CloudAccountAvailability::Unconfigured
        } else {
            CloudAccountAvailability::Available
        };
        let mut result = CloudAccountCapabilitiesResponse {
            availability,
            registration_enabled: false,
            email_verification_required: false,
            password_login_enabled: false,
            password_reset_enabled: false,
            anti_bot: CloudAccountAntiBot::NotRequired,
            password_min_length: None,
            password_max_length: None,
        };
        if let Some(gateway) = &self.gateway {
            let p: Capabilities = gateway.get("capabilities", None).await?;
            let supported = Self::validate_policy(&p).is_ok();
            result.password_min_length = supported.then_some(p.password_min_length);
            result.password_max_length = supported.then_some(p.password_max_length);
            result.registration_enabled = p.register && supported;
            result.password_login_enabled = p.login && supported;
            result.password_reset_enabled = p.password_reset && supported;
            result.email_verification_required = p.email_verification_required;
            if p.turnstile_required {
                result.anti_bot = CloudAccountAntiBot::UnsupportedRequired;
            }
        }
        Ok(result)
    }
    pub(super) async fn generation(&self, owner: &str) -> Result<i64> {
        let issuer = self.gateway()?.issuer();
        Ok(self.repo.ensure_generation(owner, issuer).await?)
    }
    pub(super) async fn check_generation(&self, owner: &str, generation: i64) -> Result<()> {
        if self.generation(owner).await? != generation {
            return Err(Error::Conflict);
        }
        Ok(())
    }
    pub async fn login(&self, owner: &str, request: CloudAccountLoginRequest) -> Result<CloudAccountSessionResponse> {
        let gateway = self.gateway()?;
        let generation = {
            let mut flows = self.flows.lock().await;
            let generation = self.repo.begin_login(owner, gateway.issuer()).await?;
            flows.retain(|_, f| f.owner != owner);
            generation
        };
        let p = self.policy().await?;
        if !p.login {
            return Err(Error::Policy);
        }
        if request.username.trim().is_empty() || request.username.len() > 254 {
            return Err(Error::Input);
        }
        let request_id = nonce()?;
        let mut body = password_fields(&request.password, &p, false)?;
        body["username"] = json!(request.username.trim());
        body["request_id"] = json!(request_id);
        let response: AuthResult = gateway.post("login", &body, None).await?;
        self.login_result(owner, generation, &request_id, response).await
    }
    pub(super) async fn login_result(
        &self,
        owner: &str,
        generation: i64,
        request_id: &str,
        result: AuthResult,
    ) -> Result<CloudAccountSessionResponse> {
        self.check_generation(owner, generation).await?;
        match result {
            AuthResult::Pending(p) => {
                if p.state != "pending" || p.account.id.is_empty() || p.account.id.len() > 64 {
                    return Err(Error::Protocol);
                }
                validate_credentials(&p.credentials)?;
                let stored = Stored {
                    owner: owner.into(),
                    issuer: self.gateway()?.issuer().into(),
                    generation,
                    provider_id: format!("cloud_{}", nonce()?),
                    account: p.account,
                    credentials: p.credentials,
                    inference_key: None,
                };
                let encrypted = self.encrypt(&stored)?;
                self.repo.save_pending(stored.params(&encrypted)).await?;
                tracing::info!("Cloud account pending grant saved");
                let stored = self.usable_grant(stored).await?;
                Ok(CloudAccountSessionResponse::Connected {
                    generation: stored.generation.to_string(),
                    account: stored.account,
                })
            }
            AuthResult::Flow(flow) if flow.purpose == "openh3_login" => {
                let verification = self.keep_flow(owner, generation, request_id, flow, None, None).await?;
                Ok(CloudAccountSessionResponse::VerificationRequired {
                    generation: generation.to_string(),
                    verification,
                })
            }
            _ => Err(Error::Protocol),
        }
    }
    fn encrypt(&self, stored: &Stored) -> Result<String> {
        encrypt_string(
            &serde_json::to_string(stored).map_err(|_| Error::Storage)?,
            &self.encryption_key,
        )
        .map_err(|_| Error::Storage)
    }
    pub(super) async fn read(&self, owner: &str) -> Result<Option<Stored>> {
        let issuer = self.gateway()?.issuer();
        let Some(row) = self.repo.load(owner, issuer).await? else {
            return Ok(None);
        };
        if row.encrypted.is_none() && matches!(row.state.as_str(), "disconnected" | "reauth_required") {
            return Ok(None);
        }
        match self.decode(&row) {
            Ok(stored) => Ok(Some(stored)),
            Err(_) => {
                self.invalidate_local(owner, issuer, row.generation, true).await?;
                tracing::warn!("Cloud account stored credentials invalidated");
                Err(Error::Authentication)
            }
        }
    }
    pub(super) fn decode(&self, row: &CloudAccountRow) -> Result<Stored> {
        let plain = decrypt_string(
            row.encrypted.as_deref().ok_or(Error::Authentication)?,
            &self.encryption_key,
        )
        .map_err(|_| Error::Authentication)?;
        let s: Stored = serde_json::from_str(&plain).map_err(|_| Error::Authentication)?;
        if !matches!(row.state.as_str(), "active" | "pending")
            || s.owner != row.owner
            || s.issuer != row.issuer
            || s.generation != row.generation
            || Some(&s.provider_id) != row.provider_id.as_ref()
            || Some(&s.account.id) != row.subject.as_ref()
            || Some(&s.credentials.device_id) != row.device_id.as_ref()
            || (row.state == "active") != s.inference_key.is_some()
        {
            return Err(Error::Authentication);
        }
        Ok(s)
    }
    pub(super) async fn invalidate_auth<T>(&self, stored: &Stored, result: Result<T>) -> Result<T> {
        if matches!(result, Err(Error::Authentication)) {
            self.invalidate_local(&stored.owner, &stored.issuer, stored.generation, true)
                .await?;
            tracing::info!("Cloud account reauthentication required");
        }
        result
    }
    async fn usable(&self, owner: &str) -> Result<Option<Stored>> {
        let Some(original) = self.read(owner).await? else {
            return Ok(None);
        };
        self.usable_grant(original).await.map(Some)
    }
    async fn usable_grant(&self, original: Stored) -> Result<Stored> {
        // Bind identity before either refresh-flight wait. Reload credentials
        // afterward so concurrent callers share a rotation within this grant.
        let owner = original.owner.as_str();
        let flight = self
            .flights
            .lock()
            .await
            .entry(owner.into())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let _flight = flight.lock().await;
        let row = self.repo.load(owner, &original.issuer).await?.ok_or(Error::Conflict)?;
        if row.owner != original.owner
            || row.issuer != original.issuer
            || row.generation != original.generation
            || row.subject.as_ref() != Some(&original.account.id)
            || row.provider_id.as_ref() != Some(&original.provider_id)
            || row.device_id.as_ref() != Some(&original.credentials.device_id)
        {
            return Err(Error::Conflict);
        }
        // Compare indexed identity before decoding/invalidation as well: an old
        // caller must not invalidate a malformed replacement grant.
        let mut stored = match self.decode(&row) {
            Ok(stored) => stored,
            Err(_) => return self.invalidate_auth(&original, Err(Error::Authentication)).await,
        };
        let gateway = self.gateway()?;
        if stored.inference_key.is_some() && stored.credentials.session_expires_at <= now() {
            return self.invalidate_auth(&stored, Err(Error::Authentication)).await;
        }
        // A pending deadline can be stale after a lost successful activation.
        // Ask the server while access is valid; otherwise refresh that same grant.
        if stored.credentials.access_expires_at <= now() + 30 {
            let response = gateway.post::<Refreshed>("token", &json!({"refresh_token": stored.credentials.refresh_token, "device_id": stored.credentials.device_id}), None).await;
            let refreshed = self.invalidate_auth(&stored, response).await?.credentials;
            validate_credentials(&refreshed)?;
            if refreshed.device_id != stored.credentials.device_id {
                return Err(Error::Protocol);
            }
            stored.credentials = refreshed;
            self.repo.save_active(stored.params(&self.encrypt(&stored)?)).await?;
        }
        if stored.inference_key.is_none() {
            let response = gateway
                .post::<Activated>("activate", &json!({}), Some(&stored.credentials.access_token))
                .await;
            let active = self.invalidate_auth(&stored, response).await?;
            if active.device_id != stored.credentials.device_id
                || active.inference_key.is_empty()
                || active.inference_key.len() > 4096
                || active.session_expires_at <= now()
            {
                return Err(Error::Protocol);
            }
            stored.credentials.session_expires_at = active.session_expires_at;
            stored.inference_key = Some(active.inference_key);
            self.repo.save_active(stored.params(&self.encrypt(&stored)?)).await?;
            tracing::info!("Cloud account connected");
        }
        self.check_generation(owner, stored.generation).await?;
        Ok(stored)
    }
    pub async fn session(&self, owner: &str) -> Result<CloudAccountSessionResponse> {
        if !self.enabled {
            return Ok(CloudAccountSessionResponse::Disabled {});
        }
        if self.gateway.is_none() {
            return Ok(CloudAccountSessionResponse::Unconfigured {});
        }
        let original_generation = self.generation(owner).await?;
        match self.usable(owner).await {
            Ok(Some(s)) => {
                self.check_generation(owner, original_generation).await?;
                Ok(CloudAccountSessionResponse::Connected {
                    generation: s.generation.to_string(),
                    account: s.account,
                })
            }
            Err(Error::Authentication) => {
                self.check_generation(owner, original_generation + 1).await?;
                Ok(CloudAccountSessionResponse::ReauthRequired {
                    generation: (original_generation + 1).to_string(),
                })
            }
            Err(e) => Err(e),
            Ok(None) => {
                let row = self.repo.load(owner, self.gateway()?.issuer()).await?;
                self.check_generation(owner, original_generation).await?;
                if row.is_some_and(|r| r.state == "reauth_required") {
                    return Ok(CloudAccountSessionResponse::ReauthRequired {
                        generation: original_generation.to_string(),
                    });
                }
                let flows = self.flows.lock().await;
                self.check_generation(owner, original_generation).await?;
                if let Some((id, flow)) = flows
                    .iter()
                    .find(|(_, f)| f.owner == owner && f.flow.purpose == "openh3_login" && f.flow.expires_at > now())
                {
                    return Ok(CloudAccountSessionResponse::VerificationRequired {
                        generation: flow.generation.to_string(),
                        verification: flow.public(id)?,
                    });
                }
                Ok(CloudAccountSessionResponse::Disconnected {
                    generation: original_generation.to_string(),
                })
            }
        }
    }
    pub(super) async fn connected(&self, owner: &str) -> Result<Stored> {
        self.usable(owner).await?.ok_or(Error::Authentication)
    }
    /// Resolve each inference request against its original provider. An old
    /// conversation must never silently charge a replacement account.
    pub async fn inference_credentials(
        &self,
        owner: &str,
        provider_id: &str,
    ) -> Result<CloudAccountInferenceCredentials> {
        let previous = self.read(owner).await?.ok_or(Error::Authentication)?;
        if previous.provider_id != provider_id {
            return Err(Error::Conflict);
        }
        let s = self.usable_grant(previous).await?;
        self.check_generation(owner, s.generation).await?;
        Ok(CloudAccountInferenceCredentials {
            endpoint: s.issuer,
            key: s.inference_key.ok_or(Error::Authentication)?,
        })
    }
    pub async fn me(&self, owner: &str) -> Result<CloudAccountSessionResponse> {
        let stored = self.connected(owner).await?;
        let result = self
            .gateway()?
            .get::<Me>("me", Some(&stored.credentials.access_token))
            .await;
        let account = self.invalidate_auth(&stored, result).await?.account;
        if account.id != stored.account.id {
            return Err(Error::Protocol);
        }
        self.check_generation(owner, stored.generation).await?;
        Ok(CloudAccountSessionResponse::Connected {
            generation: stored.generation.to_string(),
            account,
        })
    }
    pub async fn logout(&self, owner: &str) -> Result<CloudAccountLogoutResponse> {
        use CloudAccountRemoteRevocation::*;
        let gateway = self.gateway()?;
        let stored;
        let had_grant;
        {
            let mut flows = self.flows.lock().await;
            let row = self.disconnect_local(owner, gateway.issuer()).await?;
            had_grant = matches!(row.state.as_str(), "active" | "pending");
            stored = self.decode(&row).ok();
            flows.retain(|_, f| f.owner != owner);
        }
        tracing::info!("Cloud account disconnected locally");
        let remote_revocation = if let Some(stored) = stored {
            let Ok(request_id) = nonce() else {
                return Ok(CloudAccountLogoutResponse {
                    remote_revocation: Unconfirmed,
                });
            };
            let result = gateway
                .post::<State>(
                    "revoke",
                    &json!({"device_id": stored.credentials.device_id, "request_id": request_id}),
                    Some(&stored.credentials.access_token),
                )
                .await;
            if matches!(result, Ok(State { state }) if state == "revoked") {
                Confirmed
            } else {
                Unconfirmed
            }
        } else if had_grant {
            Unconfirmed
        } else {
            NotNeeded
        };
        Ok(CloudAccountLogoutResponse { remote_revocation })
    }
    pub async fn devices(&self, owner: &str) -> Result<CloudAccountDevicesResponse> {
        let stored = self.connected(owner).await?;
        let result = self
            .gateway()?
            .get::<Devices>("devices", Some(&stored.credentials.access_token))
            .await;
        let devices = self.invalidate_auth(&stored, result).await?;
        self.check_generation(owner, stored.generation).await?;
        Ok(CloudAccountDevicesResponse {
            items: devices
                .devices
                .into_iter()
                .map(|d| CloudAccountDevice {
                    id: d.device_id,
                    label: if d.user_agent.trim().is_empty() {
                        "Desktop".into()
                    } else {
                        d.user_agent.chars().filter(|c| !c.is_control()).take(128).collect()
                    },
                    current: d.current,
                    status: CloudAccountDeviceStatus::Active,
                    created_at: d.created_at,
                    last_active_at: d.last_active_at,
                    expires_at: d.expires_at,
                })
                .collect(),
        })
    }
}
impl Stored {
    fn params<'a>(&'a self, encrypted: &'a str) -> SaveCloudAccount<'a> {
        SaveCloudAccount {
            owner: &self.owner,
            issuer: &self.issuer,
            generation: self.generation,
            subject: &self.account.id,
            device_id: &self.credentials.device_id,
            provider_id: &self.provider_id,
            encrypted,
            state: if self.inference_key.is_some() {
                "active"
            } else {
                "pending"
            },
        }
    }
}
fn validate_credentials(c: &Credentials) -> Result<()> {
    if c.access_token.is_empty()
        || c.access_token.len() > 4096
        || c.refresh_token.is_empty()
        || c.refresh_token.len() > 256
        || c.device_id.is_empty()
        || c.device_id.len() > 64
        || c.access_expires_at <= now()
        || c.session_expires_at <= now()
    {
        return Err(Error::Protocol);
    }
    Ok(())
}

mod billing;
mod validation;

mod topup;
