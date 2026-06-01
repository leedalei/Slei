use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::agent_dm_service::AgentDmError;
use crate::services::conversation_service::ConversationError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDmRequest {
    agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendConversationMessageRequest {
    author_id: String,
    body: String,
    session_id: Option<String>,
    #[serde(default)]
    attachment_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadAttachmentRequest {
    name: String,
    mime_type: String,
    bytes_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMessagesQuery {
    session_id: Option<String>,
}

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(json!({ "conversations": state.conversations().list_conversations().await }))
        .into_response()
}

pub async fn create_dm(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateDmRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    if !state
        .members()
        .list_product_agents()
        .await
        .iter()
        .any(|agent| agent.id == payload.agent_id)
    {
        return error_response(StatusCode::BAD_REQUEST, "agent not found");
    }

    match state.conversations().create_dm(&payload.agent_id).await {
        Ok((conversation, created)) => (
            if created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            },
            Json(json!({ "conversation": conversation })),
        )
            .into_response(),
        Err(error) => conversation_error_response(error),
    }
}

pub async fn messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.conversations().list_messages(&id).await {
        Ok(messages) => {
            let messages = match query
                .session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                Some(session_id) => messages
                    .into_iter()
                    .filter(|message| message.session_id.as_deref() == Some(session_id))
                    .collect::<Vec<_>>(),
                None => messages,
            };
            Json(json!({ "messages": messages })).into_response()
        }
        Err(error) => conversation_error_response(error),
    }
}

pub async fn sessions(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.conversations().list_sessions(&id).await {
        Ok(sessions) => Json(json!({ "sessions": sessions })).into_response(),
        Err(error) => conversation_error_response(error),
    }
}

pub async fn create_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.conversations().create_session(&id).await {
        Ok((conversation, session)) => (
            StatusCode::CREATED,
            Json(json!({ "conversation": conversation, "session": session })),
        )
            .into_response(),
        Err(error) => conversation_error_response(error),
    }
}

pub async fn activate_session(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state
        .conversations()
        .activate_session(&id, &session_id)
        .await
    {
        Ok((conversation, session)) => {
            Json(json!({ "conversation": conversation, "session": session })).into_response()
        }
        Err(error) => conversation_error_response(error),
    }
}

pub async fn upload_attachment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<UploadAttachmentRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state
        .conversations()
        .store_attachment(&payload.name, &payload.mime_type, &payload.bytes_base64)
        .await
    {
        Ok(attachment) => (
            StatusCode::CREATED,
            Json(json!({ "attachment": attachment })),
        )
            .into_response(),
        Err(error) => conversation_error_response(error),
    }
}

pub async fn send_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<SendConversationMessageRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok());

    match state
        .conversations()
        .append_message_with_session(
            &id,
            &payload.author_id,
            &payload.body,
            idempotency_key,
            payload.session_id.as_deref(),
            &payload.attachment_ids,
        )
        .await
    {
        Ok(message) => {
            if payload.author_id.starts_with("human:") {
                if let Err(error) = state
                    .agent_dm()
                    .start_for_human_message(&id, &message)
                    .await
                {
                    return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
                }
            }
            (StatusCode::CREATED, Json(json!({ "message": message }))).into_response()
        }
        Err(error) => conversation_error_response(error),
    }
}

pub async fn reset_runtime_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.agent_dm().reset_runtime_session(&id).await {
        Ok(conversation) => Json(json!({ "conversation": conversation })).into_response(),
        Err(error) => agent_dm_error_response(error),
    }
}

fn agent_dm_error_response(error: AgentDmError) -> Response {
    match error {
        AgentDmError::Conversation(error) => conversation_error_response(error),
        other => error_response(StatusCode::INTERNAL_SERVER_ERROR, &other.to_string()),
    }
}

fn conversation_error_response(error: ConversationError) -> Response {
    match error {
        ConversationError::ConversationNotFound => {
            error_response(StatusCode::NOT_FOUND, &error.to_string())
        }
        ConversationError::InvalidConversation | ConversationError::InvalidMessage => {
            error_response(StatusCode::BAD_REQUEST, &error.to_string())
        }
        ConversationError::Io(_) | ConversationError::Json(_) => {
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
        }
    }
}

fn error_response(status: StatusCode, error: &str) -> Response {
    (status, Json(json!({ "error": error }))).into_response()
}
