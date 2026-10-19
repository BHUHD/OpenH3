use openh3_api_types::SystemInfoResponse;

/// Map Rust `std::env::consts::OS` to the Node.js-compatible platform name
/// used by the API contract.
fn map_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other, // "linux" stays "linux"
    }
}

/// Map Rust `std::env::consts::ARCH` to the API contract arch name.
fn map_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

/// Resolve the cache directory for OpenH3.
///
/// Priority: `OPENH3_CACHE_DIR` env → legacy `AIONUI_CACHE_DIR` env →
/// an existing legacy directory → the canonical OpenH3 directory.
fn resolve_cache_dir() -> String {
    resolve_env_dir(
        "OPENH3_CACHE_DIR",
        "AIONUI_CACHE_DIR",
        dirs::cache_dir,
        "OpenH3",
        "aionui",
    )
}

/// Resolve the work (data) directory for OpenH3.
///
/// Priority: `OPENH3_WORK_DIR` env → legacy `AIONUI_WORK_DIR` env →
/// an existing legacy directory → the canonical OpenH3 directory.
fn resolve_work_dir() -> String {
    resolve_env_dir("OPENH3_WORK_DIR", "AIONUI_WORK_DIR", dirs::data_dir, "OpenH3", "aionui")
}

/// Resolve the log directory for OpenH3.
///
/// Priority: `OPENH3_LOG_DIR` env → legacy `AIONUI_LOG_DIR` env → an existing
/// legacy directory → the canonical OpenH3 directory.
fn resolve_log_dir() -> String {
    if let Some(value) = env_override("OPENH3_LOG_DIR", "AIONUI_LOG_DIR") {
        return value;
    }
    // macOS: ~/Library/Logs is the conventional log location
    if cfg!(target_os = "macos")
        && let Some(home) = dirs::home_dir()
    {
        let canonical = home.join("Library/Logs/OpenH3");
        let legacy = home.join("Library/Logs/aionui");
        return existing_or_canonical(canonical, legacy);
    }
    // Linux: XDG state dir
    if let Some(state) = dirs::state_dir() {
        return existing_or_canonical(state.join("OpenH3/logs"), state.join("aionui/logs"));
    }
    // Fallback: data_dir/OpenH3/logs
    dirs::data_dir()
        .map(|p| existing_or_canonical(p.join("OpenH3/logs"), p.join("aionui/logs")))
        .unwrap_or_default()
}

fn env_override(canonical: &str, legacy: &str) -> Option<String> {
    [canonical, legacy]
        .into_iter()
        .find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty()))
}

fn existing_or_canonical(canonical: std::path::PathBuf, legacy: std::path::PathBuf) -> String {
    if legacy.exists() && !canonical.exists() {
        legacy.to_string_lossy().into_owned()
    } else {
        canonical.to_string_lossy().into_owned()
    }
}

fn resolve_env_dir(
    canonical_env: &str,
    legacy_env: &str,
    base: fn() -> Option<std::path::PathBuf>,
    canonical_name: &str,
    legacy_name: &str,
) -> String {
    if let Some(value) = env_override(canonical_env, legacy_env) {
        return value;
    }
    base()
        .map(|root| existing_or_canonical(root.join(canonical_name), root.join(legacy_name)))
        .unwrap_or_default()
}

/// Build the system info response from the current runtime environment.
pub fn get_system_info() -> SystemInfoResponse {
    SystemInfoResponse {
        cache_dir: resolve_cache_dir(),
        work_dir: resolve_work_dir(),
        log_dir: resolve_log_dir(),
        platform: map_platform().to_owned(),
        arch: map_arch().to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_platform_known() {
        let p = map_platform();
        // On CI this will be one of the known values
        assert!(["darwin", "win32", "linux"].contains(&p), "unexpected platform: {p}");
    }

    #[test]
    fn test_map_arch_known() {
        let a = map_arch();
        assert!(["x64", "arm64"].contains(&a), "unexpected arch: {a}");
    }

    #[test]
    fn test_get_system_info_fields_non_empty() {
        let info = get_system_info();
        assert!(!info.cache_dir.is_empty(), "cache_dir should not be empty");
        assert!(!info.work_dir.is_empty(), "work_dir should not be empty");
        assert!(!info.log_dir.is_empty(), "log_dir should not be empty");
        assert!(!info.platform.is_empty());
        assert!(!info.arch.is_empty());
    }

    #[test]
    fn test_env_override_cache_dir() {
        // This test verifies the resolve logic returns a branded path. Existing
        // installations may intentionally keep the legacy directory.
        let dir = resolve_cache_dir();
        assert!(
            dir.contains("OpenH3") || dir.contains("aionui"),
            "unexpected cache_dir: {dir}"
        );
    }

    #[test]
    fn test_env_override_work_dir() {
        let dir = resolve_work_dir();
        assert!(
            dir.contains("OpenH3") || dir.contains("aionui"),
            "unexpected work_dir: {dir}"
        );
    }

    #[test]
    fn test_env_override_log_dir() {
        let dir = resolve_log_dir();
        assert!(
            dir.to_ascii_lowercase().contains("openh3") || dir.to_ascii_lowercase().contains("aionui"),
            "log_dir should contain an OpenH3 or legacy directory: {dir}"
        );
    }
}
