use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::services::orchestration_store::OrchestrationStore;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUpdateEvent {
    pub id: String,
    pub agent_id: String,
    pub event_type: String,
    pub channel_id: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug)]
pub struct MemoryEventService {
    store: OrchestrationStore,
    cache: Arc<Mutex<Vec<MemoryUpdateEvent>>>,
}

impl MemoryEventService {
    pub fn new(store: OrchestrationStore) -> Self {
        Self {
            store,
            cache: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn request_channel_join_update(
        &self,
        agent_id: &str,
        channel_id: &str,
    ) -> MemoryUpdateEvent {
        self.record(
            agent_id,
            "memory_update_requested",
            channel_id,
            "pending",
            None,
        )
        .await
    }

    pub async fn start_update(&self, agent_id: &str, channel_id: &str) -> MemoryUpdateEvent {
        self.record(
            agent_id,
            "memory_update_started",
            channel_id,
            "syncing",
            None,
        )
        .await
    }

    pub async fn complete_update(&self, agent_id: &str, channel_id: &str) -> MemoryUpdateEvent {
        self.record(agent_id, "memory_updated", channel_id, "ready", None)
            .await
    }

    pub async fn fail_update(&self, agent_id: &str, channel_id: &str) -> MemoryUpdateEvent {
        self.record(agent_id, "memory_failed", channel_id, "failed", None)
            .await
    }

    pub async fn record_document_touch(
        &self,
        agent_id: &str,
        channel_id: &str,
        document_path: &str,
        document_section: &str,
    ) -> MemoryUpdateEvent {
        self.record(
            agent_id,
            "memory_document_touched",
            channel_id,
            "ready",
            Some((document_path, document_section)),
        )
        .await
    }

    pub async fn events_for_agent(&self, agent_id: &str) -> Vec<MemoryUpdateEvent> {
        match self.store.memory_update_events_for_agent(agent_id).await {
            Ok(events) => events
                .into_iter()
                .map(|event| MemoryUpdateEvent {
                    id: event.id.to_string(),
                    agent_id: event.agent_id,
                    event_type: event.event_type,
                    channel_id: event
                        .source_message_id
                        .as_deref()
                        .and_then(channel_id_from_source),
                    status: event.status,
                })
                .collect(),
            Err(_) => self
                .cache
                .lock()
                .await
                .iter()
                .filter(|event| event.agent_id == agent_id)
                .cloned()
                .collect(),
        }
    }

    async fn record(
        &self,
        agent_id: &str,
        event_type: &str,
        channel_id: &str,
        status: &str,
        document: Option<(&str, &str)>,
    ) -> MemoryUpdateEvent {
        let id = Uuid::new_v4();
        let source_message_id = source_for_channel(channel_id);
        let (document_path, document_section) = document
            .map(|(path, section)| (Some(path), Some(section)))
            .unwrap_or((None, None));
        self.store
            .record_memory_event(
                id,
                agent_id,
                event_type,
                Some(&source_message_id),
                document_path,
                document_section,
                status,
            )
            .await
            .expect("persist memory update event");

        let event = MemoryUpdateEvent {
            id: id.to_string(),
            agent_id: agent_id.to_string(),
            event_type: event_type.to_string(),
            channel_id: Some(channel_id.to_string()),
            status: status.to_string(),
        };
        self.cache.lock().await.push(event.clone());
        event
    }
}

fn source_for_channel(channel_id: &str) -> String {
    format!("channel:{channel_id}")
}

fn channel_id_from_source(source: &str) -> Option<String> {
    source.strip_prefix("channel:").map(ToString::to_string)
}
