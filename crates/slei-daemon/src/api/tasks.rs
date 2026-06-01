use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::task_service::TaskError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    channel_id: String,
    creator_id: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskReplyRequest {
    sender_id: String,
    body: String,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateTaskRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    match state
        .tasks()
        .create_task_root(
            &payload.channel_id,
            &payload.creator_id,
            &payload.title,
            idempotency_key,
        )
        .await
    {
        Ok(task) => (StatusCode::CREATED, Json(json!({ "task": task }))).into_response(),
        Err(error) => task_error_response(error),
    }
}

pub async fn reply(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<CreateTaskReplyRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    match state
        .tasks()
        .add_reply(&id, &payload.sender_id, &payload.body, idempotency_key)
        .await
    {
        Ok(reply) => (StatusCode::CREATED, Json(json!({ "reply": reply }))).into_response(),
        Err(error) => task_error_response(error),
    }
}

pub async fn thread(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.tasks().thread_context(&id).await {
        Ok(thread) => Json(json!({ "thread": thread })).into_response(),
        Err(error) => task_error_response(error),
    }
}

fn task_error_response(error: TaskError) -> Response {
    match error {
        TaskError::TaskNotFound => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        TaskError::ActiveTaskRootDeletionBlocked => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
