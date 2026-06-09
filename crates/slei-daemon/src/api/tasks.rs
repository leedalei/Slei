use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::channel_orchestrator_service::ChannelOrchestratorError;
use crate::services::channel_service::ChannelError;
use crate::services::member_service::MemberError;
use crate::services::message_service::MessageError;
use crate::services::task_service::{TaskError, TaskQuery, TaskStatus};
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
pub struct TaskListQuery {
    channel_id: Option<String>,
    creator_id: Option<String>,
    assignee_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskStatusRequest {
    status: TaskStatus,
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
        Ok(task) => match state.tasks().task_summary(&task.id).await {
            Ok(task) => (StatusCode::CREATED, Json(json!({ "task": task }))).into_response(),
            Err(error) => task_error_response(error),
        },
        Err(error) => task_error_response(error),
    }
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TaskListQuery>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let tasks = state
        .tasks()
        .list_task_summaries(TaskQuery {
            channel_id: query.channel_id,
            creator_id: query.creator_id,
            assignee_id: query.assignee_id,
        })
        .await;
    Json(json!({ "tasks": tasks })).into_response()
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
        .channel_orchestrator()
        .add_task_reply(&id, &payload.sender_id, &payload.body, idempotency_key)
        .await
    {
        Ok(receipt) => (
            StatusCode::CREATED,
            Json(json!({
                "reply": receipt.reply,
                "route": receipt.route
            })),
        )
            .into_response(),
        Err(error) => task_reply_error_response(error),
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

    match state.tasks().thread_view(&id).await {
        Ok(thread) => Json(json!({ "thread": thread })).into_response(),
        Err(error) => task_error_response(error),
    }
}

pub async fn update_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<UpdateTaskStatusRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.tasks().update_status(&id, payload.status).await {
        Ok(()) => match state.tasks().task_summary(&id).await {
            Ok(task) => Json(json!({ "task": task })).into_response(),
            Err(error) => task_error_response(error),
        },
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

fn task_reply_error_response(error: ChannelOrchestratorError) -> Response {
    let status = match &error {
        ChannelOrchestratorError::Task(TaskError::TaskNotFound)
        | ChannelOrchestratorError::Channel(ChannelError::MissingChannel)
        | ChannelOrchestratorError::Channel(ChannelError::MissingMember)
        | ChannelOrchestratorError::Member(MemberError::AgentNotFound)
        | ChannelOrchestratorError::Message(MessageError::MessageNotFound) => StatusCode::NOT_FOUND,
        ChannelOrchestratorError::Task(TaskError::ActiveTaskRootDeletionBlocked)
        | ChannelOrchestratorError::Channel(ChannelError::InvalidChannel)
        | ChannelOrchestratorError::Channel(ChannelError::MissingIdempotencyKey)
        | ChannelOrchestratorError::Member(MemberError::MissingIdempotencyKey)
        | ChannelOrchestratorError::Member(MemberError::InvalidAgent)
        | ChannelOrchestratorError::Member(MemberError::InvalidHandle)
        | ChannelOrchestratorError::Member(MemberError::DuplicateHandle)
        | ChannelOrchestratorError::Member(MemberError::InvalidMemory)
        | ChannelOrchestratorError::Member(MemberError::WorkspaceBoundary)
        | ChannelOrchestratorError::Member(MemberError::SystemAgentImmutable)
        | ChannelOrchestratorError::Message(MessageError::InvalidMessage)
        | ChannelOrchestratorError::Message(MessageError::AgentMessageImmutable)
        | ChannelOrchestratorError::Message(MessageError::PrimaryAgentMissing)
        | ChannelOrchestratorError::InactiveIdempotentMessage { .. } => StatusCode::BAD_REQUEST,
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
