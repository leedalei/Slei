use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::config::DaemonConfig;
use slei_daemon::state::AppState;
use tower::ServiceExt;

#[tokio::test]
async fn health_reports_versions_without_sensitive_configuration() {
    let state = AppState::for_tests(AuthToken::from_static("test-token"));
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["daemon_version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(json["protocol_version"], "v1");
    assert!(json.get("token").is_none());
}

#[tokio::test]
async fn protected_routes_require_the_native_broker_token() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let app = build_router(state);

    let missing = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/nodes")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);

    let accepted = app
        .oneshot(
            Request::builder()
                .uri("/v1/nodes")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(accepted.status(), StatusCode::OK);
}

#[test]
fn runtime_descriptor_excludes_bearer_secret() {
    let config = DaemonConfig::for_tests(AuthToken::from_static("test-token"));
    let descriptor = config.runtime_descriptor();
    let json = serde_json::to_string(&descriptor).unwrap();

    assert!(json.contains("instance_id"));
    assert!(json.contains("port"));
    assert!(!json.contains("test-token"));
    assert!(!json.contains("authorization"));
}
