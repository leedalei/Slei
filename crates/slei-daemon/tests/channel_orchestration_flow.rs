use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::agent_inbox_service::DeliveryState;
use slei_daemon::services::channel_orchestrator_service::SendChannelMessageInput;
use slei_daemon::services::channel_service::{
    ChannelDraft, ChannelMemberReadiness, PermissionPreset,
};
use slei_daemon::services::coordinator_service::CoordinatorInput;
use slei_daemon::services::member_service::{ProductAgentRecord, RuntimeThreadRecord};
use slei_daemon::services::message_service::MessageKind;
use slei_daemon::services::task_service::TaskQuery;
use slei_daemon::state::AppState;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn command_message_creates_task_assignment_inbox_decision_and_task_card() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
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
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let command_body = "实现频道创建时选择 Agent 的功能";
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: command_body.to_string(),
            idempotency_key: "send-command".to_string(),
        })
        .await
        .unwrap();

    assert_eq!(outcome.action, "create_task_and_assign");
    assert_eq!(outcome.assignee_agent_id.as_deref(), Some("agent_alice"));
    let task_id = outcome.task_id.as_deref().unwrap();
    let task = state.tasks().task(task_id).await.unwrap();
    assert_eq!(task.assignee_id.as_deref(), Some("agent_alice"));
    assert_eq!(
        task.source_message_id.as_deref(),
        Some(outcome.message_id.as_str())
    );
    assert!(!task.needs_assignment);
    assert!(task
        .assignment_reason
        .as_deref()
        .unwrap()
        .contains("ready agent"));

    let inbox = state.agent_inbox().events_for_agent("agent_alice").await;
    assert!(inbox.iter().any(|event| {
        event.event_type == "task_assigned"
            && event.task_id.as_deref() == Some(task_id)
            && event.message_id == outcome.message_id
    }));

    let messages = state.channel_messages_for_tests("dev").await;
    assert!(messages.iter().any(|message| {
        message.kind == MessageKind::TaskCard
            && message
                .body
                .as_deref()
                .is_some_and(|body| body.contains(task_id))
    }));

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&outcome.message_id)
        .await;
    assert_eq!(decisions.len(), 1);
    assert_eq!(decisions[0].action, "create_task_and_assign");

    let packages = state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&outcome.message_id)
        .await;
    assert_eq!(packages.len(), 1);
    assert!(!packages[0].payload.contains(command_body));
    let payload: Value = serde_json::from_str(&packages[0].payload).unwrap();
    assert_eq!(payload["currentMessageId"], outcome.message_id);
    assert_eq!(payload["taskId"], task_id);
    assert_eq!(
        payload["assignmentReason"].as_str().unwrap(),
        task.assignment_reason.as_deref().unwrap()
    );
    assert!(payload["relatedMessageIds"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id == &outcome.message_id));
    assert_eq!(
        payload["safeMemoryRefs"].as_array().unwrap(),
        &vec![
            Value::String("MEMORY.md".to_string()),
            Value::String("notes/channels.md".to_string()),
            Value::String("notes/relationships.md".to_string()),
        ]
    );
}

#[tokio::test]
async fn explicit_mention_creates_readiness_aware_inbox_without_overriding_target() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
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
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "@alice-win 帮我看下".to_string(),
            idempotency_key: "send-explicit".to_string(),
        })
        .await
        .unwrap();

    assert_eq!(outcome.action, "request_agent_reply");
    assert_eq!(outcome.assignee_agent_id.as_deref(), Some("agent_alice"));
    assert_eq!(outcome.task_id, None);

    let inbox = state.agent_inbox().events_for_agent("agent_alice").await;
    assert!(inbox.iter().any(|event| {
        event.event_type == "human_mention"
            && event.message_id == outcome.message_id
            && event.delivery_state == DeliveryState::PendingMemoryReady
    }));
    assert!(state
        .tasks()
        .list_tasks(TaskQuery::default())
        .await
        .is_empty());
}

