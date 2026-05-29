use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::state::AppState;

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(json!({ "nodes": state.nodes().list_nodes() })).into_response()
}

pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.nodes().get_node(&id) {
        Some(node) => Json(json!({ "node": node })).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct RenameLocalNodePayload {
    pub name: String,
}

pub async fn rename_local(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RenameLocalNodePayload>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.nodes().rename_local_node(&payload.name) {
        Ok(node) => Json(json!({ "node": node })).into_response(),
        Err(_) => StatusCode::BAD_REQUEST.into_response(),
    }
}
