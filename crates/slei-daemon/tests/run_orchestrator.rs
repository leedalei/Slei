use slei_daemon::services::run_orchestrator::RunOrchestrator;

#[tokio::test]
async fn run_orchestrator_redacts_secret_split_across_output_deltas_before_fanout() {
    let orchestrator = RunOrchestrator::for_tests(vec!["SECRET".to_string()]);

    orchestrator
        .emit_output_delta("run_1", "The token is SEC")
        .await
        .unwrap();
    orchestrator
        .emit_output_delta("run_1", "RET and must be hidden")
        .await
        .unwrap();

    let events = orchestrator.events().replay(0).await;
    let serialized = serde_json::to_string(&events).unwrap();

    assert!(!serialized.contains("SECRET"));
    assert!(serialized.contains("[REDACTED]"));
}

#[tokio::test]
async fn run_orchestrator_cancel_produces_exactly_one_terminal_cancelled_event() {
    let orchestrator = RunOrchestrator::for_tests(Vec::new());

    orchestrator.cancel_run("run_1").await.unwrap();
    orchestrator.cancel_run("run_1").await.unwrap();
    orchestrator.complete_run("run_1").await.unwrap();

    let events = orchestrator.events().replay(0).await;
    let cancelled = events
        .iter()
        .filter(|event| event.event_type == "run.cancelled")
        .count();
    let completed = events
        .iter()
        .filter(|event| event.event_type == "run.completed")
        .count();

    assert_eq!(cancelled, 1);
    assert_eq!(completed, 0);
}
