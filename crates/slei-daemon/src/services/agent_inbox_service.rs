use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::services::channel_service::ChannelMemberReadiness;
use crate::services::orchestration_store::OrchestrationStore;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    Pending,
    PendingMemoryReady,
    BlockedMemoryFailed,
    BlockedRuntimeUnavailable,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentInboxEvent {
    pub id: String,
    pub agent_id: String,
    pub channel_id: String,
    pub task_id: Option<String>,
    pub message_id: String,
    pub event_type: String,
    pub delivery_state: DeliveryState,
}

#[derive(Clone, Debug)]
pub struct AgentInboxService {
    store: OrchestrationStore,
    cache: Arc<Mutex<Vec<AgentInboxEvent>>>,
}

impl AgentInboxService {
    pub fn new(store: OrchestrationStore) -> Self {
        Self {
            store,
            cache: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn create_human_mention(
        &self,
        agent_id: &str,
        channel_id: &str,
        message_id: &str,
        readiness: ChannelMemberReadiness,
    ) -> AgentInboxEvent {
        self.push(
            agent_id,
            channel_id,
            None,
            message_id,
            "human_mention",
            delivery_state_for_readiness(readiness),
        )
        .await
    }

    pub async fn create_task_assignment(
        &self,
        agent_id: &str,
        channel_id: &str,
        task_id: &str,
        message_id: &str,
    ) -> AgentInboxEvent {
        self.push(
            agent_id,
            channel_id,
            Some(task_id),
            message_id,
            "task_assigned",
            DeliveryState::Pending,
        )
        .await
    }

    pub async fn events_for_agent(&self, agent_id: &str) -> Vec<AgentInboxEvent> {
        self.cache
            .lock()
            .await
            .iter()
            .filter(|event| event.agent_id == agent_id)
            .cloned()
            .collect()
    }

    async fn push(
        &self,
        agent_id: &str,
        channel_id: &str,
        task_id: Option<&str>,
        message_id: &str,
        event_type: &str,
        delivery_state: DeliveryState,
    ) -> AgentInboxEvent {
        let id = Uuid::new_v4();
        let event = AgentInboxEvent {
            id: id.to_string(),
            agent_id: agent_id.to_string(),
            channel_id: channel_id.to_string(),
            task_id: task_id.map(ToString::to_string),
            message_id: message_id.to_string(),
            event_type: event_type.to_string(),
            delivery_state,
        };
        let payload = serde_json::to_string(&event).expect("serialize agent inbox event");
        self.store
            .record_inbox_event(
                id,
                agent_id,
                event_type,
                &delivery_state_as_str(&event.delivery_state),
                &payload,
            )
            .await
            .expect("persist agent inbox event");
        self.cache.lock().await.push(event.clone());
        event
    }
}

fn delivery_state_for_readiness(readiness: ChannelMemberReadiness) -> DeliveryState {
    match readiness {
        ChannelMemberReadiness::Joining | ChannelMemberReadiness::MemorySyncing => {
            DeliveryState::PendingMemoryReady
        }
        ChannelMemberReadiness::Ready => DeliveryState::Pending,
        ChannelMemberReadiness::MemoryFailed => DeliveryState::BlockedMemoryFailed,
        ChannelMemberReadiness::Unavailable => DeliveryState::BlockedRuntimeUnavailable,
    }
}

fn delivery_state_as_str(delivery_state: &DeliveryState) -> String {
    serde_json::to_value(delivery_state)
        .expect("serialize delivery state")
        .as_str()
        .expect("delivery state serializes to string")
        .to_string()
}
