use std::fs;
use std::path::PathBuf;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn global_search_rejects_empty_query() {
    let token = AuthToken::from_static("search-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let response = get_json(&app, &token, "/v1/search/global?query=%20").await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn global_search_returns_agents_channels_and_messages() {
    let token = AuthToken::from_static("search-token");
    let root = make_temp_dir("global-search-all");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state);

    let coda_id = create_agent(&app, &token, "Coda", "@coda", "needle runtime engineer").await;
    let channel_id = create_channel(
        &app,
        &token,
        "dev-team",
        Some("needle engineering channel"),
        "create-dev-team",
    )
    .await;
    let channel_message_id = send_channel_message(
        &app,
        &token,
        &channel_id,
        &coda_id,
        "channel body with needle inside",
        "send-channel-needle",
    )
    .await;
    let conversation_id = create_dm(&app, &token, &coda_id, "dm-coda").await;
    let dm_message_id = send_dm_message(
        &app,
        &token,
        &conversation_id,
        &coda_id,
        "dm body with needle inside",
        "send-dm-needle",
    )
    .await;

    let response = get_json(&app, &token, "/v1/search/global?query=needle").await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["query"], "needle");
    assert_eq!(body["agents"][0]["agentId"], coda_id);
    assert_eq!(body["channels"][0]["channelId"], channel_id);
    let messages = body["messages"].as_array().unwrap();
    assert!(messages.iter().any(|message| {
        message["sourceKind"] == "channel"
            && message["messageId"] == channel_message_id
            && message["channelId"] == channel_id
    }));
    assert!(messages.iter().any(|message| {
        message["sourceKind"] == "dm"
            && message["messageId"] == dm_message_id
            && message["conversationId"] == conversation_id
    }));
}

#[tokio::test]
async fn global_search_channel_filter_excludes_dm_messages() {
    let token = AuthToken::from_static("search-token");
    let root = make_temp_dir("global-search-channel-filter");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state);

    let coda_id = create_agent(&app, &token, "Coda", "@coda", "runtime engineer").await;
    let dev_channel = create_channel(&app, &token, "dev-team", None, "create-dev-filter").await;
    let ops_channel = create_channel(&app, &token, "ops-team", None, "create-ops-filter").await;
    let expected_message_id = send_channel_message(
        &app,
        &token,
        &dev_channel,
        &coda_id,
        "needle in dev team",
        "send-dev-filter",
    )
    .await;
    send_channel_message(
        &app,
        &token,
        &ops_channel,
        &coda_id,
        "needle in ops team",
        "send-ops-filter",
    )
    .await;
    let conversation_id = create_dm(&app, &token, &coda_id, "dm-filter").await;
    send_dm_message(
        &app,
        &token,
        &conversation_id,
        &coda_id,
        "needle in dm",
        "send-dm-filter",
    )
    .await;

    let response = get_json(
        &app,
        &token,
        "/v1/search/global?query=needle&channelId=dev-team",
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["sourceKind"], "channel");
    assert_eq!(messages[0]["channelId"], dev_channel);
    assert_eq!(messages[0]["messageId"], expected_message_id);
    assert!(messages[0]["conversationId"].is_null());
}

#[tokio::test]
async fn global_search_channel_message_result_includes_session_id_for_transition() {
    let token = AuthToken::from_static("search-token");
    let root = make_temp_dir("global-search-session");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state);

    let coda_id = create_agent(&app, &token, "Coda", "@coda", "runtime engineer").await;
    let channel_id = create_channel(&app, &token, "dev-team", None, "create-session-channel").await;
    let sessions =
        response_json(get_json(&app, &token, &format!("/v1/channels/{channel_id}/sessions")).await)
            .await;
    let session_id = sessions["sessions"][0]["id"].as_str().unwrap().to_string();
    let message_id = send_channel_message(
        &app,
        &token,
        &channel_id,
        &coda_id,
        "needle in active session",
        "send-session-channel",
    )
    .await;

    let response = get_json(&app, &token, "/v1/search/global?query=needle").await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let message = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["messageId"] == message_id)
        .expect("matching channel message should be returned");
    assert_eq!(message["sourceKind"], "channel");
    assert_eq!(message["sessionId"], session_id);
}

async fn create_agent(
    app: &axum::Router,
    token: &AuthToken,
    name: &str,
    handle: &str,
    description: &str,
) -> String {
    let response = post_json(
        app,
        token,
        "/v1/agents",
        Some(&format!("create-agent-{name}")),
        json!({
            "name": name,
            "handle": handle,
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": description,
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn create_channel(
    app: &axum::Router,
    token: &AuthToken,
    name: &str,
    description: Option<&str>,
    idempotency_key: &str,
) -> String {
    let response = post_json(
        app,
        token,
        "/v1/channels",
        Some(idempotency_key),
        json!({
            "name": name,
            "description": description,
            "agentIds": [],
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["channel"]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn create_dm(
    app: &axum::Router,
    token: &AuthToken,
    agent_id: &str,
    idempotency_key: &str,
) -> String {
    let response = post_json(
        app,
        token,
        "/v1/conversations/dm",
        Some(idempotency_key),
        json!({ "agentId": agent_id }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["conversation"]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn send_channel_message(
    app: &axum::Router,
    token: &AuthToken,
    channel_id: &str,
    author_id: &str,
    body: &str,
    idempotency_key: &str,
) -> String {
    let response = post_json(
        app,
        token,
        &format!("/v1/channels/{channel_id}/messages"),
        Some(idempotency_key),
        json!({ "authorId": author_id, "body": body }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    response_json(response).await["outcome"]["messageId"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn send_dm_message(
    app: &axum::Router,
    token: &AuthToken,
    conversation_id: &str,
    author_id: &str,
    body: &str,
    idempotency_key: &str,
) -> String {
    let response = post_json(
        app,
        token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some(idempotency_key),
        json!({ "authorId": author_id, "body": body }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["message"]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn get_json(app: &axum::Router, token: &AuthToken, uri: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri)
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn post_json(
    app: &axum::Router,
    token: &AuthToken,
    uri: &str,
    idempotency_key: Option<&str>,
    body: Value,
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
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn make_temp_dir(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("slei-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    path
}
