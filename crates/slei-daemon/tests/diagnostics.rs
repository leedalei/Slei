use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::channel_service::ChannelMemberReadiness;
use slei_daemon::services::diagnostics_service::{
    DiagnosticEvent, DiagnosticsInput, DiagnosticsService,
};
use slei_daemon::state::AppState;
use tower::ServiceExt;
use uuid::Uuid;

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
            agent_inbox_event_count: 5,
            memory_update_event_count: 8,
            recent_events: vec![DiagnosticEvent {
                sequence: 7,
                event_type: "channel_message.received".to_string(),
                entity_id: "route-1".to_string(),
                payload: "body={\"prompt\":\"secret\"}".to_string(),
                created_at: "2026-06-04 00:00:00".to_string(),
            }],
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
    assert!(serialized.contains("\"agentInboxEventCount\":5"));
    assert!(serialized.contains("\"memoryUpdateEventCount\":8"));
    assert!(serialized.contains("\"recentEvents\""));

    let export = service
        .export_logs(vec![
            DiagnosticEvent {
                sequence: 1,
                event_type: "runtime.delta".to_string(),
                entity_id: "event-1".to_string(),
                payload: "output_delta=private answer".to_string(),
                created_at: "2026-06-04 00:00:00".to_string(),
            },
            DiagnosticEvent {
                sequence: 2,
                event_type: "api.request".to_string(),
                entity_id: "event-2".to_string(),
                payload: "request body={\"message\":\"secret\"} token=abc".to_string(),
                created_at: "2026-06-04 00:00:01".to_string(),
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

#[tokio::test]
async fn diagnostics_endpoint_reports_orchestration_aggregate_counts() {
    let token = AuthToken::from_static("test-token");
    let data_root = std::env::temp_dir().join(format!("slei-diagnostics-{}", Uuid::new_v4()));
    let state = AppState::for_tests_with_agent_root(token.clone(), data_root);
    state
        .agent_inbox()
        .create_human_mention(
            "agent_alice",
            "dev",
            "message-1",
            ChannelMemberReadiness::Ready,
        )
        .await;
    state
        .memory_events()
        .complete_update("agent_alice", "dev")
        .await;

    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/diagnostics")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert!(json.get("coordinatorDecisionCount").is_none());
    assert_eq!(json["agentInboxEventCount"], 1);
    assert_eq!(json["memoryUpdateEventCount"], 1);
    assert!(json.get("agentInboxEvents").is_none());
    assert!(json.get("memoryUpdateEvents").is_none());
}
