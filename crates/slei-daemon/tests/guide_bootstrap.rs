use std::fs;

use serde_json::json;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::channel_service::{ChannelDraft, PermissionPreset};
use slei_daemon::services::member_service::{ProductAgentDraft, ProductAgentUpdate};
use slei_daemon::services::node_service::{GuideBootstrap, NodeService, RuntimeReadinessDto};
use slei_daemon::state::AppState;
use uuid::Uuid;

#[test]
fn guide_bootstrap_does_not_create_entities_until_claude_runtime_is_ready() {
    let mut service = NodeService::for_tests();
    service.set_runtimes_for_tests(vec![RuntimeReadinessDto {
        kind: "ClaudeCode".to_string(),
        readiness: "unknown".to_string(),
        version: None,
    }]);

    let result = service.bootstrap_guide_agent();

    assert!(matches!(result, GuideBootstrap::RuntimeUnavailable));
    assert_eq!(service.guide_agent_count(), 0);
    assert_eq!(service.default_channel_count(), 0);
}

#[test]
fn guide_bootstrap_creates_one_guide_agent_and_default_channel_idempotently() {
    let mut service = NodeService::for_tests();
    service.set_runtimes_for_tests(vec![RuntimeReadinessDto {
        kind: "ClaudeCode".to_string(),
        readiness: "ready".to_string(),
        version: Some("1.2.3".to_string()),
    }]);

    let first = service.bootstrap_guide_agent();
    let second = service.bootstrap_guide_agent();

    assert!(matches!(first, GuideBootstrap::Created { .. }));
    assert!(matches!(second, GuideBootstrap::AlreadyExists { .. }));
    assert_eq!(service.guide_agent_count(), 1);
    assert_eq!(service.default_channel_count(), 1);
}

