use super::CloudAccountService;
use openh3_auth::{AuthState, CookieConfig, RateLimiter};
use std::sync::Arc;

/// Dependencies assembled by the application, never from renderer input.
#[derive(Clone)]
pub struct CloudAccountRouterState {
    pub service: Arc<CloudAccountService>,
    pub auth: AuthState,
    pub cookies: Arc<CookieConfig>,
    pub capability: Option<Arc<str>>,
    pub trusted_origins: Arc<Vec<String>>,
    pub limiter: Arc<RateLimiter>,
}
