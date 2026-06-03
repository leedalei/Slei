use slei_daemon::services::agent_inbox_service::{AgentInboxService, DeliveryState};
use slei_daemon::services::channel_service::ChannelMemberReadiness;
use slei_daemon::services::orchestration_store::OrchestrationStore;

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
