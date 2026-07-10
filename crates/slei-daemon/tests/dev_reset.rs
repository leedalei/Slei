use std::fs;
use std::sync::Mutex;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::channel_orchestrator_service::SendChannelMessageInput;
use slei_daemon::services::channel_service::{ChannelDraft, PermissionPreset};
use slei_daemon::services::member_service::ProductAgentDraft;
use slei_daemon::services::settings_service::{
    AppearancePreferences, LocalePreference, NotificationPreferences,
};
use slei_daemon::services::task_service::TaskQuery;
use slei_daemon::state::AppState;
use tokio::time::{timeout, Duration};
use tower::ServiceExt;
use uuid::Uuid;

static ENV_LOCK: Mutex<()> = Mutex::new(());

#[tokio::test]
async fn dev_reset_is_forbidden_without_env_guard() {
    let _env_guard = ENV_LOCK.lock().expect("lock reset env");
    std::env::remove_var("SLEI_ENABLE_DEV_RESET");

    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/dev/reset")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "dev_reset_disabled");

    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}

#[tokio::test]
async fn dev_reset_api_returns_conflict_when_reset_is_already_in_progress() {
    let _env_guard = ENV_LOCK.lock().expect("lock reset env");
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");

    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();

    let response = post_dev_reset(state, token).await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "reset_in_progress");
    reset_guard.finish().await;
    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}

#[tokio::test]
async fn dev_reset_clears_database_and_agent_workspace_when_enabled() {
    let _env_guard = ENV_LOCK.lock().expect("lock reset env");
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");

    let token = AuthToken::from_static("test-token");
    let data_root = temp_data_root();
    std::fs::create_dir_all(data_root.join("agents/agent_coda")).unwrap();
    std::fs::write(
        data_root.join("agents/agent_coda/MEMORY.md"),
        "remember this",
    )
    .unwrap();
    std::fs::create_dir_all(data_root.join("attachments")).unwrap();
    std::fs::write(data_root.join("attachments/index.json"), "{}").unwrap();

    let state = AppState::for_tests_with_agent_root_async(token.clone(), data_root.clone()).await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev",
        )
        .await
        .unwrap();
    state
        .orchestration()
        .record_diagnostic_event("test.before_reset", "{}")
        .await
        .unwrap();

    let response = post_dev_reset(state.clone(), token).await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["reset"]["databaseReset"], true);
    assert!(json["reset"]["removedPaths"]
        .as_array()
        .unwrap()
        .iter()
        .any(|path| path == "agents"));
    assert!(!data_root.join("agents/agent_coda/MEMORY.md").exists());
    assert!(!data_root.join("channels/index.json").exists());
    assert!(!data_root.join("attachments/index.json").exists());
    assert!(state
        .orchestration()
        .repos()
        .channels()
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        state
            .channels()
            .list_channels()
            .await
            .into_iter()
            .map(|channel| channel.id)
            .collect::<Vec<_>>(),
        vec!["all".to_string()]
    );

    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}

#[tokio::test]
async fn dev_reset_clears_live_in_memory_product_state() {
    let _env_guard = ENV_LOCK.lock().expect("lock reset env");
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");

    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-before-memory-reset",
        )
        .await
        .unwrap();
    state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "please route before reset".to_string(),
            attachment_ids: Vec::new(),
            idempotency_key: "message-before-memory-reset".to_string(),
            as_task: false,
        })
        .await
        .unwrap();
    let agent = state
        .members()
        .create_product_agent(
            ProductAgentDraft {
                name: "Coda".to_string(),
                handle: "@coda".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                profession: "智能体".to_string(),
                description: "dev agent".to_string(),
                avatar_seed: None,
            },
            "create-agent-before-memory-reset",
        )
        .await
        .unwrap();
    let (conversation, _) = state.conversations().create_dm(&agent.id).await.unwrap();
    state
        .conversations()
        .append_message(
            &conversation.id,
            "human:lei",
            "remember this before reset",
            Some("dm-before-memory-reset"),
        )
        .await
        .unwrap();
    state
        .tasks()
        .create_task_root(
            "dev",
            "human_lei",
            "task before reset",
            "task-before-memory-reset",
        )
        .await
        .unwrap();

    let response = post_dev_reset(state.clone(), token).await;
    assert_eq!(response.status(), StatusCode::OK);

    let channel_ids = state
        .channels()
        .list_channels()
        .await
        .into_iter()
        .map(|channel| channel.id)
        .collect::<Vec<_>>();
    assert_eq!(channel_ids, vec!["all".to_string()]);
    assert!(state.channel_messages_for_tests("dev").await.is_empty());
    assert!(state
        .messages()
        .channel_message_for_idempotency("message-before-memory-reset")
        .await
        .is_none());
    assert!(state.conversations().list_conversations().await.is_empty());
    assert!(state.members().list_product_agents().await.is_empty());
    assert!(state
        .tasks()
        .list_task_summaries(TaskQuery::default())
        .await
        .is_empty());

    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}

