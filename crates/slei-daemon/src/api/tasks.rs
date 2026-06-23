use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::channel_orchestrator_service::ChannelOrchestratorError;
use crate::services::channel_service::ChannelError;
use crate::services::claim_service::ClaimError;
use crate::services::member_service::MemberError;
use crate::services::message_service::MessageError;
use crate::services::message_thread_service::MessageThreadError;
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
pub struct CreateTaskFromSourceMessageRequest {
    source_message_id: String,
    creator_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListQuery {
    channel_id: Option<String>,
    channel: Option<String>,
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
    sender_id: Option<String>,
    agent_id: Option<String>,
    role: Option<String>,
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

    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

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

pub async fn create_from_source_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateTaskFromSourceMessageRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let Some(idempotency_key) = idempotency_key(&headers) else {
        return missing_idempotency_response();
    };

    let thread = match state
        .message_threads()
        .ensure_thread_for_source_message(
            &payload.source_message_id,
            &payload.creator_id,
            idempotency_key,
        )
        .await
    {
        Ok(outcome) => outcome.thread,
        Err(error) => return message_thread_error_response(error),
    };

    match state
        .tasks()
        .create_from_source_message_with_thread(
            &payload.source_message_id,
            &payload.creator_id,
            idempotency_key,
            Some(thread.id),
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

    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let channel_id = query.channel_id.or(query.channel);
    let tasks = state
        .tasks()
        .list_task_summaries(TaskQuery {
            channel_id,
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

    let activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let Some(idempotency_key) = idempotency_key(&headers) else {
        return missing_idempotency_response();
    };

    if payload.agent_id.is_some() || payload.role.is_some() {
        let Some(sender_id) = payload.agent_id.or(payload.sender_id) else {
            return task_error_response(TaskError::InvalidTaskInput);
        };
        return match state
            .channel_orchestrator()
            .add_task_reply_with_role_with_launch_guard(
                &id,
                &sender_id,
                payload.role.as_deref(),
                &payload.body,
                idempotency_key,
                &activity_guard,
            )
            .await
        {
            Ok(outcome) => (
                StatusCode::CREATED,
                Json(json!({
                    "reply": outcome.reply,
                    "route": outcome.route
                })),
            )
                .into_response(),
            Err(error) => task_reply_error_response(error),
        };
    }

    let Some(sender_id) = payload.sender_id else {
        return task_error_response(TaskError::InvalidTaskInput);
    };

    match state
        .channel_orchestrator()
        .add_task_reply_with_launch_guard(
            &id,
            &sender_id,
            &payload.body,
            idempotency_key,
            &activity_guard,
        )
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

    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

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

    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.tasks().update_status(&id, payload.status).await {
        Ok(()) => match state.tasks().task_summary(&id).await {
            Ok(task) => Json(json!({ "task": task })).into_response(),
            Err(error) => task_error_response(error),
        },
        Err(error) => task_error_response(error),
    }
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<UpdateTaskStatusRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let Some(idempotency_key) = idempotency_key(&headers) else {
        return missing_idempotency_response();
    };

    match state
        .tasks()
        .update_status_idempotent(&id, payload.status, idempotency_key)
        .await
    {
        Ok(task) => Json(json!({ "task": task })).into_response(),
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
        TaskError::ActiveTaskRootDeletionBlocked
        | TaskError::MissingIdempotencyKey
        | TaskError::InvalidTaskInput => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        TaskError::Storage(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

fn idempotency_key(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn missing_idempotency_response() -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": "idempotency-key is required" })),
    )
        .into_response()
}

fn message_thread_error_response(error: MessageThreadError) -> Response {
    match error {
        MessageThreadError::ThreadNotFound | MessageThreadError::SourceMessageNotFound => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        MessageThreadError::InvalidThreadInput
        | MessageThreadError::MissingIdempotencyKey
        | MessageThreadError::NestedThreadNotAllowed => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        MessageThreadError::Storage(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
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
        | ChannelOrchestratorError::Message(MessageError::MessageNotFound)
        | ChannelOrchestratorError::MessageThread(MessageThreadError::ThreadNotFound)
        | ChannelOrchestratorError::MessageThread(MessageThreadError::SourceMessageNotFound) => {
            StatusCode::NOT_FOUND
        }
        ChannelOrchestratorError::Task(TaskError::ActiveTaskRootDeletionBlocked)
        | ChannelOrchestratorError::Task(TaskError::MissingIdempotencyKey)
        | ChannelOrchestratorError::Task(TaskError::InvalidTaskInput)
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
        | ChannelOrchestratorError::Message(MessageError::InvalidMessage)
        | ChannelOrchestratorError::Message(MessageError::AgentMessageImmutable)
        | ChannelOrchestratorError::Message(MessageError::PrimaryAgentMissing)
        | ChannelOrchestratorError::MessageThread(MessageThreadError::InvalidThreadInput)
        | ChannelOrchestratorError::MessageThread(MessageThreadError::MissingIdempotencyKey)
        | ChannelOrchestratorError::MessageThread(MessageThreadError::NestedThreadNotAllowed)
        | ChannelOrchestratorError::Claim(ClaimError::MissingIdempotencyKey)
        | ChannelOrchestratorError::Claim(ClaimError::InvalidInput(_))
        | ChannelOrchestratorError::InvalidWorkerEvent(_)
        | ChannelOrchestratorError::InactiveIdempotentMessage { .. } => StatusCode::BAD_REQUEST,
        ChannelOrchestratorError::Channel(ChannelError::DuplicateChannelName)
        | ChannelOrchestratorError::Channel(ChannelError::DuplicateWorkspacePath)
        | ChannelOrchestratorError::Channel(ChannelError::IdempotencyConflict) => {
            StatusCode::CONFLICT
        }
        ChannelOrchestratorError::Reset(_) => StatusCode::CONFLICT,
        ChannelOrchestratorError::Message(MessageError::Storage(_))
        | ChannelOrchestratorError::Task(TaskError::Storage(_))
        | ChannelOrchestratorError::MessageThread(MessageThreadError::Storage(_))
        | ChannelOrchestratorError::Channel(ChannelError::Io(_))
        | ChannelOrchestratorError::Member(MemberError::Io(_))
        | ChannelOrchestratorError::Member(MemberError::Json(_))
        | ChannelOrchestratorError::Card(_)
        | ChannelOrchestratorError::AgentMessageTodo(_)
        | ChannelOrchestratorError::Claim(ClaimError::Json(_))
        | ChannelOrchestratorError::Claim(ClaimError::Storage(_))
        | ChannelOrchestratorError::Worker(_)
        | ChannelOrchestratorError::Json(_)
        | ChannelOrchestratorError::Sql(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(json!({ "error": error.to_string() }))).into_response()
}
