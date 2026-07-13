use std::sync::Arc;

use serde::{Deserialize, Serialize};
use slei_storage::repositories::{
    AgentMessageTodoQueryRow, AgentMessageTodoRow, ChannelMessageRow, NewAgentMessageTodoRow,
    Repositories,
};
use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;

use crate::services::idempotency::namespaced_key;

#[derive(Clone, Debug)]
pub struct AgentMessageTodoService {
    repos: Repositories,
    idempotency_gate: Arc<AsyncMutex<()>>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageTodoListQuery {
    pub agent_id: Option<String>,
    pub channel_id: Option<String>,
    pub status: Option<String>,
    #[serde(default)]
    pub include_deleted: bool,
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentMessageTodoInput {
    pub agent_id: String,
    pub channel_id: String,
    pub message_id: String,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentMessageTodoInput {
    pub status: String,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearAgentMessageTodosInput {
    pub agent_id: Option<String>,
    pub channel_id: Option<String>,
    pub status: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageTodo {
    pub sequence: i64,
    pub id: String,
    pub agent_id: String,
    pub channel_id: String,
    pub message_id: String,
    pub message_author_id: String,
    pub message_created_at: String,
    pub claim_owner_agent_id: String,
    pub status: String,
    pub run_id: Option<String>,
    pub note: Option<String>,
    pub last_prompted_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingMessageTodoPrompt {
    pub id: String,
    pub channel_id: String,
    pub message_id: String,
    pub author_id: String,
    pub created_at: String,
    pub claim_owner_agent_id: String,
    pub body: String,
    pub task_id: Option<String>,
    pub task_thread_id: Option<String>,
    pub task_status: Option<String>,
}

impl AgentMessageTodoService {
    pub fn new(repos: Repositories) -> Self {
        Self {
            repos,
            idempotency_gate: Arc::new(AsyncMutex::new(())),
        }
    }

    pub async fn list(
        &self,
        query: AgentMessageTodoListQuery,
    ) -> Result<Vec<AgentMessageTodo>, AgentMessageTodoError> {
        let rows = self
            .repos
            .agent_message_todos(query_to_row(query))
            .await
            .map_err(storage_error)?;
        Ok(rows.into_iter().map(AgentMessageTodo::from).collect())
    }

    pub async fn get(&self, todo_id: &str) -> Result<AgentMessageTodo, AgentMessageTodoError> {
        let todo_id = required_trimmed(todo_id, "todo id")?;
        self.repos
            .agent_message_todo(todo_id)
            .await
            .map_err(storage_error)?
            .map(AgentMessageTodo::from)
            .ok_or(AgentMessageTodoError::TodoNotFound)
    }

    pub async fn create_manual_idempotent(
        &self,
        input: CreateAgentMessageTodoInput,
        idempotency_key: &str,
    ) -> Result<AgentMessageTodo, AgentMessageTodoError> {
        let durable_key = namespaced_key("agent-message-todo:create", idempotency_key)
            .ok_or(AgentMessageTodoError::MissingIdempotencyKey)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;
        if let Some(todo) = self.idempotent_todo(&durable_key).await? {
            return Ok(todo);
        }

        let agent_id = required_trimmed(&input.agent_id, "agentId")?.to_string();
        let channel_id = required_trimmed(&input.channel_id, "channelId")?.to_string();
        let message_id = required_trimmed(&input.message_id, "messageId")?.to_string();
        let message = self
            .validate_manual_source_message(&channel_id, &message_id)
            .await?;

        let payload = self
            .repos
            .create_agent_message_todo_idempotent(
                NewAgentMessageTodoRow {
                    agent_id: agent_id.clone(),
                    channel_id,
                    message_id,
                    message_author_id: message.author_id,
                    message_created_at: message.created_at,
                    claim_owner_agent_id: agent_id,
                    note: normalize_optional(input.note),
                },
                &durable_key,
                todo_response_payload,
            )
            .await
            .map_err(storage_error)?;
        todo_from_payload(&payload)
    }

    pub async fn update_idempotent(
        &self,
        todo_id: &str,
        input: UpdateAgentMessageTodoInput,
        idempotency_key: &str,
    ) -> Result<AgentMessageTodo, AgentMessageTodoError> {
        let durable_key = namespaced_key("agent-message-todo:update", idempotency_key)
            .ok_or(AgentMessageTodoError::MissingIdempotencyKey)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;
        if let Some(todo) = self.idempotent_todo(&durable_key).await? {
            return Ok(todo);
        }

        let todo_id = required_trimmed(todo_id, "todo id")?;
        let status = validate_manual_status(&input.status)?;
        let payload = self
            .repos
            .update_agent_message_todo_status_idempotent(
                todo_id,
                status,
                normalize_optional(input.note).as_deref(),
                &durable_key,
                todo_response_payload,
            )
            .await
            .map_err(storage_error)?;
        todo_from_payload(&payload)
    }

    pub async fn delete_idempotent(
        &self,
        todo_id: &str,
        idempotency_key: &str,
    ) -> Result<AgentMessageTodo, AgentMessageTodoError> {
        let durable_key = namespaced_key("agent-message-todo:delete", idempotency_key)
            .ok_or(AgentMessageTodoError::MissingIdempotencyKey)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;
        if let Some(todo) = self.idempotent_todo(&durable_key).await? {
            return Ok(todo);
        }

        let todo_id = required_trimmed(todo_id, "todo id")?;
        let payload = self
            .repos
            .delete_agent_message_todo_idempotent(todo_id, &durable_key, |todo| {
                todo_response_payload(todo)
            })
            .await
            .map_err(storage_error)?;
        todo_from_payload(&payload)
    }

    pub async fn clear_idempotent(
        &self,
        input: ClearAgentMessageTodosInput,
        idempotency_key: &str,
    ) -> Result<Vec<AgentMessageTodo>, AgentMessageTodoError> {
        let durable_key = namespaced_key("agent-message-todo:clear", idempotency_key)
            .ok_or(AgentMessageTodoError::MissingIdempotencyKey)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;
        if let Some(todos) = self.idempotent_todos(&durable_key).await? {
            return Ok(todos);
        }

        let status = clear_status(input.status)?;
        let payload = self
            .repos
            .clear_agent_message_todos_idempotent(
                AgentMessageTodoQueryRow {
                    agent_id: normalize_optional(input.agent_id),
                    channel_id: normalize_optional(input.channel_id),
                    status: Some(status),
                    include_deleted: false,
                    limit: None,
                },
                normalize_optional(input.note).as_deref(),
                &durable_key,
                todos_response_payload,
            )
            .await
            .map_err(storage_error)?;
        todos_from_payload(&payload)
    }

    pub async fn create_pending_from_failed_claim(
        &self,
        message_id: &str,
        failed_agent_id: &str,
        claim_owner_agent_id: &str,
    ) -> Result<Option<AgentMessageTodo>, AgentMessageTodoError> {
        let message_id = required_trimmed(message_id, "message id")?;
        let failed_agent_id = required_trimmed(failed_agent_id, "failed agent id")?;
        let claim_owner_agent_id = required_trimmed(claim_owner_agent_id, "claim owner agent id")?;
        let Some(message) = self
            .repos
            .channel_message(message_id)
            .await
            .map_err(storage_error)?
        else {
            return Ok(None);
        };
        if message.deleted || !is_processable_message(&message) {
            return Ok(None);
        }

        let deliveries = self
            .repos
            .message_deliveries_for_message(message_id)
            .await
            .map_err(storage_error)?;
        if !deliveries
            .iter()
            .any(|delivery| delivery.agent_id == failed_agent_id)
        {
            return Ok(None);
        }

        let todo = self
            .repos
            .create_agent_message_todo(NewAgentMessageTodoRow {
                agent_id: failed_agent_id.to_string(),
                channel_id: message.channel_id,
                message_id: message.id,
                message_author_id: message.author_id,
                message_created_at: message.created_at,
                claim_owner_agent_id: claim_owner_agent_id.to_string(),
                note: None,
            })
            .await
            .map_err(storage_error)?;
        Ok(Some(AgentMessageTodo::from(todo)))
    }

    pub async fn mark_running_for_prompt(
        &self,
        agent_id: &str,
        channel_id: &str,
        run_id: &str,
        limit: i64,
    ) -> Result<Vec<PendingMessageTodoPrompt>, AgentMessageTodoError> {
        let agent_id = required_trimmed(agent_id, "agent id")?;
        let channel_id = required_trimmed(channel_id, "channel id")?;
        let run_id = required_trimmed(run_id, "run id")?;
        let limit = limit.max(0) as usize;
        let mut prompts = Vec::with_capacity(limit);
        while prompts.len() < limit {
            let batch_limit = (limit - prompts.len()) as i64;
            let rows = self
                .repos
                .mark_agent_message_todos_running(agent_id, channel_id, run_id, batch_limit)
                .await
                .map_err(storage_error)?;
            if rows.is_empty() {
                break;
            }

            for row in rows {
                let message = self
                    .repos
                    .channel_message(&row.message_id)
                    .await
                    .map_err(storage_error)?;
                let Some(message) = message else {
                    self.mark_invalid_source_deleted(&row.id).await?;
                    continue;
                };
                if message.deleted || !is_processable_message(&message) {
                    self.mark_invalid_source_deleted(&row.id).await?;
                    continue;
                }
                let Some(body) = message
                    .body
                    .as_deref()
                    .map(str::trim)
                    .filter(|body| !body.is_empty())
                else {
                    self.mark_invalid_source_deleted(&row.id).await?;
                    continue;
                };
                let task = self
                    .repos
                    .task_by_source_message(&row.message_id)
                    .await
                    .map_err(storage_error)?;
                prompts.push(PendingMessageTodoPrompt {
                    id: row.id,
                    channel_id: row.channel_id,
                    message_id: row.message_id,
                    author_id: message.author_id,
                    created_at: message.created_at,
                    claim_owner_agent_id: row.claim_owner_agent_id,
                    body: body.to_string(),
                    task_id: task.as_ref().map(|task| task.id.clone()),
                    task_thread_id: task.as_ref().and_then(|task| task.thread_id.clone()),
                    task_status: task.map(|task| task.status),
                });
            }
        }

        Ok(prompts)
    }

    pub async fn mark_done_for_run(
        &self,
        run_id: &str,
    ) -> Result<Vec<AgentMessageTodo>, AgentMessageTodoError> {
        let run_id = required_trimmed(run_id, "run id")?;
        let rows = self
            .repos
            .mark_agent_message_todos_done_for_run(run_id)
            .await
            .map_err(storage_error)?;
        Ok(rows.into_iter().map(AgentMessageTodo::from).collect())
    }

    pub async fn restore_pending_for_run(
        &self,
        run_id: &str,
    ) -> Result<Vec<AgentMessageTodo>, AgentMessageTodoError> {
        let run_id = required_trimmed(run_id, "run id")?;
        let rows = self
            .repos
            .restore_agent_message_todos_pending_for_run(run_id)
            .await
            .map_err(storage_error)?;
        Ok(rows.into_iter().map(AgentMessageTodo::from).collect())
    }

    async fn validate_manual_source_message(
        &self,
        channel_id: &str,
        message_id: &str,
    ) -> Result<ChannelMessageRow, AgentMessageTodoError> {
        let message = self
            .repos
            .channel_message(message_id)
            .await
            .map_err(storage_error)?
            .ok_or(AgentMessageTodoError::MessageNotFound)?;
        if message.channel_id != channel_id {
            return Err(AgentMessageTodoError::InvalidInput(
                "message does not belong to channel".to_string(),
            ));
        }
        if message.deleted {
            return Err(AgentMessageTodoError::InvalidInput(
                "message is deleted".to_string(),
            ));
        }
        if !is_processable_message(&message) {
            return Err(AgentMessageTodoError::InvalidInput(
                "message cannot be converted to an agent todo".to_string(),
            ));
        }
        Ok(message)
    }

    async fn mark_invalid_source_deleted(
        &self,
        todo_id: &str,
    ) -> Result<(), AgentMessageTodoError> {
        self.repos
            .update_agent_message_todo_status(
                todo_id,
                "deleted",
                Some("source message is missing, deleted, empty, or unprocessable"),
            )
            .await
            .map_err(storage_error)?;
        Ok(())
    }

    async fn idempotent_todo(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<AgentMessageTodo>, AgentMessageTodoError> {
        self.repos
            .idempotent_response(idempotency_key)
            .await
            .map_err(storage_error)?
            .map(|payload| todo_from_payload(&payload))
            .transpose()
    }

    async fn idempotent_todos(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<Vec<AgentMessageTodo>>, AgentMessageTodoError> {
        self.repos
            .idempotent_response(idempotency_key)
            .await
            .map_err(storage_error)?
            .map(|payload| todos_from_payload(&payload))
            .transpose()
    }
}

impl From<AgentMessageTodoRow> for AgentMessageTodo {
    fn from(row: AgentMessageTodoRow) -> Self {
        Self {
            sequence: row.sequence,
            id: row.id,
            agent_id: row.agent_id,
            channel_id: row.channel_id,
            message_id: row.message_id,
            message_author_id: row.message_author_id,
            message_created_at: row.message_created_at,
            claim_owner_agent_id: row.claim_owner_agent_id,
            status: row.status,
            run_id: row.run_id,
            note: row.note,
            last_prompted_at: row.last_prompted_at,
            completed_at: row.completed_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, Error)]
pub enum AgentMessageTodoError {
    #[error("todo not found")]
    TodoNotFound,
    #[error("message not found")]
    MessageNotFound,
    #[error("idempotency-key is required")]
    MissingIdempotencyKey,
    #[error("{0}")]
    InvalidInput(String),
    #[error("json error: {0}")]
    Json(String),
    #[error("storage error: {0}")]
    Storage(String),
}

fn query_to_row(query: AgentMessageTodoListQuery) -> AgentMessageTodoQueryRow {
    AgentMessageTodoQueryRow {
        agent_id: normalize_optional(query.agent_id),
        channel_id: normalize_optional(query.channel_id),
        status: normalize_optional(query.status),
        include_deleted: query.include_deleted,
        limit: query.limit,
    }
}

fn required_trimmed<'a>(
    value: &'a str,
    field: &'static str,
) -> Result<&'a str, AgentMessageTodoError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(AgentMessageTodoError::InvalidInput(format!(
            "{field} is required"
        )))
    } else {
        Ok(trimmed)
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn validate_manual_status(status: &str) -> Result<&str, AgentMessageTodoError> {
    let status = required_trimmed(status, "status")?;
    match status {
        "pending" | "done" | "deleted" => Ok(status),
        "running" => Err(AgentMessageTodoError::InvalidInput(
            "running status requires a daemon-owned run_id".to_string(),
        )),
        _ => Err(AgentMessageTodoError::InvalidInput(format!(
            "unsupported todo status: {status}"
        ))),
    }
}

fn clear_status(status: Option<String>) -> Result<String, AgentMessageTodoError> {
    let Some(status) = normalize_optional(status) else {
        return Ok("pending".to_string());
    };
    if status == "pending" {
        Ok(status)
    } else {
        Err(AgentMessageTodoError::InvalidInput(
            "clear only supports pending todos".to_string(),
        ))
    }
}

fn todo_response_payload(todo: &AgentMessageTodoRow) -> String {
    serde_json::to_string(&AgentMessageTodo::from(todo.clone()))
        .expect("agent message todo response should serialize")
}

fn todos_response_payload(todos: &[AgentMessageTodoRow]) -> String {
    let todos = todos
        .iter()
        .cloned()
        .map(AgentMessageTodo::from)
        .collect::<Vec<_>>();
    serde_json::to_string(&todos).expect("agent message todo response should serialize")
}

fn todo_from_payload(payload: &str) -> Result<AgentMessageTodo, AgentMessageTodoError> {
    serde_json::from_str(payload).map_err(json_error)
}

fn todos_from_payload(payload: &str) -> Result<Vec<AgentMessageTodo>, AgentMessageTodoError> {
    serde_json::from_str(payload).map_err(json_error)
}

fn is_processable_message(message: &ChannelMessageRow) -> bool {
    if matches!(
        message.kind.as_str(),
        "task_card" | "tombstone" | "task_root" | "task_reply"
    ) {
        return false;
    }

    let Some(body) = message.body.as_deref() else {
        return true;
    };
    !body.trim_start().starts_with("task_card:")
}

fn storage_error(error: sqlx::Error) -> AgentMessageTodoError {
    match error {
        sqlx::Error::RowNotFound => AgentMessageTodoError::TodoNotFound,
        error => AgentMessageTodoError::Storage(error.to_string()),
    }
}

fn json_error(error: serde_json::Error) -> AgentMessageTodoError {
    AgentMessageTodoError::Json(error.to_string())
}
