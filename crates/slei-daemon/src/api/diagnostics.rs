use axum::extract::State;
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::services::diagnostics_service::{DiagnosticEvent, DiagnosticsInput, DiagnosticsService};
use crate::state::AppState;

const DIAGNOSTICS_SCHEMA_VERSION: &str = "2026-05-27";

pub async fn get(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let counts = match state.orchestration().event_counts().await {
        Ok(counts) => counts,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };
    let node = state
        .nodes()
        .get_node("local-node")
        .or_else(|| state.nodes().list_nodes().into_iter().next());
    let recent_events = match state.orchestration().recent_diagnostic_events(50).await {
        Ok(events) => events
            .into_iter()
            .map(|event| DiagnosticEvent {
                sequence: event.sequence as u64,
                event_type: event.event_type,
                entity_id: event.entity_id.to_string(),
                payload: event.payload,
                created_at: event.created_at,
            })
            .collect(),
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };
    let node_name = node
        .as_ref()
        .map(|node| node.name.clone())
        .unwrap_or_else(|| "local-node".to_string());
    let runtime = node
        .and_then(|node| node.runtimes.into_iter().next())
        .map(|runtime| runtime.kind)
        .unwrap_or_else(|| "unknown".to_string());

    let service = DiagnosticsService;
    let snapshot = service
        .snapshot(DiagnosticsInput {
            node_name,
            runtime,
            worker: "claude-agent".to_string(),
            protocol_version: state.protocol_version.to_string(),
            schema_version: DIAGNOSTICS_SCHEMA_VERSION.to_string(),
            recent_failure: None,
            agent_inbox_event_count: counts.agent_inbox_event_count,
            memory_update_event_count: counts.memory_update_event_count,
            recent_events,
        })
        .await;

    Json(snapshot).into_response()
}

pub async fn not_implemented() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "error": "diagnostics endpoint is not wired yet" })),
    )
        .into_response()
}
