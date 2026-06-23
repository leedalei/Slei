use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::services::agent_message_todo_service::{
    AgentMessageTodoError, AgentMessageTodoListQuery, ClearAgentMessageTodosInput,
    CreateAgentMessageTodoInput, UpdateAgentMessageTodoInput,
};
use crate::state::AppState;

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AgentMessageTodoListQuery>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.agent_message_todos().list(query).await {
        Ok(todos) => Json(json!({ "todos": todos })).into_response(),
        Err(error) => agent_message_todo_error_response(error),
    }
}

pub async fn get(
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

    match state.agent_message_todos().get(&id).await {
        Ok(todo) => Json(json!({ "todo": todo })).into_response(),
        Err(error) => agent_message_todo_error_response(error),
    }
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateAgentMessageTodoInput>,
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
        .agent_message_todos()
        .create_manual_idempotent(payload, idempotency_key)
        .await
    {
        Ok(todo) => (StatusCode::CREATED, Json(json!({ "todo": todo }))).into_response(),
        Err(error) => agent_message_todo_error_response(error),
    }
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<UpdateAgentMessageTodoInput>,
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
        .agent_message_todos()
        .update_idempotent(&id, payload, idempotency_key)
        .await
    {
        Ok(todo) => Json(json!({ "todo": todo })).into_response(),
        Err(error) => agent_message_todo_error_response(error),
    }
}

pub async fn delete(
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

    let Some(idempotency_key) = idempotency_key(&headers) else {
        return missing_idempotency_response();
    };

    match state
        .agent_message_todos()
        .delete_idempotent(&id, idempotency_key)
        .await
    {
        Ok(todo) => Json(json!({ "todo": todo })).into_response(),
        Err(error) => agent_message_todo_error_response(error),
    }
}

pub async fn clear(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ClearAgentMessageTodosInput>,
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
        .agent_message_todos()
        .clear_idempotent(payload, idempotency_key)
        .await
    {
        Ok(todos) => Json(json!({ "todos": todos })).into_response(),
        Err(error) => agent_message_todo_error_response(error),
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

fn agent_message_todo_error_response(error: AgentMessageTodoError) -> Response {
    match error {
        AgentMessageTodoError::TodoNotFound | AgentMessageTodoError::MessageNotFound => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        AgentMessageTodoError::MissingIdempotencyKey | AgentMessageTodoError::InvalidInput(_) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        AgentMessageTodoError::Json(_) | AgentMessageTodoError::Storage(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
