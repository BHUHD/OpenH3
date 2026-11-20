use super::{CloudAccountError as Error, Result, wire::Envelope};
use reqwest::{Client, Method, Url};
use serde::{Serialize, de::DeserializeOwned};
use std::time::Duration;

/// Trusted application configuration only. Never deserialize from a request.
#[derive(Clone, Default)]
pub struct CloudAccountConfig {
    pub enabled: bool,
    pub endpoint: Option<String>,
    /// Explicit developer/test opt-in; production must leave this false.
    pub allow_insecure_loopback: bool,
}
pub(super) struct Gateway {
    client: Client,
    endpoint: Url,
}
impl Gateway {
    pub fn new(config: &CloudAccountConfig) -> Result<Option<Self>> {
        let Some(endpoint) = &config.endpoint else {
            return Ok(None);
        };
        let mut endpoint = Url::parse(endpoint).map_err(|_| Error::Policy)?;
        let loopback = matches!(endpoint.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if (endpoint.scheme() != "https"
            && !(config.allow_insecure_loopback && loopback && endpoint.scheme() == "http"))
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(Error::Policy);
        }
        // Account routes are relative to this trusted base, including its prefix.
        if !endpoint.path().ends_with('/') {
            endpoint.path_segments_mut().map_err(|_| Error::Policy)?.push("");
        }
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .user_agent("OpenH3 Desktop")
            .build()
            .map_err(|_| Error::Transport)?;
        Ok(Some(Self { client, endpoint }))
    }
    pub fn issuer(&self) -> &str {
        self.endpoint.as_str()
    }
    pub async fn call<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&impl Serialize>,
        bearer: Option<&str>,
    ) -> Result<T> {
        let url = self
            .endpoint
            .join(&format!("api/openh3/{path}"))
            .map_err(|_| Error::Protocol)?;
        let mut request = self.client.request(method, url);
        if let Some(body) = body {
            request = request.json(body);
        }
        if let Some(bearer) = bearer {
            request = request.bearer_auth(bearer);
        }
        let response = request.send().await.map_err(|_| Error::Transport)?;
        let status = response.status().as_u16();
        // Older gateways may respond with the SPA's HTML fallback.
        if path == "media-models"
            && (matches!(status, 404 | 405)
                || (status == 200
                    && response
                        .headers()
                        .get("content-type")
                        .and_then(|h| h.to_str().ok())
                        .is_some_and(|h| h.split(';').next() == Some("text/html"))))
        {
            return Err(Error::MediaCatalogMissing);
        }
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .map(|v| v.min(86400));
        // Finite practical success limits, not a promise to fit every admin
        // configuration. Credentials and all error bodies remain at 64 KiB.
        let limit = if status == 200 {
            match path {
                "models" => 8 * 1024 * 1024,
                "media-models" => 8 * 1024 * 1024,
                "wallet" => 512 * 1024,
                "usage" => 2 * 1024 * 1024,
                "topup/options" | "topup/orders" => 128 * 1024,
                _ => 65536,
            }
        } else {
            65536
        };
        let bytes = bounded_bytes(response, limit).await?;
        if status != 200 {
            let envelope: Envelope<serde_json::Value> = serde_json::from_slice(&bytes).map_err(|_| Error::Protocol)?;
            if envelope.success {
                return Err(Error::Protocol);
            }
            return Err(match (status, envelope.code.as_str()) {
                (401, "authentication_failed") => Error::Authentication,
                (401, "verification_failed" | "registration_failed") => Error::Verification,
                (400, "invalid_request" | "invalid_password_transport") => Error::Input,
                (403 | 404, _) => Error::Policy,
                (429, "rate_limited") => Error::RateLimited { retry_after },
                (409, "quote_or_idempotency_conflict") => Error::TopupConflict,
                (409, "wallet_capacity_exceeded") => Error::WalletCapacity,
                (503, "temporarily_unavailable") if path.starts_with("topup/") => Error::TopupUnavailable,
                (409, "refresh_conflict") => Error::Conflict,
                (503, "temporarily_unavailable") => Error::Transport,
                _ => Error::Protocol,
            });
        }
        let envelope: Envelope<T> = serde_json::from_slice(&bytes).map_err(|_| Error::Protocol)?;
        if !envelope.success || envelope.code != "ok" || envelope.message != "ok" {
            return Err(Error::Protocol);
        }
        envelope.data.ok_or(Error::Protocol)
    }
    pub async fn get<T: DeserializeOwned>(&self, path: &str, bearer: Option<&str>) -> Result<T> {
        self.call(Method::GET, path, None::<&()>, bearer).await
    }
    pub async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
        bearer: Option<&str>,
    ) -> Result<T> {
        self.call(Method::POST, path, Some(body), bearer).await
    }

    /// Inference uses the device key and a fixed route on the configured issuer.
    /// Neither redirects nor transport retries are permitted on billable requests.
    pub(super) async fn media_call(
        &self,
        path: &str,
        key: &str,
        body: Option<&serde_json::Value>,
        limit: usize,
    ) -> Result<Vec<u8>> {
        let url = self.endpoint.join(path).map_err(|_| Error::Protocol)?;
        let request = match body {
            Some(body) => self.client.post(url).json(body),
            None => self.client.get(url),
        };
        let response = request
            .bearer_auth(key)
            .timeout(Duration::from_secs(240))
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                400 | 413 | 422 => Error::Input,
                401 => Error::Authentication,
                402 => {
                    // Only the configured gateway's local wallet classification
                    // identifies a shortfall. Supplier payment errors are redacted.
                    let bytes = bounded_bytes(response, 65536).await?;
                    let error = serde_json::from_slice::<serde_json::Value>(&bytes).ok();
                    if error
                        .as_ref()
                        .and_then(|v| v.pointer("/error/code"))
                        .and_then(|v| v.as_str())
                        == Some("native_insufficient_balance")
                    {
                        Error::MediaQuota
                    } else {
                        Error::Policy
                    }
                }
                403 => Error::Policy,
                404 if body.is_none() => Error::MediaJobNotFound,
                404 => Error::Policy,
                429 => Error::RateLimited { retry_after: None },
                408 => Error::Transport,
                500..=599 => Error::Transport,
                _ => Error::Protocol,
            });
        }
        bounded_bytes(response, limit).await
    }
}

async fn bounded_bytes(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(Error::Protocol);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Error::Transport)? {
        if chunk.len() > limit - bytes.len() {
            return Err(Error::Protocol);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
