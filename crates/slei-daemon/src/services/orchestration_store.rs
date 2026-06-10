use std::fmt;

use slei_storage::repositories::{
    AgentInboxEventRecord, BlockedMemorySectionRecord, CoordinatorDecisionRecord,
    CoordinatorRuntimeRunRecord, EventRecord, MemoryUpdateEventRecord, Repositories,
    RoutingContextPackageRecord,
};
use uuid::Uuid;

use crate::services::reset_service::ResetRuntimeState;

#[derive(Clone)]
pub struct OrchestrationStore {
    repos: Repositories,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OrchestrationEventCounts {
    pub coordinator_decision_count: u64,
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

    pub async fn record_channel_coordinator(
        &self,
        channel_id: &str,
        strategy: &str,
    ) -> Result<(), sqlx::Error> {
        self.repos
            .insert_channel_coordinator(channel_id, strategy, true)
            .await
    }

    pub async fn record_decision(
        &self,
        id: Uuid,
        channel_id: &str,
        message_id: &str,
        intent: &str,
        action: &str,
        assignee_agent_id: Option<&str>,
        assignee_agent_ids: &[String],
        reason: &str,
    ) -> Result<(), sqlx::Error> {
        self.repos
            .insert_coordinator_decision(
                id,
                channel_id,
                message_id,
                intent,
                action,
                assignee_agent_id,
                assignee_agent_ids,
                reason,
            )
            .await
    }

    pub async fn create_coordinator_runtime_run(
        &self,
        run_id: &str,
        channel_id: &str,
        message_id: &str,
        idempotency_key: &str,
        prompt: &str,
    ) -> Result<(), sqlx::Error> {
        self.repos
            .insert_coordinator_runtime_run(run_id, channel_id, message_id, idempotency_key, prompt)
            .await
    }

    pub async fn append_coordinator_runtime_output(
        &self,
        run_id: &str,
        delta: &str,
    ) -> Result<(), sqlx::Error> {
        self.repos
            .append_coordinator_runtime_output(run_id, delta)
            .await
    }

    pub async fn finish_coordinator_runtime_run(
        &self,
        run_id: &str,
        status: &str,
        error: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        self.repos
            .finish_coordinator_runtime_run(run_id, status, error)
            .await
    }

    pub async fn coordinator_runtime_run(
        &self,
        run_id: &str,
    ) -> Result<Option<CoordinatorRuntimeRunRecord>, sqlx::Error> {
        self.repos.coordinator_runtime_run(run_id).await
    }

    pub async fn coordinator_runtime_run_for_idempotency(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<CoordinatorRuntimeRunRecord>, sqlx::Error> {
        self.repos
            .coordinator_runtime_run_for_idempotency(idempotency_key)
            .await
    }

    pub async fn pending_coordinator_runtime_run_ids(&self) -> Result<Vec<String>, sqlx::Error> {
        self.repos.pending_coordinator_runtime_run_ids().await
    }

    pub async fn cancel_pending_coordinator_runs_for_reset(
        &self,
        reset_runtime: &ResetRuntimeState,
    ) -> Result<Vec<String>, sqlx::Error> {
        let run_ids = self.pending_coordinator_runtime_run_ids().await?;
        reset_runtime.mark_cancelled_runs(run_ids.clone()).await;
        self.repos
            .cancel_coordinator_runtime_runs(&run_ids, "development reset")
            .await?;
        Ok(run_ids)
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

    pub async fn decisions_for_message_for_tests(
        &self,
        message_id: &str,
    ) -> Vec<CoordinatorDecisionRecord> {
        self.decisions_for_message(message_id)
            .await
            .expect("read coordinator decisions for tests")
    }

    pub async fn decisions_for_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<CoordinatorDecisionRecord>, sqlx::Error> {
        self.repos
            .coordinator_decisions_for_message(message_id)
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
        let decisions = self.decisions_for_message(message_id).await?;
        let mut packages = Vec::new();
        for decision in decisions {
            packages.extend(
                self.repos
                    .routing_context_packages_for_decision(decision.id)
                    .await?,
            );
        }
        Ok(packages)
    }

    pub async fn blocked_memory_sections(
        &self,
        agent_id: &str,
    ) -> Result<Vec<BlockedMemorySectionRecord>, sqlx::Error> {
        self.repos.blocked_memory_sections(agent_id).await
    }

    pub async fn event_counts(&self) -> Result<OrchestrationEventCounts, sqlx::Error> {
        Ok(OrchestrationEventCounts {
            coordinator_decision_count: self.repos.coordinator_decision_count().await?,
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
