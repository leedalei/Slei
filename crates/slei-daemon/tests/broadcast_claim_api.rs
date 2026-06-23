use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::channel_service::{
    ChannelDraft, ChannelMemberReadiness, PermissionPreset,
};
use slei_daemon::services::member_service::{ProductAgentRecord, RuntimeThreadRecord};
use slei_daemon::services::message_service::MessageKind;
use slei_daemon::state::AppState;
use slei_storage::db::SleiDb;
use tower::ServiceExt;
use uuid::Uuid;

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

fn authed_json_request_with_idempotency(
    token: &AuthToken,
    method: &str,
    uri: impl AsRef<str>,
    idempotency_key: &str,
    body: Value,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri.as_ref())
        .header("authorization", token.authorization_header())
        .header("content-type", "application/json")
        .header("idempotency-key", idempotency_key)
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn message_read_api_returns_agent_visible_recent_messages() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state
        .messages()
        .create_human_channel_message("all", "human_lei", "大家好", "read-recent-1", false)
        .await
        .unwrap();
    let agent_message = state
        .messages()
        .create_agent_channel_message("all", "agent_cindy", "@lei-lee 已完成")
        .await
        .unwrap();
    let app = build_router(state);

    let response = app
        .oneshot(authed_empty_request(
            &token,
            "/v1/messages/read?channel=all&limit=20",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 2);

    let message = messages
        .iter()
        .find(|message| message["messageId"] == agent_message.id)
        .unwrap();
    assert_eq!(message["id"], agent_message.id);
    assert_eq!(message["channelId"], "all");
    assert_eq!(message["authorId"], "agent_cindy");
    assert_eq!(message["kind"], "agent");
    assert_eq!(message["type"], "agent");
    assert_eq!(message["body"], "@lei-lee 已完成");
    assert!(message["sequence"].as_i64().unwrap() > 0);
    let created_at = message["createdAt"].as_str().unwrap();
    assert_eq!(
        message["visibleText"],
        format!(
            "[target=#all msg={} time={} type=agent] agent_cindy: @lei-lee 已完成",
            agent_message.id, created_at
        )
    );
}

#[tokio::test]
async fn message_read_api_reads_after_and_before_sequence_anchors() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let first = state
        .messages()
        .create_human_channel_message("all", "human_lei", "第一条", "read-anchor-1", false)
        .await
        .unwrap();
    let second = state
        .messages()
        .create_agent_channel_message("all", "agent_cindy", "第二条")
        .await
        .unwrap();
    let third = state
        .messages()
        .create_agent_channel_message("all", "agent_mina", "第三条")
        .await
        .unwrap();
    let app = build_router(state);

    let recent = app
        .clone()
        .oneshot(authed_empty_request(
            &token,
            "/v1/messages/read?channel=all&limit=20",
        ))
        .await
        .unwrap();
    assert_eq!(recent.status(), StatusCode::OK);
    let recent_body = response_json(recent).await;
    let messages = recent_body["messages"].as_array().unwrap();
    let second_sequence = messages
        .iter()
        .find(|message| message["messageId"] == second.id)
        .unwrap()["sequence"]
        .as_i64()
        .unwrap();

    let after = app
        .clone()
        .oneshot(authed_empty_request(
            &token,
            format!("/v1/messages/read?channel=all&after={second_sequence}&limit=20"),
        ))
        .await
        .unwrap();
    assert_eq!(after.status(), StatusCode::OK);
    let after_body = response_json(after).await;
    let after_messages = after_body["messages"].as_array().unwrap();
    assert_eq!(after_messages.len(), 1);
    assert_eq!(after_messages[0]["messageId"], third.id);

    let before = app
        .oneshot(authed_empty_request(
            &token,
            format!("/v1/messages/read?channel=all&before={second_sequence}&limit=20"),
        ))
        .await
        .unwrap();
    assert_eq!(before.status(), StatusCode::OK);
    let before_body = response_json(before).await;
    let before_messages = before_body["messages"].as_array().unwrap();
    assert_eq!(before_messages.len(), 1);
    assert_eq!(before_messages[0]["messageId"], first.id);
}

