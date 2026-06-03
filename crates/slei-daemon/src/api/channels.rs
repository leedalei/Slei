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
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    let agent_ids = payload.agent_ids.unwrap_or_default();
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
            for agent_id in agent_ids {
                if let Err(error) = state
                    .channels()
                    .add_agent_to_channel(&channel.id, &agent_id)
                    .await
                {
                    return channel_error_response(error);
                }
                state
                    .memory_events()
                    .request_channel_join_update(&agent_id, &channel.id)
                    .await;
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
        ChannelError::Io(_) | ChannelError::Json(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
