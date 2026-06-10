use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::channel_orchestrator_service::{
    ChannelOrchestratorError, SendChannelMessageInput,
};
use crate::services::channel_service::ChannelError;
use crate::services::member_service::MemberError;
use crate::services::message_service::MessageError;
use crate::services::task_service::TaskError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageRequest {
    author_id: String,
    body: String,
    #[serde(default)]
    as_task: bool,
}

pub async fn list_channel_messages(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let messages = state.messages().channel_messages(&channel_id).await;
    Json(json!({ "messages": messages })).into_response()
}

pub async fn send_channel_message(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<SendChannelMessageRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let Some(idempotency_key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "idempotency-key is required" })),
        )
            .into_response();
    };

    let _ = state
        .orchestration()
        .record_diagnostic_event(
            "channel_message.received",
            &format!(
                "channel_id={} author_id={} idempotency_key={} body=[redacted-body]",
                channel_id, payload.author_id, idempotency_key
            ),
        )
        .await;

    match state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id,
            author_id: payload.author_id,
            body: payload.body,
            idempotency_key: idempotency_key.to_string(),
            as_task: payload.as_task,
        })
        .await
    {
        Ok(outcome) => {
            let _ = state
                .orchestration()
                .record_diagnostic_event(
                    "channel_message.outcome",
                    &format!(
                        "message_id={} action={} decision_status={} coordinator_run_id={} task_id={} assignee_agent_id={} assignee_agent_ids={}",
                        outcome.message_id,
                        outcome.action,
                        outcome.decision_status.as_deref().unwrap_or("none"),
                        outcome.coordinator_run_id.as_deref().unwrap_or("none"),
                        outcome.task_id.as_deref().unwrap_or("none"),
                        outcome.assignee_agent_id.as_deref().unwrap_or("none"),
                        outcome.assignee_agent_ids.join(",")
                    ),
                )
                .await;
            Json(json!({ "outcome": outcome })).into_response()
        }
        Err(error) => channel_message_error_response(error),
    }
}

fn channel_message_error_response(error: ChannelOrchestratorError) -> Response {
    let status = match &error {
        ChannelOrchestratorError::Channel(ChannelError::MissingChannel)
        | ChannelOrchestratorError::Channel(ChannelError::MissingMember)
        | ChannelOrchestratorError::Member(MemberError::AgentNotFound)
        | ChannelOrchestratorError::Message(MessageError::MessageNotFound)
        | ChannelOrchestratorError::Task(TaskError::TaskNotFound) => StatusCode::NOT_FOUND,
        ChannelOrchestratorError::Message(MessageError::InvalidMessage)
        | ChannelOrchestratorError::Message(MessageError::AgentMessageImmutable)
        | ChannelOrchestratorError::Message(MessageError::PrimaryAgentMissing)
        | ChannelOrchestratorError::Channel(ChannelError::InvalidChannel)
        | ChannelOrchestratorError::Channel(ChannelError::InvalidWorkspacePath)
        | ChannelOrchestratorError::Channel(ChannelError::MissingIdempotencyKey)
        | ChannelOrchestratorError::Member(MemberError::MissingIdempotencyKey)
        | ChannelOrchestratorError::Member(MemberError::InvalidAgent)
        | ChannelOrchestratorError::Member(MemberError::InvalidHandle)
        | ChannelOrchestratorError::Member(MemberError::DuplicateHandle)
        | ChannelOrchestratorError::Member(MemberError::InvalidMemory)
        | ChannelOrchestratorError::Member(MemberError::WorkspaceBoundary)
        | ChannelOrchestratorError::Member(MemberError::SystemAgentImmutable)
        | ChannelOrchestratorError::Task(TaskError::ActiveTaskRootDeletionBlocked)
        | ChannelOrchestratorError::InactiveIdempotentMessage { .. } => StatusCode::BAD_REQUEST,
        ChannelOrchestratorError::Channel(ChannelError::DuplicateChannelName)
        | ChannelOrchestratorError::Channel(ChannelError::DuplicateWorkspacePath) => {
            StatusCode::CONFLICT
        }
        ChannelOrchestratorError::Channel(ChannelError::Io(_))
        | ChannelOrchestratorError::Channel(ChannelError::Json(_))
        | ChannelOrchestratorError::Member(MemberError::Io(_))
        | ChannelOrchestratorError::Member(MemberError::Json(_))
        | ChannelOrchestratorError::Coordinator(_)
        | ChannelOrchestratorError::InvalidDecisionId
        | ChannelOrchestratorError::Json(_)
        | ChannelOrchestratorError::Sql(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(json!({ "error": error.to_string() }))).into_response()
}
