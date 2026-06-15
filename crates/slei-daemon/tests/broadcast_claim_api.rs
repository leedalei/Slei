use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;
use tower::ServiceExt;

fn authed_json_request(
    token: &AuthToken,
    method: &str,
    uri: impl AsRef<str>,
    body: Value,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri.as_ref())
        .header("authorization", token.authorization_header())
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn authed_empty_request(token: &AuthToken, uri: impl AsRef<str>) -> Request<Body> {
    Request::builder()
        .uri(uri.as_ref())
        .header("authorization", token.authorization_header())
        .body(Body::empty())
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn message_claim_api_returns_owner_for_losing_agents() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let first = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/claims/messages/msg_123",
            json!({ "agentId": "agent_cindy" }),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let first_json = response_json(first).await;
    assert_eq!(first_json["claimed"], true);
    assert_eq!(first_json["agentId"], "agent_cindy");

    let second = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/claims/messages/msg_123",
            json!({ "agentId": "agent_mina" }),
        ))
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::OK);
    let second_json = response_json(second).await;
    assert_eq!(second_json["claimed"], false);
    assert_eq!(second_json["agentId"], "agent_cindy");

    let retry = app
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/claims/messages/msg_123",
            json!({ "agentId": "agent_cindy" }),
        ))
        .await
        .unwrap();
    assert_eq!(retry.status(), StatusCode::OK);
    let retry_json = response_json(retry).await;
    assert_eq!(retry_json["claimed"], true);
    assert_eq!(retry_json["agentId"], "agent_cindy");
}

#[tokio::test]
async fn task_claim_api_returns_owner_for_losing_agents() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let first = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/claims/tasks/task_123",
            json!({ "agentId": "agent_cindy" }),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let first_json = response_json(first).await;
    assert_eq!(first_json["claimed"], true);
    assert_eq!(first_json["agentId"], "agent_cindy");

    let second = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/claims/tasks/task_123",
            json!({ "agentId": "agent_mina" }),
        ))
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::OK);
    let second_json = response_json(second).await;
    assert_eq!(second_json["claimed"], false);
    assert_eq!(second_json["agentId"], "agent_cindy");

    let retry = app
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/claims/tasks/task_123",
            json!({ "agentId": "agent_cindy" }),
        ))
        .await
        .unwrap();
    assert_eq!(retry.status(), StatusCode::OK);
    let retry_json = response_json(retry).await;
    assert_eq!(retry_json["claimed"], true);
    assert_eq!(retry_json["agentId"], "agent_cindy");
}

