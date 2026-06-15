use serde::{Deserialize, Serialize};
use serde_json::json;
use slei_storage::repositories::{AgentActivityLogRow, AgentStatusRow, Repositories};

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
}

impl ClaimService {
    pub fn new(repos: Repositories) -> Self {
        Self { repos }
    }

    pub async fn claim_message(
        &self,
        message_id: &str,
        agent_id: &str,
    ) -> Result<ClaimResponse, ClaimError> {
        let message_id = required_value(message_id, "message_id")?;
        let agent_id = required_value(agent_id, "agentId")?;
        let claim = self
            .repos
            .try_claim_message(&message_id, "reply", &agent_id)
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
        let task_id = required_value(task_id, "task_id")?;
        let agent_id = required_value(agent_id, "agentId")?;
        let claim = self
            .repos
            .try_claim_task(&task_id, &agent_id)
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
        let agent_id = required_value(agent_id, "agent_id")?;
        let update = normalize_update(update)?;
        self.repos
            .upsert_agent_status(AgentStatusRow {
                agent_id: agent_id.clone(),
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
                &agent_id,
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
        let agent_id = required_value(agent_id, "agent_id")?;
        let update = normalize_update(update)?;
        let idempotency_key = namespaced_key("agent:status", idempotency_key)
            .ok_or(ClaimError::MissingIdempotencyKey)?;

        let payload = json!({ "agentId": agent_id, "ok": true }).to_string();
        self.repos
            .record_agent_status_idempotent(
                &idempotency_key,
                &payload,
                AgentStatusRow {
                    agent_id,
                    state: update.state,
                    phase: update.phase,
                    reason: update.reason,
                    run_id: update.run_id,
                    channel_id: update.channel_id,
                    message_id: update.message_id,
                    task_id: update.task_id,
                    updated_at: None,
                },
            )
            .await
            .map_err(ClaimError::Storage)?;
        Ok(())
    }

    pub async fn activity_logs(
        &self,
        agent_id: &str,
        limit: i64,
    ) -> Result<Vec<AgentActivityLogRow>, ClaimError> {
        let agent_id = required_value(agent_id, "agent_id")?;
        self.repos
            .agent_activity_logs(&agent_id, limit)
            .await
            .map_err(ClaimError::Storage)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ClaimError {
    #[error("idempotency-key is required")]
    MissingIdempotencyKey,
    #[error("{0} is required")]
    InvalidInput(&'static str),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("storage error: {0}")]
    Storage(sqlx::Error),
}

fn required_value(value: &str, field: &'static str) -> Result<String, ClaimError> {
    let value = value.trim();
    if value.is_empty() {
        Err(ClaimError::InvalidInput(field))
    } else {
        Ok(value.to_string())
    }
}

fn normalize_update(update: AgentStatusUpdate) -> Result<AgentStatusUpdate, ClaimError> {
    Ok(AgentStatusUpdate {
        state: required_value(&update.state, "state")?,
        phase: trim_optional(update.phase),
        reason: trim_optional(update.reason),
        run_id: trim_optional(update.run_id),
        channel_id: trim_optional(update.channel_id),
        message_id: trim_optional(update.message_id),
        task_id: trim_optional(update.task_id),
    })
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}
