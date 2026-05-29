use std::fs;
use std::path::PathBuf;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn creating_agent_generates_workspace_memory_and_docs() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-root");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let app = build_router(state);

    let response = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-coda"),
        json!({
            "name": "Coda",
            "handle": "@coda",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "研发团队开发工程师。基于架构师的技术方案和任务分解进行实际编码工作。"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response_json(response).await;
    let agent = &body["agent"];
    let id = agent["id"].as_str().unwrap();
    let workspace = PathBuf::from(agent["workspacePath"].as_str().unwrap());

    assert!(workspace.starts_with(root.join("agents")));
    assert!(workspace.ends_with(id));
    assert!(workspace.join("docs").is_dir());

    let memory = fs::read_to_string(workspace.join("MEMORY.md")).unwrap();
    assert!(memory.contains("# Coda"));
    assert!(memory.contains("## Role"));
    assert!(memory.contains("研发团队开发工程师"));
    assert!(memory.contains("## Team"));
    assert!(memory.contains("@coda — 我自己"));
    assert!(memory.contains("## Key Knowledge"));
    assert!(memory.contains("主频道：#all"));
    assert!(memory.contains("## Active Context"));
    assert_eq!(agent["agentKind"], "agent");
    assert_eq!(agent["systemOwned"], false);
    assert_eq!(agent["channelIds"], json!(["all"]));
    assert_eq!(agent["runtimeThread"]["runtimeKind"], "ClaudeCode");
    assert_eq!(agent["runtimeThread"]["status"], "ready");
    assert!(agent["runtimeThread"].get("sessionId").is_none());

    let all_members = get_json(&app, &token, "/v1/channels/all/members").await;
    assert_eq!(all_members.status(), StatusCode::OK);
    let all_members_body = response_json(all_members).await;
    assert_eq!(all_members_body["members"][0]["agentId"], id);
}

#[tokio::test]
async fn guide_bootstrap_creates_real_leelei_agent_dm_skills_and_all_membership() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("guide-bootstrap-real");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    state.nodes().set_runtime_ready_for_tests("1.2.3");
    let app = build_router(state);

    let first = post_json(
        &app,
        &token,
        "/v1/agents/guide/bootstrap",
        Some("bootstrap-guide"),
        json!({}),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let first_body = response_json(first).await;
    let guide = &first_body["agent"];
    assert_eq!(first_body["status"], "created");
    assert_eq!(guide["id"], "agent_guide_local_node");
    assert_eq!(guide["name"], "Leelei");
    assert_eq!(guide["handle"], "@leelei");
    assert_eq!(guide["agentKind"], "guide");
    assert_eq!(guide["systemOwned"], true);
    assert_eq!(guide["channelIds"], json!(["all"]));
    assert_eq!(guide["runtimeThread"]["status"], "ready");
    assert!(serde_json::to_string(guide).unwrap().find("session_").is_none());

    let workspace = PathBuf::from(guide["workspacePath"].as_str().unwrap());
    assert!(workspace.ends_with("agent_guide_local_node"));
    assert!(workspace.join("MEMORY.md").is_file());
    assert!(workspace.join("docs").is_dir());
    assert!(workspace.join("skills/index.json").is_file());
    assert!(workspace.join("skills/guide-create.skill.md").is_file());
    assert!(workspace.join("skills/memory.skill.md").is_file());

    let skills = get_json(&app, &token, "/v1/agents/agent_guide_local_node/skills").await;
    assert_eq!(skills.status(), StatusCode::OK);
    let skills_body = response_json(skills).await;
    assert_eq!(skills_body["skills"].as_array().unwrap().len(), 2);
    assert!(skills_body["skills"].to_string().contains("guide-create"));
    assert!(skills_body["skills"].to_string().contains("memory"));

    let conversations = get_json(&app, &token, "/v1/conversations").await;
    let conversations_body = response_json(conversations).await;
    assert_eq!(conversations_body["conversations"][0]["agentId"], "agent_guide_local_node");
    let conversation_id = conversations_body["conversations"][0]["id"].as_str().unwrap();
    let messages = get_json(&app, &token, &format!("/v1/conversations/{conversation_id}/messages")).await;
    assert!(response_json(messages).await["messages"][0]["body"]
        .as_str()
        .unwrap()
        .contains("Leelei"));

    let second = post_json(
        &app,
        &token,
        "/v1/agents/guide/bootstrap",
        Some("bootstrap-guide-retry"),
        json!({}),
    )
    .await;
    assert_eq!(second.status(), StatusCode::OK);
    assert_eq!(response_json(second).await["status"], "alreadyExists");

    let listed = get_json(&app, &token, "/v1/agents").await;
    assert_eq!(response_json(listed).await["agents"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn guide_bootstrap_waits_for_runtime_ready() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("guide-bootstrap-runtime");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    state.nodes().set_runtimes_for_tests(vec![]);
    let app = build_router(state);

    let response = post_json(
        &app,
        &token,
        "/v1/agents/guide/bootstrap",
        Some("bootstrap-unavailable"),
        json!({}),
    )
    .await;

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let body = response_json(response).await;
    assert_eq!(body["status"], "runtimeUnavailable");
    assert_eq!(get_json(&app, &token, "/v1/agents").await.status(), StatusCode::OK);
}

#[tokio::test]
async fn channels_normalize_hash_prefix_and_default_all_is_persistent() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channels");
    let app = build_router(AppState::for_tests_with_agent_root(token.clone(), root.clone()));

    let channels = get_json(&app, &token, "/v1/channels").await;
    assert_eq!(channels.status(), StatusCode::OK);
    let channels_body = response_json(channels).await;
    assert_eq!(channels_body["channels"][0]["id"], "all");
    assert_eq!(channels_body["channels"][0]["name"], "all");
    assert_eq!(channels_body["channels"][0]["isDefault"], true);
    assert!(!channels_body.to_string().contains("#all"));

    let created = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-dev-team"),
        json!({ "name": "#dev-team", "description": "Dev team" }),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_body = response_json(created).await;
    assert_eq!(created_body["channel"]["id"], "dev-team");
    assert_eq!(created_body["channel"]["name"], "dev-team");

    let reloaded = build_router(AppState::for_tests_with_agent_root(token.clone(), root.clone()));
    let listed = response_json(get_json(&reloaded, &token, "/v1/channels").await).await;
    assert_eq!(listed["channels"].as_array().unwrap().len(), 2);
    assert!(root.join("channels/index.json").is_file());
}

#[tokio::test]
async fn guide_skill_creates_persistent_interactive_cards_and_completion_is_idempotent() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("interactive-cards");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    state.nodes().set_runtime_ready_for_tests("1.2.3");
    let app = build_router(state);
    let guide = post_json(
        &app,
        &token,
        "/v1/agents/guide/bootstrap",
        Some("bootstrap-guide-card"),
        json!({}),
    )
    .await;
    assert_eq!(guide.status(), StatusCode::CREATED);

    let conversations = response_json(get_json(&app, &token, "/v1/conversations").await).await;
    let conversation_id = conversations["conversations"][0]["id"].as_str().unwrap();
    let sent = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("message-create-agent"),
        json!({ "body": "帮我创建一个叫 Nancy 的 QA Agent", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);

    let messages = response_json(get_json(&app, &token, &format!("/v1/conversations/{conversation_id}/messages")).await).await;
    let card = &messages["messages"][1]["cards"][0];
    assert_eq!(card["kind"], "createAgent");
    assert_eq!(card["state"], "pending");
    assert_eq!(card["draft"]["name"], "Nancy");
    assert_eq!(card["actionLabel"], "创建");

    let card_id = card["id"].as_str().unwrap();
    let done = post_json(
        &app,
        &token,
        &format!("/v1/interactive-cards/{card_id}/complete"),
        Some("complete-card"),
        json!({}),
    )
    .await;
    assert_eq!(done.status(), StatusCode::OK);
    let done_body = response_json(done).await;
    assert_eq!(done_body["card"]["state"], "done");
    assert_eq!(done_body["card"]["doneLabel"], "DONE");

    let duplicate = post_json(
        &app,
        &token,
        &format!("/v1/interactive-cards/{card_id}/complete"),
        Some("complete-card-retry"),
        json!({}),
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::OK);
    assert_eq!(response_json(duplicate).await["card"]["state"], "done");
}

#[tokio::test]
async fn agent_create_validates_handle_uniqueness_node_and_runtime() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-validation");
    let app = build_router(AppState::for_tests_with_agent_root(token.clone(), root));

    let first = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-one"),
        json!({
            "name": "Coda",
            "handle": "coda",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "开发工程师"
        }),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);

    let duplicate = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-two"),
        json!({
            "name": "Other",
            "handle": "@coda",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "duplicate handle"
        }),
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let bad_node = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-bad-node"),
        json!({
            "name": "Remote",
            "handle": "@remote",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "missing-node",
            "description": "bad node"
        }),
    )
    .await;
    assert_eq!(bad_node.status(), StatusCode::BAD_REQUEST);

    let bad_runtime = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-bad-runtime"),
        json!({
            "name": "NoRuntime",
            "handle": "@no-runtime",
            "runtimeKind": "ImaginaryRuntime",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "bad runtime"
        }),
    )
    .await;
    assert_eq!(bad_runtime.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn remembering_a_fact_appends_to_agent_memory_inside_workspace() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-memory");
    let app = build_router(AppState::for_tests_with_agent_root(
        token.clone(),
        root.clone(),
    ));

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-memory-agent"),
        json!({
            "name": "Nancy",
            "handle": "@nancy",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "QA 质保员，审查代码质量、安全漏洞，提出改进意见。"
        }),
    )
    .await;
    let created_body = response_json(created).await;
    let agent_id = created_body["agent"]["id"].as_str().unwrap().to_string();
    let memory_path = PathBuf::from(created_body["agent"]["memoryPath"].as_str().unwrap());

    let remembered = post_json(
        &app,
        &token,
        &format!("/v1/agents/{agent_id}/memory/remember"),
        None,
        json!({ "fact": "记住：Nancy 优先检查安全漏洞和测试覆盖率。" }),
    )
    .await;

    assert_eq!(remembered.status(), StatusCode::OK);
    let memory = fs::read_to_string(&memory_path).unwrap();
    assert!(memory.contains("Nancy 优先检查安全漏洞和测试覆盖率"));
    assert!(memory_path.starts_with(root.join("agents")));
}

