use slei_daemon::services::node_service::{GuideBootstrap, NodeService, RuntimeReadinessDto};

#[test]
fn guide_bootstrap_does_not_create_entities_until_claude_runtime_is_ready() {
    let mut service = NodeService::for_tests();
    service.set_runtimes_for_tests(vec![RuntimeReadinessDto {
        kind: "ClaudeCode".to_string(),
        readiness: "unknown".to_string(),
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
    }]);

    let first = service.bootstrap_guide_agent();
    let second = service.bootstrap_guide_agent();

    assert!(matches!(first, GuideBootstrap::Created { .. }));
    assert!(matches!(second, GuideBootstrap::AlreadyExists { .. }));
    assert_eq!(service.guide_agent_count(), 1);
    assert_eq!(service.default_channel_count(), 1);
}
