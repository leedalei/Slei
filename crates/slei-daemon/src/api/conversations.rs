use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::agent_dm_service::AgentDmError;
use crate::services::conversation_service::ConversationError;
use crate::services::reset_service::ResetRuntimeError;
use crate::state::AppState;

const INITIAL_MESSAGE_LIMIT: i64 = 50;
const BEFORE_MESSAGE_LIMIT: i64 = 30;

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
    before: Option<i64>,
    around_message_id: Option<String>,
    limit: Option<i64>,
}

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

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
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let agent_exists = state
        .members()
        .list_product_agents()
        .await
        .iter()
        .any(|agent| agent.id == payload.agent_id);
    if !agent_exists {
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
    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let limit = message_page_limit(
        query.before,
        query.around_message_id.as_deref(),
        query.limit,
    );
    match state
        .conversations()
        .list_messages_page(&id, query.before, query.around_message_id.as_deref(), limit)
        .await
    {
        Ok(messages) => {
            let mut rendered = Vec::with_capacity(messages.len());
            for message in messages {
                if let Some(session_id) = query
                    .session_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    if message.session_id.as_deref() != Some(session_id) {
                        continue;
                    }
                }
                let mut value = serde_json::to_value(&message).unwrap_or_else(|_| json!({}));
                if let Some(thread) = state
                    .message_threads()
                    .thread_summary_for_source_message(&message.id)
                    .await
                {
                    value["thread"] = serde_json::to_value(thread).unwrap_or_else(|_| json!(null));
                }
                rendered.push(value);
            }
            let page_info = conversation_page_info(&rendered);
            Json(json!({ "messages": rendered, "pageInfo": page_info })).into_response()
        }
        Err(error) => conversation_error_response(error),
    }
}

pub async fn clear_messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.conversations().clear_messages(&id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
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
    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

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
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

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
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

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
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

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

    let launch_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

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
                    .start_for_human_message_with_launch_guard(&id, &message, &launch_guard)
                    .await
                {
                    return agent_dm_error_response(error);
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
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.agent_dm().reset_runtime_session(&id).await {
        Ok(conversation) => Json(json!({ "conversation": conversation })).into_response(),
        Err(error) => agent_dm_error_response(error),
    }
}

fn message_page_limit(
    before: Option<i64>,
    around_message_id: Option<&str>,
    limit: Option<i64>,
) -> i64 {
    let default = if around_message_id.is_some() {
        INITIAL_MESSAGE_LIMIT
    } else if before.is_some() {
        BEFORE_MESSAGE_LIMIT
    } else {
        INITIAL_MESSAGE_LIMIT
    };
    limit.unwrap_or(default).clamp(1, 200)
}

fn conversation_page_info(messages: &[serde_json::Value]) -> serde_json::Value {
    let oldest_cursor = messages
        .iter()
        .filter_map(|message| message["sequence"].as_i64())
        .min();
    let newest_cursor = messages
        .iter()
        .filter_map(|message| message["sequence"].as_i64())
        .max();
    json!({
        "hasMoreBefore": oldest_cursor.is_some_and(|cursor| cursor > 1),
        "oldestCursor": oldest_cursor,
        "newestCursor": newest_cursor,
    })
}

fn agent_dm_error_response(error: AgentDmError) -> Response {
    match error {
        AgentDmError::Conversation(error) => conversation_error_response(error),
        AgentDmError::Reset(error) => reset_runtime_error_response(error),
        other => error_response(StatusCode::INTERNAL_SERVER_ERROR, &other.to_string()),
    }
}

fn reset_runtime_error_response(error: ResetRuntimeError) -> Response {
    match error {
        ResetRuntimeError::ResetInProgress => {
            error_response(StatusCode::CONFLICT, &error.to_string())
        }
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
