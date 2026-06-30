use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::json;

use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRolePresetView {
    id: String,
    title: String,
    description: String,
    sort_order: i64,
}

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.orchestration().repos().agent_role_presets().await {
        Ok(presets) => Json(json!({
            "presets": presets
                .into_iter()
                .map(|preset| AgentRolePresetView {
                    id: preset.id,
                    title: preset.title,
                    description: preset.description,
                    sort_order: preset.sort_order,
                })
                .collect::<Vec<_>>()
        }))
        .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
