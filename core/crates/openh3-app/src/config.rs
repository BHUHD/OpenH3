//! Application configuration parsed from CLI arguments + key derivation.

use std::path::PathBuf;

use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityMode {
    Local,
    WebUi,
    AionPro,
}

impl IdentityMode {
    pub fn auth_label(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::WebUi => "webui",
            Self::AionPro => "aionpro",
        }
    }

    pub fn is_local(self) -> bool {
        self == Self::Local
    }
}

/// Application configuration parsed from CLI arguments.
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub cloud_account: CloudAccountTransportConfig,
    pub host: String,
    pub port: u16,
    pub data_dir: PathBuf,
    pub work_dir: PathBuf,
    pub app_version: String,
    /// Run in local embedded mode (skip authentication, use system_default_user).
    pub local: bool,
    pub identity_mode: IdentityMode,
    pub bootstrap_secret: Option<String>,
    /// Dump prompt diagnostics under `data_dir/prompt-dumps`.
    pub dump_prompts: bool,
    /// Explicitly authorize backup and rebuild for corruption-like local databases.
    pub recover_corrupted_database: bool,
}

impl AppConfig {
    pub fn effective_identity_mode(&self) -> IdentityMode {
        if self.local {
            IdentityMode::Local
        } else {
            self.identity_mode
        }
    }

    /// Format as `host:port` for socket binding.
    pub fn socket_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    /// Local URL helpers should use to call this backend from the same machine.
    pub fn local_base_url(&self) -> String {
        let host = match self.host.as_str() {
            "0.0.0.0" | "::" => "127.0.0.1",
            other => other,
        };
        format!("http://{host}:{}", self.port)
    }

    /// Path to the SQLite database file.
    pub fn database_path(&self) -> PathBuf {
        self.data_dir.join("aionui-backend.db")
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            cloud_account: CloudAccountTransportConfig::default(),
            host: openh3_common::constants::DEFAULT_HOST.to_string(),
            port: openh3_common::constants::DEFAULT_PORT,
            data_dir: PathBuf::from("data"),
            work_dir: PathBuf::from("data"),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            local: false,
            identity_mode: IdentityMode::WebUi,
            bootstrap_secret: None,
            dump_prompts: false,
            recover_corrupted_database: false,
        }
    }
}

/// Derive a 32-byte encryption key from the storage-encryption secret using
/// SHA-256. The domain-separation prefix is part of the on-disk contract and
/// must never change — doing so would orphan every stored ciphertext.
pub fn derive_encryption_key(secret: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"aionui-encryption-key:");
    hasher.update(secret.as_bytes());
    hasher.finalize().into()
}

