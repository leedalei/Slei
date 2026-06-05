use std::collections::HashSet;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::channel_service::{ChannelDraft, ChannelError, PermissionPreset};
use crate::state::AppState;

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(json!({ "channels": state.channels().list_channels().await })).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChannelRequest {
    name: String,
    description: Option<String>,
    agent_ids: Option<Vec<String>>,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateChannelRequest>,
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

    let agent_ids = dedupe_agent_ids(payload.agent_ids.unwrap_or_default());
    for agent_id in &agent_ids {
        if let Err(error) = state.members().get_product_agent(agent_id).await {
            return error_response(StatusCode::BAD_REQUEST, &error.to_string());
        }
    }

    match state
        .channels()
        .create_channel(
            ChannelDraft {
                name: payload.name,
                description: payload.description,
                permission: PermissionPreset::Controlled,
            },
            idempotency_key,
        )
        .await
    {
        Ok(channel) => {
            let coordinator = match state
                .members()
                .ensure_channel_coordinator_agent(&channel.id, &channel.name, "local-node")
                .await
            {
                Ok(coordinator) => coordinator,
                Err(error) => {
                    return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
                }
            };
            if let Err(error) = state
                .channels()
                .add_agent_to_channel(&channel.id, &coordinator.id)
                .await
            {
                return channel_error_response(error);
            }
            for agent_id in agent_ids {
                let outcome = match state
                    .channels()
                    .add_agent_to_channel_with_outcome(&channel.id, &agent_id)
                    .await
                {
                    Ok(outcome) => outcome,
                    Err(error) => return channel_error_response(error),
                };
                if outcome.created {
                    state
                        .memory_events()
                        .request_channel_join_update(&agent_id, &channel.id)
                        .await;
                }
            }
            (StatusCode::CREATED, Json(json!({ "channel": channel }))).into_response()
        }
        Err(error) => channel_error_response(error),
    }
}

pub async fn members(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.channels().channel_members(&id).await {
        Ok(members) => Json(json!({ "members": members })).into_response(),
        Err(error) => channel_error_response(error),
    }
}

fn dedupe_agent_ids(agent_ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    agent_ids
        .into_iter()
        .filter_map(|agent_id| {
            let trimmed = agent_id.trim().to_string();
            if !seen.insert(trimmed.clone()) {
                None
            } else {
                Some(trimmed)
            }
        })
        .collect()
}

fn channel_error_response(error: ChannelError) -> Response {
    match error {
        ChannelError::MissingChannel | ChannelError::MissingMember => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        ChannelError::InvalidChannel => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        ChannelError::MissingIdempotencyKey => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        ChannelError::Io(_) | ChannelError::Json(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

fn error_response(status: StatusCode, error: &str) -> Response {
    (status, Json(json!({ "error": error }))).into_response()
}
