use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::member_service::{MemberError, ProductAgentDraft, ProductAgentUpdate};
use crate::state::AppState;

pub async fn list_agents(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    if let Err(error) = ensure_channel_coordinators(&state).await {
        return member_error_response(error);
    }

    Json(json!({ "agents": state.members().list_product_agents().await })).into_response()
}

pub async fn create_agent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ProductAgentDraft>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let Some(idempotency_key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
    else {
        return error_response(StatusCode::BAD_REQUEST, "missing idempotency key");
    };

    if !node_runtime_exists(&state, &payload.node_id, &payload.runtime_kind) {
        return error_response(StatusCode::BAD_REQUEST, "node or runtime not available");
    }

    match state
        .members()
        .create_product_agent(payload, idempotency_key)
        .await
    {
        Ok(agent) => {
            if let Err(error) = state
                .channels()
                .ensure_default_agent_membership(&agent.id)
                .await
            {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
            }
            (StatusCode::CREATED, Json(json!({ "agent": agent }))).into_response()
        }
        Err(MemberError::DuplicateHandle) => {
            error_response(StatusCode::CONFLICT, "duplicate handle")
        }
        Err(error) => member_error_response(error),
    }
}

pub async fn bootstrap_guide(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    if !has_ready_claude_runtime(&state, "local-node") {
        return (
            StatusCode::ACCEPTED,
            Json(json!({ "status": "runtimeUnavailable" })),
        )
            .into_response();
    }

    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("bootstrap-guide");

    match state
        .members()
        .create_guide_agent("local-node", idempotency_key)
        .await
    {
        Ok((agent, created)) => {
            if let Err(error) = state
                .channels()
                .ensure_default_agent_membership(&agent.id)
                .await
            {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
            }
            let (conversation, _) = match state.conversations().create_dm(&agent.id).await {
                Ok(receipt) => receipt,
                Err(error) => {
                    return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
                }
            };
            let _ = state
                .conversations()
                .append_message(
                    &conversation.id,
                    &agent.id,
                    "Yeal 已准备好，可以帮助你创建成员、频道并了解 Slei 的使用方式。",
                    Some("guide-welcome"),
                )
                .await;
            (
                if created {
                    StatusCode::CREATED
                } else {
                    StatusCode::OK
                },
                Json(json!({
                    "status": if created { "created" } else { "alreadyExists" },
                    "agent": agent,
                    "conversation": conversation,
                })),
            )
                .into_response()
        }
        Err(MemberError::DuplicateHandle) => {
            error_response(StatusCode::CONFLICT, "reserved guide handle already exists")
        }
        Err(error) => member_error_response(error),
    }
}

pub async fn update_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<ProductAgentUpdate>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    if let Some(node_id) = payload.node_id.as_deref() {
        if state.nodes().get_node(node_id).is_none() {
            return error_response(StatusCode::BAD_REQUEST, "node not available");
        }
    }
    if let Some(runtime_kind) = payload.runtime_kind.as_deref() {
        let node_id = payload.node_id.as_deref().unwrap_or("local-node");
        if !node_runtime_exists(&state, node_id, runtime_kind) {
            return error_response(StatusCode::BAD_REQUEST, "runtime not available");
        }
    }

    match state.members().update_product_agent(&id, payload).await {
        Ok(agent) => Json(json!({ "agent": agent })).into_response(),
        Err(error) => member_error_response(error),
    }
}

pub async fn delete_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.members().delete_product_agent(&id).await {
        Ok(agent) => {
            if let Err(error) = state.channels().remove_agent_from_all_channels(&id).await {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
            }
            Json(json!({ "agent": agent })).into_response()
        }
        Err(error) => member_error_response(error),
    }
}

pub async fn list_skills(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.members().list_agent_skills(&id).await {
        Ok(skills) => Json(json!({ "skills": skills })).into_response(),
        Err(error) => member_error_response(error),
    }
}

#[derive(Debug, Deserialize)]
pub struct RememberFactRequest {
    fact: String,
}

pub async fn remember_agent_fact(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<RememberFactRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state
        .members()
        .remember_agent_fact(&id, &payload.fact)
        .await
    {
        Ok(agent) => Json(json!({ "agent": agent })).into_response(),
        Err(error) => member_error_response(error),
    }
}

fn node_runtime_exists(state: &AppState, node_id: &str, runtime_kind: &str) -> bool {
    state.nodes().get_node(node_id).is_some_and(|node| {
        node.runtimes
            .iter()
            .any(|runtime| runtime.kind == runtime_kind)
    })
}

fn has_ready_claude_runtime(state: &AppState, node_id: &str) -> bool {
    state.nodes().get_node(node_id).is_some_and(|node| {
        node.runtimes
            .iter()
            .any(|runtime| runtime.kind == "ClaudeCode" && runtime.readiness == "ready")
    })
}

pub(crate) async fn ensure_channel_coordinators(state: &AppState) -> Result<(), MemberError> {
    for channel in state.channels().list_channels().await {
        let coordinator = state
            .members()
            .ensure_channel_coordinator_agent(&channel.id, &channel.name, "local-node")
            .await?;
        if let Err(error) = state
            .channels()
            .add_agent_to_channel(&channel.id, &coordinator.id)
            .await
        {
            return Err(MemberError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                error.to_string(),
            )));
        }
    }
    Ok(())
}

fn member_error_response(error: MemberError) -> Response {
    match error {
        MemberError::AgentNotFound => error_response(StatusCode::NOT_FOUND, &error.to_string()),
        MemberError::DuplicateHandle => error_response(StatusCode::CONFLICT, &error.to_string()),
        MemberError::MissingIdempotencyKey
        | MemberError::InvalidAgent
        | MemberError::InvalidHandle
        | MemberError::InvalidMemory
        | MemberError::WorkspaceBoundary
        | MemberError::SystemAgentImmutable => {
            error_response(StatusCode::BAD_REQUEST, &error.to_string())
        }
        MemberError::Io(_) | MemberError::Json(_) => {
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
        }
    }
}

fn error_response(status: StatusCode, error: &str) -> Response {
    (status, Json(json!({ "error": error }))).into_response()
}
