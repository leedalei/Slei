use slei_daemon::adapters::claude_worker::ClaudeWorkerAdapter;
use slei_daemon::adapters::worker_rpc::WorkerTransport;
use slei_daemon::services::agent_inbox_service::{AgentInboxService, DeliveryState};
use slei_daemon::services::channel_service::ChannelMemberReadiness;
use slei_daemon::services::coordinator_service::{
    build_coordinator_prompt, parse_and_validate_coordinator_json, CoordinatorAction,
    CoordinatorDecisionError, CoordinatorPromptInput, CoordinatorPromptMember,
    CoordinatorRuntimeInput, CoordinatorService, IntentKind, WorkspaceMount,
};
use slei_daemon::services::orchestration_store::OrchestrationStore;
use uuid::Uuid;

#[tokio::test]
async fn human_mentions_preserve_target_and_reflect_readiness() {
    let inbox = AgentInboxService::new(OrchestrationStore::for_tests().await);

    let pending = inbox
        .create_human_mention(
            "agent_alice",
            "channel_dev",
            "msg_1",
            ChannelMemberReadiness::MemorySyncing,
        )
        .await;
    let blocked = inbox
        .create_human_mention(
            "agent_coda",
            "channel_dev",
            "msg_2",
            ChannelMemberReadiness::Unavailable,
        )
        .await;

    assert_eq!(pending.delivery_state, DeliveryState::PendingMemoryReady);
    assert_eq!(pending.agent_id, "agent_alice");
    assert_eq!(pending.channel_id, "channel_dev");
    assert_eq!(pending.message_id, "msg_1");
    assert_eq!(pending.task_id, None);
    assert_eq!(
        blocked.delivery_state,
        DeliveryState::BlockedRuntimeUnavailable
    );
    assert_eq!(inbox.events_for_agent("agent_alice").await, vec![pending]);
}

#[tokio::test]
async fn inbox_events_replay_from_persisted_store_after_restart() {
    let store = OrchestrationStore::for_tests().await;
    let inbox = AgentInboxService::new(store.clone());

    let assigned = inbox
        .create_task_assignment("agent_alice", "channel_dev", "task_1", "msg_3")
        .await;

    let restarted = AgentInboxService::new(store);
    let replayed = restarted.events_for_agent("agent_alice").await;

    assert_eq!(replayed, vec![assigned]);
    assert_eq!(replayed[0].channel_id, "channel_dev");
    assert_eq!(replayed[0].task_id.as_deref(), Some("task_1"));
    assert_eq!(replayed[0].message_id, "msg_3");
    assert_eq!(replayed[0].event_type, "task_assigned");
    assert_eq!(replayed[0].delivery_state, DeliveryState::Pending);
}

#[tokio::test]
async fn inbox_replay_skips_malformed_payloads_without_hiding_valid_events() {
    let store = OrchestrationStore::for_tests().await;
    let inbox = AgentInboxService::new(store.clone());

    let assigned = inbox
        .create_task_assignment("agent_alice", "channel_dev", "task_1", "msg_3")
        .await;
    store
        .record_inbox_event(
            Uuid::new_v4(),
            "agent_alice",
            "task_assigned",
            "pending",
            "{malformed-json",
        )
        .await
        .unwrap();

    let restarted = AgentInboxService::new(store);
    let replayed = restarted.events_for_agent("agent_alice").await;

    assert_eq!(replayed, vec![assigned]);
}

#[tokio::test]
async fn coordinator_prompt_includes_raw_message_roster_and_json_schema() {
    let prompt = build_coordinator_prompt(CoordinatorPromptInput {
        channel_id: "all".to_string(),
        channel_name: "all".to_string(),
        message_id: "msg_tail_mention".to_string(),
        author_id: "human_lei".to_string(),
        body: "这个方案怎么看 @alice-win".to_string(),
        members: vec![CoordinatorPromptMember {
            agent_id: "agent_alice".to_string(),
            name: "Alice".to_string(),
            handle: "@alice-win".to_string(),
            agent_kind: "agent".to_string(),
            readiness: "ready".to_string(),
        }],
        context_refs: vec!["channels/all/summary".to_string()],
        workspace_mounts: vec![WorkspaceMount {
            path: "/workspace/Slei".to_string(),
            label: "Slei".to_string(),
        }],
    });

    assert!(prompt.contains("这个方案怎么看 @alice-win"));
    assert!(prompt.contains("@alice-win"));
    assert!(prompt.contains("\"targetAgentIds\""));
    assert!(prompt.contains("Return JSON only"));
    assert!(prompt.contains("Coordinator must not visibly answer"));
    assert!(prompt.contains("no product-level \"primary Agent\" workflow"));
    assert!(prompt.contains("Routed Agents decide any later handoff themselves"));
}

