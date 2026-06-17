use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::channel_service::ChannelMemberReadiness;
use slei_daemon::services::member_service::ProductAgentDraft;
use slei_daemon::state::AppState;
use tower::ServiceExt;

fn authed_json_request(
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
async fn create_thread_from_channel_message_is_idempotent_and_not_a_task() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human:local",
            "可以开一个普通子线程吗",
            "thread-channel-source",
            false,
        )
        .await
        .unwrap();
    let app = build_router(state);

    let first = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "thread-channel-create:first",
            json!({
                "sourceMessageId": source.id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::CREATED);
    let first_json = response_json(first).await;

    let second = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "thread-channel-create:second",
            json!({
                "sourceMessageId": source.id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::OK);
    let second_json = response_json(second).await;

    assert_eq!(first_json["thread"]["id"], second_json["thread"]["id"]);
    assert_eq!(first_json["thread"]["sourceKind"], "channel");
    assert_eq!(first_json["thread"]["sourceId"], "all");
    assert_eq!(first_json["thread"]["replyCount"], 0);

    let tasks = app
        .oneshot(authed_empty_request(&token, "/v1/tasks?channelId=all"))
        .await
        .unwrap();
    assert_eq!(tasks.status(), StatusCode::OK);
    let tasks_json = response_json(tasks).await;
    assert!(tasks_json["tasks"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn create_thread_from_dm_message_is_idempotent_and_not_a_task() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let (conversation, _) = state.conversations().create_dm("agent_coda").await.unwrap();
    let source = state
        .conversations()
        .append_message(
            &conversation.id,
            "human:local",
            "私聊里也可以开普通子线程",
            Some("thread-dm-source"),
        )
        .await
        .unwrap();
    let app = build_router(state);

    let first = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "thread-dm-create:first",
            json!({
                "sourceMessageId": source.id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::CREATED);
    let first_json = response_json(first).await;

    let second = app
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "thread-dm-create:second",
            json!({
                "sourceMessageId": source.id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::OK);
    let second_json = response_json(second).await;

    assert_eq!(first_json["thread"]["id"], second_json["thread"]["id"]);
    assert_eq!(first_json["thread"]["sourceKind"], "dm");
    assert_eq!(first_json["thread"]["sourceId"], conversation.id);
}

#[tokio::test]
async fn cannot_create_nested_thread_from_thread_reply() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human:local",
            "先开一个 thread",
            "thread-nested-source",
            false,
        )
        .await
        .unwrap();
    let app = build_router(state);
    let created = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "thread-nested-create",
            json!({
                "sourceMessageId": source.id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();
    let created_json = response_json(created).await;
    let thread_id = created_json["thread"]["id"].as_str().unwrap();

    let reply = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            format!("/v1/message-threads/{thread_id}/replies"),
            "thread-nested-reply",
            json!({
                "senderId": "human:local",
                "role": "human",
                "body": "这个回复不能再开二级 thread"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(reply.status(), StatusCode::CREATED);
    let reply_json = response_json(reply).await;
    let reply_id = reply_json["reply"]["id"].as_str().unwrap();

    let nested = app
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "thread-nested-forbidden",
            json!({
                "sourceMessageId": reply_id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();

    assert_eq!(nested.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn thread_reply_updates_reply_count_and_preserves_role() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human:local",
            "检查 reply count",
            "thread-reply-source",
            false,
        )
        .await
        .unwrap();
    let app = build_router(state);
    let created = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "thread-reply-create",
            json!({
                "sourceMessageId": source.id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();
    let created_json = response_json(created).await;
    let thread_id = created_json["thread"]["id"].as_str().unwrap();

    let reply = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            format!("/v1/message-threads/{thread_id}/replies"),
            "thread-reply-add",
            json!({
                "senderId": "agent_coda",
                "role": "agent",
                "body": "收到，我会看"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(reply.status(), StatusCode::CREATED);
    let reply_json = response_json(reply).await;
    assert_eq!(reply_json["reply"]["role"], "agent");
    assert_eq!(reply_json["reply"]["senderId"], "agent_coda");

    let fetched = app
        .oneshot(authed_empty_request(
            &token,
            format!("/v1/message-threads/{thread_id}"),
        ))
        .await
        .unwrap();
    assert_eq!(fetched.status(), StatusCode::OK);
    let fetched_json = response_json(fetched).await;
    assert_eq!(fetched_json["thread"]["replyCount"], 1);
    assert_eq!(fetched_json["replies"][0]["role"], "agent");
    assert_eq!(fetched_json["replies"][0]["body"], "收到，我会看");
}

#[tokio::test]
async fn channel_message_list_defaults_to_latest_fifty_and_pages_thirty_before_cursor() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    for index in 1..=55 {
        state
            .messages()
            .create_human_channel_message(
                "all",
                "human:local",
                &format!("channel message {index:02}"),
                &format!("thread-page-channel-{index:02}"),
                false,
            )
            .await
            .unwrap();
    }
    let app = build_router(state);

    let latest = app
        .clone()
        .oneshot(authed_empty_request(&token, "/v1/channels/all/messages"))
        .await
        .unwrap();
    assert_eq!(latest.status(), StatusCode::OK);
    let latest_json = response_json(latest).await;
    let latest_messages = latest_json["messages"].as_array().unwrap();
    assert_eq!(latest_messages.len(), 50);
    assert_eq!(latest_messages[0]["body"], "channel message 06");
    assert_eq!(latest_messages[49]["body"], "channel message 55");
    assert_eq!(latest_json["pageInfo"]["hasMoreBefore"], true);
    let oldest_cursor = latest_json["pageInfo"]["oldestCursor"].as_i64().unwrap();

    let older = app
        .oneshot(authed_empty_request(
            &token,
            format!("/v1/channels/all/messages?before={oldest_cursor}"),
        ))
        .await
        .unwrap();
    assert_eq!(older.status(), StatusCode::OK);
    let older_json = response_json(older).await;
    let older_messages = older_json["messages"].as_array().unwrap();
    assert_eq!(older_messages.len(), 5);
    assert_eq!(older_messages[0]["body"], "channel message 01");
    assert_eq!(older_messages[4]["body"], "channel message 05");
    assert_eq!(older_json["pageInfo"]["hasMoreBefore"], false);
}

#[tokio::test]
async fn conversation_message_list_defaults_to_latest_fifty_and_pages_thirty_before_cursor() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let (conversation, _) = state.conversations().create_dm("agent_coda").await.unwrap();
    for index in 1..=55 {
        state
            .conversations()
            .append_message(
                &conversation.id,
                "human:local",
                &format!("dm message {index:02}"),
                Some(&format!("thread-page-dm-{index:02}")),
            )
            .await
            .unwrap();
    }
    let app = build_router(state);

    let latest = app
        .clone()
        .oneshot(authed_empty_request(
            &token,
            format!("/v1/conversations/{}/messages", conversation.id),
        ))
        .await
        .unwrap();
    assert_eq!(latest.status(), StatusCode::OK);
    let latest_json = response_json(latest).await;
    let latest_messages = latest_json["messages"].as_array().unwrap();
    assert_eq!(latest_messages.len(), 50);
    assert_eq!(latest_messages[0]["body"], "dm message 06");
    assert_eq!(latest_messages[49]["body"], "dm message 55");
    assert_eq!(latest_json["pageInfo"]["hasMoreBefore"], true);
    let oldest_cursor = latest_json["pageInfo"]["oldestCursor"].as_i64().unwrap();

    let older = app
        .oneshot(authed_empty_request(
            &token,
            format!(
                "/v1/conversations/{}/messages?before={oldest_cursor}",
                conversation.id
            ),
        ))
        .await
        .unwrap();
    assert_eq!(older.status(), StatusCode::OK);
    let older_json = response_json(older).await;
    let older_messages = older_json["messages"].as_array().unwrap();
    assert_eq!(older_messages.len(), 5);
    assert_eq!(older_messages[0]["body"], "dm message 01");
    assert_eq!(older_messages[4]["body"], "dm message 05");
    assert_eq!(older_json["pageInfo"]["hasMoreBefore"], false);
}

#[tokio::test]
async fn message_list_around_message_id_returns_target_window_with_summaries() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let mut target_id = String::new();
    for index in 1..=20 {
        let message = state
            .messages()
            .create_human_channel_message(
                "all",
                "human:local",
                &format!("summary message {index:02}"),
                &format!("thread-page-summary-{index:02}"),
                false,
            )
            .await
            .unwrap();
        if index == 10 {
            target_id = message.id;
        }
    }
    let app = build_router(state);

    let thread = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "thread-page-summary-open",
            json!({
                "sourceMessageId": target_id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(thread.status(), StatusCode::CREATED);
    let task = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/tasks/from-source-message",
            "thread-page-summary-task",
            json!({
                "sourceMessageId": target_id,
                "creatorId": "human:local"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(task.status(), StatusCode::CREATED);

    let response = app
        .oneshot(authed_empty_request(
            &token,
            format!("/v1/channels/all/messages?aroundMessageId={target_id}&limit=7"),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let messages = body["messages"].as_array().unwrap();
    let target = messages
        .iter()
        .find(|message| message["id"] == target_id)
        .unwrap();

    assert_eq!(messages.len(), 7);
    assert_eq!(target["thread"]["sourceMessageId"], target_id);
    assert_eq!(target["task"]["sourceMessageId"], target_id);
    assert_eq!(target["task"]["threadId"], target["thread"]["id"]);
    assert!(target["sequence"].as_i64().is_some());
}

#[tokio::test]
async fn task_created_from_source_message_ensures_thread_and_returns_thread_summary() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human:local",
            "手动转为任务需要进入 TASK",
            "task-thread-source",
            false,
        )
        .await
        .unwrap();
    let app = build_router(state);

    let task = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/tasks/from-source-message",
            "task-thread-create",
            json!({
                "sourceMessageId": source.id,
                "creatorId": "human:local"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(task.status(), StatusCode::CREATED);
    let task_json = response_json(task).await;
    let thread_id = task_json["task"]["threadId"].as_str().unwrap();

    let messages = app
        .oneshot(authed_empty_request(
            &token,
            format!("/v1/channels/all/messages?aroundMessageId={}", source.id),
        ))
        .await
        .unwrap();
    assert_eq!(messages.status(), StatusCode::OK);
    let messages_json = response_json(messages).await;
    let source_message = messages_json["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["id"] == source.id)
        .unwrap();

    assert_eq!(source_message["thread"]["id"], thread_id);
    assert_eq!(source_message["task"]["threadId"], thread_id);
}

#[tokio::test]
async fn normal_thread_then_task_reuses_same_thread() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human:local",
            "先普通 thread 后任务",
            "normal-then-task-source",
            false,
        )
        .await
        .unwrap();
    let app = build_router(state);

    let thread = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "normal-then-task-thread",
            json!({
                "sourceMessageId": source.id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();
    let thread_json = response_json(thread).await;
    let thread_id = thread_json["thread"]["id"].as_str().unwrap();

    let task = app
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/tasks/from-source-message",
            "normal-then-task-create",
            json!({
                "sourceMessageId": source.id,
                "creatorId": "human:local"
            }),
        ))
        .await
        .unwrap();
    let task_json = response_json(task).await;

    assert_eq!(task_json["task"]["threadId"], thread_id);
}

#[tokio::test]
async fn task_then_normal_thread_open_reuses_task_thread_without_duplicate() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human:local",
            "先任务后普通打开 thread",
            "task-then-normal-source",
            false,
        )
        .await
        .unwrap();
    let app = build_router(state);

    let task = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/tasks/from-source-message",
            "task-then-normal-create",
            json!({
                "sourceMessageId": source.id,
                "creatorId": "human:local"
            }),
        ))
        .await
        .unwrap();
    let task_json = response_json(task).await;
    let task_thread_id = task_json["task"]["threadId"].as_str().unwrap();

    let thread = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "task-then-normal-thread",
            json!({
                "sourceMessageId": source.id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();
    let thread_json = response_json(thread).await;

    let tasks = app
        .oneshot(authed_empty_request(&token, "/v1/tasks?channelId=all"))
        .await
        .unwrap();
    let tasks_json = response_json(tasks).await;

    assert_eq!(thread_json["thread"]["id"], task_thread_id);
    assert_eq!(tasks_json["tasks"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn thread_reply_with_visible_mention_launches_agent_without_main_timeline_message() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let agent = state
        .members()
        .create_product_agent(
            ProductAgentDraft {
                name: "Coda".to_string(),
                handle: "@coda".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "coding agent".to_string(),
            },
            "thread-reply-agent",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("all", &agent.id)
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("all", &agent.id, ChannelMemberReadiness::Ready)
        .await
        .unwrap();
    let source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human:local",
            "这个消息有子线程",
            "thread-route-source",
            false,
        )
        .await
        .unwrap();
    let app = build_router(state.clone());

    let thread = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            "/v1/message-threads/from-source-message",
            "thread-route-open",
            json!({
                "sourceMessageId": source.id,
                "createdBy": "human:local"
            }),
        ))
        .await
        .unwrap();
    let thread_json = response_json(thread).await;
    let thread_id = thread_json["thread"]["id"].as_str().unwrap();

    let reply = app
        .clone()
        .oneshot(authed_json_request(
            &token,
            "POST",
            format!("/v1/message-threads/{thread_id}/replies"),
            "thread-route-reply",
            json!({
                "senderId": "human:local",
                "role": "human",
                "body": "@coda please check this thread"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(reply.status(), StatusCode::CREATED);
    let reply_json = response_json(reply).await;
    let reply_id = reply_json["reply"]["id"].as_str().unwrap();

    let messages = app
        .oneshot(authed_empty_request(&token, "/v1/channels/all/messages"))
        .await
        .unwrap();
    let messages_json = response_json(messages).await;
    assert!(messages_json["messages"]
        .as_array()
        .unwrap()
        .iter()
        .all(|message| message["body"] != "@coda please check this thread"));
    assert!(state.worker_commands().iter().any(|command| {
        command["session"]["agent_id"] == agent.id
            && command["input"]["prompt"]
                .as_str()
                .is_some_and(|prompt| prompt.contains("@coda please check this thread"))
    }));
    let deliveries = state
        .claims()
        .message_deliveries_for_message(reply_id)
        .await
        .unwrap();
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].agent_id, agent.id);
    assert_eq!(deliveries[0].delivery_state, "running");
    assert!(deliveries[0].run_id.is_some());
}
