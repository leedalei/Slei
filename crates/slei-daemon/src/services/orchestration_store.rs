use std::fmt;

use slei_storage::repositories::{
    AgentInboxEventRecord, BlockedMemorySectionRecord, EventRecord, MemoryUpdateEventRecord,
    Repositories, RoutingContextPackageRecord,
};
use uuid::Uuid;

#[derive(Clone)]
pub struct OrchestrationStore {
    repos: Repositories,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OrchestrationEventCounts {
    pub agent_inbox_event_count: u64,
    pub memory_update_event_count: u64,
}

impl fmt::Debug for OrchestrationStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("OrchestrationStore").finish()
    }
}

impl OrchestrationStore {
    pub fn new(repos: Repositories) -> Self {
        Self { repos }
    }

    pub fn repos(&self) -> Repositories {
        self.repos.clone()
    }

    pub async fn record_inbox_event(
        &self,
        id: Uuid,
        agent_id: &str,
        event_type: &str,
        delivery_state: &str,
        payload: &str,
    ) -> Result<(), sqlx::Error> {
        self.repos
            .insert_agent_inbox_event(id, agent_id, event_type, delivery_state, payload)
            .await
    }

    pub async fn record_diagnostic_event(
        &self,
        event_type: &str,
        payload: &str,
    ) -> Result<i64, sqlx::Error> {
        self.repos
            .append_event(event_type, Uuid::new_v4(), payload)
            .await
    }

    pub async fn recent_diagnostic_events(
        &self,
        limit: i64,
    ) -> Result<Vec<EventRecord>, sqlx::Error> {
        self.repos.recent_events(limit).await
    }

    pub async fn agent_inbox_events_for_agent(
        &self,
        agent_id: &str,
    ) -> Result<Vec<AgentInboxEventRecord>, sqlx::Error> {
        self.repos.agent_inbox_events(agent_id).await
    }

    pub async fn record_memory_event(
        &self,
        id: Uuid,
        agent_id: &str,
        event_type: &str,
        source_message_id: Option<&str>,
        document_path: Option<&str>,
        document_section: Option<&str>,
        status: &str,
    ) -> Result<(), sqlx::Error> {
        self.repos
            .insert_memory_update_event(
                id,
                agent_id,
                event_type,
                source_message_id,
                document_path,
                document_section,
                status,
            )
            .await
    }

    pub async fn memory_update_events_for_agent(
        &self,
        agent_id: &str,
    ) -> Result<Vec<MemoryUpdateEventRecord>, sqlx::Error> {
        self.repos.memory_update_events_for_agent(agent_id).await
    }

    pub async fn record_memory_document_state(
        &self,
        agent_id: &str,
        document_path: &str,
        document_section: &str,
        version_hash: Option<&str>,
        blocked: bool,
    ) -> Result<(), sqlx::Error> {
        self.repos
            .upsert_memory_document_state(
                agent_id,
                document_path,
                document_section,
                version_hash,
                blocked,
            )
            .await
    }

    pub async fn record_routing_context_package(
        &self,
        id: Uuid,
        decision_id: Uuid,
        source_message_id: &str,
        payload: &str,
        contains_deleted_body: bool,
    ) -> Result<(), sqlx::Error> {
        self.repos
            .insert_routing_context_package(
                id,
                decision_id,
                source_message_id,
                payload,
                contains_deleted_body,
            )
            .await
    }

    pub async fn mark_context_packages_deleted(
        &self,
        source_message_id: &str,
    ) -> Result<(), sqlx::Error> {
        self.repos
            .mark_context_packages_deleted(source_message_id)
            .await
    }

    pub async fn routing_context_packages_for_message_for_tests(
        &self,
        message_id: &str,
    ) -> Vec<RoutingContextPackageRecord> {
        self.routing_context_packages_for_message(message_id)
            .await
            .expect("read routing context packages for tests")
    }

    pub async fn routing_context_packages_for_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<RoutingContextPackageRecord>, sqlx::Error> {
        self.repos
            .routing_context_packages_for_message(message_id)
            .await
    }

    pub async fn blocked_memory_sections(
        &self,
        agent_id: &str,
    ) -> Result<Vec<BlockedMemorySectionRecord>, sqlx::Error> {
        self.repos.blocked_memory_sections(agent_id).await
    }

    pub async fn event_counts(&self) -> Result<OrchestrationEventCounts, sqlx::Error> {
        Ok(OrchestrationEventCounts {
            agent_inbox_event_count: self.repos.agent_inbox_event_count().await?,
            memory_update_event_count: self.repos.memory_update_event_count().await?,
        })
    }

    pub async fn for_data_root(root: std::path::PathBuf) -> Self {
        std::fs::create_dir_all(&root).expect("create orchestration data root");
        let db_path = root.join("slei.sqlite");
        let database_url = format!("sqlite://{}", db_path.display());
        let db = slei_storage::db::SleiDb::connect(&database_url)
            .await
            .expect("connect orchestration db");
        db.migrate().await.expect("migrate orchestration db");
        Self::new(Repositories::new(db.pool().clone()))
    }

    pub async fn for_tests() -> Self {
        Self::for_data_root(
            std::env::temp_dir().join(format!("slei-orchestration-{}", Uuid::new_v4())),
        )
        .await
    }
}
