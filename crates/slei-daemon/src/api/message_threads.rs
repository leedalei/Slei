use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde::Serialize;

use crate::services::channel_orchestrator_service::ChannelOrchestratorError;
use crate::services::message_thread_service::{
    MessageThreadError, MessageThreadReplyView, MessageThreadSummaryView,
};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMessageThreadRequest {
    source_message_id: String,
    created_by: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageThreadReplyRequest {
    sender_id: String,
    role: Option<String>,
    body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageThreadResponse {
    thread: MessageThreadSummaryView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageThreadWithRepliesResponse {
    thread: MessageThreadSummaryView,
    replies: Vec<MessageThreadReplyView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageThreadReplyResponse {
    reply: MessageThreadReplyView,
}

pub async fn create_from_source_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateMessageThreadRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(idempotency_key) = idempotency_key(&headers) else {
        return message_thread_error_response(MessageThreadError::MissingIdempotencyKey);
    };
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state
        .message_threads()
        .ensure_thread_for_source_message(
            &payload.source_message_id,
            &payload.created_by,
            idempotency_key,
        )
        .await
    {
        Ok(outcome) => {
            let status = if outcome.created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            };
            (
                status,
                Json(MessageThreadResponse {
                    thread: outcome.thread,
                }),
            )
                .into_response()
        }
        Err(error) => message_thread_error_response(error),
    }
}

pub async fn get(
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.message_threads().get_thread(&thread_id).await {
        Ok(view) => Json(MessageThreadWithRepliesResponse {
            thread: view.thread,
            replies: view.replies,
        })
        .into_response(),
        Err(error) => message_thread_error_response(error),
    }
}

pub async fn reply(
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<MessageThreadReplyRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(idempotency_key) = idempotency_key(&headers) else {
        return message_thread_error_response(MessageThreadError::MissingIdempotencyKey);
    };
    let activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state
        .channel_orchestrator()
        .add_message_thread_reply_with_launch_guard(
            &thread_id,
            &payload.sender_id,
            payload.role.as_deref(),
            &payload.body,
            idempotency_key,
            &activity_guard,
        )
        .await
    {
        Ok(reply) => (
            StatusCode::CREATED,
            Json(MessageThreadReplyResponse { reply }),
        )
            .into_response(),
        Err(error) => channel_orchestrator_error_response(error),
    }
}

fn idempotency_key(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn message_thread_error_response(error: MessageThreadError) -> Response {
    match error {
        MessageThreadError::ThreadNotFound | MessageThreadError::SourceMessageNotFound => {
            (StatusCode::NOT_FOUND, Json(error_body(error))).into_response()
        }
        MessageThreadError::InvalidThreadInput
        | MessageThreadError::MissingIdempotencyKey
        | MessageThreadError::NestedThreadNotAllowed => {
            (StatusCode::BAD_REQUEST, Json(error_body(error))).into_response()
        }
        MessageThreadError::Storage(_) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body(error))).into_response()
        }
    }
}

fn error_body(error: MessageThreadError) -> serde_json::Value {
    serde_json::json!({ "error": error.to_string() })
}

fn channel_orchestrator_error_response(error: ChannelOrchestratorError) -> Response {
    match error {
        ChannelOrchestratorError::MessageThread(error) => message_thread_error_response(error),
        other => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": other.to_string() })),
        )
            .into_response(),
    }
}
