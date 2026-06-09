use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::agent_inbox_service::DeliveryState;
use slei_daemon::services::channel_orchestrator_service::SendChannelMessageInput;
use slei_daemon::services::channel_service::{
    ChannelDraft, ChannelMemberReadiness, PermissionPreset,
};
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
    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: command_body.to_string(),
        idempotency_key: "send-command".to_string(),
    };
    let pending = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();

    assert_eq!(pending.action, "coordinator_pending");
    let coordinator_run_id = pending.coordinator_run_id.as_deref().unwrap();
    complete_coordinator_run(
        &state,
        coordinator_run_id,
        task_decision_json(
            "agent_alice",
            "task command assigned to ready agent agent_alice",
        ),
    )
    .await;
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input)
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
    let payload: Value = serde_json::from_str(&packages[0].payload).unwrap();
    assert_eq!(payload["currentMessageId"], outcome.message_id);
    assert_eq!(payload["sourceBody"], command_body);
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
async fn broadcast_channel_message_creates_inbox_events_for_all_selected_reply_targets() {
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
            "create-dev-broadcast",
        )
        .await
        .unwrap();
    for agent_id in ["agent_alice", "agent_coda"] {
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

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "大家好，报数".to_string(),
        idempotency_key: "send-broadcast-multi".to_string(),
    };

    let pending = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();

    assert_eq!(pending.action, "coordinator_pending");
    assert_eq!(pending.decision_status.as_deref(), Some("pending"));
    let coordinator_run_id = pending.coordinator_run_id.clone().unwrap();
    assert!(pending.assignee_agent_ids.is_empty());
    let commands = state.worker_commands();
    assert_eq!(commands[0]["type"], "start_run");
    assert_eq!(commands[0]["run_id"], coordinator_run_id);
    assert!(commands[0]["input"]["prompt"]
        .as_str()
        .unwrap()
        .contains("大家好，报数"));

    for agent_id in ["agent_alice", "agent_coda"] {
        let inbox = state.agent_inbox().events_for_agent(agent_id).await;
        assert!(inbox
            .iter()
            .all(|event| event.message_id != pending.message_id));
    }

    state
        .handle_worker_event(serde_json::json!({
            "type": "output_delta",
            "run_id": coordinator_run_id,
            "delta": r#"{
              "intent": "consultation",
              "action": "request_agent_reply",
              "routeMode": "broadcast",
              "primaryAssigneeAgentId": "agent_alice",
              "targetAgentIds": ["agent_alice", "agent_coda"],
              "task": null,
              "reason": "The Coordinator selected both available engineering agents.",
              "confidence": 0.87
            }"#
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(serde_json::json!({
            "type": "completed",
            "run_id": coordinator_run_id
        }))
        .await
        .unwrap();

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

    assert_eq!(outcome.action, "request_agent_reply");
    assert_eq!(outcome.decision_status.as_deref(), Some("completed"));
    assert_eq!(outcome.assignee_agent_id.as_deref(), Some("agent_alice"));
    assert_eq!(
        outcome.assignee_agent_ids,
        vec!["agent_alice".to_string(), "agent_coda".to_string()]
    );

    for agent_id in ["agent_alice", "agent_coda"] {
        let inbox = state.agent_inbox().events_for_agent(agent_id).await;
        assert!(inbox.iter().any(|event| {
            event.event_type == "human_mention" && event.message_id == outcome.message_id
        }));
    }

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&outcome.message_id)
        .await;
    assert_eq!(
        decisions[0].assignee_agent_ids,
        vec!["agent_alice".to_string(), "agent_coda".to_string()]
    );

    let packages = state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&outcome.message_id)
        .await;
    assert_eq!(packages.len(), 2);
    let payloads = packages
        .iter()
        .map(|package| serde_json::from_str::<serde_json::Value>(&package.payload).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(payloads[0]["sourceMessageId"], outcome.message_id);
    assert_eq!(payloads[0]["coordinatorRunId"], coordinator_run_id);
    assert_eq!(payloads[0]["channelId"], "dev");
    assert_eq!(payloads[0]["targetAgentId"], "agent_alice");
    assert_eq!(payloads[0]["primaryAssigneeAgentId"], "agent_alice");
    assert_eq!(
        payloads[0]["targetAgentIds"],
        serde_json::json!(["agent_alice", "agent_coda"])
    );
    assert_eq!(payloads[0]["action"], "request_agent_reply");
    assert_eq!(payloads[0]["sourceBody"], "大家好，报数");
    assert!(payloads[0]["workspaceMounts"].is_array());
    assert_eq!(payloads[1]["targetAgentId"], "agent_coda");
}

