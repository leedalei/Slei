use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ReplayQuery {
    after: Option<u64>,
}

pub async fn replay(
    State(state): State<AppState>,
    Query(query): Query<ReplayQuery>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let events = state.events().replay(query.after.unwrap_or_default()).await;
    Json(json!({ "events": events })).into_response()
}
