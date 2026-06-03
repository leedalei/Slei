use serde_json::Value;
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

async fn app_state_with_agent_handle(agent_id: &str, handle: &str) -> AppState {
    let root = std::env::temp_dir().join(format!("slei-channel-flow-{}", Uuid::new_v4()));
    std::fs::create_dir_all(root.join("agents")).unwrap();
    let workspace_path = root.join("agents").join(agent_id);
    std::fs::create_dir_all(workspace_path.join("docs")).unwrap();
    let agent = ProductAgentRecord {
        id: agent_id.to_string(),
        name: "Alice".to_string(),
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
        avatar_seed: "alice".to_string(),
        runtime_thread: RuntimeThreadRecord {
            runtime_kind: "ClaudeCode".to_string(),
            status: "ready".to_string(),
            created_at: "0".to_string(),
        },
        channel_ids: vec!["all".to_string()],
        created_at: "0".to_string(),
        updated_at: "0".to_string(),
    };
    std::fs::write(
        root.join("agents/index.json"),
        serde_json::to_string_pretty(&vec![agent]).unwrap(),
    )
    .unwrap();
    AppState::for_tests_with_agent_root_async(AuthToken::from_static("test-token"), root).await
}