#[tokio::test]
async fn malformed_coordinator_json_does_not_fallback_to_first_ready_agent() {
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
            "create-dev-invalid-json",
        )
        .await
        .unwrap();

    for agent_id in ["agent_alice", "agent_coda"] {
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

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "请看看这个问题 @alice-win".to_string(),
        idempotency_key: "send-invalid-coordinator-json".to_string(),
    };
    let pending = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();
    let coordinator_run_id = pending.coordinator_run_id.clone().unwrap();

    state
        .handle_worker_event(serde_json::json!({
            "type": "output_delta",
            "run_id": coordinator_run_id,
            "delta": "{not json"
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(serde_json::json!({
            "type": "completed",
            "run_id": coordinator_run_id
        }))
        .await
        .unwrap();

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

    assert_eq!(outcome.action, "needs_manual_assignment");
    assert_eq!(outcome.decision_status.as_deref(), Some("failed"));
    assert_eq!(outcome.assignee_agent_id, None);
    assert!(outcome.assignee_agent_ids.is_empty());

    for agent_id in ["agent_alice", "agent_coda"] {
        let inbox = state.agent_inbox().events_for_agent(agent_id).await;
        assert!(!inbox.iter().any(|event| {
            event.event_type == "human_mention" && event.message_id == outcome.message_id
        }));
    }

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&outcome.message_id)
        .await;
    assert_eq!(decisions[0].action, "needs_manual_assignment");
    assert!(decisions[0].reason.contains("Coordinator decision failed"));
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

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "@alice-win 帮我看下".to_string(),
        idempotency_key: "send-explicit".to_string(),
    };
    let pending = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();

    assert_eq!(pending.action, "coordinator_pending");
    complete_coordinator_run(
        &state,
        pending.coordinator_run_id.as_deref().unwrap(),
        reply_decision_json("agent_alice", "explicit @alice-win mention"),
    )
    .await;
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input)
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

    let pending = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();
    let pending_retry = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();

    assert_eq!(pending.action, "coordinator_pending");
    assert_eq!(pending_retry.action, "coordinator_pending");
    assert_eq!(pending.message_id, pending_retry.message_id);
    assert_eq!(pending.coordinator_run_id, pending_retry.coordinator_run_id);
    complete_coordinator_run(
        &state,
        pending.coordinator_run_id.as_deref().unwrap(),
        task_decision_json(
            "agent_alice",
            "task command assigned to ready agent agent_alice",
        ),
    )
    .await;
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
    let assignment_reason = "task command assigned to ready agent agent_alice";
    let decision_id = Uuid::new_v4();
    let target_agent_ids = vec!["agent_alice".to_string()];
    state
        .orchestration()
        .record_decision(
            decision_id,
            "dev",
            &message.id,
            "task_command",
            "create_task_and_assign",
            Some("agent_alice"),
            &target_agent_ids,
            assignment_reason,
        )
        .await
        .unwrap();
    let task = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "human_lei",
            &message.id,
            body,
            Some("agent_alice".to_string()),
            assignment_reason,
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
            decision_id,
            &message.id,
            &serde_json::json!({
                "currentMessageId": message.id,
                "taskId": task.id,
                "assignmentReason": assignment_reason,
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

    let input = SendChannelMessageInput {
        channel_id: "qa".to_string(),
        author_id: "human_other".to_string(),
        body: "实现一个不该被采用的新任务".to_string(),
        idempotency_key: idempotency_key.to_string(),
    };
    let pending = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();

    assert_eq!(pending.action, "coordinator_pending");
    assert_eq!(pending.message_id, message.id);
    complete_coordinator_run(
        &state,
        pending.coordinator_run_id.as_deref().unwrap(),
        task_decision_json(
            "agent_alice",
            "task command assigned to ready agent agent_alice",
        ),
    )
    .await;
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input)
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

    let (first_pending, second_pending) = tokio::join!(
        state
            .channel_orchestrator()
            .send_channel_message(input.clone()),
        state
            .channel_orchestrator()
            .send_channel_message(input.clone()),
    );
    let first_pending = first_pending.unwrap();
    let second_pending = second_pending.unwrap();

    assert_eq!(first_pending.action, "coordinator_pending");
    assert_eq!(second_pending.action, "coordinator_pending");
    assert_eq!(first_pending.message_id, second_pending.message_id);
    assert_eq!(
        first_pending.coordinator_run_id,
        second_pending.coordinator_run_id
    );
    complete_coordinator_run(
        &state,
        first_pending.coordinator_run_id.as_deref().unwrap(),
        task_decision_json(
            "agent_alice",
            "task command assigned to ready agent agent_alice",
        ),
    )
    .await;
    let first = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();
    let second = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

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
    assert_eq!(body["outcome"]["action"], "coordinator_pending");
    let coordinator_run_id = body["outcome"]["coordinatorRunId"].as_str().unwrap();
    complete_coordinator_run(
        &state,
        coordinator_run_id,
        task_decision_json(
            "agent_alice",
            "task command assigned to ready agent agent_alice",
        ),
    )
    .await;

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

#[tokio::test]
async fn public_channel_message_api_maps_missing_channel_to_not_found() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);
    let response = post_json(
        &app,
        &token,
        "/v1/channels/missing/messages",
        Some("public-api-missing-channel"),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "实现一个 API 路由"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn public_default_all_channel_message_api_accepts_messages() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());
    let response = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        Some("public-api-all-send"),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "hello，报数"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["outcome"]["action"], "coordinator_pending");
    let coordinator_run_id = body["outcome"]["coordinatorRunId"].as_str().unwrap();
    complete_coordinator_run(
        &state,
        coordinator_run_id,
        reply_decision_json("agent_alice", "default all channel selected agent_alice"),
    )
    .await;

    let response = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        Some("public-api-all-send"),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "hello，报数"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["outcome"]["action"], "request_agent_reply");
    assert_eq!(body["outcome"]["assigneeAgentId"], "agent_alice");
    let message_id = body["outcome"]["messageId"].as_str().unwrap();
    assert!(message_id.starts_with("msg_"));

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(message_id)
        .await;
    assert_eq!(decisions.len(), 1);
    assert_eq!(decisions[0].action, "request_agent_reply");
    assert_eq!(
        decisions[0].assignee_agent_id.as_deref(),
        Some("agent_alice")
    );

    let inbox = state.agent_inbox().events_for_agent("agent_alice").await;
    assert_eq!(
        inbox
            .iter()
            .filter(|event| event.event_type == "human_mention" && event.message_id == message_id)
            .count(),
        1
    );

    let diagnostics = get_json(&app, &token, "/v1/diagnostics").await;
    assert_eq!(diagnostics.status(), StatusCode::OK);
    let diagnostics_body = response_json(diagnostics).await;
    let recent_events = diagnostics_body["recentEvents"].as_array().unwrap();
    assert!(recent_events.iter().any(|event| {
        event["eventType"] == "channel_message.received"
            && event["payload"].as_str().is_some_and(|payload| {
                payload.contains("channel_id=all")
                    && payload.contains("body=[redacted-body]")
                    && !payload.contains("hello")
            })
    }));
    assert!(recent_events.iter().any(|event| {
        event["eventType"] == "channel_message.outcome"
            && event["payload"].as_str().is_some_and(|payload| {
                payload.contains("action=request_agent_reply")
                    && payload.contains("assignee_agent_id=agent_alice")
            })
    }));
}

