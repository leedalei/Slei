use slei_daemon::services::agent_inbox_service::{AgentInboxService, DeliveryState};
use slei_daemon::services::channel_service::ChannelMemberReadiness;
use slei_daemon::services::coordinator_service::{
    CoordinatorAction, CoordinatorInput, CoordinatorService, IntentKind,
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
async fn coordinator_classifies_consultation_without_task_creation() {
    let coordinator = CoordinatorService::new(OrchestrationStore::for_tests().await);
    let decision = coordinator
        .decide(CoordinatorInput {
            channel_id: "channel_dev".to_string(),
            message_id: "msg_consult".to_string(),
            body: "这个架构方案你怎么看？".to_string(),
            explicit_agent_ids: vec![],
            ready_agent_ids: vec!["agent_alice".to_string()],
        })
        .await;

    assert_eq!(decision.intent, IntentKind::Consultation);
    assert_eq!(decision.action, CoordinatorAction::RequestAgentReply);
    assert_eq!(decision.assignee_agent_id.as_deref(), Some("agent_alice"));
}

#[tokio::test]
async fn coordinator_creates_task_for_command_intent_and_needs_assignment_without_ready_agents() {
    let coordinator = CoordinatorService::new(OrchestrationStore::for_tests().await);
    let task = coordinator
        .decide(CoordinatorInput {
            channel_id: "channel_dev".to_string(),
            message_id: "msg_task".to_string(),
            body: "实现频道创建时选择 Agent 的功能".to_string(),
            explicit_agent_ids: vec![],
            ready_agent_ids: vec!["agent_alice".to_string()],
        })
        .await;
    let unassigned = coordinator
        .decide(CoordinatorInput {
            channel_id: "channel_dev".to_string(),
            message_id: "msg_no_ready".to_string(),
            body: "实现一个导出功能".to_string(),
            explicit_agent_ids: vec![],
            ready_agent_ids: vec![],
        })
        .await;

    assert_eq!(task.intent, IntentKind::TaskCommand);
    assert_eq!(task.action, CoordinatorAction::CreateTaskAndAssign);
    assert_eq!(task.assignee_agent_id.as_deref(), Some("agent_alice"));
    assert_eq!(unassigned.action, CoordinatorAction::NeedsManualAssignment);
}
