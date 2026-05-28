use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;

use crate::api;
use crate::state::AppState;

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/nodes", get(api::nodes::list))
        .route("/v1/nodes/{id}", get(api::nodes::get))
        .route(
            "/v1/workspaces",
            get(api::workspaces::list).post(api::workspaces::create),
        )
        .route("/v1/events/ws", get(api::events::replay))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "daemon_version": state.daemon_version,
        "protocol_version": state.protocol_version,
        "status": "ok",
    }))
}
