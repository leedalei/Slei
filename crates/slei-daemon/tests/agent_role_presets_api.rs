use std::fs;
use std::path::PathBuf;

use axum::body::{to_bytes, Body};
use axum::http::{Request, Response, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn lists_enabled_agent_role_presets_from_sqlite_sorted() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-role-presets-api-list");
    let app = build_router(AppState::for_tests_with_agent_root_async(token.clone(), root).await);

    let response = get_json(&app, &token, "/v1/agent-role-presets").await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let presets = body["presets"].as_array().unwrap();
    assert_eq!(presets.len(), 10);
    assert_eq!(presets[0]["id"], "xiaohongshu-researcher");
    assert_eq!(presets[0]["title"], "小红书调研员");
    assert_eq!(presets[0]["sortOrder"], 10);
    assert!(!presets
        .iter()
        .any(|preset| preset.get("enabled") == Some(&json!(false))));
}

#[tokio::test]
async fn agent_create_accepts_chinese_handle_and_persists_avatar_seed() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-role-presets-api-create-chinese");
    let app = build_router(AppState::for_tests_with_agent_root_async(token.clone(), root).await);

    let response = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-xiaohongshu-researcher"),
        json!({
            "name": "小红书调研员",
            "handle": "@小红书调研员",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "负责从小红书调研信息并整理结论。",
            "avatarSeed": "avatar-custom-seed"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response_json(response).await;
    let agent = &body["agent"];
    assert_eq!(agent["name"], "小红书调研员");
    assert_eq!(agent["handle"], "@小红书调研员");
    assert_eq!(agent["avatarSeed"], "avatar-custom-seed");
}

#[tokio::test]
async fn agent_create_rejects_name_with_space_or_hyphen_and_duplicate_name() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-role-presets-api-create-name-validation");
    let app = build_router(AppState::for_tests_with_agent_root_async(token.clone(), root).await);

    let space_name = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-space-name"),
        json!({
            "name": "系统 架构师",
            "handle": "@系统架构师",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "名称包含空格，应被拒绝。"
        }),
    )
    .await;
    assert_eq!(space_name.status(), StatusCode::BAD_REQUEST);

    let hyphen_name = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-hyphen-name"),
        json!({
            "name": "legal-researcher",
            "handle": "@legalresearcher",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "名称包含连字符，应被拒绝。"
        }),
    )
    .await;
    assert_eq!(hyphen_name.status(), StatusCode::BAD_REQUEST);

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-architect"),
        json!({
            "name": "架构师",
            "handle": "@架构师",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "负责系统设计。"
        }),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);

    let duplicate_name = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-architect-duplicate-name"),
        json!({
            "name": "  架构师  ",
            "handle": "@架构师二号",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "同名不同 handle，应被拒绝。"
        }),
    )
    .await;
    assert_eq!(duplicate_name.status(), StatusCode::CONFLICT);
    let duplicate_name_body = response_json(duplicate_name).await;
    assert_eq!(duplicate_name_body["error"], "duplicate name");
}

#[tokio::test]
async fn agent_create_rejects_invalid_handles_and_preserves_case() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-role-presets-api-handle-validation");
    let app = build_router(AppState::for_tests_with_agent_root_async(token.clone(), root).await);

    let whitespace_handle = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-whitespace-handle"),
        json!({
            "name": "WhitespaceHandle",
            "handle": "@white space",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "Handle contains whitespace."
        }),
    )
    .await;
    assert_eq!(whitespace_handle.status(), StatusCode::BAD_REQUEST);

    let hyphen_handle = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-hyphen-handle"),
        json!({
            "name": "HyphenHandle",
            "handle": "@hyphen-handle",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "Handle contains hyphen."
        }),
    )
    .await;
    assert_eq!(hyphen_handle.status(), StatusCode::BAD_REQUEST);

    let mixed_case = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-mixed-case-handle"),
        json!({
            "name": "MixedCase",
            "handle": "@CasePreserved",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "Handle case should be preserved."
        }),
    )
    .await;
    assert_eq!(mixed_case.status(), StatusCode::CREATED);
    let mixed_case_body = response_json(mixed_case).await;
    assert_eq!(mixed_case_body["agent"]["handle"], "@CasePreserved");
}

#[tokio::test]
async fn agent_create_rejects_unicode_case_duplicate_handle() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-role-presets-api-unicode-handle-duplicate");
    let app = build_router(AppState::for_tests_with_agent_root_async(token.clone(), root).await);

    let first = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-uppercase-umlaut-handle"),
        json!({
            "name": "UmlautUpper",
            "handle": "@Ä",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "Uses uppercase non-ASCII handle."
        }),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);

    let duplicate = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-lowercase-umlaut-handle"),
        json!({
            "name": "UmlautLower",
            "handle": "@ä",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "Should conflict after Rust Unicode lowercase folding."
        }),
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    let body = response_json(duplicate).await;
    assert_eq!(body["error"], "duplicate handle");
}

#[tokio::test]
async fn agent_update_rejects_invalid_or_duplicate_display_name() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-role-presets-api-update-name-validation");
    let app = build_router(AppState::for_tests_with_agent_root_async(token.clone(), root).await);

    let first = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-update-name-first"),
        json!({
            "name": "架构师",
            "handle": "@架构师",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "负责系统设计。"
        }),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let first_body = response_json(first).await;
    let first_id = first_body["agent"]["id"].as_str().unwrap();

    let second = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-update-name-second"),
        json!({
            "name": "调研员",
            "handle": "@调研员",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "负责资料调研。"
        }),
    )
    .await;
    assert_eq!(second.status(), StatusCode::CREATED);
    let second_body = response_json(second).await;
    let second_id = second_body["agent"]["id"].as_str().unwrap();

    let spaced = patch_json(
        &app,
        &token,
        &format!("/v1/agents/{first_id}"),
        json!({ "name": "Foo Bar" }),
    )
    .await;
    assert_eq!(spaced.status(), StatusCode::BAD_REQUEST);

    let hyphenated = patch_json(
        &app,
        &token,
        &format!("/v1/agents/{first_id}"),
        json!({ "name": "Foo-Bar" }),
    )
    .await;
    assert_eq!(hyphenated.status(), StatusCode::BAD_REQUEST);

    let duplicate = patch_json(
        &app,
        &token,
        &format!("/v1/agents/{second_id}"),
        json!({ "name": "  架构师  " }),
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    let duplicate_body = response_json(duplicate).await;
    assert_eq!(duplicate_body["error"], "duplicate name");
}

async fn get_json(app: &axum::Router, token: &AuthToken, uri: &str) -> Response<Body> {
    app.clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri)
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn post_json(
    app: &axum::Router,
    token: &AuthToken,
    uri: &str,
    idempotency_key: Option<&str>,
    body: Value,
) -> Response<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri(uri)
        .header("authorization", token.authorization_header())
        .header("content-type", "application/json");
    if let Some(key) = idempotency_key {
        builder = builder.header("idempotency-key", key);
    }
    app.clone()
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
}

async fn patch_json(
    app: &axum::Router,
    token: &AuthToken,
    uri: &str,
    body: Value,
) -> Response<Body> {
    app.clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(uri)
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn response_json(response: Response<Body>) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn make_temp_dir(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("slei-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    path
}
