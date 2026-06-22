use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::services::saved_message_service::{SaveMessageRequest, SavedMessageError};
use crate::state::AppState;

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.saved_messages().list_saved_messages().await {
        Ok(saved_messages) => Json(json!({ "savedMessages": saved_messages })).into_response(),
        Err(error) => saved_message_error_response(error),
    }
}

pub async fn save(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SaveMessageRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.saved_messages().save_message(payload).await {
        Ok(outcome) => (
            if outcome.created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            },
            Json(json!({ "savedMessage": outcome.saved_message })),
        )
            .into_response(),
        Err(error) => saved_message_error_response(error),
    }
}

pub async fn unsave(
    State(state): State<AppState>,
    Path(message_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.saved_messages().unsave_message(&message_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => saved_message_error_response(error),
    }
}

fn saved_message_error_response(error: SavedMessageError) -> Response {
    match error {
        SavedMessageError::InvalidSavedMessage | SavedMessageError::SavedMessageNotFound => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        SavedMessageError::Storage(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
