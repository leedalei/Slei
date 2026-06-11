use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::services::card_service::CardError;
use crate::state::AppState;

pub async fn complete(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
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

    match state.cards().complete(&id, idempotency_key).await {
        Ok(card) => Json(json!({ "card": card })).into_response(),
        Err(error) => card_error_response(error),
    }
}

fn card_error_response(error: CardError) -> Response {
    match error {
        CardError::CardNotFound => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        CardError::MissingIdempotencyKey
        | CardError::FreeformRejected
        | CardError::WorkspaceMountRejected
        | CardError::PrivilegeEscalationRejected
        | CardError::UnsupportedProductToolCardKind(_)
        | CardError::InvalidProductToolPayload(_) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        CardError::Io(_) | CardError::Json(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
