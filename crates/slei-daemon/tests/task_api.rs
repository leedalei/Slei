use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::channel_service::{
    ChannelDraft, ChannelMemberReadiness, PermissionPreset,
};
use slei_daemon::services::member_service::{ProductAgentRecord, RuntimeThreadRecord};
use slei_daemon::state::AppState;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn task_api_lists_tasks_and_updates_status() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/tasks")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "task-list-create")
                .body(Body::from(
                    json!({
                        "channelId": "all",
                        "creatorId": "human:local",
                        "title": "实现任务分支"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = to_bytes(created.into_body(), usize::MAX).await.unwrap();
    let task_id = serde_json::from_slice::<Value>(&body).unwrap()["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let listed = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/tasks?channelId=all")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = to_bytes(listed.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["tasks"][0]["id"], task_id);
    assert_eq!(json["tasks"][0]["status"], "pending_assignment");

    let updated = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/v1/tasks/{task_id}/status"))
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "status": "done" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
}

#[tokio::test]
async fn task_api_creates_roots_and_appends_thread_replies() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state.channels().list_channels().await;
    let app = build_router(state);

    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/tasks")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "task-api-create")
                .body(Body::from(
                    json!({
                        "channelId": "all",
                        "creatorId": "human:local",
                        "title": "把任务 Thread 做完"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(created.status(), StatusCode::CREATED);
    let body = to_bytes(created.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let task_id = json["task"]["id"].as_str().unwrap();
    assert_eq!(json["task"]["status"], "pending_assignment");
    assert_eq!(json["task"]["title"], "把任务 Thread 做完");

    let reply = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/tasks/{task_id}/replies"))
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "task-api-reply")
                .body(Body::from(
                    json!({
                        "senderId": "agent:coda",
                        "body": "我会继续在这个任务 session 里处理"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(reply.status(), StatusCode::CREATED);
    let body = to_bytes(reply.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["reply"]["taskId"], task_id);
    assert!(json["reply"]["createdAt"].as_str().is_some());

    let thread = app
        .oneshot(
            Request::builder()
                .uri(format!("/v1/tasks/{task_id}/thread"))
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(thread.status(), StatusCode::OK);
    let body = to_bytes(thread.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["thread"]["task"]["id"], task_id);
    assert_eq!(json["thread"]["task"]["replyCount"], 1);
    assert_eq!(json["thread"]["root"]["role"], "human");
    assert_eq!(json["thread"]["root"]["body"], "把任务 Thread 做完");
    assert_eq!(
        json["thread"]["replies"][0]["body"],
        "我会继续在这个任务 session 里处理"
    );
}

#[tokio::test]
async fn task_api_requires_idempotency_key_for_mutations() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state.channels().list_channels().await;
    let app = build_router(state);

    let missing_create_key = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/tasks")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "channelId": "all",
                        "creatorId": "human:local",
                        "title": "missing key"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_create_key.status(), StatusCode::BAD_REQUEST);

    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/tasks")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "task-api-required-create")
                .body(Body::from(
                    json!({
                        "channelId": "all",
                        "creatorId": "human:local",
                        "title": "has key"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = to_bytes(created.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let task_id = json["task"]["id"].as_str().unwrap();

    let missing_reply_key = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/tasks/{task_id}/replies"))
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "senderId": "human:local",
                        "body": "missing reply key"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_reply_key.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn task_reply_api_routes_mentions_through_orchestrator_once_per_idempotency_key() {
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
            "task-api-create-channel",
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
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/tasks")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "task-api-handoff-create")
                .body(Body::from(
                    json!({
                        "channelId": "api-dev",
                        "creatorId": "human_lei",
                        "title": "实现任务接力"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = to_bytes(created.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let task_id = json["task"]["id"].as_str().unwrap();

    for body in [
        "架构方案完成。@coda-win 请接手。",
        "重试正文不应该产生新 handoff。@coda-win",
    ] {
        let reply = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/v1/tasks/{task_id}/replies"))
                    .header("authorization", token.authorization_header())
                    .header("content-type", "application/json")
                    .header("idempotency-key", "task-api-handoff-reply")
                    .body(Body::from(
                        json!({
                            "senderId": "human_lei",
                            "body": body
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(reply.status(), StatusCode::CREATED);
        let body = to_bytes(reply.into_body(), usize::MAX).await.unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["route"]["handoffAgentIds"][0], "agent_coda");
    }

    let handoffs = state
        .agent_inbox()
        .events_for_agent("agent_coda")
        .await
        .into_iter()
        .filter(|event| event.event_type == "task_handoff")
        .collect::<Vec<_>>();
    assert_eq!(handoffs.len(), 1);
    assert_eq!(handoffs[0].task_id.as_deref(), Some(task_id));
    assert_eq!(handoffs[0].sender_id.as_deref(), Some("human_lei"));
    assert_eq!(
        handoffs[0].handoff_text.as_deref(),
        Some("架构方案完成。@coda-win 请接手。")
    );
}

async fn app_state_with_agent_handle(agent_id: &str, handle: &str) -> AppState {
    let root = std::env::temp_dir().join(format!("slei-task-api-{}", Uuid::new_v4()));
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