#[tokio::test]
async fn dev_reset_preserves_user_preferences_when_enabled() {
    let _env_guard = ENV_LOCK.lock().expect("lock reset env");
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");

    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    state
        .settings()
        .set_locale(LocalePreference::ZhCn)
        .await
        .unwrap();
    state
        .settings()
        .set_time_zone("Asia/Shanghai".to_string())
        .await
        .unwrap();
    state
        .settings()
        .set_appearance(AppearancePreferences {
            theme: "dark".to_string(),
            font_size: "lg".to_string(),
        })
        .await
        .unwrap();
    state
        .settings()
        .set_notifications(NotificationPreferences {
            mentions: false,
            human_replies: true,
            approvals: false,
        })
        .await
        .unwrap();

    let response = post_dev_reset(state.clone(), token).await;

    assert_eq!(response.status(), StatusCode::OK);
    let preferences = state.settings().preferences().await;
    assert_eq!(preferences.locale, LocalePreference::ZhCn);
    assert_eq!(preferences.time_zone, "Asia/Shanghai");
    assert_eq!(
        preferences.appearance,
        AppearancePreferences {
            theme: "dark".to_string(),
            font_size: "lg".to_string(),
        }
    );
    assert_eq!(
        preferences.notifications,
        NotificationPreferences {
            mentions: false,
            human_replies: true,
            approvals: false,
        }
    );

    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}

#[tokio::test]
async fn dev_reset_restores_live_local_node_state() {
    let _env_guard = ENV_LOCK.lock().expect("lock reset env");
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");

    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    state
        .nodes()
        .rename_local_node("Studio Node")
        .await
        .unwrap();

    let response = post_dev_reset(state.clone(), token).await;
    assert_eq!(response.status(), StatusCode::OK);

    let node = state.nodes().get_node("local-node").unwrap();
    assert_eq!(node.name, "本机设备");

    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}

#[tokio::test]
async fn dev_reset_in_progress_blocks_new_channel_runs() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token, temp_data_root()).await;
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();

    let result = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "please launch".to_string(),
            attachment_ids: Vec::new(),
            idempotency_key: "blocked-by-reset".to_string(),
            as_task: false,
        })
        .await;

    let error = result.unwrap_err().to_string();
    assert!(error.contains("reset in progress"));
    reset_guard.finish().await;
}

#[tokio::test]
async fn dev_reset_waits_for_in_flight_activity_and_ignores_new_worker_events() {
    let _env_guard = ENV_LOCK.lock().expect("lock reset env");
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");

    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    let activity_guard = state.reset().runtime().begin_launch().await.unwrap();

    let reset_task = tokio::spawn(post_dev_reset(state.clone(), token));
    tokio::time::sleep(Duration::from_millis(25)).await;
    assert!(
        !reset_task.is_finished(),
        "reset must wait for in-flight activity before clearing state"
    );

    drop(activity_guard);
    let response = reset_task.await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}

#[tokio::test]
async fn dev_reset_allows_concurrent_non_reset_activity_guards() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token, temp_data_root()).await;

    let first_guard = state.reset().runtime().begin_launch().await.unwrap();
    let second_guard = state.reset().runtime().begin_launch().await.unwrap();

    drop(second_guard);
    drop(first_guard);
}