#[tokio::test]
async fn product_agents_survive_app_state_reload_without_legacy_json_index() {
    let root = temp_data_root();
    let token = AuthToken::from_static("guide-bootstrap-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;

    let created = state
        .members()
        .create_product_agent(
            ProductAgentDraft {
                name: "Coda".to_string(),
                handle: "@coda".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "负责实现任务".to_string(),
                avatar_seed: None,
            },
            "create-coda",
        )
        .await
        .expect("agent is created");
    assert_eq!(created.channel_ids, vec!["all".to_string()]);

    let reloaded = AppState::for_tests_with_agent_root_async(token, root.clone()).await;
    let restored = reloaded
        .members()
        .get_product_agent(&created.id)
        .await
        .expect("agent reloads from persistent storage");

    assert_eq!(restored.handle, "@coda");
    assert_eq!(restored.name, "Coda");
    assert_eq!(restored.channel_ids, created.channel_ids);
    assert!(!root.join("agents/index.json").exists());
}

#[tokio::test]
async fn legacy_agent_index_import_does_not_overwrite_existing_sqlite_agents() {
    let root = temp_data_root();
    let workspace = root.join("agents/agent_legacy");
    fs::create_dir_all(workspace.join("docs")).unwrap();
    fs::write(
        workspace.join("MEMORY.md"),
        "# Legacy\n\n## Role\nLegacy agent",
    )
    .unwrap();
    let legacy_agent = json!([{
        "id": "agent_legacy",
        "name": "Legacy",
        "handle": "@legacy",
        "agentKind": "agent",
        "systemOwned": false,
        "runtimeKind": "ClaudeCode",
        "model": "Sonnet",
        "nodeId": "local-node",
        "description": "stale legacy description",
        "workspacePath": workspace.to_string_lossy(),
        "memoryPath": workspace.join("MEMORY.md").to_string_lossy(),
        "docsPath": workspace.join("docs").to_string_lossy(),
        "avatarSeed": "agent_legacy",
        "runtimeThread": { "runtimeKind": "ClaudeCode", "status": "ready", "createdAt": "1" },
        "channelIds": ["all"],
        "createdAt": "1",
        "updatedAt": "1"
    }]);
    fs::write(
        root.join("agents/index.json"),
        serde_json::to_string_pretty(&legacy_agent).unwrap(),
    )
    .unwrap();

    let token = AuthToken::from_static("legacy-import-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;
    let imported = state
        .members()
        .get_product_agent("agent_legacy")
        .await
        .expect("legacy agent imports once");
    assert_eq!(imported.description, "stale legacy description");

    state
        .members()
        .update_product_agent(
            "agent_legacy",
            ProductAgentUpdate {
                name: Some("Fresh SQLite Name".to_string()),
                description: Some("fresh sqlite description".to_string()),
                runtime_kind: None,
                model: None,
                node_id: None,
            },
        )
        .await
        .expect("agent updates in sqlite");

    let reloaded = AppState::for_tests_with_agent_root_async(token, root.clone()).await;
    let restored = reloaded
        .members()
        .get_product_agent("agent_legacy")
        .await
        .expect("agent reloads from sqlite");

    assert_eq!(restored.name, "Fresh SQLite Name");
    assert_eq!(restored.description, "fresh sqlite description");
    assert!(root.join("agents/index.json").exists());
}

#[tokio::test]
async fn legacy_agent_index_import_does_not_overwrite_existing_channel_metadata() {
    let root = temp_data_root();
    let token = AuthToken::from_static("legacy-channel-import-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;
    let channel = state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "legacy-team".to_string(),
                description: Some("keep this description".to_string()),
                permission: PermissionPreset::ReadOnly,
            },
            "create-legacy-team",
        )
        .await
        .expect("preexisting channel saves");
    assert_eq!(channel.id, "legacy-team");

    let workspace = root.join("agents/agent_legacy");
    fs::create_dir_all(workspace.join("docs")).unwrap();
    fs::write(
        workspace.join("MEMORY.md"),
        "# Legacy\n\n## Role\nLegacy agent",
    )
    .unwrap();
    let legacy_agent = json!([{
        "id": "agent_legacy",
        "name": "Legacy",
        "handle": "@legacy",
        "agentKind": "agent",
        "systemOwned": false,
        "runtimeKind": "ClaudeCode",
        "model": "Sonnet",
        "nodeId": "local-node",
        "description": "legacy agent",
        "workspacePath": workspace.to_string_lossy(),
        "memoryPath": workspace.join("MEMORY.md").to_string_lossy(),
        "docsPath": workspace.join("docs").to_string_lossy(),
        "avatarSeed": "agent_legacy",
        "runtimeThread": { "runtimeKind": "ClaudeCode", "status": "ready", "createdAt": "1" },
        "channelIds": ["legacy-team"],
        "createdAt": "1",
        "updatedAt": "1"
    }]);
    fs::write(
        root.join("agents/index.json"),
        serde_json::to_string_pretty(&legacy_agent).unwrap(),
    )
    .unwrap();

    let reloaded = AppState::for_tests_with_agent_root_async(token, root).await;
    let restored_channel = reloaded
        .channels()
        .list_channels()
        .await
        .into_iter()
        .find(|channel| channel.id == "legacy-team")
        .expect("preexisting channel remains");
    let members = reloaded
        .channels()
        .channel_members("legacy-team")
        .await
        .expect("legacy membership imports");
    let imported_agent = reloaded
        .members()
        .get_product_agent("agent_legacy")
        .await
        .expect("legacy agent imports");

    assert_eq!(
        restored_channel.description.as_deref(),
        Some("keep this description")
    );
    assert_eq!(restored_channel.permission, PermissionPreset::ReadOnly);
    assert!(members
        .iter()
        .any(|member| member.agent_id == "agent_legacy"));
    assert_eq!(imported_agent.channel_ids, vec!["legacy-team".to_string()]);
}

fn temp_data_root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("slei-guide-bootstrap-{}", Uuid::new_v4()))
}