#[tokio::test]
async fn task_thread_visible_agent_mention_creates_task_scoped_inbox_event() {
    let state =
        app_state_with_agent_handles(&[("agent_alice", "@alice-win"), ("agent_coda", "@coda-win")])
            .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-handoff",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_coda")
        .await
        .unwrap();
    state.run_channel_join_memory_updates("dev").await.unwrap();

    let task = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "agent_alice",
            "msg_root",
            "实现频道 Coordinator",
            Some("agent_alice".to_string()),
            "initial architecture assignment",
            "task-handoff-root",
        )
        .await
        .unwrap();

    let reply = state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "agent_alice",
            "架构方案完成。@coda-win 请根据方案实现。",
            "task-handoff-reply",
        )
        .await
        .unwrap();
    let retry = state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "agent_alice",
            "架构方案完成。@coda-win 请根据方案实现。",
            "task-handoff-reply",
        )
        .await
        .unwrap();
    assert_eq!(reply.id, retry.id);

    let inbox = state.agent_inbox().events_for_agent("agent_coda").await;
    let handoffs = inbox
        .iter()
        .filter(|event| {
            event.event_type == "task_handoff"
                && event.task_id.as_deref() == Some(task.id.as_str())
                && event.message_id == reply.id
        })
        .collect::<Vec<_>>();
    assert_eq!(handoffs.len(), 1);
    assert_eq!(handoffs[0].sender_id.as_deref(), Some("agent_alice"));
    assert!(handoffs[0]
        .handoff_text
        .as_deref()
        .unwrap()
        .contains("@coda-win"));
}

#[tokio::test]
async fn task_reply_retry_uses_stored_reply_for_handoff_side_effects() {
    let state = app_state_with_agent_handles(&[
        ("agent_alice", "@alice-win"),
        ("agent_coda", "@coda-win"),
        ("agent_bob", "@bob-win"),
    ])
    .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-replay-handoff",
        )
        .await
        .unwrap();
    for agent_id in ["agent_coda", "agent_bob"] {
        state
            .channels()
            .add_agent_to_channel("dev", agent_id)
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness("dev", agent_id, ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    let task_a = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "agent_alice",
            "msg_root_a",
            "实现频道 Coordinator",
            Some("agent_alice".to_string()),
            "initial architecture assignment",
            "task-handoff-replay-a",
        )
        .await
        .unwrap();
    let task_b = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "agent_bob",
            "msg_root_b",
            "实现频道 Inbox",
            Some("agent_bob".to_string()),
            "retry target should be ignored",
            "task-handoff-replay-b",
        )
        .await
        .unwrap();

    let original_body = "架构方案完成。@coda-win 请根据方案实现。";
    let reply = state
        .channel_orchestrator()
        .add_task_reply(
            &task_a.id,
            "agent_alice",
            original_body,
            "task-handoff-replay",
        )
        .await
        .unwrap();
    let retry = state
        .channel_orchestrator()
        .add_task_reply(
            &task_b.id,
            "agent_bob",
            "改派：@bob-win 请接手这个重试请求。",
            "task-handoff-replay",
        )
        .await
        .unwrap();
    assert_eq!(reply.id, retry.id);
    assert_eq!(retry.sender_id, "agent_alice");
    assert_eq!(retry.body, original_body);

    let coda_handoffs = state
        .agent_inbox()
        .events_for_agent("agent_coda")
        .await
        .into_iter()
        .filter(|event| event.event_type == "task_handoff")
        .collect::<Vec<_>>();
    assert_eq!(coda_handoffs.len(), 1);
    assert_eq!(
        coda_handoffs[0].task_id.as_deref(),
        Some(task_a.id.as_str())
    );
    assert_eq!(coda_handoffs[0].message_id, reply.id);
    assert_eq!(coda_handoffs[0].sender_id.as_deref(), Some("agent_alice"));
    assert_eq!(
        coda_handoffs[0].handoff_text.as_deref(),
        Some(original_body)
    );

    let bob_handoffs = state
        .agent_inbox()
        .events_for_agent("agent_bob")
        .await
        .into_iter()
        .filter(|event| event.event_type == "task_handoff")
        .collect::<Vec<_>>();
    assert!(bob_handoffs.is_empty());
}

