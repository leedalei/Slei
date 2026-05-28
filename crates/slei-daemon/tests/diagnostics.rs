use slei_daemon::services::diagnostics_service::{
    DiagnosticEvent, DiagnosticsInput, DiagnosticsService,
};

#[tokio::test]
async fn diagnostics_expose_status_and_sanitize_failure_summaries_and_logs() {
    let service = DiagnosticsService::for_tests();
    let snapshot = service
        .snapshot(DiagnosticsInput {
            node_name: "MacBookPro M4 MAX".to_string(),
            runtime: "Claude Code".to_string(),
            worker: "claude-agent".to_string(),
            protocol_version: "v1".to_string(),
            schema_version: "2026-05-27".to_string(),
            recent_failure: Some(
                "Bearer secret-token failed in /Users/leelei/Documents/Slei/work with body={\"prompt\":\"secret\"}"
                    .to_string(),
            ),
        })
        .await;

    assert_eq!(snapshot.node, "MacBookPro M4 MAX");
    assert_eq!(snapshot.runtime, "Claude Code");
    assert_eq!(snapshot.worker, "claude-agent");
    assert_eq!(snapshot.protocol_version, "v1");
    assert_eq!(snapshot.schema_version, "2026-05-27");
    let serialized = serde_json::to_string(&snapshot).unwrap();
    assert!(!serialized.contains("secret-token"));
    assert!(!serialized.contains("/Users/leelei"));
    assert!(!serialized.contains("\"prompt\""));
    assert!(serialized.contains("[redacted-token]"));

    let export = service
        .export_logs(vec![
            DiagnosticEvent {
                sequence: 1,
                event_type: "runtime.delta".to_string(),
                payload: "output_delta=private answer".to_string(),
            },
            DiagnosticEvent {
                sequence: 2,
                event_type: "api.request".to_string(),
                payload: "request body={\"message\":\"secret\"} token=abc".to_string(),
            },
        ])
        .await;
    assert!(export.contains("runtime.delta"));
    assert!(export.contains("[redacted-output]"));
    assert!(export.contains("[redacted-body]"));
    assert!(export.contains("[redacted-token]"));
    assert!(!export.contains("private answer"));
    assert!(!export.contains("\"message\""));
    assert!(!export.contains("abc"));
}
