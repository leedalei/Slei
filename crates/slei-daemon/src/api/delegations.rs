use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

pub async fn not_implemented() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "error": "delegation endpoint is not wired yet" })),
    )
        .into_response()
}