/// Trusted process configuration. Debug deliberately omits endpoint and capability.
#[derive(Clone, Default)]
pub struct CloudAccountTransportConfig {
    pub service: openh3_system::provider::cloud_account::CloudAccountConfig,
    pub capability: Option<std::sync::Arc<str>>,
    pub trusted_origins: Vec<String>,
}
impl std::fmt::Debug for CloudAccountTransportConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CloudAccountTransportConfig")
            .field("enabled", &self.service.enabled)
            .finish_non_exhaustive()
    }
}
impl CloudAccountTransportConfig {
    /// Consume trusted process configuration before any runtime or subprocess starts.
    /// Tests normally inject typed configuration directly.
    ///
    /// # Safety
    /// The caller must ensure no other thread can access the process environment.
    pub unsafe fn from_env() -> Self {
        let config = Self {
            service: openh3_system::provider::cloud_account::CloudAccountConfig {
                enabled: std::env::var("OPENH3_CLOUD_ACCOUNT_ENABLED").as_deref() == Ok("1"),
                endpoint: std::env::var("OPENH3_CLOUD_ACCOUNT_ENDPOINT")
                    .ok()
                    .filter(|v| !v.is_empty()),
                allow_insecure_loopback: std::env::var("OPENH3_CLOUD_ACCOUNT_ALLOW_LOOPBACK_HTTP").as_deref()
                    == Ok("1"),
            },
            capability: std::env::var("OPENH3_CLOUD_ACCOUNT_CAPABILITY")
                .ok()
                .filter(|v| v.len() >= 32)
                .map(Into::into),
            trusted_origins: std::env::var("OPENH3_CLOUD_ACCOUNT_TRUSTED_ORIGINS")
                .unwrap_or_default()
                .split(',')
                .filter_map(|v| {
                    let url = reqwest::Url::parse(v.trim()).ok()?;
                    ((url.scheme() == "https" || url.scheme() == "http")
                        && url.username().is_empty()
                        && url.password().is_none()
                        && url.path() == "/"
                        && url.query().is_none()
                        && url.fragment().is_none())
                    .then(|| url.origin().ascii_serialization())
                })
                .collect(),
        };
        // Some vendored tools use plain Command and bypass our spawn filters.
        // Remove all casing variants so only application state retains the secret.
        let keys: Vec<_> = std::env::vars_os()
            .map(|(key, _)| key)
            .filter(|key| {
                key.to_string_lossy()
                    .eq_ignore_ascii_case("OPENH3_CLOUD_ACCOUNT_CAPABILITY")
            })
            .collect();
        for key in keys {
            // SAFETY: upheld by the caller before starting worker threads.
            unsafe { std::env::remove_var(key) };
        }
        config
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_config_default() {
        let config = AppConfig::default();
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 25808);
        assert_eq!(config.data_dir, PathBuf::from("data"));
        assert_eq!(config.app_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(config.identity_mode, IdentityMode::WebUi);
        assert!(config.bootstrap_secret.is_none());
        assert!(!config.dump_prompts);
        assert!(!config.recover_corrupted_database);
        assert!(!config.cloud_account.service.enabled);
        assert!(config.cloud_account.service.endpoint.is_none());
    }

    #[test]
    fn cloud_debug_never_contains_trusted_secrets_or_endpoint() {
        let config = AppConfig {
            cloud_account: CloudAccountTransportConfig {
                capability: Some("SENTINEL-capability".into()),
                service: openh3_system::provider::cloud_account::CloudAccountConfig {
                    endpoint: Some("https://SENTINEL.example".into()),
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(!format!("{config:?}").contains("SENTINEL"));
    }

    #[test]
    fn cloud_bootstrap_consumes_capability_before_plain_child_spawn() {
        const MARKER: &str = "OPENH3_TEST_CLOUD_BOOTSTRAP_CHILD";
        const TEST: &str = "config::tests::cloud_bootstrap_consumes_capability_before_plain_child_spawn";
        let child = || {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command.args(["--exact", TEST, "--test-threads=1"]);
            command
        };
        match std::env::var(MARKER).as_deref() {
            Ok("probe") => {
                assert!(std::env::vars_os().all(|(key, _)| {
                    !key.to_string_lossy()
                        .eq_ignore_ascii_case("OPENH3_CLOUD_ACCOUNT_CAPABILITY")
                }));
            }
            Ok("capture") => {
                // SAFETY: this isolated process runs only this test, with no
                // runtime or other test reading the environment concurrently.
                let config = unsafe { CloudAccountTransportConfig::from_env() };
                assert!(config.capability.as_deref() == Some("synthetic-bootstrap-capability-123456"));
                assert!(child().env(MARKER, "probe").output().unwrap().status.success());
            }
            _ => {
                for key in [
                    "OPENH3_CLOUD_ACCOUNT_CAPABILITY",
                    #[cfg(windows)]
                    "OpenH3_Cloud_Account_Capability",
                ] {
                    assert!(
                        child()
                            .env_remove("OPENH3_CLOUD_ACCOUNT_CAPABILITY")
                            .env(key, "synthetic-bootstrap-capability-123456")
                            .env(MARKER, "capture")
                            .output()
                            .unwrap()
                            .status
                            .success()
                    );
                }
            }
        }
    }

    #[test]
    fn test_app_config_socket_addr() {
        let config = AppConfig {
            host: "0.0.0.0".to_string(),
            port: 3000,
            ..Default::default()
        };
        assert_eq!(config.socket_addr(), "0.0.0.0:3000");
    }

    #[test]
    fn local_base_url_uses_loopback_for_wildcard_host() {
        let config = AppConfig {
            host: "0.0.0.0".to_string(),
            port: 49152,
            ..Default::default()
        };
        assert_eq!(config.local_base_url(), "http://127.0.0.1:49152");
    }

    #[test]
    fn test_app_config_database_path() {
        let config = AppConfig {
            data_dir: PathBuf::from("/tmp/aionui"),
            ..Default::default()
        };
        assert_eq!(config.database_path(), PathBuf::from("/tmp/aionui/aionui-backend.db"));
    }
}
