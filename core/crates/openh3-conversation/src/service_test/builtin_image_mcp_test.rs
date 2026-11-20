use openh3_api_types::{SessionMcpServer, SessionMcpTransport};
use openh3_db::{CreateMcpServerParams, IMcpServerRepository, SqliteMcpServerRepository, UpdateMcpServerParams};

use super::*;

const USER: &str = "system_default_user";
const IMAGE_MCP_NAME: &str = "openh3-image-generation";
const LEGACY_NAME: &str = "aionui-image-generation";
#[cfg(windows)]
const LEGACY_SCRIPT: &str = r"D:\AionUi\resources\app.asar.unpacked\out\main\builtin-mcp-image-gen.js";
#[cfg(windows)]
const CURRENT_SCRIPT: &str = r"C:\Program Files\OpenH3\resources\app.asar.unpacked\out\main\builtin-mcp-image-gen.js";
#[cfg(not(windows))]
const LEGACY_SCRIPT: &str = "/opt/AionUi/resources/app.asar.unpacked/out/main/builtin-mcp-image-gen.js";
#[cfg(not(windows))]
const CURRENT_SCRIPT: &str = "/opt/OpenH3/resources/app.asar.unpacked/out/main/builtin-mcp-image-gen.js";

async fn make_repo() -> Arc<dyn IMcpServerRepository> {
    let database = init_database_memory().await.unwrap();
    Arc::new(SqliteMcpServerRepository::new(database.pool().clone()))
}

async fn create_image_server(repo: &dyn IMcpServerRepository, name: &str, builtin: bool, command: &str) -> String {
    let transport = json!({
        "command": command,
        "args": [CURRENT_SCRIPT],
        "env": { "OPENH3_IMG_MODEL": "current-global-model" },
    });
    repo.create(CreateMcpServerParams {
        user_id: USER,
        name,
        description: None,
        enabled: false,
        transport_type: "stdio",
        transport_config: &transport.to_string(),
        tools: None,
        original_json: None,
        builtin,
    })
    .await
    .unwrap()
    .id
}

fn frozen_stdio(id: &str, name: &str, script: &str, env: serde_json::Value) -> SessionMcpServer {
    serde_json::from_value(json!({
        "id": id,
        "name": name,
        "transport": { "type": "stdio", "command": "node", "args": [script], "env": env },
    }))
    .unwrap()
}

fn frozen_conversation(user_id: &str, workspace: &Path, servers: &[SessionMcpServer]) -> ConversationRow {
    ConversationRow {
        id: "existing-image-conversation".to_owned(),
        user_id: user_id.to_owned(),
        name: "existing image conversation".to_owned(),
        r#type: "aionrs".to_owned(),
        extra: json!({ "workspace": workspace, "session_mcp_servers": servers }).to_string(),
        model: None,
        status: Some("finished".to_owned()),
        source: Some("aionui".to_owned()),
        channel_chat_id: None,
        pinned: false,
        pinned_at: None,
        created_at: 1,
        updated_at: 1,
        project_id: None,
        folder_id: None,
        name_source: None,
    }
}

fn image_tools(options: BuildTaskOptions) -> Vec<SessionMcpServer> {
    match options.context.kind {
        AgentSessionKind::Aionrs(ctx) => ctx.config.session_mcp_servers,
        _ => panic!("expected Aionrs build options"),
    }
}

#[tokio::test]
async fn frozen_image_mcp_uses_current_entrypoint_on_rebuild_and_preserves_selection_env() {
    let (service, _, conversations, _) = make_service();
    let repo = make_repo().await;
    let id = create_image_server(repo.as_ref(), IMAGE_MCP_NAME, true, "node").await;
    service.with_mcp_server_repo(repo.clone());
    let workspace = tempfile::tempdir().unwrap();

    for (name, env) in [
        (LEGACY_NAME, json!({})),
        (
            IMAGE_MCP_NAME,
            json!({
                "OPENH3_CREATION_REQUEST_ID": "explicit-request",
                "OPENH3_CREATION_SOURCE": "local",
                "OPENH3_IMG_MODEL": "session-model",
                "CUSTOM_SETTING": "session-value",
            }),
        ),
    ] {
        let snapshot = frozen_stdio(&id, name, LEGACY_SCRIPT, env.clone());
        let expected = frozen_stdio(&id, IMAGE_MCP_NAME, CURRENT_SCRIPT, env);
        let mut row = frozen_conversation(USER, workspace.path(), &[snapshot]);
        row.id = format!("existing-conversation-{name}");
        conversations.create(&row).await.unwrap();

        let build = service.build_task_options(&row).await.unwrap();
        let runtime = service.build_task_options_for_runtime(&row, None).await.unwrap();
        assert_eq!(image_tools(build), vec![expected.clone()]);
        assert_eq!(image_tools(runtime), vec![expected]);
        assert_eq!(
            conversations.get(USER, &row.id).await.unwrap().unwrap().extra,
            row.extra,
            "the historical MCP selection stays frozen"
        );
        let global = repo.find_by_id(USER, &id).await.unwrap().unwrap();
        assert!(!global.enabled, "a frozen selection does not alter global enablement");
    }
}

