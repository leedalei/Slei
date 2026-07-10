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
    profession: String,
    description: String,
    category_id: String,
    sort_order: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRolePresetCategoryView {
    id: String,
    title: String,
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

    let repos = state.orchestration().repos();
    match (
        repos.agent_role_preset_categories().await,
        repos.agent_role_presets().await,
    ) {
        (Ok(categories), Ok(presets)) => Json(json!({
            "categories": categories
                .into_iter()
                .map(|category| AgentRolePresetCategoryView {
                    id: category.id,
                    title: category.title,
                    sort_order: category.sort_order,
                })
                .collect::<Vec<_>>(),
            "presets": presets
                .into_iter()
                .map(|preset| AgentRolePresetView {
                    id: preset.id,
                    title: preset.title,
                    profession: preset.profession,
                    description: preset.description,
                    category_id: preset.category_id,
                    sort_order: preset.sort_order,
                })
                .collect::<Vec<_>>()
        }))
        .into_response(),
        (Err(error), _) | (_, Err(error)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
