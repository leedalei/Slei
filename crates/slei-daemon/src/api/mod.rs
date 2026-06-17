pub mod approvals;
pub mod artifacts;
pub mod capabilities;
pub mod cards;
pub mod channels;
pub mod claims;
pub mod conversations;
pub mod delegations;
pub mod dev;
pub mod diagnostics;
pub mod events;
pub mod members;
pub mod messages;
pub mod nodes;
pub mod notifications;
pub mod runs;
pub mod search;
pub mod settings;
pub mod tasks;
pub mod workspaces;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::services::reset_service::{ResetLaunchGuard, ResetRuntimeError};
use crate::state::AppState;

pub(crate) async fn begin_resettable_write(state: &AppState) -> Result<ResetLaunchGuard, Response> {
    state
        .reset()
        .runtime()
        .begin_launch()
        .await
        .map_err(reset_runtime_error_response)
}

pub(crate) async fn begin_resettable_read(state: &AppState) -> Result<ResetLaunchGuard, Response> {
    state
        .reset()
        .runtime()
        .begin_launch()
        .await
        .map_err(reset_runtime_error_response)
}

pub(crate) fn reset_runtime_error_response(error: ResetRuntimeError) -> Response {
    match error {
        ResetRuntimeError::ResetInProgress => (
            StatusCode::CONFLICT,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
