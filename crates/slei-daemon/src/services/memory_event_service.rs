use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::services::orchestration_store::OrchestrationStore;

const MEMORY_CLEANUP_COORDINATOR_AGENT_ID: &str = "__memory_cleanup__";
const MEMORY_DOCUMENT_SOURCE_RECORDED: &str = "memory_document_source_recorded";
const MEMORY_CLEANUP_REQUESTED: &str = "memory_cleanup_requested";
const MEMORY_CLEANUP_COMPLETED: &str = "memory_cleanup_completed";

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MemorySectionRef {
    pub agent_id: String,
    pub document_path: String,
    pub document_section: String,
}

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

    pub async fn clear_for_development_reset(&self) {
        self.cache.lock().await.clear();
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

    pub async fn record_memory_document_source(
        &self,
        agent_id: &str,
        document_path: &str,
        document_section: &str,
        source_message_id: &str,
    ) {
        let id = Uuid::new_v4();
        self.store
            .record_memory_event(
                id,
                agent_id,
                MEMORY_DOCUMENT_SOURCE_RECORDED,
                Some(source_message_id),
                Some(document_path),
                Some(document_section),
                "ready",
            )
            .await
            .expect("persist memory document source event");
        self.update_section_blocked_state(agent_id, document_path, document_section)
            .await;
    }

    pub async fn request_cleanup_for_source_message(&self, source_message_id: &str) {
        let id = Uuid::new_v4();
        self.store
            .record_memory_event(
                id,
                MEMORY_CLEANUP_COORDINATOR_AGENT_ID,
                MEMORY_CLEANUP_REQUESTED,
                Some(source_message_id),
                None,
                None,
                "pending",
            )
            .await
            .expect("persist memory cleanup request event");
    }

    pub async fn complete_cleanup(
        &self,
        agent_id: &str,
        document_path: &str,
        document_section: &str,
        source_message_id: &str,
    ) {
        let requested_sources = self.cleanup_requested_sources().await;
        let section_sources = self
            .source_message_ids_for_section(agent_id, document_path, document_section)
            .await;
        if requested_sources.contains(source_message_id)
            && section_sources.contains(source_message_id)
        {
            self.store
                .record_memory_event(
                    Uuid::new_v4(),
                    agent_id,
                    MEMORY_CLEANUP_COMPLETED,
                    Some(source_message_id),
                    Some(document_path),
                    Some(document_section),
                    "ready",
                )
                .await
                .expect("persist memory cleanup completion event");
        }

        self.update_section_blocked_state(agent_id, document_path, document_section)
            .await;
    }

    pub async fn blocked_memory_sections(&self, agent_id: &str) -> Vec<MemorySectionRef> {
        self.materialize_blocked_sections(agent_id).await;
        self.store
            .blocked_memory_sections(agent_id)
            .await
            .expect("read blocked memory sections")
            .into_iter()
            .map(|record| MemorySectionRef {
                agent_id: record.agent_id,
                document_path: record.document_path,
                document_section: record.document_section,
            })
            .collect()
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

    async fn materialize_blocked_sections(&self, agent_id: &str) {
        for ((document_path, document_section), blocked) in
            self.computed_section_blocked_states(agent_id).await
        {
            self.store
                .record_memory_document_state(
                    agent_id,
                    &document_path,
                    &document_section,
                    None,
                    blocked,
                )
                .await
                .expect("persist materialized memory document state");
        }
    }

    async fn cleanup_requested_sources(&self) -> HashSet<String> {
        self.store
            .memory_update_events_for_agent(MEMORY_CLEANUP_COORDINATOR_AGENT_ID)
            .await
            .expect("read memory cleanup request events")
            .into_iter()
            .filter(|event| event.event_type == MEMORY_CLEANUP_REQUESTED)
            .filter_map(|event| event.source_message_id)
            .collect()
    }

    async fn source_message_ids_for_section(
        &self,
        agent_id: &str,
        document_path: &str,
        document_section: &str,
    ) -> HashSet<String> {
        self.store
            .memory_update_events_for_agent(agent_id)
            .await
            .expect("read memory document source events")
            .into_iter()
            .filter(|event| {
                event.event_type == MEMORY_DOCUMENT_SOURCE_RECORDED
                    && event.document_path.as_deref() == Some(document_path)
                    && event.document_section.as_deref() == Some(document_section)
            })
            .filter_map(|event| event.source_message_id)
            .collect()
    }

    async fn update_section_blocked_state(
        &self,
        agent_id: &str,
        document_path: &str,
        document_section: &str,
    ) {
        let blocked = self.computed_section_blocked_states(agent_id).await;
        let blocked = blocked
            .get(&(document_path.to_string(), document_section.to_string()))
            .copied()
            .unwrap_or(false);
        self.store
            .record_memory_document_state(agent_id, document_path, document_section, None, blocked)
            .await
            .expect("persist memory document cleanup state");
    }

    async fn computed_section_blocked_states(
        &self,
        agent_id: &str,
    ) -> HashMap<(String, String), bool> {
        let requested_sources = self.cleanup_requested_sources().await;
        let events = self
            .store
            .memory_update_events_for_agent(agent_id)
            .await
            .expect("read memory update events for section state replay");
        let mut active_sources = HashMap::new();
        let mut known_sections = HashSet::new();

        for event in events {
            let (Some(source_message_id), Some(document_path), Some(document_section)) = (
                event.source_message_id,
                event.document_path,
                event.document_section,
            ) else {
                continue;
            };

            if event.event_type != MEMORY_DOCUMENT_SOURCE_RECORDED
                && event.event_type != MEMORY_CLEANUP_COMPLETED
            {
                continue;
            }

            known_sections.insert((document_path.clone(), document_section.clone()));
            let key = (source_message_id.clone(), document_path, document_section);
            let active = event.event_type == MEMORY_DOCUMENT_SOURCE_RECORDED
                && requested_sources.contains(&source_message_id);
            active_sources.insert(key, active);
        }

        let mut section_states = known_sections
            .into_iter()
            .map(|section| (section, false))
            .collect::<HashMap<_, _>>();
        for ((_source_message_id, document_path, document_section), active) in active_sources {
            if active {
                section_states.insert((document_path, document_section), true);
            }
        }

        section_states
    }
}

fn source_for_channel(channel_id: &str) -> String {
    format!("channel:{channel_id}")
}

fn channel_id_from_source(source: &str) -> Option<String> {
    source.strip_prefix("channel:").map(ToString::to_string)
}