#[tokio::test]
async fn dev_reset_in_progress_makes_channel_message_api_conflict() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-api-conflict",
        )
        .await
        .unwrap();
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();

    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/channels/dev/messages")
                .header("authorization", token.authorization_header())
                .header("idempotency-key", "channel-api-reset-conflict")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "authorId": "human_lei",
                        "body": "please route",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(state.channel_messages_for_tests("dev").await.is_empty());
    reset_guard.finish().await;
}

#[tokio::test]
async fn dev_reset_queued_behind_channel_send_guard_does_not_deadlock_inner_launch() {
    let _env_guard = ENV_LOCK.lock().expect("lock reset env");
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");

    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-nested-channel-guard",
        )
        .await
        .unwrap();
    let activity_guard = state.reset().runtime().begin_launch().await.unwrap();
    let reset_task = tokio::spawn(post_dev_reset(state.clone(), token));
    tokio::time::sleep(Duration::from_millis(25)).await;
    assert!(reset_task.is_finished() == false);

    let outcome = timeout(
        Duration::from_millis(500),
        state
            .channel_orchestrator()
            .send_channel_message_with_launch_guard(
                SendChannelMessageInput {
                    channel_id: "dev".to_string(),
                    author_id: "human_lei".to_string(),
                    body: "please route while reset is queued".to_string(),
                    attachment_ids: Vec::new(),
                    idempotency_key: "nested-channel-guard".to_string(),
                    as_task: false,
                },
                &activity_guard,
            ),
    )
    .await
    .expect("channel send should not deadlock behind its own outer reset guard")
    .unwrap();
    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.coordinator_run_id, None);

    drop(activity_guard);
    let response = reset_task.await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}

#[tokio::test]
async fn dev_reset_in_progress_makes_channel_create_api_conflict() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();

    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/channels")
                .header("authorization", token.authorization_header())
                .header("idempotency-key", "channel-create-reset-conflict")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "dev",
                        "description": null,
                        "agentIds": [],
                        "projectPaths": [],
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        state
            .channels()
            .list_channels()
            .await
            .into_iter()
            .map(|channel| channel.id)
            .collect::<Vec<_>>(),
        vec!["all".to_string()]
    );
    reset_guard.finish().await;
}

#[tokio::test]
async fn dev_reset_in_progress_makes_local_node_rename_api_conflict() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();

    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/nodes/local-node/name")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Studio Node",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        state.nodes().get_node("local-node").unwrap().name,
        "本机设备"
    );
    reset_guard.finish().await;
}

#[tokio::test]
async fn dev_reset_in_progress_makes_dm_message_api_conflict_before_append() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    let agent = state
        .members()
        .create_product_agent(
            ProductAgentDraft {
                name: "Coda".to_string(),
                handle: "@coda".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                profession: "智能体".to_string(),
                description: "dev agent".to_string(),
                avatar_seed: None,
            },
            "create-agent-coda-dm-api-conflict",
        )
        .await
        .unwrap();
    let (conversation, _) = state.conversations().create_dm(&agent.id).await.unwrap();
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();

    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/conversations/{}/messages", conversation.id))
                .header("authorization", token.authorization_header())
                .header("idempotency-key", "dm-api-reset-conflict")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "authorId": "human:lei",
                        "body": "please help",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(state
        .conversations()
        .list_messages(&conversation.id)
        .await
        .unwrap()
        .is_empty());
    reset_guard.finish().await;
}

#[tokio::test]
async fn dev_reset_in_progress_makes_conversation_reads_conflict_without_legacy_import() {
    let token = AuthToken::from_static("test-token");
    let root = temp_data_root();
    fs::create_dir_all(root.join("conversations/messages")).unwrap();
    fs::write(
        root.join("conversations/index.json"),
        r#"[
          {
            "id": "dm:agent_reset_legacy",
            "kind": "dm",
            "agentId": "agent_reset_legacy",
            "createdAt": "1",
            "updatedAt": "1"
          }
        ]"#,
    )
    .unwrap();
    fs::write(
        root.join("conversations/messages/dm_agent_reset_legacy.json"),
        r#"[
          {
            "id": "legacy-reset-message",
            "conversationId": "dm:agent_reset_legacy",
            "authorId": "human:local",
            "body": "不应在 reset 中导入",
            "createdAt": "2"
          }
        ]"#,
    )
    .unwrap();
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();

    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/conversations")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(state
        .orchestration()
        .repos()
        .conversations()
        .await
        .unwrap()
        .is_empty());
    reset_guard.finish().await;
}