#[tokio::test]
async fn message_read_api_reads_context_around_message_id() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let before = state
        .messages()
        .create_human_channel_message("all", "human_lei", "before", "read-around-1", false)
        .await
        .unwrap();
    let center = state
        .messages()
        .create_agent_channel_message("all", "agent_cindy", "center")
        .await
        .unwrap();
    let after = state
        .messages()
        .create_agent_channel_message("all", "agent_mina", "after")
        .await
        .unwrap();
    let app = build_router(state);

    let response = app
        .oneshot(authed_empty_request(
            &token,
            format!("/v1/messages/read?channel=all&around={}&limit=3", center.id),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let message_ids = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|message| message["messageId"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(message_ids, vec![before.id, center.id, after.id]);
}

#[tokio::test]
async fn message_read_api_reads_inclusive_message_id_range() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state
        .messages()
        .create_human_channel_message("all", "human_lei", "before", "read-range-before", false)
        .await
        .unwrap();
    let first = state
        .messages()
        .create_human_channel_message("all", "human_lei", "first", "read-range-first", false)
        .await
        .unwrap();
    let second = state
        .messages()
        .create_agent_channel_message("all", "agent_cindy", "second")
        .await
        .unwrap();
    let third = state
        .messages()
        .create_agent_channel_message("all", "agent_mina", "third")
        .await
        .unwrap();
    state
        .messages()
        .create_human_channel_message("all", "human_lei", "after", "read-range-after", false)
        .await
        .unwrap();
    let app = build_router(state);

    let response = app
        .oneshot(authed_empty_request(
            &token,
            format!(
                "/v1/messages/read?channel=all&fromMessage={}&toMessage={}&limit=20",
                first.id, third.id
            ),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let message_ids = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|message| message["messageId"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(message_ids, vec![first.id, second.id, third.id]);
}

#[tokio::test]
async fn message_read_api_reads_reversed_message_id_range_ascending() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let first = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "first reversed",
            "read-range-reversed-first",
            false,
        )
        .await
        .unwrap();
    let second = state
        .messages()
        .create_agent_channel_message("all", "agent_cindy", "second reversed")
        .await
        .unwrap();
    let third = state
        .messages()
        .create_agent_channel_message("all", "agent_mina", "third reversed")
        .await
        .unwrap();
    let app = build_router(state);

    let response = app
        .oneshot(authed_empty_request(
            &token,
            format!(
                "/v1/messages/read?channel=all&fromMessage={}&toMessage={}&limit=20",
                third.id, first.id
            ),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let message_ids = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|message| message["messageId"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(message_ids, vec![first.id, second.id, third.id]);
}

#[tokio::test]
async fn message_read_api_rejects_invalid_message_id_range_inputs() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let all_message = state
        .messages()
        .create_human_channel_message("all", "human_lei", "all", "read-range-all", false)
        .await
        .unwrap();
    let ops_message = state
        .messages()
        .create_human_channel_message("ops", "human_lei", "ops", "read-range-ops", false)
        .await
        .unwrap();
    let deleted = state
        .messages()
        .create_human_channel_message("all", "human_lei", "deleted", "read-range-deleted", false)
        .await
        .unwrap();
    state
        .messages()
        .delete_human_message(&deleted.id)
        .await
        .unwrap();
    let app = build_router(state);

    for uri in [
        format!(
            "/v1/messages/read?channel=all&fromMessage={}&toMessage={}&limit=20",
            all_message.id, ops_message.id
        ),
        format!(
            "/v1/messages/read?channel=all&fromMessage={}&toMessage={}&limit=20",
            deleted.id, all_message.id
        ),
        format!(
            "/v1/messages/read?channel=all&fromMessage={}&toMessage={}&around={}&limit=20",
            all_message.id, all_message.id, all_message.id
        ),
        format!(
            "/v1/messages/read?channel=all&fromMessage={}&limit=20",
            all_message.id
        ),
        format!(
            "/v1/messages/read?channel=all&fromMessage=&toMessage={}&limit=20",
            all_message.id
        ),
    ] {
        let response = app
            .clone()
            .oneshot(authed_empty_request(&token, uri))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
async fn message_read_api_range_hides_task_control_messages() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let first = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "visible first",
            "read-range-controls-first",
            false,
        )
        .await
        .unwrap();
    let legacy_task_card = state
        .messages()
        .create_human_channel_message(
            "all",
            "system",
            "task_card:legacy:source:msg_old",
            "read-range-legacy-task-card",
            false,
        )
        .await
        .unwrap();
    let task_card = state
        .messages()
        .create_task_card_message("all", "task_hidden", &first.id)
        .await
        .unwrap();
    let tombstone = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "deleted hidden",
            "read-range-controls-deleted",
            false,
        )
        .await
        .unwrap();
    state
        .messages()
        .delete_human_message(&tombstone.id)
        .await
        .unwrap();
    let task = state
        .tasks()
        .create_task_root(
            "all",
            "human_lei",
            "hidden task root",
            "read-range-task-root",
        )
        .await
        .unwrap();
    let reply = state
        .tasks()
        .add_reply(
            &task.id,
            "agent_cindy",
            "hidden task reply",
            "read-range-task-reply",
        )
        .await
        .unwrap();
    let last = state
        .messages()
        .create_agent_channel_message("all", "agent_cindy", "visible last")
        .await
        .unwrap();
    let app = build_router(state);

    let response = app
        .oneshot(authed_empty_request(
            &token,
            format!(
                "/v1/messages/read?channel=all&fromMessage={}&toMessage={}&limit=20",
                first.id, last.id
            ),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let message_ids = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|message| message["messageId"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();

    assert_eq!(message_ids, vec![first.id, last.id]);
    for hidden_id in [
        legacy_task_card.id,
        task_card.id,
        tombstone.id,
        format!("task_root_msg_{}", task.id),
        format!("task_reply_msg_{}", reply.id),
    ] {
        assert!(
            !message_ids.contains(&hidden_id),
            "{hidden_id} should be hidden"
        );
    }
}

#[tokio::test]
async fn search_api_returns_matching_agent_visible_messages() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state
        .messages()
        .create_human_channel_message("all", "human_lei", "普通消息", "search-1", false)
        .await
        .unwrap();
    let matched = state
        .messages()
        .create_agent_channel_message("all", "agent_cindy", "包含关键词的消息")
        .await
        .unwrap();
    let app = build_router(state);

    let response = app
        .oneshot(authed_empty_request(
            &token,
            "/v1/messages/search?query=关键词",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["messageId"], matched.id);
    assert_eq!(messages[0]["body"], "包含关键词的消息");
    assert!(messages[0]["visibleText"]
        .as_str()
        .unwrap()
        .starts_with(&format!("[target=#all msg={}", matched.id)));
}

#[tokio::test]
async fn message_read_api_conflicts_during_reset() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state
        .messages()
        .create_human_channel_message("all", "human_lei", "reset read", "reset-read-1", false)
        .await
        .unwrap();
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();
    let app = build_router(state);

    let response = app
        .oneshot(authed_empty_request(
            &token,
            "/v1/messages/read?channel=all&limit=20",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = response_json(response).await;
    assert_eq!(
        body["error"],
        "reset in progress; runtime launches are temporarily disabled"
    );

    reset_guard.finish().await;
}

#[tokio::test]
async fn search_api_conflicts_during_reset() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state
        .messages()
        .create_human_channel_message("all", "human_lei", "reset search", "reset-search-1", false)
        .await
        .unwrap();
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();
    let app = build_router(state);

    let response = app
        .oneshot(authed_empty_request(
            &token,
            "/v1/messages/search?query=reset",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = response_json(response).await;
    assert_eq!(
        body["error"],
        "reset in progress; runtime launches are temporarily disabled"
    );

    reset_guard.finish().await;
}

#[tokio::test]
async fn agent_send_api_writes_agent_message_and_returns_message_id() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let app = build_router(state.clone());

    let response = app
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/messages/send",
            "agent-send-once",
            json!({
                "target": "#all",
                "agentId": "agent_cindy",
                "body": "@lei-lee 已完成"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let message_id = body["messageId"].as_str().unwrap();

    let messages = state.channel_messages_for_tests("all").await;
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].id, message_id);
    assert_eq!(messages[0].author_id, "agent_cindy");
    assert_eq!(messages[0].kind, MessageKind::Agent);
    assert_eq!(messages[0].body.as_deref(), Some("@lei-lee 已完成"));
    assert!(!messages[0].as_task);
}

#[tokio::test]
async fn agent_send_api_is_idempotent_for_retries() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let app = build_router(state.clone());

    let first = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/messages/send",
            "agent-send-retry",
            json!({
                "target": "#all",
                "agentId": "agent_cindy",
                "body": "@lei-lee 已完成"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let first_body = response_json(first).await;
    let message_id = first_body["messageId"].as_str().unwrap().to_string();

    let retry = app
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/messages/send",
            "agent-send-retry",
            json!({
                "target": "#all",
                "agentId": "agent_cindy",
                "body": "@lei-lee 已完成"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(retry.status(), StatusCode::OK);
    let retry_body = response_json(retry).await;
    assert_eq!(retry_body["messageId"], message_id);
    assert_eq!(state.channel_messages_for_tests("all").await.len(), 1);
}

#[tokio::test]
async fn agent_send_api_idempotency_key_is_scoped_per_agent() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let app = build_router(state.clone());

    let first = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/messages/send",
            "shared-agent-send-key",
            json!({
                "target": "#all",
                "agentId": "agent_cindy",
                "body": "Cindy done"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let first_body = response_json(first).await;
    let first_message_id = first_body["messageId"].as_str().unwrap().to_string();

    let second = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/messages/send",
            "shared-agent-send-key",
            json!({
                "target": "#all",
                "agentId": "agent_mina",
                "body": "Mina done"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::OK);
    let second_body = response_json(second).await;
    let second_message_id = second_body["messageId"].as_str().unwrap().to_string();

    let first_retry = app
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/messages/send",
            "shared-agent-send-key",
            json!({
                "target": "#all",
                "agentId": "agent_cindy",
                "body": "Cindy done"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(first_retry.status(), StatusCode::OK);
    let first_retry_body = response_json(first_retry).await;

    assert_ne!(first_message_id, second_message_id);
    assert_eq!(first_retry_body["messageId"], first_message_id);
    let messages = state.channel_messages_for_tests("all").await;
    assert_eq!(messages.len(), 2);
    assert!(messages
        .iter()
        .any(|message| message.author_id == "agent_cindy" && message.id == first_message_id));
    assert!(messages
        .iter()
        .any(|message| message.author_id == "agent_mina" && message.id == second_message_id));
}

#[tokio::test]
async fn message_read_api_rejects_thread_target_until_thread_reads_exist() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let app = build_router(state);

    let response = app
        .oneshot(authed_empty_request(
            &token,
            "/v1/messages/read?channel=%23all:msg_123",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn agent_send_api_rejects_thread_target_until_thread_sends_exist() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let app = build_router(state);

    let response = app
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/messages/send",
            "agent-send-thread-target",
            json!({
                "target": "#all:msg_123",
                "agentId": "agent_cindy",
                "body": "@lei-lee 已完成"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
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
async fn message_claim_api_records_claim_diagnostic_for_desktop_activity() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let claim = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/claims/messages/msg_claimed_123",
            json!({ "agentId": "agent_coda" }),
        ))
        .await
        .unwrap();
    assert_eq!(claim.status(), StatusCode::OK);
    let claim_json = response_json(claim).await;
    assert_eq!(claim_json["claimed"], true);

    let diagnostics = app
        .oneshot(authed_empty_request(&token, "/v1/diagnostics"))
        .await
        .unwrap();
    assert_eq!(diagnostics.status(), StatusCode::OK);
    let diagnostics_json = response_json(diagnostics).await;
    let events = diagnostics_json["recentEvents"].as_array().unwrap();
    assert!(
        events.iter().any(|event| {
            event["eventType"] == "message_claimed"
                && event["payload"].as_str().is_some_and(|payload| {
                    payload.contains("message_id=msg_claimed_123")
                        && payload.contains("agent_id=agent_coda")
                })
        }),
        "missing message_claimed diagnostic event: {events:?}"
    );
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
async fn task_cli_api_creates_from_source_replies_updates_and_lists_thread() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state.channels().list_channels().await;
    let source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "请从这条消息创建任务，并保留完整正文。",
            "task-cli-source-message",
            false,
        )
        .await
        .unwrap();
    let app = build_router(state.clone());

    let created = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/tasks/from-source-message",
            "task-cli-create",
            json!({
                "sourceMessageId": source.id,
                "creatorId": "agent_cindy"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_json = response_json(created).await;
    let task_id = created_json["task"]["id"].as_str().unwrap().to_string();
    assert_eq!(created_json["task"]["sourceMessageId"], source.id);
    assert_eq!(created_json["task"]["creatorId"], "human_lei");
    assert_eq!(
        created_json["task"]["title"],
        "请从这条消息创建任务，并保留完整正文。"
    );

    let same_source = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/tasks/from-source-message",
            "task-cli-create-same-source",
            json!({
                "sourceMessageId": source.id,
                "creatorId": "agent_mina"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(same_source.status(), StatusCode::CREATED);
    let same_source_json = response_json(same_source).await;
    assert_eq!(same_source_json["task"]["id"], task_id);
    assert_eq!(state.channel_messages_for_tests("all").await.len(), 1);

    let listed = app
        .clone()
        .oneshot(authed_empty_request(&token, "/v1/tasks?channel=all"))
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    let listed_json = response_json(listed).await;
    assert_eq!(listed_json["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(listed_json["tasks"][0]["id"], task_id);

    let reply = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            format!("/v1/tasks/{task_id}/replies"),
            "task-cli-reply",
            json!({
                "agentId": "agent_cindy",
                "role": "agent",
                "body": "已处理到第一步"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(reply.status(), StatusCode::CREATED);
    let reply_json = response_json(reply).await;
    let reply_id = reply_json["reply"]["id"].as_str().unwrap().to_string();
    assert_eq!(reply_json["reply"]["senderId"], "agent_cindy");
    assert_eq!(reply_json["reply"]["role"], "agent");

    let reply_retry = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            format!("/v1/tasks/{task_id}/replies"),
            "task-cli-reply",
            json!({
                "agentId": "agent_cindy",
                "role": "human",
                "body": "重试不能新增或覆盖"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(reply_retry.status(), StatusCode::CREATED);
    let reply_retry_json = response_json(reply_retry).await;
    assert_eq!(reply_retry_json["reply"]["id"], reply_id);
    assert_eq!(reply_retry_json["reply"]["role"], "agent");
    assert_eq!(reply_retry_json["reply"]["body"], "已处理到第一步");

    let missing_update_key = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "PATCH",
            format!("/v1/tasks/{task_id}"),
            json!({ "status": "in_progress" }),
        ))
        .await
        .unwrap();
    assert_eq!(missing_update_key.status(), StatusCode::BAD_REQUEST);

    let updated = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "PATCH",
            format!("/v1/tasks/{task_id}"),
            "task-cli-update",
            json!({ "status": "in_progress" }),
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let updated_json = response_json(updated).await;
    assert_eq!(updated_json["task"]["status"], "in_progress");

    let update_retry = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "PATCH",
            format!("/v1/tasks/{task_id}"),
            "task-cli-update",
            json!({ "status": "done" }),
        ))
        .await
        .unwrap();
    assert_eq!(update_retry.status(), StatusCode::OK);
    let update_retry_json = response_json(update_retry).await;
    assert_eq!(update_retry_json["task"]["status"], "in_progress");

    let thread = app
        .oneshot(authed_empty_request(
            &token,
            format!("/v1/tasks/{task_id}/thread"),
        ))
        .await
        .unwrap();
    assert_eq!(thread.status(), StatusCode::OK);
    let thread_json = response_json(thread).await;
    assert_eq!(
        thread_json["thread"]["root"]["body"],
        "请从这条消息创建任务，并保留完整正文。"
    );
    assert_eq!(thread_json["thread"]["root"]["senderId"], "human_lei");
    assert_eq!(
        thread_json["thread"]["replies"].as_array().unwrap().len(),
        1
    );
    assert_eq!(thread_json["thread"]["replies"][0]["id"], reply_id);
    assert_eq!(thread_json["thread"]["replies"][0]["role"], "agent");
}

#[tokio::test]
async fn task_cli_reply_preserves_role_and_routes_visible_handoff_mentions() {
    let token = AuthToken::from_static("test-token");
    let state = app_state_with_agent_handle("agent_coda", "@coda-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "api-dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "task-cli-handoff-channel",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("api-dev", "agent_coda")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("api-dev", "agent_coda", ChannelMemberReadiness::Ready)
        .await
        .unwrap();
    let app = build_router(state.clone());

    let created = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/tasks",
            "task-cli-handoff-create",
            json!({
                "channelId": "api-dev",
                "creatorId": "human_lei",
                "title": "CLI handoff task"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_json = response_json(created).await;
    let task_id = created_json["task"]["id"].as_str().unwrap().to_string();

    let reply = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            format!("/v1/tasks/{task_id}/replies"),
            "task-cli-handoff-reply",
            json!({
                "agentId": "agent_cindy",
                "role": "agent",
                "body": "我处理完第一步。@coda-win 请接手后续验证。"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(reply.status(), StatusCode::CREATED);
    let reply_json = response_json(reply).await;
    assert_eq!(reply_json["reply"]["role"], "agent");
    assert_eq!(reply_json["route"]["handoffAgentIds"][0], "agent_coda");

    let handoffs = state
        .agent_inbox()
        .events_for_agent("agent_coda")
        .await
        .into_iter()
        .filter(|event| event.event_type == "task_handoff")
        .collect::<Vec<_>>();
    assert_eq!(handoffs.len(), 1);
    assert_eq!(handoffs[0].task_id.as_deref(), Some(task_id.as_str()));
    assert_eq!(handoffs[0].sender_id.as_deref(), Some("agent_cindy"));
    assert_eq!(
        handoffs[0].handoff_text.as_deref(),
        Some("我处理完第一步。@coda-win 请接手后续验证。")
    );
}

#[tokio::test]
async fn agent_activity_api_records_status_update_fields_and_is_idempotent() {
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
        .clone()
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
    assert_eq!(logs[0]["eventKind"], "status.updated");
    assert_eq!(logs[0]["severity"], "info");
    assert!(logs[0]["summary"].as_str().unwrap().contains("working"));
    assert_eq!(logs[0]["payloadPreview"], serde_json::Value::Null);

    let diagnostics = app
        .oneshot(authed_empty_request(&token, "/v1/diagnostics"))
        .await
        .unwrap();
    assert_eq!(diagnostics.status(), StatusCode::OK);
    let diagnostics_json = response_json(diagnostics).await;
    let events = diagnostics_json["recentEvents"].as_array().unwrap();
    assert!(events.iter().any(|event| {
        event["eventType"] == "agent_activity.updated"
            && event["payload"]
                .as_str()
                .unwrap()
                .contains("agent_id=agent_cindy")
            && event["payload"]
                .as_str()
                .unwrap()
                .contains("message_id=msg_123")
            && event["payload"]
                .as_str()
                .unwrap()
                .contains("phase=reading_history")
    }));
}

#[tokio::test]
async fn channel_agent_runtime_records_activity_events_and_sanitizes_failure_preview() {
    let token = AuthToken::from_static("test-token");
    let state = app_state_with_agent_handle("agent_cindy", "@cindy").await;
    state
        .channels()
        .set_member_readiness("all", "agent_cindy", ChannelMemberReadiness::Ready)
        .await
        .unwrap();
    let app = build_router(state.clone());

    let sent = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/channels/all/messages",
            "channel-agent-runtime-activity",
            json!({
                "authorId": "human_lei",
                "body": "@cindy 请检查发布风险",
                "asTask": true
            }),
        ))
        .await
        .unwrap();
    assert_eq!(sent.status(), StatusCode::OK);
    let sent_json = response_json(sent).await;
    assert_eq!(sent_json["outcome"]["action"], "create_task_and_assign");
    let message_id = sent_json["outcome"]["messageId"].as_str().unwrap();

    let run_id = state
        .worker_commands()
        .into_iter()
        .find(|command| {
            command["type"] == "start_run" && command["session"]["agent_id"] == "agent_cindy"
        })
        .and_then(|command| command["run_id"].as_str().map(ToOwned::to_owned))
        .expect("channel agent runtime should have started");

    state
        .handle_worker_event(json!({
            "type": "tool_started",
            "run_id": run_id,
            "tool_use_id": "tool-read-1",
            "name": "Read"
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "tool_completed",
            "run_id": run_id,
            "tool_use_id": "tool-read-1",
            "name": "Read",
            "ok": true
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "product_tool_requested",
            "run_id": run_id,
            "agent_id": "agent_cindy",
            "tool_name": "slei_propose_interactive_card",
            "tool_use_id": "tool-activity-1",
            "payload": {
                "kind": "createAgent",
                "title": "检查项",
                "summary": "记录工具开始",
                "actionLabel": "创建",
                "doneLabel": "完成",
                "draft": {
                    "name": "Temp",
                    "handle": "@temp-activity",
                    "runtimeKind": "ClaudeCode",
                    "model": "Sonnet",
                    "nodeId": "local-node",
                    "description": "临时测试 Agent"
                }
            }
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "tool_completed",
            "run_id": run_id,
            "agent_id": "agent_cindy",
            "tool_name": "slei_propose_interactive_card",
            "tool_use_id": "tool-activity-1",
            "ok": true,
            "payload": { "result": "ok" }
        }))
        .await
        .unwrap();

    let long_sensitive_tail = "x".repeat(2300);
    state
        .handle_worker_event(json!({
            "type": "failed",
            "run_id": run_id,
            "agent_id": "agent_cindy",
            "message": format!(
                "工具失败 Authorization: Bearer secret-token password=abc {long_sensitive_tail}"
            ),
            "payload": {
                "authorization": "Bearer secret-token",
                "password": "abc",
                "notes": long_sensitive_tail
            }
        }))
        .await
        .unwrap();

    let completed_sent = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/channels/all/messages",
            "channel-agent-runtime-completed-activity",
            json!({
                "authorId": "human_lei",
                "body": "@cindy 请总结发布风险",
                "asTask": true
            }),
        ))
        .await
        .unwrap();
    assert_eq!(completed_sent.status(), StatusCode::OK);
    let completed_json = response_json(completed_sent).await;
    assert_eq!(
        completed_json["outcome"]["action"],
        "create_task_and_assign"
    );
    let completed_run_id = state
        .worker_commands()
        .into_iter()
        .rev()
        .find(|command| {
            command["type"] == "start_run"
                && command["session"]["agent_id"] == "agent_cindy"
                && command["run_id"] != run_id
        })
        .and_then(|command| command["run_id"].as_str().map(ToOwned::to_owned))
        .expect("second channel agent runtime should have started");
    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": completed_run_id,
            "delta": "发布风险较低，",
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": completed_run_id,
            "delta": "请关注回滚。",
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "completed",
            "run_id": completed_run_id,
        }))
        .await
        .unwrap();

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
    let event_kinds = logs
        .iter()
        .map(|log| log["eventKind"].as_str().unwrap())
        .collect::<Vec<_>>();
    for expected in [
        "run.started",
        "input.received",
        "tool.started",
        "tool.completed",
        "run.completed",
        "run.failed",
    ] {
        assert!(
            event_kinds.contains(&expected),
            "missing {expected} in {event_kinds:?}"
        );
    }
    assert!(
        !event_kinds.contains(&"output.delta"),
        "output_delta fragments should be aggregated into the terminal activity event"
    );

    let failed = logs
        .iter()
        .find(|log| log["eventKind"] == "run.failed")
        .expect("failed activity event");
    assert_eq!(failed["runId"], run_id);
    assert_eq!(failed["channelId"], "all");
    assert_eq!(failed["messageId"], message_id);
    let preview = failed["payloadPreview"].as_str().unwrap();
    assert!(!preview.contains("secret-token"));
    assert!(!preview.contains("abc"));
    assert!(preview.contains("[redacted]"));
    assert!(preview.contains("[truncated]"));

    let read_started = logs
        .iter()
        .find(|log| {
            log["eventKind"] == "tool.started"
                && log["runId"] == run_id
                && log["toolName"] == "Read"
        })
        .expect("ordinary tool_started name should be preserved");
    assert!(read_started["summary"].as_str().unwrap().contains("Read"));

    let read_completed = logs
        .iter()
        .find(|log| {
            log["eventKind"] == "tool.completed"
                && log["runId"] == run_id
                && log["toolName"] == "Read"
        })
        .expect("ordinary tool_completed name should be preserved");
    assert!(read_completed["summary"].as_str().unwrap().contains("Read"));

    let completed = logs
        .iter()
        .find(|log| log["eventKind"] == "run.completed")
        .expect("completed activity event");
    assert_eq!(completed["runId"], completed_run_id);
    let completed_preview = completed["payloadPreview"].as_str().unwrap();
    assert!(completed_preview.contains("output_chars=13"));
    assert!(completed_preview.contains("发布风险较低，请关注回滚。"));
}

#[tokio::test]
async fn channel_agent_terminal_activity_survives_completed_side_effect_failure() {
    let token = AuthToken::from_static("test-token");
    let root = std::env::temp_dir().join(format!(
        "slei-broadcast-api-terminal-failure-{}",
        Uuid::new_v4()
    ));
    let state = app_state_with_agent_handle_at_root("agent_cindy", "@cindy", root.clone()).await;
    state
        .channels()
        .set_member_readiness("all", "agent_cindy", ChannelMemberReadiness::Ready)
        .await
        .unwrap();
    let app = build_router(state.clone());

    let sent = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/channels/all/messages",
            "channel-agent-terminal-failure",
            json!({
                "authorId": "human_lei",
                "body": "@cindy 请处理会丢失任务的消息",
                "asTask": true
            }),
        ))
        .await
        .unwrap();
    assert_eq!(sent.status(), StatusCode::OK);
    let sent_json = response_json(sent).await;
    let task_id = sent_json["outcome"]["taskId"].as_str().unwrap().to_string();
    let run_id = state
        .worker_commands()
        .into_iter()
        .find(|command| {
            command["type"] == "start_run" && command["session"]["agent_id"] == "agent_cindy"
        })
        .and_then(|command| command["run_id"].as_str().map(ToOwned::to_owned))
        .expect("channel agent runtime should have started");

    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": run_id,
            "delta": "我会尝试写入任务回复。",
        }))
        .await
        .unwrap();

    let db_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let db = SleiDb::connect(&db_url).await.unwrap();
    sqlx::query("DELETE FROM tasks WHERE id = ?")
        .bind(&task_id)
        .execute(db.pool())
        .await
        .unwrap();

    let error = state
        .handle_worker_event(json!({
            "type": "completed",
            "run_id": run_id,
        }))
        .await
        .expect_err("completed side effect should still return the task error");
    assert!(error.contains("task not found"), "{error}");

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
    assert!(logs.iter().any(|log| {
        log["eventKind"] == "run.completed"
            && log["runId"] == run_id
            && log["toolName"] == serde_json::Value::Null
    }));
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
async fn agent_activity_api_defaults_to_latest_200_logs() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    for index in 0..205 {
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
            "/v1/agents/agent_cindy/activity",
        ))
        .await
        .unwrap();
    assert_eq!(activity.status(), StatusCode::OK);
    let activity_json = response_json(activity).await;
    let logs = activity_json["logs"].as_array().unwrap();
    assert_eq!(logs.len(), 200);
    assert_eq!(logs.first().unwrap()["runId"], "run_204");
    assert_eq!(logs.last().unwrap()["runId"], "run_5");
}

#[tokio::test]
async fn agent_activity_api_clamps_limit_to_200() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    for index in 0..205 {
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
            "/v1/agents/agent_cindy/activity?limit=999",
        ))
        .await
        .unwrap();
    let logs = response_json(activity).await["logs"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(logs.len(), 200);
}

#[tokio::test]
async fn agent_message_todo_api_creates_lists_updates_deletes_and_gets_deleted_todo() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let message = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "请跟进发布检查",
            "todo-api-message",
            false,
        )
        .await
        .unwrap();
    let app = build_router(state);

    let created = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/agent-message-todos",
            "todo-create-once",
            json!({
                "agentId": "agent_coda",
                "channelId": "all",
                "messageId": message.id,
                "note": "manual follow-up"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_json = response_json(created).await;
    let todo = &created_json["todo"];
    let todo_id = todo["id"].as_str().unwrap().to_string();
    assert_eq!(todo["agentId"], "agent_coda");
    assert_eq!(todo["channelId"], "all");
    assert_eq!(todo["messageId"], message.id);
    assert_eq!(todo["messageAuthorId"], "human_lei");
    assert_eq!(todo["claimOwnerAgentId"], "agent_coda");
    assert_eq!(todo["status"], "pending");
    assert_eq!(todo["note"], "manual follow-up");

    let listed = app
        .clone()
        .oneshot(authed_empty_request(
            &token,
            "/v1/agent-message-todos?agentId=agent_coda&channelId=all&status=pending",
        ))
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    let listed_json = response_json(listed).await;
    let todos = listed_json["todos"].as_array().unwrap();
    assert_eq!(todos.len(), 1);
    assert_eq!(todos[0]["id"], todo_id);

    let updated = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "PATCH",
            format!("/v1/agent-message-todos/{todo_id}"),
            "todo-update-once",
            json!({
                "status": "done",
                "note": "verified by human"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let updated_json = response_json(updated).await;
    assert_eq!(updated_json["todo"]["id"], todo_id);
    assert_eq!(updated_json["todo"]["status"], "done");
    assert_eq!(updated_json["todo"]["note"], "verified by human");
    assert!(updated_json["todo"]["completedAt"].as_str().is_some());

    let deleted = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "DELETE",
            format!("/v1/agent-message-todos/{todo_id}"),
            "todo-delete-once",
            json!({}),
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::OK);
    let deleted_json = response_json(deleted).await;
    assert_eq!(deleted_json["todo"]["id"], todo_id);
    assert_eq!(deleted_json["todo"]["status"], "deleted");

    let fetched = app
        .oneshot(authed_empty_request(
            &token,
            format!("/v1/agent-message-todos/{todo_id}"),
        ))
        .await
        .unwrap();
    assert_eq!(fetched.status(), StatusCode::OK);
    let fetched_json = response_json(fetched).await;
    assert_eq!(fetched_json["todo"]["id"], todo_id);
    assert_eq!(fetched_json["todo"]["status"], "deleted");
}

#[tokio::test]
async fn agent_message_todo_api_clear_soft_deletes_matching_pending_todos() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let first = state
        .messages()
        .create_human_channel_message("all", "human_lei", "第一条待办", "todo-clear-first", false)
        .await
        .unwrap();
    let second = state
        .messages()
        .create_human_channel_message("all", "human_lei", "第二条待办", "todo-clear-second", false)
        .await
        .unwrap();
    let app = build_router(state);

    for (key, message_id) in [
        ("todo-clear-create-first", first.id.as_str()),
        ("todo-clear-create-second", second.id.as_str()),
    ] {
        let response = app
            .clone()
            .oneshot(authed_json_request_with_idempotency(
                &token,
                "POST",
                "/v1/agent-message-todos",
                key,
                json!({
                    "agentId": "agent_coda",
                    "channelId": "all",
                    "messageId": message_id
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    let cleared = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/agent-message-todos/clear",
            "todo-clear-once",
            json!({
                "agentId": "agent_coda",
                "channelId": "all",
                "status": "pending",
                "note": "cleared manually"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(cleared.status(), StatusCode::OK);
    let cleared_json = response_json(cleared).await;
    let cleared_todos = cleared_json["todos"].as_array().unwrap();
    assert_eq!(cleared_todos.len(), 2);
    assert!(cleared_todos.iter().all(|todo| {
        todo["agentId"] == "agent_coda"
            && todo["channelId"] == "all"
            && todo["status"] == "deleted"
            && todo["note"] == "cleared manually"
    }));

    let pending = app
        .oneshot(authed_empty_request(
            &token,
            "/v1/agent-message-todos?agentId=agent_coda&channelId=all&status=pending",
        ))
        .await
        .unwrap();
    assert_eq!(pending.status(), StatusCode::OK);
    assert_eq!(
        response_json(pending).await["todos"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

#[tokio::test]
async fn agent_message_todo_api_write_calls_require_idempotency_key() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let message = state
        .messages()
        .create_human_channel_message("all", "human_lei", "缺少幂等键", "todo-missing-key", false)
        .await
        .unwrap();
    let app = build_router(state);

    let create = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/agent-message-todos",
            json!({
                "agentId": "agent_coda",
                "channelId": "all",
                "messageId": message.id
            }),
        ))
        .await
        .unwrap();
    assert_eq!(create.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(create).await["error"],
        "idempotency-key is required"
    );

    let blank_create = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/agent-message-todos",
            "   ",
            json!({
                "agentId": "agent_coda",
                "channelId": "all",
                "messageId": message.id
            }),
        ))
        .await
        .unwrap();
    assert_eq!(blank_create.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(blank_create).await["error"],
        "idempotency-key is required"
    );

    let created = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/agent-message-todos",
            "todo-missing-key-create",
            json!({
                "agentId": "agent_coda",
                "channelId": "all",
                "messageId": message.id
            }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let todo_id = response_json(created).await["todo"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    for (method, uri, body) in [
        (
            "PATCH",
            format!("/v1/agent-message-todos/{todo_id}"),
            json!({ "status": "done" }),
        ),
        (
            "DELETE",
            format!("/v1/agent-message-todos/{todo_id}"),
            json!({}),
        ),
        (
            "POST",
            "/v1/agent-message-todos/clear".to_string(),
            json!({ "agentId": "agent_coda", "channelId": "all", "status": "pending" }),
        ),
    ] {
        let response = app
            .clone()
            .oneshot(authed_json_request(&token, method, uri, body))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response_json(response).await["error"],
            "idempotency-key is required"
        );
    }
}

#[tokio::test]
async fn agent_message_todo_api_replays_idempotent_create_update_delete_and_clear() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let first = state
        .messages()
        .create_human_channel_message("all", "human_lei", "待办一", "todo-replay-first", false)
        .await
        .unwrap();
    let second = state
        .messages()
        .create_human_channel_message("all", "human_lei", "待办二", "todo-replay-second", false)
        .await
        .unwrap();
    let third = state
        .messages()
        .create_human_channel_message("all", "human_lei", "待办三", "todo-replay-third", false)
        .await
        .unwrap();
    let app = build_router(state);

    let first_create = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/agent-message-todos",
            "todo-replay-create",
            json!({
                "agentId": "agent_coda",
                "channelId": "all",
                "messageId": first.id,
                "note": "first response"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(first_create.status(), StatusCode::CREATED);
    let first_create_json = response_json(first_create).await;
    let todo_id = first_create_json["todo"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let replay_create = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/agent-message-todos",
            "todo-replay-create",
            json!({
                "agentId": "agent_coda",
                "channelId": "all",
                "messageId": second.id,
                "note": "should not be applied"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(replay_create.status(), StatusCode::CREATED);
    assert_eq!(response_json(replay_create).await, first_create_json);

    let listed_after_create_replay = app
        .clone()
        .oneshot(authed_empty_request(
            &token,
            "/v1/agent-message-todos?agentId=agent_coda&channelId=all",
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(listed_after_create_replay).await["todos"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let first_update = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "PATCH",
            format!("/v1/agent-message-todos/{todo_id}"),
            "todo-replay-update",
            json!({
                "status": "done",
                "note": "done once"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(first_update.status(), StatusCode::OK);
    let first_update_json = response_json(first_update).await;

    let replay_update = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "PATCH",
            format!("/v1/agent-message-todos/{todo_id}"),
            "todo-replay-update",
            json!({
                "status": "pending",
                "note": "should not reopen"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(replay_update.status(), StatusCode::OK);
    assert_eq!(response_json(replay_update).await, first_update_json);

    let first_delete = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "DELETE",
            format!("/v1/agent-message-todos/{todo_id}"),
            "todo-replay-delete",
            json!({}),
        ))
        .await
        .unwrap();
    assert_eq!(first_delete.status(), StatusCode::OK);
    let first_delete_json = response_json(first_delete).await;

    let replay_delete = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "DELETE",
            format!("/v1/agent-message-todos/{todo_id}"),
            "todo-replay-delete",
            json!({}),
        ))
        .await
        .unwrap();
    assert_eq!(replay_delete.status(), StatusCode::OK);
    assert_eq!(response_json(replay_delete).await, first_delete_json);

    for (key, message_id) in [
        ("todo-replay-clear-create-second", second.id.as_str()),
        ("todo-replay-clear-create-third", third.id.as_str()),
    ] {
        let response = app
            .clone()
            .oneshot(authed_json_request_with_idempotency(
                &token,
                "POST",
                "/v1/agent-message-todos",
                key,
                json!({
                    "agentId": "agent_coda",
                    "channelId": "all",
                    "messageId": message_id
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    let first_clear = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/agent-message-todos/clear",
            "todo-replay-clear",
            json!({
                "agentId": "agent_coda",
                "channelId": "all",
                "status": "pending",
                "note": "clear once"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(first_clear.status(), StatusCode::OK);
    let first_clear_json = response_json(first_clear).await;
    assert_eq!(first_clear_json["todos"].as_array().unwrap().len(), 2);

    let replay_clear = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/agent-message-todos/clear",
            "todo-replay-clear",
            json!({
                "agentId": "agent_coda",
                "channelId": "all",
                "status": "pending",
                "note": "should not matter"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(replay_clear.status(), StatusCode::OK);
    assert_eq!(response_json(replay_clear).await, first_clear_json);
}

#[tokio::test]
async fn agent_message_todo_api_rejects_running_status_and_unprocessable_messages() {
    let token = AuthToken::from_static("test-token");
    let root = std::env::temp_dir().join(format!(
        "slei-agent-message-todo-api-unprocessable-{}",
        Uuid::new_v4()
    ));
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;
    let message = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "有效待办",
            "todo-running-message",
            false,
        )
        .await
        .unwrap();
    let task_card = state
        .messages()
        .create_task_card_message("all", "task_123", &message.id)
        .await
        .unwrap();
    let tombstone = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "墓碑消息",
            "todo-tombstone-message",
            false,
        )
        .await
        .unwrap();
    state
        .messages()
        .delete_human_message(&tombstone.id)
        .await
        .unwrap();
    let task = state
        .tasks()
        .create_task_root(
            "all",
            "human_lei",
            "todo rejects task root",
            "todo-task-root",
        )
        .await
        .unwrap();
    let reply = state
        .tasks()
        .add_reply(
            &task.id,
            "agent_coda",
            "todo rejects task reply",
            "todo-task-reply",
        )
        .await
        .unwrap();
    let legacy_control = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "task_card:{\"taskId\":\"task_legacy\"}",
            "todo-legacy-control",
            false,
        )
        .await
        .unwrap();
    let deleted_message = state
        .messages()
        .create_human_channel_message("all", "human_lei", "已删除", "todo-deleted-message", false)
        .await
        .unwrap();
    let db_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let db = SleiDb::connect(&db_url).await.unwrap();
    sqlx::query("UPDATE messages SET deleted = 1 WHERE id = ?")
        .bind(&deleted_message.id)
        .execute(db.pool())
        .await
        .unwrap();
    let app = build_router(state);

    let created = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "POST",
            "/v1/agent-message-todos",
            "todo-running-create",
            json!({
                "agentId": "agent_coda",
                "channelId": "all",
                "messageId": message.id
            }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let todo_id = response_json(created).await["todo"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let running = app
        .clone()
        .oneshot(authed_json_request_with_idempotency(
            &token,
            "PATCH",
            format!("/v1/agent-message-todos/{todo_id}"),
            "todo-running-update",
            json!({ "status": "running" }),
        ))
        .await
        .unwrap();
    assert_eq!(running.status(), StatusCode::BAD_REQUEST);
    assert!(response_json(running).await["error"]
        .as_str()
        .unwrap()
        .contains("running"));

    let task_root_message_id = format!("task_root_msg_{}", task.id);
    let task_reply_message_id = format!("task_reply_msg_{}", reply.id);
    for (key, message_id) in [
        ("todo-task-card-reject", task_card.id.as_str()),
        ("todo-tombstone-reject", tombstone.id.as_str()),
        ("todo-task-root-reject", task_root_message_id.as_str()),
        ("todo-task-reply-reject", task_reply_message_id.as_str()),
        ("todo-legacy-control-reject", legacy_control.id.as_str()),
        ("todo-deleted-message-reject", deleted_message.id.as_str()),
    ] {
        let response = app
            .clone()
            .oneshot(authed_json_request_with_idempotency(
                &token,
                "POST",
                "/v1/agent-message-todos",
                key,
                json!({
                    "agentId": "agent_coda",
                    "channelId": "all",
                    "messageId": message_id
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}

async fn app_state_with_agent_handle(agent_id: &str, handle: &str) -> AppState {
    let root = std::env::temp_dir().join(format!("slei-broadcast-api-{}", Uuid::new_v4()));
    app_state_with_agent_handle_at_root(agent_id, handle, root).await
}

async fn app_state_with_agent_handle_at_root(
    agent_id: &str,
    handle: &str,
    root: std::path::PathBuf,
) -> AppState {
    std::fs::create_dir_all(root.join("agents")).unwrap();
    let workspace_path = root.join("agents").join(agent_id);
    std::fs::create_dir_all(workspace_path.join("docs")).unwrap();
    std::fs::write(
        workspace_path.join("MEMORY.md"),
        format!("# {agent_id}\n\n## Active Context\n"),
    )
    .unwrap();
    let agents = vec![ProductAgentRecord {
        id: agent_id.to_string(),
        name: agent_id.trim_start_matches("agent_").to_string(),
        handle: handle.to_string(),
        agent_kind: "agent".to_string(),
        system_owned: false,
        runtime_kind: "ClaudeCode".to_string(),
        model: "Sonnet".to_string(),
        node_id: "local-node".to_string(),
        description: "工程协作 Agent".to_string(),
        workspace_path: workspace_path.to_string_lossy().to_string(),
        memory_path: workspace_path
            .join("MEMORY.md")
            .to_string_lossy()
            .to_string(),
        docs_path: workspace_path.join("docs").to_string_lossy().to_string(),
        avatar_seed: agent_id.trim_start_matches("agent_").to_string(),
        runtime_thread: RuntimeThreadRecord {
            runtime_kind: "ClaudeCode".to_string(),
            status: "ready".to_string(),
            created_at: "0".to_string(),
        },
        channel_ids: vec!["all".to_string()],
        created_at: "0".to_string(),
        updated_at: "0".to_string(),
    }];
    std::fs::write(
        root.join("agents/index.json"),
        serde_json::to_string_pretty(&agents).unwrap(),
    )
    .unwrap();
    AppState::for_tests_with_agent_root_async(AuthToken::from_static("test-token"), root).await
}
