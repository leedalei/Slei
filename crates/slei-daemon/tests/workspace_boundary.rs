use std::fs;
use std::path::PathBuf;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::workspace_service::WorkspaceService;
use slei_daemon::state::AppState;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn registering_a_workspace_is_canonicalized_and_idempotent() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let app = build_router(state.clone());
    let workspace_dir = make_temp_dir("canonical-workspace");

    let body = json!({
        "path": workspace_dir.join(".").to_string_lossy(),
        "display_name": "Canonical Workspace"
    });

    let first = post_workspace(&app, &token, "register-workspace-1", body.clone()).await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let first_json = response_json(first).await;

    let retry = post_workspace(&app, &token, "register-workspace-1", body).await;
    assert_eq!(retry.status(), StatusCode::OK);
    let retry_json = response_json(retry).await;

    assert_eq!(first_json["workspace"]["id"], retry_json["workspace"]["id"]);
    assert_eq!(
        first_json["workspace"]["path"].as_str().unwrap(),
        fs::canonicalize(&workspace_dir).unwrap().to_string_lossy()
    );

    let events = state.events().replay(0).await;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "workspace.created");
}

#[tokio::test]
async fn workspace_registration_requires_idempotency_key() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));
    let workspace_dir = make_temp_dir("missing-idempotency");

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/workspaces")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"path": workspace_dir.to_string_lossy()}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn mounted_child_paths_cannot_escape_the_registered_workspace() {
    let root = make_temp_dir("workspace-root");
    let outside = make_temp_dir("workspace-outside");
    let outside_file = outside.join("secret.txt");
    fs::write(&outside_file, "not allowed").unwrap();

    #[cfg(unix)]
    {
        let link = root.join("escape");
        std::os::unix::fs::symlink(&outside_file, &link).unwrap();

        let service = WorkspaceService::for_tests();
        let workspace = service
            .register_workspace(root.to_string_lossy().as_ref(), None, "key-1")
            .await
            .unwrap();

        let err = service
            .validate_mount_path(&workspace.workspace.id, &link)
            .await
            .unwrap_err();

        assert!(err.to_string().contains("outside workspace"));
    }
}

async fn post_workspace(
    app: &axum::Router,
    token: &AuthToken,
    idempotency_key: &str,
    body: Value,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/workspaces")
                .header("authorization", token.authorization_header())
                .header("idempotency-key", idempotency_key)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn make_temp_dir(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("slei-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    path
}
