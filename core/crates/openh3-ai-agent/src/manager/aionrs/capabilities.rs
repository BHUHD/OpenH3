use aion_protocol::events::ToolCategory;
use aion_providers::{LlmProvider, ProviderError};
use aion_tools::Tool;
use aion_types::llm::{LlmEvent, LlmRequest};
use aion_types::tool::{JsonSchema, ToolDef, ToolResult};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::{Arc, RwLock};

/// Exact tools exposed by the engine to the model on its latest request.
pub(super) type CapabilitySnapshot = Arc<RwLock<Vec<ToolDef>>>;
pub(super) struct SessionCapabilities(pub CapabilitySnapshot);

/// Observe the engine's final tool selection instead of duplicating its model,
/// plan-mode and tool-policy filters at the registry boundary.
pub(super) struct CapabilityProvider {
    pub inner: Arc<dyn LlmProvider>,
    pub snapshot: CapabilitySnapshot,
}

#[async_trait]
impl LlmProvider for CapabilityProvider {
    async fn stream(&self, request: &LlmRequest) -> Result<tokio::sync::mpsc::Receiver<LlmEvent>, ProviderError> {
        if let Ok(mut tools) = self.snapshot.write() {
            *tools = request.tools.clone();
        }
        self.inner.stream(request).await
    }
}

#[async_trait]
impl Tool for SessionCapabilities {
    fn name(&self) -> &str {
        "openh3_session_capabilities"
    }
    fn description(&self) -> &str {
        "Inspect tools and exact schemas available to the current model on this request, after model capability and session policy filtering. Use a keyword such as ViewImage, web, source, ExecCommand, Read or Edit. Availability does not grant permission or prove network reachability. If ViewImage is absent, do not claim to see image contents or ask to restore an unexposed tool; report image viewing as unavailable on this request and check model capability settings or tool policy to identify the cause. Never fabricate tool names or bypass a denied permission."
    }
    fn input_schema(&self) -> JsonSchema {
        json!({"type":"object","properties":{"query":{"type":"string"}},"additionalProperties":false})
    }
    fn is_concurrency_safe(&self, _input: &Value) -> bool {
        true
    }
    fn category(&self) -> ToolCategory {
        ToolCategory::Info
    }
    async fn execute(&self, input: Value) -> ToolResult {
        let query = input["query"].as_str().unwrap_or("").to_lowercase();
        let Ok(definitions) = self.0.read() else {
            return ToolResult {
                content: "SESSION_CAPABILITIES_UNAVAILABLE".into(),
                is_error: true,
            };
        };
        let matches: Vec<Value> = definitions.iter()
            .filter(|tool| query.is_empty() || tool.name.to_lowercase().contains(&query) || tool.description.to_lowercase().contains(&query))
            .take(80)
            .map(|tool| if query.is_empty() { json!({"name":tool.name,"deferred":tool.deferred}) }
                else { json!({"name":tool.name,"description":tool.description,"parameters":tool.input_schema,"deferred":tool.deferred}) })
            .collect();
        ToolResult { content: json!({"scope":"current-model-request", "tools":matches,"availableCount":definitions.len(),"permissionPolicy":"current runtime approvals apply; this tool grants nothing","networkHealth":"not probed","snapshot":"observed on latest model request"}).to_string(), is_error:false }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn reports_observed_tools_and_updated_snapshot_without_inventing_search() {
        let snapshot = Arc::new(RwLock::new(vec![ToolDef {
            name: "ExecCommand".into(),
            description: "shell".into(),
            input_schema: json!({"required":["cmd"]}),
            deferred: false,
        }]));
        let tool = SessionCapabilities(snapshot.clone());
        let result: Value = serde_json::from_str(&tool.execute(json!({"query":"ExecCommand"})).await.content).unwrap();
        assert_eq!(result["tools"][0]["parameters"]["required"][0], "cmd");
        let result: Value = serde_json::from_str(&tool.execute(json!({"query":"web"})).await.content).unwrap();
        assert_eq!(result["tools"], json!([]));
        snapshot.write().unwrap().clear();
        let result: Value = serde_json::from_str(&tool.execute(json!({})).await.content).unwrap();
        assert_eq!(result["availableCount"], 0);
    }
}
