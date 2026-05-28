use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;
use tower::ServiceExt;

#[tokio::test]
async fn nodes_report_runtime_readiness_placeholders() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/nodes")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let node = &json["nodes"][0];

    assert_eq!(node["status"], "connected");
    assert_eq!(node["runtimes"][0]["kind"], "ClaudeCode");
    assert_eq!(node["runtimes"][0]["readiness"], "unknown");
}

#[tokio::test]
async fn event_replay_requires_auth_and_filters_by_sequence_and_cutoff() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state
        .events()
        .append_for_tests("old.event", json!({"value": "too-old"}), 25)
        .await;
    let first = state
        .events()
        .append_for_tests("workspace.created", json!({"workspace_id": "ws_1"}), 0)
        .await;
    state
        .events()
        .append_for_tests("workspace.created", json!({"workspace_id": "ws_2"}), 0)
        .await;

    let app = build_router(state);
    let rejected = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/events/ws?after=0")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

    let replayed = app
        .oneshot(
            Request::builder()
                .uri(format!("/v1/events/ws?after={}", first.sequence - 1))
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(replayed.status(), StatusCode::OK);
    let body = to_bytes(replayed.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let events = json["events"].as_array().unwrap();

    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["sequence"], first.sequence);
    assert_eq!(events[0]["type"], "workspace.created");
    assert_eq!(events[1]["payload"]["workspace_id"], "ws_2");
}
