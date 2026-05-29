use axum::extract::State;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde_json::json;

use crate::api;
use crate::state::AppState;

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/nodes", get(api::nodes::list))
        .route("/v1/nodes/{id}", get(api::nodes::get))
        .route("/v1/nodes/local-node/name", patch(api::nodes::rename_local))
        .route(
            "/v1/channels",
            get(api::channels::list).post(api::channels::create),
        )
        .route(
            "/v1/channels/{id}/members",
            get(api::channels::members),
        )
        .route(
            "/v1/agents",
            get(api::members::list_agents).post(api::members::create_agent),
        )
        .route(
            "/v1/agents/guide/bootstrap",
            post(api::members::bootstrap_guide),
        )
        .route("/v1/agents/{id}", patch(api::members::update_agent))
        .route("/v1/agents/{id}/skills", get(api::members::list_skills))
        .route(
            "/v1/agents/{id}/memory/remember",
            post(api::members::remember_agent_fact),
        )
        .route(
            "/v1/interactive-cards/{id}/complete",
            post(api::cards::complete),
        )
        .route("/v1/conversations", get(api::conversations::list))
        .route("/v1/conversations/dm", post(api::conversations::create_dm))
        .route(
            "/v1/conversations/{id}/messages",
            get(api::conversations::messages).post(api::conversations::send_message),
        )
        .route(
            "/v1/workspaces",
            get(api::workspaces::list).post(api::workspaces::create),
        )
        .route(
            "/v1/settings/preferences",
            get(api::settings::get_preferences).patch(api::settings::update_preferences),
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