#[tokio::test]
async fn public_channel_message_api_lists_channel_history() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);

    let sent = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        Some("public-api-list-history"),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "hello history"
        }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::OK);
    let sent_body = response_json(sent).await;
    let message_id = sent_body["outcome"]["messageId"].as_str().unwrap();

    let listed = get_json(&app, &token, "/v1/channels/all/messages").await;
    assert_eq!(listed.status(), StatusCode::OK);
    let body = response_json(listed).await;
    let messages = body["messages"].as_array().unwrap();
    assert!(messages.iter().any(|message| {
        message["id"] == message_id
            && message["channelId"] == "all"
            && message["authorId"] == "human_lei"
            && message["body"] == "hello history"
            && message["kind"] == "human"
    }));
}

#[tokio::test]
async fn public_channel_create_api_mounts_project_paths() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());
    let response = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("public-api-create-projects"),
        serde_json::json!({
            "name": "api-dev",
            "description": "API",
            "agentIds": [],
            "projectPaths": ["/workspace/api", "/workspace/api", "/workspace/web"]
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response_json(response).await;
    assert_eq!(body["channel"]["id"], "api-dev");
    let workspaces = state.channels().workspaces("api-dev").await.unwrap();
    assert_eq!(workspaces.len(), 2);
    assert_eq!(workspaces[0].path, "/workspace/api");
    assert_eq!(workspaces[0].label, "api");
    assert_eq!(workspaces[1].path, "/workspace/web");
    assert_eq!(workspaces[1].label, "web");
}

#[tokio::test]
async fn public_channel_create_api_rejects_missing_idempotency_key() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);
    let response = post_json(
        &app,
        &token,
        "/v1/channels",
        None,
        serde_json::json!({
            "name": "api-dev",
            "description": null,
            "agentIds": []
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["error"], "idempotency-key is required");
}

#[tokio::test]
async fn public_channel_create_api_rejects_empty_idempotency_key() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);
    let response = post_json(
        &app,
        &token,
        "/v1/channels",
        Some(""),
        serde_json::json!({
            "name": "api-dev",
            "description": null,
            "agentIds": []
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["error"], "idempotency-key is required");
}

#[tokio::test]
async fn public_channel_message_api_rejects_missing_idempotency_key_before_orchestration() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);
    let response = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        None,
        serde_json::json!({
            "authorId": "human_lei",
            "body": "实现一个 API 路由"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["error"], "idempotency-key is required");
}