#[tokio::test]
async fn command_message_retry_replays_outcome_without_duplicate_side_effects() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
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
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "实现频道创建时选择 Agent 的功能".to_string(),
        idempotency_key: "send-command-retry".to_string(),
    };

    let first = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();
    let retry = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

    assert_eq!(first.message_id, retry.message_id);
    assert_eq!(first.task_id, retry.task_id);
    assert_eq!(first.action, retry.action);
    assert_eq!(first.assignee_agent_id, retry.assignee_agent_id);

    let task_id = first.task_id.as_deref().unwrap();
    let task_cards = state
        .channel_messages_for_tests("dev")
        .await
        .into_iter()
        .filter(|message| message.kind == MessageKind::TaskCard)
        .collect::<Vec<_>>();
    assert_eq!(task_cards.len(), 1);

    let matching_assignments = state
        .agent_inbox()
        .events_for_agent("agent_alice")
        .await
        .into_iter()
        .filter(|event| {
            event.event_type == "task_assigned"
                && event.message_id == first.message_id
                && event.task_id.as_deref() == Some(task_id)
        })
        .collect::<Vec<_>>();
    assert_eq!(matching_assignments.len(), 1);

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&first.message_id)
        .await;
    assert_eq!(decisions.len(), 1);

    let packages = state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&first.message_id)
        .await;
    assert_eq!(packages.len(), 1);
}

#[tokio::test]
async fn command_message_partial_retry_recovers_existing_side_effects_without_duplicates() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
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
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let idempotency_key = "send-command-partial";
    let body = "实现频道创建时选择 Agent 的功能";
    let message = state
        .messages()
        .create_human_channel_message("dev", "human_lei", body, idempotency_key)
        .await
        .unwrap();
    let decision = state
        .coordinator()
        .decide(CoordinatorInput {
            channel_id: "dev".to_string(),
            message_id: message.id.clone(),
            body: body.to_string(),
            explicit_agent_ids: vec![],
            ready_agent_ids: vec!["agent_alice".to_string()],
        })
        .await;
    let task = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "human_lei",
            &message.id,
            body,
            Some("agent_alice".to_string()),
            &decision.reason,
            &format!("{idempotency_key}:coordinator-task"),
        )
        .await
        .unwrap();
    state
        .messages()
        .create_task_card_message("dev", &task.id, &message.id)
        .await
        .unwrap();
    state
        .agent_inbox()
        .create_task_assignment("agent_alice", "dev", &task.id, &message.id)
        .await;
    state
        .orchestration()
        .record_routing_context_package(
            Uuid::new_v4(),
            Uuid::parse_str(&decision.id).unwrap(),
            &message.id,
            &serde_json::json!({
                "currentMessageId": message.id,
                "taskId": task.id,
                "assignmentReason": decision.reason,
                "relatedMessageIds": [message.id],
                "safeMemoryRefs": ["MEMORY.md", "notes/channels.md", "notes/relationships.md"],
            })
            .to_string(),
            false,
        )
        .await
        .unwrap();

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: body.to_string(),
            idempotency_key: idempotency_key.to_string(),
        })
        .await
        .unwrap();

    assert_eq!(outcome.message_id, message.id);
    assert_eq!(outcome.task_id.as_deref(), Some(task.id.as_str()));
    assert_eq!(outcome.action, "create_task_and_assign");
    assert_eq!(outcome.assignee_agent_id.as_deref(), Some("agent_alice"));

    let task_cards = state
        .channel_messages_for_tests("dev")
        .await
        .into_iter()
        .filter(|message| message.kind == MessageKind::TaskCard)
        .collect::<Vec<_>>();
    assert_eq!(task_cards.len(), 1);

    let matching_assignments = state
        .agent_inbox()
        .events_for_agent("agent_alice")
        .await
        .into_iter()
        .filter(|event| {
            event.event_type == "task_assigned"
                && event.message_id == outcome.message_id
                && event.task_id.as_deref() == outcome.task_id.as_deref()
        })
        .collect::<Vec<_>>();
    assert_eq!(matching_assignments.len(), 1);

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&outcome.message_id)
        .await;
    assert_eq!(decisions.len(), 1);

    let packages = state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&outcome.message_id)
        .await;
    assert_eq!(packages.len(), 1);
}

