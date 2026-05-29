use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::conversation_service::ConversationError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDmRequest {
    agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendConversationMessageRequest {
    author_id: String,
    body: String,
}

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(json!({ "conversations": state.conversations().list_conversations().await }))
        .into_response()
}

pub async fn create_dm(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateDmRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    if !state
        .members()
        .list_product_agents()
        .await
        .iter()
        .any(|agent| agent.id == payload.agent_id)
    {
        return error_response(StatusCode::BAD_REQUEST, "agent not found");
    }

    match state.conversations().create_dm(&payload.agent_id).await {
        Ok((conversation, created)) => (
            if created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            },
            Json(json!({ "conversation": conversation })),
        )
            .into_response(),
        Err(error) => conversation_error_response(error),
    }
}

pub async fn messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.conversations().list_messages(&id).await {
        Ok(messages) => Json(json!({ "messages": messages })).into_response(),
        Err(error) => conversation_error_response(error),
    }
}

pub async fn send_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<SendConversationMessageRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok());

    match state
        .conversations()
        .append_message(&id, &payload.author_id, &payload.body, idempotency_key)
        .await
    {
        Ok(message) => {
            let mut response_message = message.clone();
            if id == "dm:agent_guide_local_node" && payload.author_id.starts_with("human:") {
                let card_key = idempotency_key
                    .map(|key| format!("guide-card-{key}"))
                    .unwrap_or_else(|| format!("guide-card-{}", message.id));
                match state
                    .cards()
                    .propose_guide_card(&id, &message.id, &payload.body, &card_key)
                    .await
                {
                    Ok(Some(card)) => {
                        if let Ok(updated) = state
                            .conversations()
                            .attach_cards(&id, &message.id, vec![card])
                            .await
                        {
                            response_message = updated;
                        }
                    }
                    Ok(None) => {}
                    Err(error) => return error_response(StatusCode::BAD_REQUEST, &error.to_string()),
                }
            }
            (StatusCode::CREATED, Json(json!({ "message": response_message }))).into_response()
        }
        Err(error) => conversation_error_response(error),
    }
}

fn conversation_error_response(error: ConversationError) -> Response {
    match error {
        ConversationError::ConversationNotFound => {
            error_response(StatusCode::NOT_FOUND, &error.to_string())
        }
        ConversationError::InvalidConversation | ConversationError::InvalidMessage => {
            error_response(StatusCode::BAD_REQUEST, &error.to_string())
        }
        ConversationError::Io(_) | ConversationError::Json(_) => {
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
        }
    }
}

fn error_response(status: StatusCode, error: &str) -> Response {
    (status, Json(json!({ "error": error }))).into_response()
}
