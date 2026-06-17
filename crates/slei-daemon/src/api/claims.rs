use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use slei_storage::repositories::AgentActivityLogRow;

use crate::services::claim_service::{AgentStatusUpdate, ClaimError};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRequest {
    agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityQuery {
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentActivityLogView {
    id: String,
    agent_id: String,
    run_id: Option<String>,
    channel_id: Option<String>,
    message_id: Option<String>,
    task_id: Option<String>,
    state: String,
    phase: Option<String>,
    reason: Option<String>,
    created_at: String,
}

impl From<AgentActivityLogRow> for AgentActivityLogView {
    fn from(row: AgentActivityLogRow) -> Self {
        Self {
            id: row.id,
            agent_id: row.agent_id,
            run_id: row.run_id,
            channel_id: row.channel_id,
            message_id: row.message_id,
            task_id: row.task_id,
            state: row.state,
            phase: row.phase,
            reason: row.reason,
            created_at: row.created_at,
        }
    }
}

pub async fn claim_message(
    State(state): State<AppState>,
    Path(message_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<ClaimRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state
        .claims()
        .claim_message(&message_id, &payload.agent_id)
        .await
    {
        Ok(response) => {
            if response.claimed {
                let _ = state
                    .orchestration()
                    .record_diagnostic_event(
                        "message_claimed",
                        &format!(
                            "message_id={} agent_id={}",
                            message_id,
                            response.agent_id.as_deref().unwrap_or(&payload.agent_id)
                        ),
                    )
                    .await;
            }
            Json(response).into_response()
        }
        Err(error) => claim_error_response(error),
    }
}

pub async fn claim_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<ClaimRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.claims().claim_task(&task_id, &payload.agent_id).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => claim_error_response(error),
    }
}

pub async fn update_agent_status(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<AgentStatusUpdate>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let Some(idempotency_key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "idempotency-key is required" })),
        )
            .into_response();
    };

    match state
        .claims()
        .update_agent_status_idempotent(&agent_id, payload.clone(), idempotency_key)
        .await
    {
        Ok(()) => {
            let _ = state
                .orchestration()
                .record_diagnostic_event(
                    "agent_activity.updated",
                    &format!(
                        "agent_id={} run_id={} channel_id={} message_id={} task_id={} state={} phase={}",
                        agent_id,
                        payload.run_id.as_deref().unwrap_or("none"),
                        payload.channel_id.as_deref().unwrap_or("none"),
                        payload.message_id.as_deref().unwrap_or("none"),
                        payload.task_id.as_deref().unwrap_or("none"),
                        payload.state,
                        diagnostic_token(payload.phase.as_deref().unwrap_or(""))
                    ),
                )
                .await;
            Json(json!({ "ok": true })).into_response()
        }
        Err(error) => claim_error_response(error),
    }
}

pub async fn agent_activity(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Query(query): Query<ActivityQuery>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state
        .claims()
        .activity_logs(&agent_id, query.limit.unwrap_or(20))
        .await
    {
        Ok(logs) => {
            let logs: Vec<AgentActivityLogView> =
                logs.into_iter().map(AgentActivityLogView::from).collect();
            Json(json!({ "logs": logs })).into_response()
        }
        Err(error) => claim_error_response(error),
    }
}

fn claim_error_response(error: ClaimError) -> Response {
    let status = match &error {
        ClaimError::MissingIdempotencyKey | ClaimError::InvalidInput(_) => StatusCode::BAD_REQUEST,
        ClaimError::Json(_) | ClaimError::Storage(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(json!({ "error": error.to_string() }))).into_response()
}

fn diagnostic_token(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join("_")
}