#[tokio::test]
async fn deleted_idempotent_message_retry_is_noop_without_routing_changed_body() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
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
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let idempotency_key = "send-command-deleted";
    let message = state
        .messages()
        .create_human_channel_message("dev", "human_lei", "先发一条", idempotency_key)
        .await
        .unwrap();
    state
        .messages()
        .delete_human_message(&message.id)
        .await
        .unwrap();

    let err = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "实现一个不该被路由的新任务".to_string(),
            idempotency_key: idempotency_key.to_string(),
        })
        .await
        .unwrap_err();

    assert!(err.to_string().contains("inactive idempotent message"));
    assert!(state
        .tasks()
        .list_tasks(TaskQuery::default())
        .await
        .is_empty());
    assert!(state
        .channel_messages_for_tests("dev")
        .await
        .into_iter()
        .filter(|message| message.kind == MessageKind::TaskCard)
        .collect::<Vec<_>>()
        .is_empty());
    assert!(state
        .agent_inbox()
        .events_for_agent("agent_alice")
        .await
        .is_empty());
    assert!(state
        .orchestration()
        .decisions_for_message_for_tests(&message.id)
        .await
        .is_empty());
    assert!(state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&message.id)
        .await
        .is_empty());
}

#[tokio::test]
async fn idempotent_retry_with_changed_fields_uses_persisted_message_fields() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    for channel in ["dev", "qa"] {
        state
            .channels()
            .create_channel(
                ChannelDraft {
                    name: channel.to_string(),
                    description: None,
                    permission: PermissionPreset::Controlled,
                },
                &format!("create-{channel}"),
            )
            .await
            .unwrap();
        state
            .channels()
            .add_agent_to_channel(channel, "agent_alice")
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness(channel, "agent_alice", ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    let idempotency_key = "send-command-mismatched-fields";
    let original_body = "实现频道创建时选择 Agent 的功能";
    let message = state
        .messages()
        .create_human_channel_message("dev", "human_lei", original_body, idempotency_key)
        .await
        .unwrap();

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "qa".to_string(),
            author_id: "human_other".to_string(),
            body: "实现一个不该被采用的新任务".to_string(),
            idempotency_key: idempotency_key.to_string(),
        })
        .await
        .unwrap();

    assert_eq!(outcome.message_id, message.id);
    let task = state
        .tasks()
        .task(outcome.task_id.as_deref().unwrap())
        .await
        .unwrap();
    assert_eq!(task.channel_id, "dev");
    assert_eq!(task.creator_id, "human_lei");
    assert_eq!(task.title, original_body);
    assert_eq!(task.source_message_id.as_deref(), Some(message.id.as_str()));

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&message.id)
        .await;
    assert_eq!(decisions.len(), 1);
    assert_eq!(decisions[0].channel_id, "dev");

    let dev_cards = state
        .channel_messages_for_tests("dev")
        .await
        .into_iter()
        .filter(|message| message.kind == MessageKind::TaskCard)
        .collect::<Vec<_>>();
    let qa_cards = state
        .channel_messages_for_tests("qa")
        .await
        .into_iter()
        .filter(|message| message.kind == MessageKind::TaskCard)
        .collect::<Vec<_>>();
    assert_eq!(dev_cards.len(), 1);
    assert!(qa_cards.is_empty());

    let inbox = state.agent_inbox().events_for_agent("agent_alice").await;
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].channel_id, "dev");
    assert_eq!(inbox[0].message_id, message.id);

    let packages = state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&message.id)
        .await;
    assert_eq!(packages.len(), 1);
    let payload: Value = serde_json::from_str(&packages[0].payload).unwrap();
    assert_eq!(payload["channelSummaryRef"], "channels/dev/summary");
}

