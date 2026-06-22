use axum::extract::State;
use axum::routing::{delete, get, patch, post};
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
            get(api::channels::members).post(api::channels::add_member),
        )
        .route(
            "/v1/channels/{id}/sessions",
            get(api::channels::sessions).post(api::channels::create_session),
        )
        .route(
            "/v1/channels/{id}/sessions/{session_id}/active",
            patch(api::channels::activate_session),
        )
        .route(
            "/v1/channels/{id}/members/{agent_id}",
            delete(api::channels::remove_member),
        )
        .route(
            "/v1/channels/{id}/messages",
            get(api::messages::list_channel_messages).post(api::messages::send_channel_message),
        )
        .route(
            "/v1/message-threads/from-source-message",
            post(api::message_threads::create_from_source_message),
        )
        .route("/v1/message-threads/{id}", get(api::message_threads::get))
        .route(
            "/v1/message-threads/{id}/replies",
            post(api::message_threads::reply),
        )
        .route("/v1/messages/read", get(api::messages::read_messages))
        .route("/v1/messages/search", get(api::messages::search_messages))
        .route("/v1/messages/send", post(api::messages::send_agent_message))
        .route("/v1/search/global", get(api::search::global))
        .route(
            "/v1/saved-messages",
            get(api::saved_messages::list).post(api::saved_messages::save),
        )
        .route(
            "/v1/saved-messages/{message_id}",
            delete(api::saved_messages::unsave),
        )
        .route(
            "/v1/claims/messages/{message_id}",
            post(api::claims::claim_message),
        )
        .route("/v1/claims/tasks/{task_id}", post(api::claims::claim_task))
        .route(
            "/v1/agents",
            get(api::members::list_agents).post(api::members::create_agent),
        )
        .route(
            "/v1/agents/{agent_id}/status",
            post(api::claims::update_agent_status),
        )
        .route(
            "/v1/agents/{agent_id}/activity",
            get(api::claims::agent_activity),
        )
        .route(
            "/v1/agents/guide/bootstrap",
            post(api::members::bootstrap_guide),
        )
        .route(
            "/v1/agents/{id}",
            patch(api::members::update_agent).delete(api::members::delete_agent),
        )
        .route("/v1/agents/{id}/skills", get(api::members::list_skills))
        .route(
            "/v1/agents/{id}/memory/remember",
            post(api::members::remember_agent_fact),
        )
        .route(
            "/v1/interactive-cards/{id}/complete",
            post(api::cards::complete),
        )
        .route(
            "/v1/approvals/permissions/resolve",
            post(api::approvals::resolve_permission),
        )
        .route("/v1/conversations", get(api::conversations::list))
        .route("/v1/conversations/dm", post(api::conversations::create_dm))
        .route(
            "/v1/attachments",
            post(api::conversations::upload_attachment),
        )
        .route(
            "/v1/conversations/{id}/sessions",
            get(api::conversations::sessions).post(api::conversations::create_session),
        )
        .route(
            "/v1/conversations/{id}/sessions/{session_id}/active",
            patch(api::conversations::activate_session),
        )
        .route(
            "/v1/conversations/{id}/messages",
            get(api::conversations::messages).post(api::conversations::send_message),
        )
        .route(
            "/v1/conversations/{id}/runtime-session/reset",
            post(api::conversations::reset_runtime_session),
        )
        .route("/v1/tasks", get(api::tasks::list).post(api::tasks::create))
        .route(
            "/v1/tasks/from-source-message",
            post(api::tasks::create_from_source_message),
        )
        .route("/v1/tasks/{id}", patch(api::tasks::update))
        .route("/v1/tasks/{id}/replies", post(api::tasks::reply))
        .route("/v1/tasks/{id}/thread", get(api::tasks::thread))
        .route("/v1/tasks/{id}/status", patch(api::tasks::update_status))
        .route(
            "/v1/workspaces",
            get(api::workspaces::list).post(api::workspaces::create),
        )
        .route(
            "/v1/settings/preferences",
            get(api::settings::get_preferences).patch(api::settings::update_preferences),
        )
        .route(
            "/v1/settings/profile",
            get(api::settings::get_profile).patch(api::settings::update_profile),
        )
        .route("/v1/diagnostics", get(api::diagnostics::get))
        .route("/v1/dev/reset", post(api::dev::reset))
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