#[tokio::test]
async fn frozen_image_mcp_repairs_only_owned_matching_builtin_stdio_snapshots() {
    let (service, _, _, _) = make_service();
    let repo = make_repo().await;
    let id = create_image_server(repo.as_ref(), IMAGE_MCP_NAME, true, "node").await;
    let custom = create_image_server(repo.as_ref(), LEGACY_NAME, false, "node").await;
    service.with_mcp_server_repo(repo.clone());
    let workspace = tempfile::tempdir().unwrap();
    let other_user_server = frozen_stdio(&id, LEGACY_NAME, LEGACY_SCRIPT, json!({}));
    let other_user = frozen_conversation("other-user", workspace.path(), &[other_user_server.clone()]);
    assert_eq!(
        image_tools(service.build_task_options(&other_user).await.unwrap()),
        vec![other_user_server]
    );

    let unchanged = vec![
        frozen_stdio(&custom, LEGACY_NAME, LEGACY_SCRIPT, json!({})),
        frozen_stdio("unregistered", LEGACY_NAME, LEGACY_SCRIPT, json!({})),
        frozen_stdio(&id, "custom-bridge", LEGACY_SCRIPT, json!({})),
        frozen_stdio(&id, LEGACY_NAME, "/custom/other-tool.js", json!({})),
        frozen_stdio(&id, LEGACY_NAME, "builtin-mcp-image-gen.js", json!({})),
        frozen_stdio(
            &id,
            LEGACY_NAME,
            "relative/out/main/builtin-mcp-image-gen.js",
            json!({}),
        ),
        SessionMcpServer {
            id: id.clone(),
            name: LEGACY_NAME.to_owned(),
            transport: SessionMcpTransport::Http {
                url: "http://localhost:4000/mcp".to_owned(),
                headers: Default::default(),
            },
        },
    ];
    let own = frozen_conversation(USER, workspace.path(), &unchanged);
    assert_eq!(image_tools(service.build_task_options(&own).await.unwrap()), unchanged);

    let unauthorized_entrypoint = json!({ "command": "/other/node", "args": [CURRENT_SCRIPT] }).to_string();
    repo.update(
        USER,
        &id,
        UpdateMcpServerParams {
            transport_config: Some(&unauthorized_entrypoint),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let snapshot = frozen_stdio(&id, LEGACY_NAME, LEGACY_SCRIPT, json!({}));
    let row = frozen_conversation(USER, workspace.path(), std::slice::from_ref(&snapshot));
    assert_eq!(
        image_tools(service.build_task_options(&row).await.unwrap()),
        vec![snapshot]
    );
}

#[tokio::test]
async fn frozen_image_mcp_keeps_a_custom_snapshot_with_the_canonical_name() {
    let (service, _, _, _) = make_service();
    let repo = make_repo().await;
    let id = create_image_server(repo.as_ref(), IMAGE_MCP_NAME, true, "node").await;
    service.with_mcp_server_repo(repo);
    let workspace = tempfile::tempdir().unwrap();
    let custom = frozen_stdio("custom-image-tool", IMAGE_MCP_NAME, "/custom/entrypoint.js", json!({}));
    let legacy = frozen_stdio(&id, LEGACY_NAME, LEGACY_SCRIPT, json!({}));
    let row = frozen_conversation(USER, workspace.path(), &[custom.clone(), legacy]);
    assert_eq!(
        image_tools(service.build_task_options(&row).await.unwrap()),
        vec![custom, frozen_stdio(&id, LEGACY_NAME, CURRENT_SCRIPT, json!({}))]
    );
}