#[tokio::test]
async fn concurrent_command_retries_share_outcome_without_duplicate_side_effects() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
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
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "实现频道创建时选择 Agent 的功能".to_string(),
        idempotency_key: "send-command-concurrent".to_string(),
    };

    let (first, second) = tokio::join!(
        state
            .channel_orchestrator()
            .send_channel_message(input.clone()),
        state.channel_orchestrator().send_channel_message(input),
    );
    let first = first.unwrap();
    let second = second.unwrap();

    assert_eq!(first.message_id, second.message_id);
    assert_eq!(first.task_id, second.task_id);
    assert_eq!(first.action, second.action);
    assert_eq!(first.assignee_agent_id, second.assignee_agent_id);

    let task_id = first.task_id.as_deref().unwrap();
    let task_cards = state
        .channel_messages_for_tests("dev")
        .await
        .into_iter()
        .filter(|message| message.kind == MessageKind::TaskCard)
        .collect::<Vec<_>>();
    assert_eq!(task_cards.len(), 1);

    let matching_assignments = state
        .agent_inbox()
        .events_for_agent("agent_alice")
        .await
        .into_iter()
        .filter(|event| {
            event.event_type == "task_assigned"
                && event.message_id == first.message_id
                && event.task_id.as_deref() == Some(task_id)
        })
        .collect::<Vec<_>>();
    assert_eq!(matching_assignments.len(), 1);

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&first.message_id)
        .await;
    assert_eq!(decisions.len(), 1);

    let packages = state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&first.message_id)
        .await;
    assert_eq!(packages.len(), 1);
}

#[tokio::test]
async fn public_channel_message_api_uses_channel_orchestrator() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "api-dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-api-dev",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("api-dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("api-dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());
    let response = post_json(
        &app,
        &token,
        "/v1/channels/api-dev/messages",
        Some("public-api-send"),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "实现一个 API 路由"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["outcome"]["action"], "create_task_and_assign");
    let task_id = body["outcome"]["taskId"].as_str().unwrap();
    assert!(!task_id.is_empty());
    assert!(!state
        .agent_inbox()
        .events_for_agent("agent_alice")
        .await
        .is_empty());
}

async fn app_state_with_agent_handle(agent_id: &str, handle: &str) -> AppState {
    app_state_with_agent_handles(&[(agent_id, handle)]).await
}

async fn app_state_with_agent_handles(agents: &[(&str, &str)]) -> AppState {
    let root = std::env::temp_dir().join(format!("slei-channel-flow-{}", Uuid::new_v4()));
    std::fs::create_dir_all(root.join("agents")).unwrap();
    let agents = agents
        .iter()
        .map(|(agent_id, handle)| {
            let workspace_path = root.join("agents").join(agent_id);
            std::fs::create_dir_all(workspace_path.join("docs")).unwrap();
            std::fs::write(
                workspace_path.join("MEMORY.md"),
                format!("# {}\n\n## Active Context\n", agent_id),
            )
            .unwrap();
            ProductAgentRecord {
                id: (*agent_id).to_string(),
                name: agent_id.trim_start_matches("agent_").to_string(),
                handle: (*handle).to_string(),
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
            }
        })
        .collect::<Vec<_>>();
    std::fs::write(
        root.join("agents/index.json"),
        serde_json::to_string_pretty(&agents).unwrap(),
    )
    .unwrap();
    AppState::for_tests_with_agent_root_async(AuthToken::from_static("test-token"), root).await
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
