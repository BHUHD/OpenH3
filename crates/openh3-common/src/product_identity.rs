//! Product-owned aliases. Persisted identifiers remain valid across upgrades.

pub const BUTLER_ASSISTANT_ID: &str = "openh3-assistant";
pub const LEGACY_BUTLER_ASSISTANT_ID: &str = "aionui-assistant";

/// An alternate lookup key, never a rewrite of a user's persisted identifier.
pub fn butler_assistant_alias(id: &str) -> Option<&'static str> {
    match id {
        BUTLER_ASSISTANT_ID => Some(LEGACY_BUTLER_ASSISTANT_ID),
        LEGACY_BUTLER_ASSISTANT_ID => Some(BUTLER_ASSISTANT_ID),
        _ => None,
    }
}
