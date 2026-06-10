use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::channel_service::{ChannelDraft, PermissionPreset};
use slei_daemon::services::coordinator_service::{
    parse_and_validate_coordinator_json, CoordinatorPromptMember,
};
use slei_daemon::services::member_service::ProductAgentDraft;
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

#[tokio::test]
async fn channel_member_api_adds_and_retries_existing_ordinary_agent() {
    let token = AuthToken::from_static("test-token");
    let state = test_state(token.clone()).await;
    create_channel(&state, "dev").await;
    let coda_id = create_agent(&state, "Coda", "@coda").await;
    let app = build_router(state.clone());

    let response = post_json(
        &app,
        &token,
        "/v1/channels/dev/members",
        None,
        json!({ "agentId": coda_id }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response_json(response).await;
    assert_eq!(body["member"]["agentId"], coda_id);
    assert_eq!(body["member"]["readiness"], "joining");

    let retry = post_json(
        &app,
        &token,
        "/v1/channels/dev/members",
        None,
        json!({ "agentId": coda_id }),
    )
    .await;
    assert_eq!(retry.status(), StatusCode::OK);
    let retry_body = response_json(retry).await;
    assert_eq!(retry_body["member"]["agentId"], coda_id);

    let members = state.channels().channel_members("dev").await.unwrap();
    assert_eq!(members.len(), 1);
}

#[tokio::test]
async fn channel_member_api_rejects_coordinator_and_removes_from_one_channel_only() {
    let token = AuthToken::from_static("test-token");
    let state = test_state(token.clone()).await;
    create_channel(&state, "dev").await;
    create_channel(&state, "design").await;
    let coda_id = create_agent(&state, "Coda", "@coda").await;
    state
        .members()
        .ensure_global_coordinator_agent("local-node")
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", &coda_id)
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("design", &coda_id)
        .await
        .unwrap();
    let app = build_router(state.clone());

    let rejected = post_json(
        &app,
        &token,
        "/v1/channels/dev/members",
        None,
        json!({ "agentId": "agent_global_coordinator" }),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);

    let removed = delete_json(&app, &token, &format!("/v1/channels/dev/members/{coda_id}")).await;
    assert_eq!(removed.status(), StatusCode::OK);
    let body = response_json(removed).await;
    assert_eq!(body["removedMember"]["agentId"], coda_id);

    assert!(state
        .channels()
        .channel_members("dev")
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        state
            .channels()
            .channel_members("design")
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(state.members().get_product_agent(&coda_id).await.is_ok());
}

async fn test_state(token: AuthToken) -> AppState {
    let root = std::env::temp_dir().join(format!("slei-channel-members-{}", Uuid::new_v4()));
    AppState::for_tests_with_agent_root_async(token, root).await
}

async fn create_channel(state: &AppState, channel_id: &str) {
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: channel_id.to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            &format!("create-{channel_id}"),
        )
        .await
        .unwrap();
}

async fn create_agent(state: &AppState, name: &str, handle: &str) -> String {
    state
        .members()
        .create_product_agent(
            ProductAgentDraft {
                name: name.to_string(),
                handle: handle.to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: format!("{name} handles channel work."),
            },
            &format!("create-agent-{handle}"),
        )
        .await
        .unwrap()
        .id
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

async fn delete_json(app: &axum::Router, token: &AuthToken, uri: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(uri)
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
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