#[tokio::test]
async fn dev_reset_queued_behind_task_reply_guard_does_not_deadlock_inner_launch() {
    let _env_guard = ENV_LOCK.lock().expect("lock reset env");
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");

    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-nested-task-guard",
        )
        .await
        .unwrap();
    let task = state
        .tasks()
        .create_task_root("dev", "human_lei", "task before reset", "nested-task-root")
        .await
        .unwrap();
    let activity_guard = state.reset().runtime().begin_launch().await.unwrap();
    let reset_task = tokio::spawn(post_dev_reset(state.clone(), token));
    tokio::time::sleep(Duration::from_millis(25)).await;
    assert!(reset_task.is_finished() == false);

    let receipt = timeout(
        Duration::from_millis(500),
        state
            .channel_orchestrator()
            .add_task_reply_with_launch_guard(
                &task.id,
                "human_lei",
                "reply while reset is queued",
                "nested-task-reply",
                &activity_guard,
            ),
    )
    .await
    .expect("task reply should not deadlock behind its own outer reset guard")
    .unwrap();
    assert_eq!(receipt.reply.body, "reply while reset is queued");

    drop(activity_guard);
    let response = reset_task.await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}

#[tokio::test]
async fn dev_reset_clears_channel_orchestrator_outcome_idempotency_cache() {
    let _env_guard = ENV_LOCK.lock().expect("lock reset env");
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");

    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), temp_data_root()).await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-cache-reset",
        )
        .await
        .unwrap();

    let first = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "please route".to_string(),
            attachment_ids: Vec::new(),
            idempotency_key: "cache-reset-key".to_string(),
            as_task: false,
        })
        .await
        .unwrap();
    assert_eq!(first.action, "broadcast_delivered");
    assert_eq!(first.coordinator_run_id, None);

    let response = post_dev_reset(state.clone(), token).await;
    assert_eq!(response.status(), StatusCode::OK);
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "recreate-dev-after-cache-reset",
        )
        .await
        .unwrap();

    let second = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "please route".to_string(),
            attachment_ids: Vec::new(),
            idempotency_key: "cache-reset-key".to_string(),
            as_task: false,
        })
        .await
        .unwrap();

    assert_eq!(second.action, "broadcast_delivered");
    assert_eq!(second.coordinator_run_id, None);
    assert_ne!(second.message_id, first.message_id);
    assert!(state.messages().message(&first.message_id).await.is_err());
    assert!(state
        .claims()
        .message_deliveries_for_message(&first.message_id)
        .await
        .unwrap()
        .is_empty());

    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}

#[tokio::test]
async fn dev_reset_guard_drop_clears_resetting_state() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token, temp_data_root()).await;
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();

    drop(reset_guard);

    let launch_guard = state.reset().runtime().begin_launch().await.unwrap();
    drop(launch_guard);
}

#[tokio::test]
async fn dev_reset_concurrent_begin_reset_returns_in_progress() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests_with_agent_root_async(token, temp_data_root()).await;
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();

    let result = timeout(
        Duration::from_millis(50),
        state.reset().runtime().begin_reset(),
    )
    .await
    .expect("concurrent reset should not wait behind the active reset");

    let error = result.unwrap_err().to_string();
    assert!(error.contains("reset in progress"));
    drop(reset_guard);
}

async fn post_dev_reset(
    state: AppState,
    token: AuthToken,
) -> axum::response::Response<axum::body::Body> {
    build_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/dev/reset")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

fn temp_data_root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("slei-dev-reset-{}", Uuid::new_v4()))
}
