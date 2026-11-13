use openh3_api_types::*;
use serde::Deserialize;

// Account reads contain only the allowlisted billing fields. Unknown upstream
// fields (including credentials) fail closed before a public value is returned.
#[derive(Deserialize)]
#[serde(transparent)]
pub(crate) struct Wallet(pub CloudAccountWalletResponse);
#[derive(Deserialize)]
#[serde(transparent)]
pub(crate) struct Usage(pub CloudAccountUsageResponse);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Catalog {
    pub status: String,
    pub reason: Option<String>,
    pub quote_semantics: String,
    pub models: Vec<CatalogModel>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CatalogModel {
    pub model_id: String,
    pub display_name: String,
    pub provider: String,
    pub purpose: String,
    pub protocol: String,
    pub input_capabilities: Vec<String>,
    pub supports_tools: bool,
    pub context_limit: i64,
    pub max_output_tokens: u64,
    pub compatibility_version: String,
    pub evidence: String,
    pub quotes: Vec<CloudAccountPriceQuote>,
}
impl From<CatalogModel> for CloudAccountModel {
    fn from(m: CatalogModel) -> Self {
        Self {
            model_id: m.model_id,
            display_name: m.display_name,
            provider: m.provider,
            purpose: m.purpose,
            protocol: m.protocol,
            input_capabilities: m.input_capabilities,
            supports_tools: m.supports_tools,
            context_limit: m.context_limit,
            max_output_tokens: m.max_output_tokens,
            compatibility_version: m.compatibility_version,
            evidence: m.evidence,
            quotes: m.quotes,
            selection_unavailable_reason: None,
        }
    }
}