#[tokio::test]
async fn public_channel_message_api_rejects_empty_idempotency_key_before_orchestration() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);
    let response = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        Some(""),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "实现一个 API 路由"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["error"], "idempotency-key is required");
}

async fn app_state_with_agent_handle(agent_id: &str, handle: &str) -> AppState {
    app_state_with_agent_handles(&[(agent_id, handle)]).await
}

async fn complete_coordinator_run(state: &AppState, run_id: &str, output: String) {
    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": run_id,
            "delta": output
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "completed",
            "run_id": run_id
        }))
        .await
        .unwrap();
}

fn task_decision_json(agent_id: &str, reason: &str) -> String {
    json!({
        "intent": "task_command",
        "action": "create_task_and_assign",
        "routeMode": "task",
        "primaryAssigneeAgentId": agent_id,
        "targetAgentIds": [agent_id],
        "task": {
            "title": "Implement requested channel work",
            "summary": "Complete the task requested by the channel message.",
            "assigneeAgentId": agent_id,
            "collaboratorAgentIds": []
        },
        "reason": reason,
        "confidence": 0.9
    })
    .to_string()
}

fn reply_decision_json(agent_id: &str, reason: &str) -> String {
    json!({
        "intent": "consultation",
        "action": "request_agent_reply",
        "routeMode": "explicit",
        "primaryAssigneeAgentId": agent_id,
        "targetAgentIds": [agent_id],
        "task": null,
        "reason": reason,
        "confidence": 0.9
    })
    .to_string()
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

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}