#[test]
fn coordinator_json_validation_preserves_tail_mention_targets_returned_by_prompt() {
    let members = vec![
        CoordinatorPromptMember {
            agent_id: "agent_alice".to_string(),
            name: "Alice".to_string(),
            handle: "@alice-win".to_string(),
            agent_kind: "agent".to_string(),
            readiness: "ready".to_string(),
        },
        CoordinatorPromptMember {
            agent_id: "agent_coda".to_string(),
            name: "Coda".to_string(),
            handle: "@coda-win".to_string(),
            agent_kind: "agent".to_string(),
            readiness: "memory_syncing".to_string(),
        },
    ];
    let raw = r#"{
      "intent": "consultation",
      "action": "request_agent_reply",
      "routeMode": "explicit",
      "primaryAssigneeAgentId": "agent_alice",
      "targetAgentIds": ["agent_alice", "agent_coda"],
      "task": null,
      "reason": "The user mentioned Alice at the end and asked Coda to review too.",
      "confidence": 0.88
    }"#;

    let decision = parse_and_validate_coordinator_json(raw, &members).unwrap();

    assert_eq!(decision.intent, IntentKind::Consultation);
    assert_eq!(decision.action, CoordinatorAction::RequestAgentReply);
    assert_eq!(decision.assignee_agent_id.as_deref(), Some("agent_alice"));
    assert_eq!(
        decision.assignee_agent_ids,
        vec!["agent_alice".to_string(), "agent_coda".to_string()]
    );
}

#[test]
fn coordinator_json_validation_rejects_coordinator_targets_without_first_ready_fallback() {
    let members = vec![
        CoordinatorPromptMember {
            agent_id: "agent_coordinator_all".to_string(),
            name: "#all Coordinator".to_string(),
            handle: "@all-coordinator".to_string(),
            agent_kind: "coordinator".to_string(),
            readiness: "ready".to_string(),
        },
        CoordinatorPromptMember {
            agent_id: "agent_alice".to_string(),
            name: "Alice".to_string(),
            handle: "@alice-win".to_string(),
            agent_kind: "agent".to_string(),
            readiness: "ready".to_string(),
        },
    ];
    let raw = r#"{
      "intent": "consultation",
      "action": "request_agent_reply",
      "routeMode": "explicit",
      "primaryAssigneeAgentId": "agent_coordinator_all",
      "targetAgentIds": ["agent_coordinator_all"],
      "task": null,
      "reason": "invalid target",
      "confidence": 0.8
    }"#;

    let error = parse_and_validate_coordinator_json(raw, &members).unwrap_err();

    assert_eq!(
        error,
        CoordinatorDecisionError::InvalidTarget("agent_coordinator_all".to_string())
    );
}

#[test]
fn coordinator_task_json_stays_task_action_with_compat_assignee_and_collaborators() {
    let members = vec![
        CoordinatorPromptMember {
            agent_id: "agent_alice".to_string(),
            name: "Alice".to_string(),
            handle: "@alice-win".to_string(),
            agent_kind: "agent".to_string(),
            readiness: "ready".to_string(),
        },
        CoordinatorPromptMember {
            agent_id: "agent_coda".to_string(),
            name: "Coda".to_string(),
            handle: "@coda-win".to_string(),
            agent_kind: "agent".to_string(),
            readiness: "ready".to_string(),
        },
    ];
    let raw = r#"{
      "intent": "task_command",
      "action": "create_task_and_assign",
      "routeMode": "task",
      "primaryAssigneeAgentId": "agent_alice",
      "targetAgentIds": ["agent_alice", "agent_coda"],
      "task": {
        "title": "实现导出功能",
        "summary": "用户要求实现导出功能",
        "assigneeAgentId": "agent_alice",
        "collaboratorAgentIds": ["agent_coda"]
      },
      "reason": "The user asked for implementation work.",
      "confidence": 0.92
    }"#;

    let decision = parse_and_validate_coordinator_json(raw, &members).unwrap();

    assert_eq!(decision.intent, IntentKind::TaskCommand);
    assert_eq!(decision.action, CoordinatorAction::CreateTaskAndAssign);
    assert_eq!(decision.assignee_agent_id.as_deref(), Some("agent_alice"));
    assert_eq!(
        decision.assignee_agent_ids,
        vec!["agent_alice".to_string(), "agent_coda".to_string()]
    );
    assert_eq!(decision.task.as_ref().unwrap().title, "实现导出功能");
}

#[tokio::test]
async fn coordinator_service_starts_worker_run_with_prompt_instead_of_local_keyword_routing() {
    let transport = WorkerTransport::fake();
    let coordinator = CoordinatorService::new_with_worker(
        OrchestrationStore::for_tests().await,
        ClaudeWorkerAdapter::new(transport.clone()),
    );

    let run = coordinator
        .start_runtime_run(CoordinatorRuntimeInput {
            run_id: "coord_run_tail".to_string(),
            channel_id: "all".to_string(),
            channel_name: "all".to_string(),
            message_id: "msg_tail".to_string(),
            author_id: "human_lei".to_string(),
            body: "你怎么看 @alice-win".to_string(),
            members: vec![CoordinatorPromptMember {
                agent_id: "agent_alice".to_string(),
                name: "Alice".to_string(),
                handle: "@alice-win".to_string(),
                agent_kind: "agent".to_string(),
                readiness: "ready".to_string(),
            }],
            context_refs: vec![],
            workspace_mounts: vec![],
        })
        .await
        .unwrap();

    assert_eq!(run.run_id, "coord_run_tail");
    let commands = transport.commands();
    assert_eq!(commands[0]["type"], "start_run");
    assert_eq!(commands[0]["run_id"], "coord_run_tail");
    assert!(commands[0]["input"]["prompt"]
        .as_str()
        .unwrap()
        .contains("你怎么看 @alice-win"));
    assert!(commands[0]["input"]["prompt"]
        .as_str()
        .unwrap()
        .contains("\"targetAgentIds\""));
}
