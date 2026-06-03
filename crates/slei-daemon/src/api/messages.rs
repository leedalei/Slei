use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::channel_orchestrator_service::SendChannelMessageInput;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageRequest {
    author_id: String,
    body: String,
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

    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    match state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id,
            author_id: payload.author_id,
            body: payload.body,
            idempotency_key: idempotency_key.to_string(),
        })
        .await
    {
        Ok(outcome) => Json(json!({ "outcome": outcome })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
