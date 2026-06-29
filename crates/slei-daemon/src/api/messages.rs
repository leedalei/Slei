use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;

use crate::services::card_service::InteractiveCardView;
use crate::services::channel_orchestrator_service::{
    ChannelOrchestratorError, SendChannelMessageInput,
};
use crate::services::channel_service::ChannelError;
use crate::services::claim_service::ClaimError;
use crate::services::member_service::MemberError;
use crate::services::message_service::{MessageError, MessageKind, MessageRecord};
use crate::services::message_thread_service::{MessageThreadError, MessageThreadSummaryView};
use crate::services::task_service::TaskError;
use crate::services::task_service::TaskSummaryView;
use crate::state::AppState;

const INITIAL_MESSAGE_LIMIT: i64 = 50;
const BEFORE_MESSAGE_LIMIT: i64 = 30;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageRequest {
    author_id: String,
    body: String,
    #[serde(default)]
    as_task: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadMessagesQuery {
    channel: String,
    limit: Option<i64>,
    after: Option<i64>,
    before: Option<i64>,
    around: Option<String>,
    from_message: Option<String>,
    to_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMessagesQuery {
    query: String,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentMessageRequest {
    target: String,
    agent_id: String,
    body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SendAgentMessageResponse {
    message_id: String,
    message: ChannelMessageView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelMessageView {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sequence: Option<i64>,
    channel_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    author_id: String,
    body: Option<String>,
    #[serde(default)]
    as_task: bool,
    kind: MessageKind,
    deleted: bool,
    edited: bool,
    created_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    cards: Vec<InteractiveCardView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread: Option<MessageThreadSummaryView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    task: Option<TaskSummaryView>,
}

impl ChannelMessageView {
    fn from_record(
        record: MessageRecord,
        thread: Option<MessageThreadSummaryView>,
        task: Option<TaskSummaryView>,
    ) -> Self {
        Self {
            id: record.id,
            sequence: record.sequence,
            channel_id: record.channel_id,
            session_id: record.session_id,
            author_id: record.author_id,
            body: record.body,
            as_task: record.as_task,
            kind: record.kind,
            deleted: record.deleted,
            edited: record.edited,
            created_at: record.created_at,
            cards: record.cards,
            thread,
            task,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessagesQuery {
    before: Option<i64>,
    around_message_id: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_more_before: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    oldest_cursor: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    newest_cursor: Option<i64>,
}

pub async fn list_channel_messages(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
    Query(query): Query<ChannelMessagesQuery>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let limit = message_page_limit(
        query.before,
        query.around_message_id.as_deref(),
        query.limit,
    );
    let mut messages = Vec::new();
    for mut message in match state
        .messages()
        .channel_messages_page(
            &channel_id,
            query.before,
            query.around_message_id.as_deref(),
            Some(limit),
        )
        .await
    {
        Ok(messages) => messages,
        Err(error) => return message_error_response(error),
    } {
        message.cards = state
            .cards()
            .cards_for_message(&message.id)
            .await
            .unwrap_or_default();
        let thread = state
            .message_threads()
            .thread_summary_for_source_message(&message.id)
            .await;
        let task = if message.kind == MessageKind::Human {
            state
                .tasks()
                .task_summary_for_source_message(&message.id)
                .await
        } else {
            None
        };
        messages.push(ChannelMessageView::from_record(message, thread, task));
    }
    let page_info = channel_page_info(&state, &channel_id, &messages).await;
    Json(json!({ "messages": messages, "pageInfo": page_info })).into_response()
}

pub async fn read_messages(
    State(state): State<AppState>,
    Query(query): Query<ReadMessagesQuery>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state
        .messages()
        .read_agent_messages(
            &query.channel,
            query.limit,
            query.after,
            query.before,
            query.around.as_deref(),
            query.from_message.as_deref(),
            query.to_message.as_deref(),
        )
        .await
    {
        Ok(messages) => Json(json!({ "messages": messages })).into_response(),
        Err(error) => message_error_response(error),
    }
}

pub async fn search_messages(
    State(state): State<AppState>,
    Query(query): Query<SearchMessagesQuery>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state
        .messages()
        .search_agent_messages(&query.query, query.limit)
        .await
    {
        Ok(messages) => Json(json!({ "messages": messages })).into_response(),
        Err(error) => message_error_response(error),
    }
}

pub async fn send_agent_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SendAgentMessageRequest>,
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

    let activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let result = state
        .messages()
        .send_agent_channel_message(
            &payload.target,
            &payload.agent_id,
            &payload.body,
            idempotency_key,
        )
        .await;

    match result {
        Ok(message) => {
            if let Err(error) = state
                .channel_orchestrator()
                .broadcast_existing_channel_message(&message)
                .await
            {
                drop(activity_guard);
                return channel_message_error_response(error);
            }
            drop(activity_guard);
            let message_id = message.id.clone();
            Json(SendAgentMessageResponse {
                message_id,
                message: ChannelMessageView::from_record(message, None, None),
            })
            .into_response()
        }
        Err(error) => {
            drop(activity_guard);
            message_error_response(error)
        }
    }
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

    let activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
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
        .send_channel_message_with_launch_guard(
            SendChannelMessageInput {
                channel_id,
                author_id: payload.author_id,
                body: payload.body,
                idempotency_key: idempotency_key.to_string(),
                as_task: payload.as_task,
            },
            &activity_guard,
        )
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

async fn channel_page_info(
    state: &AppState,
    channel_id: &str,
    messages: &[ChannelMessageView],
) -> PageInfo {
    let oldest_cursor = messages.iter().filter_map(|message| message.sequence).min();
    let newest_cursor = messages.iter().filter_map(|message| message.sequence).max();
    let has_more_before = match oldest_cursor {
        Some(cursor) => state
            .messages()
            .channel_messages_page(channel_id, Some(cursor), None, Some(1))
            .await
            .map(|messages| !messages.is_empty())
            .unwrap_or(false),
        None => false,
    };

    PageInfo {
        has_more_before,
        oldest_cursor,
        newest_cursor,
    }
}

fn message_error_response(error: MessageError) -> Response {
    let status = match error {
        MessageError::MessageNotFound => StatusCode::NOT_FOUND,
        MessageError::InvalidMessage
        | MessageError::AgentMessageImmutable
        | MessageError::PrimaryAgentMissing => StatusCode::BAD_REQUEST,
        MessageError::Storage(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(json!({ "error": error.to_string() }))).into_response()
}

fn channel_message_error_response(error: ChannelOrchestratorError) -> Response {
    let status = match &error {
        ChannelOrchestratorError::Channel(ChannelError::MissingChannel)
        | ChannelOrchestratorError::Channel(ChannelError::MissingMember)
        | ChannelOrchestratorError::Member(MemberError::AgentNotFound)
        | ChannelOrchestratorError::Message(MessageError::MessageNotFound)
        | ChannelOrchestratorError::Task(TaskError::TaskNotFound)
        | ChannelOrchestratorError::MessageThread(MessageThreadError::ThreadNotFound)
        | ChannelOrchestratorError::MessageThread(MessageThreadError::SourceMessageNotFound) => {
            StatusCode::NOT_FOUND
        }
        ChannelOrchestratorError::Message(MessageError::InvalidMessage)
        | ChannelOrchestratorError::Message(MessageError::AgentMessageImmutable)
        | ChannelOrchestratorError::Message(MessageError::PrimaryAgentMissing)
        | ChannelOrchestratorError::Channel(ChannelError::InvalidChannel)
        | ChannelOrchestratorError::Channel(ChannelError::InvalidWorkspacePath)
        | ChannelOrchestratorError::Channel(ChannelError::MissingIdempotencyKey)
        | ChannelOrchestratorError::Channel(ChannelError::DefaultChannelImmutable)
        | ChannelOrchestratorError::Member(MemberError::MissingIdempotencyKey)
        | ChannelOrchestratorError::Member(MemberError::InvalidAgent)
        | ChannelOrchestratorError::Member(MemberError::InvalidHandle)
        | ChannelOrchestratorError::Member(MemberError::DuplicateHandle)
        | ChannelOrchestratorError::Member(MemberError::InvalidMemory)
        | ChannelOrchestratorError::Member(MemberError::WorkspaceBoundary)
        | ChannelOrchestratorError::Member(MemberError::SystemAgentImmutable)
        | ChannelOrchestratorError::Task(TaskError::ActiveTaskRootDeletionBlocked)
        | ChannelOrchestratorError::Task(TaskError::MissingIdempotencyKey)
        | ChannelOrchestratorError::Task(TaskError::InvalidTaskInput)
        | ChannelOrchestratorError::Task(TaskError::InvalidTaskStatusTransition)
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
