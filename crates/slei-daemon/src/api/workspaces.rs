use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::workspace_service::WorkspaceError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct RegisterWorkspaceRequest {
    path: String,
    display_name: Option<String>,
}

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let workspaces = state.workspaces().list_workspaces().await;
    Json(json!({ "workspaces": workspaces })).into_response()
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RegisterWorkspaceRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let Some(idempotency_key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
    else {
        return Json(json!({ "error": "missing idempotency key" }))
            .with_status(StatusCode::BAD_REQUEST);
    };

    match state
        .workspaces()
        .register_workspace(&payload.path, payload.display_name, idempotency_key)
        .await
    {
        Ok(result) => {
            Json(json!({ "workspace": result.workspace })).with_status(if result.created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            })
        }
        Err(WorkspaceError::MissingIdempotencyKey) => {
            Json(json!({ "error": "missing idempotency key" })).with_status(StatusCode::BAD_REQUEST)
        }
        Err(err) => Json(json!({ "error": err.to_string() })).with_status(StatusCode::BAD_REQUEST),
    }
}

trait JsonStatus {
    fn with_status(self, status: StatusCode) -> Response;
}

impl<T> JsonStatus for Json<T>
where
    T: serde::Serialize,
{
    fn with_status(self, status: StatusCode) -> Response {
        (status, self).into_response()
    }
}
