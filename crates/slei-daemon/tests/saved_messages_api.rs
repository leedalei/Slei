use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::member_service::ProductAgentDraft;
use slei_daemon::state::AppState;
use tower::ServiceExt;

#[tokio::test]
async fn saved_message_api_persists_and_enriches_channel_and_dm_messages() {
    let token = AuthToken::from_static("test-token");
    let root =
        std::env::temp_dir().join(format!("slei-saved-message-api-{}", uuid::Uuid::new_v4()));
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let coda = state
        .members()
        .create_product_agent(
            ProductAgentDraft {
                name: "Coda".to_string(),
                handle: "@coda".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "研发工程师".to_string(),
                avatar_seed: None,
            },
            "create-coda",
        )
        .await
        .unwrap();
    let channel_message = state
        .messages()
        .create_human_channel_message(
            "all",
            &coda.id,
            "频道里的关键结论",
            "saved-channel-source",
            false,
        )
        .await
        .unwrap();
    let (conversation, _) = state.conversations().create_dm(&coda.id).await.unwrap();
    let dm_message = state
        .conversations()
        .append_message(
            &conversation.id,
            &coda.id,
            "私聊里的关键结论",
            Some("saved-dm-source"),
        )
        .await
        .unwrap();
    let app = build_router(state);

    let saved_channel = post_json(
        &app,
        &token,
        "/v1/saved-messages",
        json!({
            "messageId": channel_message.id,
            "sourceId": "all",
            "sourceKind": "channel",
            "sessionId": channel_message.session_id
        }),
    )
    .await;
    assert_eq!(saved_channel.status(), StatusCode::CREATED);
    let saved_channel_body = response_json(saved_channel).await;
    assert_eq!(
        saved_channel_body["savedMessage"]["body"],
        "频道里的关键结论"
    );
    assert_eq!(saved_channel_body["savedMessage"]["authorName"], "Coda");
    assert_eq!(saved_channel_body["savedMessage"]["sourceName"], "all");
    assert_eq!(
        saved_channel_body["savedMessage"]["sourceLabel"],
        "群聊 · #all"
    );
    assert!(
        saved_channel_body["savedMessage"]["messageCreatedAt"]
            .as_str()
            .unwrap()
            .len()
            > 4
    );

    let duplicate = post_json(
        &app,
        &token,
        "/v1/saved-messages",
        json!({
            "messageId": channel_message.id,
            "sourceId": "all",
            "sourceKind": "channel"
        }),
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::OK);
    assert_eq!(
        response_json(duplicate).await["savedMessage"]["id"],
        saved_channel_body["savedMessage"]["id"]
    );

    let saved_dm = post_json(
        &app,
        &token,
        "/v1/saved-messages",
        json!({
            "messageId": dm_message.id,
            "sourceId": conversation.id,
            "sourceKind": "dm",
            "sessionId": dm_message.session_id
        }),
    )
    .await;
    assert_eq!(saved_dm.status(), StatusCode::CREATED);
    let saved_dm_body = response_json(saved_dm).await;
    assert_eq!(saved_dm_body["savedMessage"]["body"], "私聊里的关键结论");
    assert_eq!(saved_dm_body["savedMessage"]["authorName"], "Coda");
    assert_eq!(saved_dm_body["savedMessage"]["sourceName"], "Coda");
    assert_eq!(saved_dm_body["savedMessage"]["sourceLabel"], "私聊 · Coda");

    let listed = get_json(&app, &token, "/v1/saved-messages").await;
    assert_eq!(listed.status(), StatusCode::OK);
    let listed_body = response_json(listed).await;
    let saved_messages = listed_body["savedMessages"].as_array().unwrap();
    assert_eq!(saved_messages.len(), 2);
    assert_eq!(saved_messages[0]["messageId"], dm_message.id);
    assert_eq!(saved_messages[1]["messageId"], channel_message.id);

    let reloaded = build_router(AppState::for_tests_with_agent_root(token.clone(), root));
    let reloaded_list = get_json(&reloaded, &token, "/v1/saved-messages").await;
    assert_eq!(reloaded_list.status(), StatusCode::OK);
    assert_eq!(
        response_json(reloaded_list).await["savedMessages"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let deleted = delete_json(
        &reloaded,
        &token,
        &format!("/v1/saved-messages/{}", channel_message.id),
    )
    .await;
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let after_delete = response_json(get_json(&reloaded, &token, "/v1/saved-messages").await).await;
    assert_eq!(after_delete["savedMessages"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn saved_message_api_lists_missing_or_deleted_messages_as_unavailable() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let message = state
        .messages()
        .create_human_channel_message(
            "all",
            "human:local",
            "删除前内容不应展示",
            "saved-deleted-source",
            false,
        )
        .await
        .unwrap();
    let app = build_router(state.clone());

    let saved_deleted = post_json(
        &app,
        &token,
        "/v1/saved-messages",
        json!({
            "messageId": message.id,
            "sourceId": "all",
            "sourceKind": "channel"
        }),
    )
    .await;
    assert_eq!(saved_deleted.status(), StatusCode::CREATED);
    state
        .messages()
        .delete_human_message(&message.id)
        .await
        .unwrap();

    let saved_missing = post_json(
        &app,
        &token,
        "/v1/saved-messages",
        json!({
            "messageId": "msg_missing_saved",
            "sourceId": "all",
            "sourceKind": "channel"
        }),
    )
    .await;
    assert_eq!(saved_missing.status(), StatusCode::CREATED);

    let listed = get_json(&app, &token, "/v1/saved-messages").await;
    assert_eq!(listed.status(), StatusCode::OK);
    let body = response_json(listed).await;
    let saved_messages = body["savedMessages"].as_array().unwrap();
    assert_eq!(saved_messages.len(), 2);
    assert_eq!(saved_messages[0]["messageId"], "msg_missing_saved");
    assert_eq!(saved_messages[0]["body"], "");
    assert_eq!(saved_messages[0]["messageDeleted"], true);
    assert_eq!(saved_messages[1]["messageId"], message.id);
    assert_eq!(saved_messages[1]["body"], "");
    assert_eq!(saved_messages[1]["messageDeleted"], true);
}

fn authed_request(
    token: &AuthToken,
    method: &str,
    uri: impl AsRef<str>,
    body: Body,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri.as_ref())
        .header("authorization", token.authorization_header())
        .header("content-type", "application/json")
        .body(body)
        .unwrap()
}

async fn get_json(app: &axum::Router, token: &AuthToken, uri: &str) -> axum::response::Response {
    app.clone()
        .oneshot(authed_request(token, "GET", uri, Body::empty()))
        .await
        .unwrap()
}

async fn post_json(
    app: &axum::Router,
    token: &AuthToken,
    uri: &str,
    body: Value,
) -> axum::response::Response {
    app.clone()
        .oneshot(authed_request(
            token,
            "POST",
            uri,
            Body::from(body.to_string()),
        ))
        .await
        .unwrap()
}

async fn delete_json(app: &axum::Router, token: &AuthToken, uri: &str) -> axum::response::Response {
    app.clone()
        .oneshot(authed_request(token, "DELETE", uri, Body::empty()))
        .await
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    if body.is_empty() {
        return Value::Null;
    }
    serde_json::from_slice(&body).unwrap()
}
