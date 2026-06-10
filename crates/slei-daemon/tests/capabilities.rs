use slei_daemon::auth::AuthToken;
use slei_daemon::services::capability_service::{
    CapabilityApiPolicy, CapabilityRecord, CapabilityService, CapabilitySource,
};
use slei_daemon::state::AppState;
use uuid::Uuid;

#[tokio::test]
async fn capabilities_are_read_only_and_scan_failures_are_non_blocking() {
    let service = CapabilityService::for_tests(vec![
        CapabilityRecord {
            agent_id: "agent_coda".to_string(),
            name: "youdao-lobster-pr".to_string(),
            source: CapabilitySource::WorkspaceClaude,
            description: "PR 提交流程".to_string(),
            available: true,
            error: None,
        },
        CapabilityRecord {
            agent_id: "agent_coda".to_string(),
            name: "global-commit".to_string(),
            source: CapabilitySource::GlobalClaude,
            description: "commit command".to_string(),
            available: true,
            error: None,
        },
    ]);

    service
        .record_scan_error("agent_coda", "workspace scan timed out")
        .await;

    let capabilities = service.list_for_agent("agent_coda").await;
    assert!(capabilities.iter().any(|capability| {
        capability.name == "youdao-lobster-pr"
            && capability.source == CapabilitySource::WorkspaceClaude
            && capability.available
    }));
    assert!(capabilities.iter().any(|capability| {
        !capability.available
            && capability
                .error
                .as_deref()
                .is_some_and(|error| error.contains("timed out"))
    }));

    let policy = CapabilityApiPolicy::read_only();
    assert_eq!(policy.supported_actions(), vec!["list"]);
    assert!(!policy.supported_actions().contains(&"install"));
    assert!(!policy.supported_actions().contains(&"mutate-permissions"));
}

#[tokio::test]
async fn node_name_survives_app_state_reload_without_json_sidecar() {
    let root = temp_data_root();
    let token = AuthToken::from_static("node-reload-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;

    let renamed = state
        .nodes()
        .rename_local_node("Studio Node")
        .await
        .expect("node rename saves");
    assert_eq!(renamed.name, "Studio Node");

    let reloaded = AppState::for_tests_with_agent_root_async(token, root.clone()).await;
    let restored = reloaded
        .nodes()
        .get_node("local-node")
        .expect("local node reloads");

    assert_eq!(restored.name, "Studio Node");
    assert!(!root.join("nodes/index.json").exists());
}

fn temp_data_root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("slei-capabilities-{}", Uuid::new_v4()))
}
