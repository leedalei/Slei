use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use slei_storage::repositories::{AgentActivityLogRow, AgentStatusRow, Repositories};
use tokio::sync::Mutex;

use crate::services::idempotency::namespaced_key;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimResponse {
    pub claimed: bool,
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusUpdate {
    pub state: String,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ClaimService {
    repos: Repositories,
    mutation_gate: Arc<Mutex<()>>,
}

impl ClaimService {
    pub fn new(repos: Repositories) -> Self {
        Self {
            repos,
            mutation_gate: Arc::new(Mutex::new(())),
        }
    }

    pub async fn claim_message(
        &self,
        message_id: &str,
        agent_id: &str,
    ) -> Result<ClaimResponse, ClaimError> {
        let claim = self
            .repos
            .try_claim_message(message_id, "reply", agent_id)
            .await
            .map_err(ClaimError::Storage)?;
        Ok(ClaimResponse {
            claimed: claim.claimed,
            agent_id: claim.agent_id,
        })
    }

    pub async fn claim_task(
        &self,
        task_id: &str,
        agent_id: &str,
    ) -> Result<ClaimResponse, ClaimError> {
        let claim = self
            .repos
            .try_claim_task(task_id, agent_id)
            .await
            .map_err(ClaimError::Storage)?;
        Ok(ClaimResponse {
            claimed: claim.claimed,
            agent_id: claim.agent_id,
        })
    }

    pub async fn update_agent_status(
        &self,
        agent_id: &str,
        update: AgentStatusUpdate,
    ) -> Result<(), ClaimError> {
        self.repos
            .upsert_agent_status(AgentStatusRow {
                agent_id: agent_id.to_string(),
                state: update.state.clone(),
                phase: update.phase.clone(),
                reason: update.reason.clone(),
                run_id: update.run_id.clone(),
                channel_id: update.channel_id.clone(),
                message_id: update.message_id.clone(),
                task_id: update.task_id.clone(),
                updated_at: None,
            })
            .await
            .map_err(ClaimError::Storage)?;

        self.repos
            .record_agent_activity(
                agent_id,
                update.run_id.as_deref(),
                update.channel_id.as_deref(),
                update.message_id.as_deref(),
                update.task_id.as_deref(),
                &update.state,
                update.phase.as_deref(),
                update.reason.as_deref(),
            )
            .await
            .map_err(ClaimError::Storage)?;
        Ok(())
    }

    pub async fn update_agent_status_idempotent(
        &self,
        agent_id: &str,
        update: AgentStatusUpdate,
        idempotency_key: &str,
    ) -> Result<(), ClaimError> {
        let idempotency_key = namespaced_key("agent:status", idempotency_key)
            .ok_or(ClaimError::MissingIdempotencyKey)?;
        let _gate = self.mutation_gate.lock().await;
        if self
            .repos
            .idempotent_response(&idempotency_key)
            .await
            .map_err(ClaimError::Storage)?
            .is_some()
        {
            return Ok(());
        }

        self.update_agent_status(agent_id, update).await?;
        let payload = json!({ "agentId": agent_id, "ok": true }).to_string();
        self.repos
            .record_idempotent_response(&idempotency_key, agent_id, &payload)
            .await
            .map_err(ClaimError::Storage)?;
        Ok(())
    }

    pub async fn activity_logs(
        &self,
        agent_id: &str,
        limit: i64,
    ) -> Result<Vec<AgentActivityLogRow>, ClaimError> {
        self.repos
            .agent_activity_logs(agent_id, limit)
            .await
            .map_err(ClaimError::Storage)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ClaimError {
    #[error("idempotency-key is required")]
    MissingIdempotencyKey,
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("storage error: {0}")]
    Storage(sqlx::Error),
}
