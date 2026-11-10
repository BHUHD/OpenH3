use super::{CloudAccountError as Error, CloudAccountService, Result, nonce, now, password::password_fields, wire::*};
use openh3_api_types::*;
use serde_json::json;

#[derive(Clone)]
pub(super) struct LocalFlow {
    pub owner: String,
    pub generation: i64,
    pub request_id: String,
    pub flow: Flow,
    pub email: Option<String>,
    pub target: Option<String>,
}
impl LocalFlow {
    pub fn public(&self, handle: &str) -> Result<CloudAccountVerification> {
        let purpose = match self.flow.purpose.as_str() {
            "openh3_login" => CloudAccountVerificationPurpose::Login,
            "openh3_recovery_mfa" => CloudAccountVerificationPurpose::PasswordReset,
            "openh3_revoke" => CloudAccountVerificationPurpose::DeviceRevocation,
            _ => return Err(Error::Protocol),
        };
        let methods = self
            .flow
            .methods
            .as_ref()
            .ok_or(Error::Protocol)?
            .iter()
            .map(|m| match m.as_str() {
                "totp" => Ok(CloudAccountVerificationMethod::Totp),
                "backup_code" => Ok(CloudAccountVerificationMethod::BackupCode),
                "password" if self.flow.purpose == "openh3_revoke" => Ok(CloudAccountVerificationMethod::Password),
                _ => Err(Error::Protocol),
            })
            .collect::<Result<Vec<_>>>()?;
        if methods.is_empty() {
            return Err(Error::Protocol);
        }
        Ok(CloudAccountVerification {
            purpose,
            challenge_id: handle.into(),
            expires_at: self.flow.expires_at,
            methods,
        })
    }
}
fn email(value: &str) -> Result<String> {
    let value = value.trim().to_lowercase();
    if value.len() > 254 || !value.contains('@') || value.chars().any(char::is_control) {
        return Err(Error::Input);
    }
    Ok(value)
}
impl CloudAccountService {
    async fn store_flow(
        &self,
        owner: &str,
        generation: i64,
        request_id: &str,
        flow: Flow,
        email: Option<String>,
        target: Option<String>,
    ) -> Result<String> {
        if flow.flow_token.is_empty()
            || flow.flow_token.len() > 128
            || flow.expires_at <= now()
            || flow.resend_at > flow.expires_at
        {
            return Err(Error::Protocol);
        }
        let mut flows = self.flows.lock().await;
        self.check_generation(owner, generation).await?;
        flows.retain(|_, f| f.flow.expires_at > now() && !(f.owner == owner && f.flow.purpose == flow.purpose));
        let handle = nonce()?;
        flows.insert(
            handle.clone(),
            LocalFlow {
                owner: owner.into(),
                generation,
                request_id: request_id.into(),
                flow,
                email,
                target,
            },
        );
        Ok(handle)
    }
    pub(super) async fn keep_flow(
        &self,
        owner: &str,
        generation: i64,
        request_id: &str,
        flow: Flow,
        email: Option<String>,
        target: Option<String>,
    ) -> Result<CloudAccountVerification> {
        if flow.state != "verification_required" {
            return Err(Error::Protocol);
        }
        let preview = LocalFlow {
            owner: owner.into(),
            generation,
            request_id: request_id.into(),
            flow: flow.clone(),
            email: email.clone(),
            target: target.clone(),
        };
        preview.public("")?;
        let handle = self
            .store_flow(owner, generation, request_id, flow, email, target)
            .await?;
        preview.public(&handle)
    }
    async fn handle(&self, owner: &str, handle: &str) -> Result<LocalFlow> {
        let flows = self.flows.lock().await;
        let flow = flows
            .get(handle)
            .filter(|f| f.owner == owner && f.flow.expires_at > now())
            .cloned()
            .ok_or(Error::Input)?;
        self.check_generation(owner, flow.generation).await?;
        Ok(flow)
    }
    async fn email_flow(&self, owner: &str, purpose: &str, email: &str) -> Result<LocalFlow> {
        self.flows
            .lock()
            .await
            .values()
            .find(|f| {
                f.owner == owner
                    && f.flow.purpose == purpose
                    && f.email.as_deref() == Some(email)
                    && f.flow.expires_at > now()
            })
            .cloned()
            .ok_or(Error::Input)
    }
    pub async fn email_code(&self, owner: &str, request: CloudAccountEmailCodeRequest) -> Result<()> {
        // Fence work queued behind another ceremony or a capabilities request
        // against logout, even though this request has no existing handle yet.
        let generation = self.generation(owner).await?;
        let _ceremony = self.ceremony(owner).await;
        self.check_generation(owner, generation).await?;
        let p = self.policy().await?;
        let (purpose, path) = match request.purpose {
            CloudAccountEmailCodePurpose::Registration if p.register && p.email_verification_required => {
                ("openh3_register_email", "email-code")
            }
            CloudAccountEmailCodePurpose::PasswordReset if p.password_reset => {
                ("openh3_recovery_email", "password/reset")
            }
            _ => return Err(Error::Policy),
        };
        let email = email(&request.email)?;
        let previous = self.email_flow(owner, purpose, &email).await.ok();
        if let Some(previous) = &previous
            && previous.flow.resend_at > now()
        {
            return Err(Error::RateLimited {
                retry_after: Some((previous.flow.resend_at - now()) as u64),
            });
        }
        let request_id = match previous {
            Some(f) => f.request_id,
            None => nonce()?,
        };
        // Retain only delivery correlation on failure, never fabricate a usable
        // proof. A new recovery attempt invalidates all older recovery handles.
        {
            let mut flows = self.flows.lock().await;
            self.check_generation(owner, generation).await?;
            flows.retain(|_, f| {
                !(f.owner == owner
                    && (f.flow.purpose == purpose
                        || (purpose == "openh3_recovery_email"
                            && matches!(f.flow.purpose.as_str(), "openh3_recovery_mfa" | "openh3_reset_ready"))))
            });
            flows.insert(
                nonce()?,
                LocalFlow {
                    owner: owner.into(),
                    generation,
                    request_id: request_id.clone(),
                    flow: Flow {
                        state: "delivery_pending".into(),
                        purpose: purpose.into(),
                        flow_token: String::new(),
                        expires_at: now() + 600,
                        resend_at: 0,
                        methods: None,
                    },
                    email: Some(email.clone()),
                    target: None,
                },
            );
        }
        let flow: Flow = self
            .gateway()?
            .post(path, &json!({"email": email, "request_id": request_id}), None)
            .await?;
        if flow.purpose != purpose || flow.state != "code_sent" {
            return Err(Error::Protocol);
        }
        self.store_flow(owner, generation, &request_id, flow, Some(email), None)
            .await?;
        Ok(())
    }
    pub async fn register(
        &self,
        owner: &str,
        request: CloudAccountRegisterRequest,
    ) -> Result<CloudAccountRegisterResponse> {
        let _ceremony = self.ceremony(owner).await;
        let p = self.policy().await?;
        if !p.register {
            return Err(Error::Policy);
        }
        let username = request.username.trim();
        if username.is_empty() || username.chars().count() > 20 {
            return Err(Error::Input);
        }
        let mut body = password_fields(&request.password, &p, true)?;
        body["username"] = json!(username);
        if p.email_verification_required {
            let email = email(&request.email)?;
            let f = self.email_flow(owner, "openh3_register_email", &email).await?;
            if f.flow.flow_token.is_empty() {
                return Err(Error::Input);
            }
            self.check_generation(owner, f.generation).await?;
            body["email"] = json!(email);
            body["request_id"] = json!(f.request_id);
            body["flow_token"] = json!(f.flow.flow_token);
            let code = request
                .verification_code
                .filter(|c| !c.is_empty() && c.len() <= 32)
                .ok_or(Error::Input)?;
            body["code"] = json!(code);
        } else {
            body["request_id"] = json!(nonce()?);
            if !request.email.trim().is_empty() {
                body["email"] = json!(email(&request.email)?);
            }
        }
        let result: State = self.gateway()?.post("register", &body, None).await?;
        if result.state != "registered" {
            return Err(Error::Protocol);
        }
        self.flows
            .lock()
            .await
            .retain(|_, f| !(f.owner == owner && f.flow.purpose == "openh3_register_email"));
        Ok(CloudAccountRegisterResponse::Registered {})
    }
    pub async fn password_reset(
        &self,
        owner: &str,
        request: CloudAccountPasswordResetRequest,
    ) -> Result<CloudAccountPasswordResetResponse> {
        let _ceremony = self.ceremony(owner).await;
        if !self.policy().await?.password_reset {
            return Err(Error::Policy);
        }
        let email = email(&request.email)?;
        let f = self.email_flow(owner, "openh3_recovery_email", &email).await?;
        if f.flow.flow_token.is_empty() {
            return Err(Error::Input);
        }
        self.check_generation(owner, f.generation).await?;
        if request.code.is_empty() || request.code.len() > 64 {
            return Err(Error::Input);
        }
        let flow: Flow = self.gateway()?.post("auth/verify", &json!({"purpose": f.flow.purpose, "flow_token": f.flow.flow_token, "request_id": f.request_id, "method": "email_code", "email": email, "proof": request.code}), None).await?;
        self.flows.lock().await.retain(|_, local| {
            !(local.owner == owner && local.generation == f.generation && local.flow.purpose == "openh3_recovery_email")
        });
        self.reset_result(owner, f.generation, &f.request_id, flow, Some(email))
            .await
    }
    async fn reset_result(
        &self,
        owner: &str,
        generation: i64,
        request_id: &str,
        flow: Flow,
        email: Option<String>,
    ) -> Result<CloudAccountPasswordResetResponse> {
        match flow.purpose.as_str() {
            "openh3_reset_ready" if flow.state == "reset_ready" => {
                let expires_at = flow.expires_at;
                let challenge_id = self
                    .store_flow(owner, generation, request_id, flow, email, None)
                    .await?;
                Ok(CloudAccountPasswordResetResponse::Ready {
                    challenge_id,
                    expires_at,
                })
            }
            "openh3_recovery_mfa" => Ok(CloudAccountPasswordResetResponse::VerificationRequired {
                verification: self.keep_flow(owner, generation, request_id, flow, email, None).await?,
            }),
            _ => Err(Error::Protocol),
        }
    }
    pub async fn verify(&self, owner: &str, request: CloudAccountVerifyRequest) -> Result<CloudAccountVerifyResponse> {
        let _ceremony = self.ceremony(owner).await;
        let (id, method, proof) = match request {
            CloudAccountVerifyRequest::Totp { challenge_id, code } => (challenge_id, "totp", code),
            CloudAccountVerifyRequest::BackupCode { challenge_id, code } => (challenge_id, "backup_code", code),
            CloudAccountVerifyRequest::Password { challenge_id, password } => (challenge_id, "password", password),
        };
        let f = self.handle(owner, &id).await?;
        f.public(&id)?;
        if !f.flow.methods.as_ref().is_some_and(|m| m.iter().any(|m| m == method)) {
            return Err(Error::Policy);
        }
        let mut body = if method == "password" {
            password_fields(&proof, &self.policy().await?, false)?
        } else {
            if proof.is_empty() || proof.len() > 64 {
                return Err(Error::Input);
            }
            json!({"proof": proof})
        };
        body["purpose"] = json!(f.flow.purpose);
        body["flow_token"] = json!(f.flow.flow_token);
        body["request_id"] = json!(f.request_id);
        body["method"] = json!(method);
        let connected = if f.flow.purpose == "openh3_revoke" {
            Some(self.connected(owner).await?)
        } else {
            None
        };
        let result = self
            .gateway()?
            .post::<AuthResult>(
                "auth/verify",
                &body,
                connected.as_ref().map(|s| s.credentials.access_token.as_str()),
            )
            .await;
        let result = if let Some(s) = &connected {
            self.invalidate_auth(s, result).await?
        } else {
            result?
        };
        self.check_generation(owner, f.generation).await?;
        self.flows.lock().await.remove(&id);
        match f.flow.purpose.as_str() {
            "openh3_login" => Ok(CloudAccountVerifyResponse::Login {
                session: self.login_result(owner, f.generation, &f.request_id, result).await?,
            }),
            "openh3_recovery_mfa" => {
                let AuthResult::Flow(flow) = result else {
                    return Err(Error::Protocol);
                };
                match self
                    .reset_result(owner, f.generation, &f.request_id, flow, f.email)
                    .await?
                {
                    CloudAccountPasswordResetResponse::Ready {
                        challenge_id,
                        expires_at,
                    } => Ok(CloudAccountVerifyResponse::PasswordResetReady {
                        challenge_id,
                        expires_at,
                    }),
                    _ => Err(Error::Protocol),
                }
            }
            "openh3_revoke" if matches!(result, AuthResult::Revoked(State { state }) if state == "revoked") => {
                if let Some(s) = connected
                    && f.target.as_deref() == Some(&s.credentials.device_id)
                {
                    self.repo
                        .invalidate(owner, &s.issuer, Some(s.generation), false)
                        .await?;
                }
                Ok(CloudAccountVerifyResponse::DeviceRevoked {})
            }
            _ => Err(Error::Protocol),
        }
    }
    pub async fn password_reset_complete(
        &self,
        owner: &str,
        request: CloudAccountPasswordResetCompleteRequest,
    ) -> Result<CloudAccountPasswordResetCompleteResponse> {
        let _ceremony = self.ceremony(owner).await;
        let f = self.handle(owner, &request.challenge_id).await?;
        if f.flow.purpose != "openh3_reset_ready" {
            return Err(Error::Input);
        }
        let p = self.policy().await?;
        if !p.password_reset {
            return Err(Error::Policy);
        }
        let mut body = password_fields(&request.new_password, &p, true)?;
        body["flow_token"] = json!(f.flow.flow_token);
        body["request_id"] = json!(f.request_id);
        let result: Reset = self.gateway()?.post("password/reset/complete", &body, None).await?;
        if result.state != "password_reset" {
            return Err(Error::Protocol);
        }
        self.flows.lock().await.remove(&request.challenge_id);
        // Password is already committed. Preserve success even when cleanup fails.
        let cleanup = async {
            if let Some(s) = self.read(owner).await?
                && s.generation == f.generation
                && s.account.email.as_deref().and_then(|e| email(e).ok()) == f.email
                && f.email.is_some()
            {
                self.repo.invalidate(owner, &s.issuer, Some(s.generation), true).await?;
            }
            Ok::<(), Error>(())
        }
        .await;
        Ok(CloudAccountPasswordResetCompleteResponse {
            session_cleanup_pending: result.session_cleanup_pending || cleanup.is_err(),
        })
    }
    pub async fn revoke_device(
        &self,
        owner: &str,
        request: CloudAccountRevokeDeviceRequest,
    ) -> Result<CloudAccountRevokeDeviceResponse> {
        let _ceremony = self.ceremony(owner).await;
        if request.device_id.is_empty() || request.device_id.len() > 64 {
            return Err(Error::Input);
        }
        let s = self.connected(owner).await?;
        let request_id = nonce()?;
        let result = self
            .gateway()?
            .post::<AuthResult>(
                "revoke",
                &json!({"device_id": request.device_id, "request_id": request_id}),
                Some(&s.credentials.access_token),
            )
            .await;
        let result = self.invalidate_auth(&s, result).await?;
        self.check_generation(owner, s.generation).await?;
        match result {
            AuthResult::Revoked(State { state }) if state == "revoked" => {
                if request.device_id == s.credentials.device_id {
                    self.repo
                        .invalidate(owner, &s.issuer, Some(s.generation), false)
                        .await?;
                }
                Ok(CloudAccountRevokeDeviceResponse::Revoked {})
            }
            AuthResult::Flow(flow) if flow.purpose == "openh3_revoke" => {
                Ok(CloudAccountRevokeDeviceResponse::VerificationRequired {
                    verification: self
                        .keep_flow(owner, s.generation, &request_id, flow, None, Some(request.device_id))
                        .await?,
                })
            }
            _ => Err(Error::Protocol),
        }
    }
}
