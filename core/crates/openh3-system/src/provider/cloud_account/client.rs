use super::{CloudAccountError as Error, Result, wire::Envelope};
use reqwest::{Client, Method, Url};
use serde::{Serialize, de::DeserializeOwned};
use std::time::Duration;

/// Trusted application configuration only. Never deserialize from a request.
#[derive(Default)]
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
        let endpoint = Url::parse(endpoint).map_err(|_| Error::Policy)?;
        let loopback = matches!(endpoint.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if (endpoint.scheme() != "https"
            && !(config.allow_insecure_loopback && loopback && endpoint.scheme() == "http"))
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
            || endpoint.path() != "/"
        {
            return Err(Error::Policy);
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
        let mut response = request.send().await.map_err(|_| Error::Transport)?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .map(|v| v.min(86400));
        if response.content_length().is_some_and(|n| n > 65536) {
            return Err(Error::Protocol);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::Transport)? {
            if bytes.len() + chunk.len() > 65536 {
                return Err(Error::Protocol);
            }
            bytes.extend_from_slice(&chunk);
        }
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
}
