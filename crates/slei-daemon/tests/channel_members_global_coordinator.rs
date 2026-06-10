use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::coordinator_service::{
    parse_and_validate_coordinator_json, CoordinatorPromptMember,
};
use slei_daemon::state::AppState;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn global_coordinator_channel_create_does_not_join_per_channel_coordinator() {
    let token = AuthToken::from_static("test-token");
    let root = std::env::temp_dir().join(format!("slei-global-coordinator-{}", Uuid::new_v4()));
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let app = build_router(state.clone());

    let response = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-dev"),
        json!({
            "name": "dev",
            "description": null,
            "agentIds": []
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);

    tokio::task::yield_now().await;

    assert!(state
        .members()
        .get_product_agent("agent_global_coordinator")
        .await
        .is_ok());
    assert!(state
        .members()
        .get_product_agent("agent_coordinator_dev")
        .await
        .is_err());
    let members = state.channels().channel_members("dev").await.unwrap();
    assert!(members
        .iter()
        .all(|member| member.agent_id != "agent_coordinator_dev"));
    assert!(members
        .iter()
        .all(|member| member.agent_id != "agent_global_coordinator"));
}

#[tokio::test]
async fn global_coordinator_validation_rejects_global_and_legacy_coordinator_targets() {
    let ordinary = CoordinatorPromptMember {
        agent_id: "agent_coda".to_string(),
        name: "Coda".to_string(),
        handle: "@coda".to_string(),
        agent_kind: "product".to_string(),
        readiness: "ready".to_string(),
    };
    let global = CoordinatorPromptMember {
        agent_id: "agent_global_coordinator".to_string(),
        name: "Global Coordinator".to_string(),
        handle: "@global-coordinator".to_string(),
        agent_kind: "coordinator".to_string(),
        readiness: "ready".to_string(),
    };
    let legacy = CoordinatorPromptMember {
        agent_id: "agent_coordinator_dev".to_string(),
        name: "#dev Coordinator".to_string(),
        handle: "@dev-coordinator".to_string(),
        agent_kind: "product".to_string(),
        readiness: "ready".to_string(),
    };
    let members = vec![ordinary, global, legacy];

    let global_error =
        parse_and_validate_coordinator_json(&decision_json("agent_global_coordinator"), &members)
            .unwrap_err();
    assert!(global_error
        .to_string()
        .contains("agent_global_coordinator"));

    let legacy_error =
        parse_and_validate_coordinator_json(&decision_json("agent_coordinator_dev"), &members)
            .unwrap_err();
    assert!(legacy_error.to_string().contains("agent_coordinator_dev"));
}

async fn post_json(
    app: &axum::Router,
    token: &AuthToken,
    uri: &str,
    idempotency_key: Option<&str>,
    payload: Value,
) -> axum::response::Response {
    let mut builder = Request::builder()
        .method("POST")
        .uri(uri)
        .header("authorization", token.authorization_header())
        .header("content-type", "application/json");
    if let Some(idempotency_key) = idempotency_key {
        builder = builder.header("idempotency-key", idempotency_key);
    }
    app.clone()
        .oneshot(builder.body(Body::from(payload.to_string())).unwrap())
        .await
        .unwrap()
}

fn decision_json(agent_id: &str) -> String {
    json!({
        "intent": "consultation",
        "action": "request_agent_reply",
        "routeMode": "explicit",
        "primaryAssigneeAgentId": agent_id,
        "targetAgentIds": [agent_id],
        "task": null,
        "reason": "route to selected agent",
        "confidence": 0.9
    })
    .to_string()
}

#[allow(dead_code)]
async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
