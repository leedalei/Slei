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
use crate::services::message_service::MessageError;
use crate::services::task_service::TaskError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageRequest {
    author_id: String,
    body: String,
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

    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    match state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id,
            author_id: payload.author_id,
            body: payload.body,
            idempotency_key: idempotency_key.to_string(),
        })
        .await
    {
        Ok(outcome) => Json(json!({ "outcome": outcome })).into_response(),
        Err(error) => channel_message_error_response(error),
    }
}

fn channel_message_error_response(error: ChannelOrchestratorError) -> Response {
    let status = match &error {
        ChannelOrchestratorError::Channel(ChannelError::MissingChannel)
        | ChannelOrchestratorError::Channel(ChannelError::MissingMember)
        | ChannelOrchestratorError::Message(MessageError::MessageNotFound)
        | ChannelOrchestratorError::Task(TaskError::TaskNotFound) => StatusCode::NOT_FOUND,
        ChannelOrchestratorError::Message(MessageError::InvalidMessage)
        | ChannelOrchestratorError::Message(MessageError::AgentMessageImmutable)
        | ChannelOrchestratorError::Message(MessageError::PrimaryAgentMissing)
        | ChannelOrchestratorError::Channel(ChannelError::InvalidChannel)
        | ChannelOrchestratorError::Task(TaskError::ActiveTaskRootDeletionBlocked)
        | ChannelOrchestratorError::InactiveIdempotentMessage { .. } => StatusCode::BAD_REQUEST,
        ChannelOrchestratorError::Channel(ChannelError::Io(_))
        | ChannelOrchestratorError::Channel(ChannelError::Json(_))
        | ChannelOrchestratorError::InvalidDecisionId
        | ChannelOrchestratorError::Json(_)
        | ChannelOrchestratorError::Sql(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(json!({ "error": error.to_string() }))).into_response()
}
