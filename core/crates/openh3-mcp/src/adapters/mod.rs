mod aionrs;
mod claude;
mod cli_helpers;
mod codebuddy;
mod codex;
mod gemini;
mod opencode;
mod openh3;
mod qwen;

pub use aionrs::AionrsAdapter;
pub use claude::ClaudeAdapter;
pub use codebuddy::CodeBuddyAdapter;
pub use codex::CodexAdapter;
pub use gemini::GeminiAdapter;
pub use opencode::OpencodeAdapter;
pub use openh3::Openh3Adapter;
/// Canonical OpenH3 name for the host application's DB-backed MCP adapter.
/// `AionuiAdapter` remains exported for source compatibility with older
/// integrations.
pub use openh3::Openh3Adapter as AionuiAdapter;
pub use qwen::QwenAdapter;
