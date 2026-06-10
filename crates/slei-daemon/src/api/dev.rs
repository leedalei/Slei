use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::services::reset_service::{ResetError, ResetRuntimeError};
use crate::state::AppState;

pub async fn reset(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if std::env::var("SLEI_ENABLE_DEV_RESET").as_deref() != Ok("1") {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "dev_reset_disabled" })),
        )
            .into_response();
    }

    match state.reset().reset_development_state().await {
        Ok(receipt) => Json(json!({ "reset": receipt })).into_response(),
        Err(ResetError::Runtime(ResetRuntimeError::ResetInProgress)) => (
            StatusCode::CONFLICT,
            Json(json!({ "error": "reset_in_progress" })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "dev_reset_failed",
                "message": error.to_string(),
            })),
        )
            .into_response(),
    }
}