#[tokio::test]
async fn agent_routes_require_authorization() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-auth");
    let app = build_router(AppState::for_tests_with_agent_root(token, root));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/agents")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn agents_persist_to_slei_data_root_and_reload() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-reload");
    let app = build_router(AppState::for_tests_with_agent_root(
        token.clone(),
        root.clone(),
    ));

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-persisted-agent"),
        json!({
            "name": "Alice",
            "handle": "@alice",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "研发团队架构师，负责方案和验收标准。"
        }),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);

    let reloaded = build_router(AppState::for_tests_with_agent_root(
        token.clone(),
        root.clone(),
    ));
    let listed = get_json(&reloaded, &token, "/v1/agents").await;
    assert_eq!(listed.status(), StatusCode::OK);
    let body = response_json(listed).await;

    assert_eq!(body["agents"].as_array().unwrap().len(), 1);
    assert_eq!(body["agents"][0]["handle"], "@alice");
    assert!(root.join("agents/index.json").is_file());
    assert!(body["agents"][0]["createdAt"].as_str().unwrap().len() > 4);
}

#[tokio::test]
async fn dm_conversation_and_messages_persist_through_daemon_reload() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("conversation-reload");
    let app = build_router(AppState::for_tests_with_agent_root(
        token.clone(),
        root.clone(),
    ));

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-dm-agent"),
        json!({
            "name": "Coda",
            "handle": "@coda",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "研发团队开发工程师。"
        }),
    )
    .await;
    let created_body = response_json(created).await;
    let agent_id = created_body["agent"]["id"].as_str().unwrap();

    let conversation = post_json(
        &app,
        &token,
        "/v1/conversations/dm",
        Some("dm-coda"),
        json!({ "agentId": agent_id }),
    )
    .await;
    assert_eq!(conversation.status(), StatusCode::CREATED);
    let conversation_body = response_json(conversation).await;
    let conversation_id = conversation_body["conversation"]["id"].as_str().unwrap();
    assert_eq!(conversation_body["conversation"]["agentId"], agent_id);

    let duplicate = post_json(
        &app,
        &token,
        "/v1/conversations/dm",
        Some("dm-coda-retry"),
        json!({ "agentId": agent_id }),
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::OK);
    assert_eq!(
        response_json(duplicate).await["conversation"]["id"],
        conversation_id
    );

    let sent = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("message-1"),
        json!({ "body": "帮我看一下初始化流程", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);

    let reloaded = build_router(AppState::for_tests_with_agent_root(
        token.clone(),
        root.clone(),
    ));
    let messages = get_json(
        &reloaded,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
    )
    .await;
    assert_eq!(messages.status(), StatusCode::OK);
    let messages_body = response_json(messages).await;
    assert_eq!(messages_body["messages"].as_array().unwrap().len(), 1);
    assert_eq!(messages_body["messages"][0]["body"], "帮我看一下初始化流程");
    assert!(root.join("conversations/index.json").is_file());
}

async fn get_json(app: &axum::Router, token: &AuthToken, uri: &str) -> axum::response::Response {
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
) -> axum::response::Response {
    let mut builder = Request::builder()
        .method("POST")
        .uri(uri)
        .header("authorization", token.authorization_header())
        .header("content-type", "application/json");
    if let Some(idempotency_key) = idempotency_key {
        builder = builder.header("idempotency-key", idempotency_key);
    }

    app.clone()
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
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
