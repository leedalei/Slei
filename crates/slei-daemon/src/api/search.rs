use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono_tz::Tz;
use serde::Deserialize;
use serde_json::json;

use crate::services::search_service::{
    default_time_zone, GlobalSearchInput, SearchError, TimeRange,
};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchQuery {
    query: String,
    from_id: Option<String>,
    channel_id: Option<String>,
    time_range: Option<String>,
    time_zone: Option<String>,
    include_agents: Option<bool>,
    include_channels: Option<bool>,
    include_messages: Option<bool>,
    agent_limit: Option<i64>,
    channel_limit: Option<i64>,
    message_limit: Option<i64>,
}

pub async fn global(
    State(state): State<AppState>,
    Query(query): Query<GlobalSearchQuery>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let time_zone = effective_time_zone(&state, query.time_zone.as_deref()).await;
    let input = GlobalSearchInput {
        query: query.query,
        from_id: query.from_id,
        channel_id: query.channel_id,
        time_range: parse_time_range(query.time_range.as_deref()),
        time_zone: Some(time_zone),
        include_agents: query.include_agents.unwrap_or(true),
        include_channels: query.include_channels.unwrap_or(true),
        include_messages: query.include_messages.unwrap_or(true),
        agent_limit: query.agent_limit.unwrap_or(20),
        channel_limit: query.channel_limit.unwrap_or(20),
        message_limit: query.message_limit.unwrap_or(80),
    };

    match state.search().global_search(input).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => search_error_response(error),
    }
}

async fn effective_time_zone(state: &AppState, query_time_zone: Option<&str>) -> String {
    if let Some(time_zone) = valid_time_zone(query_time_zone) {
        return time_zone;
    }
    let preferences = state.settings().preferences().await;
    if let Some(time_zone) = valid_time_zone(Some(&preferences.time_zone)) {
        return time_zone;
    }
    default_time_zone().to_string()
}

fn valid_time_zone(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| value.parse::<Tz>().is_ok())
        .map(str::to_string)
}

fn parse_time_range(value: Option<&str>) -> TimeRange {
    match value.unwrap_or("any") {
        "today" => TimeRange::Today,
        "last7Days" => TimeRange::Last7Days,
        "last30Days" => TimeRange::Last30Days,
        _ => TimeRange::Any,
    }
}

fn search_error_response(error: SearchError) -> Response {
    let status = match error {
        SearchError::EmptyQuery => StatusCode::BAD_REQUEST,
        SearchError::Storage(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(json!({ "error": error.to_string() }))).into_response()
}
