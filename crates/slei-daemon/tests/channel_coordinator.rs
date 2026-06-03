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
