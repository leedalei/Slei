use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvePermissionRequest {
    request_id: String,
    decision: String,
}

pub async fn resolve_permission(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ResolvePermissionRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state
        .agent_dm()
        .resolve_permission(&payload.request_id, &payload.decision)
        .await
    {
        Ok(message) => Json(json!({ "message": message })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