#[tokio::test]
async fn agent_status_api_updates_status_and_is_idempotent_for_activity_logs() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let first = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/agents/agent_cindy/status")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "status-once")
                .body(Body::from(
                    json!({
                        "state": "working",
                        "phase": "reading_history",
                        "reason": null,
                        "runId": "run_123",
                        "channelId": "all",
                        "messageId": "msg_123",
                        "taskId": null
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);

    let duplicate = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/agents/agent_cindy/status")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "status-once")
                .body(Body::from(
                    json!({
                        "state": "working",
                        "phase": "reading_history",
                        "reason": null,
                        "runId": "run_123",
                        "channelId": "all",
                        "messageId": "msg_123",
                        "taskId": null
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::OK);

    let activity = app
        .oneshot(authed_empty_request(
            &token,
            "/v1/agents/agent_cindy/activity?limit=200",
        ))
        .await
        .unwrap();
    assert_eq!(activity.status(), StatusCode::OK);
    let activity_json = response_json(activity).await;
    let logs = activity_json["logs"].as_array().unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["agentId"], "agent_cindy");
    assert_eq!(logs[0]["state"], "working");
    assert_eq!(logs[0]["phase"], "reading_history");
    assert_eq!(logs[0]["runId"], "run_123");
    assert_eq!(logs[0]["channelId"], "all");
    assert_eq!(logs[0]["messageId"], "msg_123");
}

#[tokio::test]
async fn agent_status_idempotency_key_is_scoped_per_agent() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    for (agent_id, run_id, message_id) in [
        ("agent_a", "run_agent_a", "msg_agent_a"),
        ("agent_b", "run_agent_b", "msg_agent_b"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/v1/agents/{agent_id}/status"))
                    .header("authorization", token.authorization_header())
                    .header("content-type", "application/json")
                    .header("idempotency-key", "shared-status-key")
                    .body(Body::from(
                        json!({
                            "state": "working",
                            "phase": "reading_history",
                            "reason": null,
                            "runId": run_id,
                            "channelId": "all",
                            "messageId": message_id,
                            "taskId": null
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    for (agent_id, run_id, message_id) in [
        ("agent_a", "run_agent_a", "msg_agent_a"),
        ("agent_b", "run_agent_b", "msg_agent_b"),
    ] {
        let activity = app
            .clone()
            .oneshot(authed_empty_request(
                &token,
                format!("/v1/agents/{agent_id}/activity?limit=200"),
            ))
            .await
            .unwrap();
        assert_eq!(activity.status(), StatusCode::OK);
        let activity_json = response_json(activity).await;
        let logs = activity_json["logs"].as_array().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["agentId"], agent_id);
        assert_eq!(logs[0]["runId"], run_id);
        assert_eq!(logs[0]["messageId"], message_id);
    }
}

#[tokio::test]
async fn agent_status_api_requires_idempotency_key() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let response = app
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/agents/agent_cindy/status",
            json!({
                "state": "working",
                "phase": "reading_history",
                "reason": null,
                "runId": "run_123",
                "channelId": "all",
                "messageId": "msg_123",
                "taskId": null
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["error"], "idempotency-key is required");
}

#[tokio::test]
async fn claim_and_status_apis_reject_blank_required_ids() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let blank_claim_agent = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/claims/messages/msg_123",
            json!({ "agentId": "   " }),
        ))
        .await
        .unwrap();
    assert_eq!(blank_claim_agent.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(blank_claim_agent).await["error"],
        "agentId is required"
    );

    let blank_message_id = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/claims/messages/%20%20",
            json!({ "agentId": "agent_cindy" }),
        ))
        .await
        .unwrap();
    assert_eq!(blank_message_id.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(blank_message_id).await["error"],
        "message_id is required"
    );

    let blank_task_id = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/claims/tasks/%20%20",
            json!({ "agentId": "agent_cindy" }),
        ))
        .await
        .unwrap();
    assert_eq!(blank_task_id.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(blank_task_id).await["error"],
        "task_id is required"
    );

    let blank_status_agent = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/agents/%20%20/status")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "blank-agent")
                .body(Body::from(
                    json!({
                        "state": "working",
                        "phase": null,
                        "reason": null,
                        "runId": null,
                        "channelId": null,
                        "messageId": null,
                        "taskId": null
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(blank_status_agent.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(blank_status_agent).await["error"],
        "agent_id is required"
    );

    let blank_status_state = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/agents/agent_cindy/status")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "blank-state")
                .body(Body::from(
                    json!({
                        "state": "   ",
                        "phase": null,
                        "reason": null,
                        "runId": null,
                        "channelId": null,
                        "messageId": null,
                        "taskId": null
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(blank_status_state.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(blank_status_state).await["error"],
        "state is required"
    );
}

#[tokio::test]
async fn agent_activity_api_returns_latest_100_logs() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    for index in 0..105 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/agents/agent_cindy/status")
                    .header("authorization", token.authorization_header())
                    .header("content-type", "application/json")
                    .header("idempotency-key", format!("status-{index}"))
                    .body(Body::from(
                        json!({
                            "state": "working",
                            "phase": "reading_history",
                            "reason": null,
                            "runId": format!("run_{index}"),
                            "channelId": "all",
                            "messageId": format!("msg_{index}"),
                            "taskId": null
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    let activity = app
        .oneshot(authed_empty_request(
            &token,
            "/v1/agents/agent_cindy/activity?limit=200",
        ))
        .await
        .unwrap();
    assert_eq!(activity.status(), StatusCode::OK);
    let activity_json = response_json(activity).await;
    let logs = activity_json["logs"].as_array().unwrap();
    assert_eq!(logs.len(), 100);
    assert_eq!(logs.first().unwrap()["runId"], "run_104");
    assert_eq!(logs.last().unwrap()["runId"], "run_5");
}
