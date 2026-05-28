use slei_daemon::services::capability_service::{
    CapabilityApiPolicy, CapabilityRecord, CapabilityService, CapabilitySource,
};

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
