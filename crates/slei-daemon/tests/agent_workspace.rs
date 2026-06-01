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
async fn guide_bootstrap_creates_real_yeal_agent_dm_skills_and_all_membership() {
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
    assert_eq!(guide["name"], "Yeal");
    assert_eq!(guide["handle"], "@yeal");
    assert_eq!(guide["agentKind"], "guide");
    assert_eq!(guide["systemOwned"], true);
    assert_eq!(guide["channelIds"], json!(["all"]));
    assert_eq!(guide["runtimeThread"]["status"], "ready");
    assert!(serde_json::to_string(guide)
        .unwrap()
        .find("session_")
        .is_none());

    let workspace = PathBuf::from(guide["workspacePath"].as_str().unwrap());
    assert!(workspace.ends_with("agent_guide_local_node"));
    assert!(workspace.join("MEMORY.md").is_file());
    assert!(workspace.join("docs").is_dir());
    assert!(workspace.join("skills/index.json").is_file());
    assert!(workspace.join("skills/guide-create.skill.md").is_file());
    assert!(workspace.join("skills/memory.skill.md").is_file());
    let memory = fs::read_to_string(workspace.join("MEMORY.md")).unwrap();
    assert!(!memory.contains("@Alice"));
    assert!(!memory.contains("@Nancy"));
    assert!(!memory.contains("@Cindy"));
    assert!(!memory.contains("Alice + Coda + Nancy"));
    assert!(!memory.contains("团队协作流程：用户/Alice"));
    assert!(memory.contains("@lei-lee"));
    assert!(memory.contains("@yeal"));

    let skills = get_json(&app, &token, "/v1/agents/agent_guide_local_node/skills").await;
    assert_eq!(skills.status(), StatusCode::OK);
    let skills_body = response_json(skills).await;
    assert_eq!(skills_body["skills"].as_array().unwrap().len(), 2);
    assert!(skills_body["skills"].to_string().contains("guide-create"));
    assert!(skills_body["skills"].to_string().contains("memory"));

    let conversations = get_json(&app, &token, "/v1/conversations").await;
    let conversations_body = response_json(conversations).await;
    assert_eq!(
        conversations_body["conversations"][0]["agentId"],
        "agent_guide_local_node"
    );
    let conversation_id = conversations_body["conversations"][0]["id"]
        .as_str()
        .unwrap();
    let messages = get_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
    )
    .await;
    assert!(response_json(messages).await["messages"][0]["body"]
        .as_str()
        .unwrap()
        .contains("Yeal"));

    fs::write(
        workspace.join("MEMORY.md"),
        format!(
            "{memory}\n@Alice — mock\n@Nancy — mock\n@Cindy — mock\n团队协作流程：用户/Alice mock\n用户刚搭建完研发团队（Alice + Coda + Nancy）\n- 用户真实补充的信息\n"
        ),
    )
    .unwrap();

    let second = post_json(
        &app,
        &token,
        "/v1/agents/guide/bootstrap",
        Some("bootstrap-guide-retry"),
        json!({}),
    )
    .await;
    assert_eq!(second.status(), StatusCode::OK);
    let cleaned_memory = fs::read_to_string(workspace.join("MEMORY.md")).unwrap();
    assert!(!cleaned_memory.contains("@Alice"));
    assert!(!cleaned_memory.contains("@Nancy"));
    assert!(!cleaned_memory.contains("@Cindy"));
    assert!(!cleaned_memory.contains("Alice + Coda + Nancy"));
    assert!(!cleaned_memory.contains("团队协作流程：用户/Alice"));
    assert!(cleaned_memory.contains("用户真实补充的信息"));
    assert_eq!(response_json(second).await["status"], "alreadyExists");

    let listed = get_json(&app, &token, "/v1/agents").await;
    assert_eq!(
        response_json(listed).await["agents"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
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
    assert_eq!(
        get_json(&app, &token, "/v1/agents").await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn channels_normalize_hash_prefix_and_default_all_is_persistent() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channels");
    let app = build_router(AppState::for_tests_with_agent_root(
        token.clone(),
        root.clone(),
    ));

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

    let reloaded = build_router(AppState::for_tests_with_agent_root(
        token.clone(),
        root.clone(),
    ));
    let listed = response_json(get_json(&reloaded, &token, "/v1/channels").await).await;
    assert_eq!(listed["channels"].as_array().unwrap().len(), 2);
    assert!(root.join("channels/index.json").is_file());
}

#[tokio::test]
async fn guide_create_request_starts_runtime_without_user_text_cards() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("interactive-cards");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    state.nodes().set_runtime_ready_for_tests("1.2.3");
    let app = build_router(state.clone());
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
    let sent_body = response_json(sent).await;
    assert_eq!(sent_body["message"]["cards"], json!([]));

    let commands = state.worker_commands();
    let start_run = commands
        .iter()
        .find(|command| command["type"] == "start_run")
        .expect("guide create request should start runtime");
    assert_eq!(start_run["session"]["agent_id"], "agent_guide_local_node");
    assert_eq!(
        start_run["input"]["prompt"],
        "帮我创建一个叫 Nancy 的 QA Agent"
    );
}

#[tokio::test]
async fn guide_product_tool_appends_card_message_and_completion_is_idempotent() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("interactive-card-tool");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    state.nodes().set_runtime_ready_for_tests("1.2.3");
    let app = build_router(state.clone());
    let guide = post_json(
        &app,
        &token,
        "/v1/agents/guide/bootstrap",
        Some("bootstrap-guide-card-tool"),
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
        Some("message-product-tool-card"),
        json!({ "body": "帮我创建一个叫 Nancy 的 QA Agent", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);
    let run_id = state.worker_commands()[0]["run_id"]
        .as_str()
        .unwrap()
        .to_string();

    state
        .handle_worker_event(json!({
            "type": "product_tool_requested",
            "run_id": run_id,
            "tool_use_id": "tool_card_1",
            "agent_id": "agent_guide_local_node",
            "tool_name": "slei_propose_interactive_card",
            "payload": {
                "kind": "createAgent",
                "title": "创建智能体草案",
                "summary": "Nancy · ClaudeCode / Sonnet",
                "draft": {
                    "name": "Nancy",
                    "handle": "@nancy",
                    "runtimeKind": "ClaudeCode",
                    "model": "Sonnet",
                    "nodeId": "local-node",
                    "description": "QA 质保员，负责审查代码质量。"
                },
                "actionLabel": "创建",
                "doneLabel": "DONE"
            }
        }))
        .await
        .unwrap();

    let messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/messages"),
        )
        .await,
    )
    .await;
    let messages = messages["messages"].as_array().unwrap();
    let human_message = messages
        .iter()
        .find(|message| message["id"] == "message-product-tool-card")
        .unwrap();
    assert_eq!(human_message["cards"], json!([]));
    let card_messages = messages
        .iter()
        .filter(|message| {
            message["id"]
                .as_str()
                .is_some_and(|id| id.starts_with("card_message_"))
        })
        .collect::<Vec<_>>();
    assert_eq!(card_messages.len(), 1);
    let card_message = card_messages[0];
    assert_eq!(card_message["authorId"], "agent_guide_local_node");
    assert_eq!(card_message["body"], "");
    assert_eq!(card_message["status"], "done");
    let card = &card_message["cards"][0];
    assert_eq!(card["kind"], "createAgent");
    assert_eq!(card["state"], "pending");
    assert_eq!(card["draft"]["name"], "Nancy");
    assert_eq!(card["actionLabel"], "创建");
    assert_eq!(
        card_message["id"],
        format!("card_message_{}", card["id"].as_str().unwrap())
    );

    state
        .handle_worker_event(json!({
            "type": "product_tool_requested",
            "run_id": run_id,
            "tool_use_id": "tool_card_1",
            "agent_id": "agent_guide_local_node",
            "tool_name": "slei_propose_interactive_card",
            "payload": {
                "kind": "createAgent",
                "title": "创建智能体草案",
                "summary": "Nancy · ClaudeCode / Sonnet",
                "draft": {
                    "name": "Nancy",
                    "handle": "@nancy",
                    "runtimeKind": "ClaudeCode",
                    "model": "Sonnet",
                    "nodeId": "local-node",
                    "description": "QA 质保员，负责审查代码质量。"
                },
                "actionLabel": "创建",
                "doneLabel": "DONE"
            }
        }))
        .await
        .unwrap();
    let duplicate_messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/messages"),
        )
        .await,
    )
    .await;
    let duplicate_card_messages = duplicate_messages["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|message| {
            message["id"]
                .as_str()
                .is_some_and(|id| id.starts_with("card_message_"))
        })
        .count();
    assert_eq!(duplicate_card_messages, 1);

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
async fn guide_product_tool_rejects_invalid_card_payloads() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("interactive-card-invalid");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    state.nodes().set_runtime_ready_for_tests("1.2.3");
    let app = build_router(state.clone());
    let guide = post_json(
        &app,
        &token,
        "/v1/agents/guide/bootstrap",
        Some("bootstrap-guide-invalid-card"),
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
        Some("message-invalid-card"),
        json!({ "body": "帮我创建一个成员", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);
    let run_id = state.worker_commands()[0]["run_id"]
        .as_str()
        .unwrap()
        .to_string();

    assert!(state
        .handle_worker_event(json!({
            "type": "product_tool_requested",
            "run_id": run_id,
            "tool_use_id": "tool_card_invalid_kind",
            "agent_id": "agent_guide_local_node",
            "tool_name": "slei_propose_interactive_card",
            "payload": {
                "kind": "createChannel",
                "title": "创建频道草案",
                "summary": "#qa",
                "draft": { "name": "qa" },
                "actionLabel": "创建",
                "doneLabel": "DONE"
            }
        }))
        .await
        .is_err());

    assert!(state
        .handle_worker_event(json!({
            "type": "product_tool_requested",
            "run_id": run_id,
            "tool_use_id": "tool_card_missing_name",
            "agent_id": "agent_guide_local_node",
            "tool_name": "slei_propose_interactive_card",
            "payload": {
                "kind": "createAgent",
                "title": "创建智能体草案",
                "summary": "Nancy · ClaudeCode / Sonnet",
                "draft": {
                    "handle": "@nancy",
                    "runtimeKind": "ClaudeCode",
                    "model": "Sonnet",
                    "nodeId": "local-node",
                    "description": "QA 质保员"
                },
                "actionLabel": "创建",
                "doneLabel": "DONE"
            }
        }))
        .await
        .is_err());

    let messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/messages"),
        )
        .await,
    )
    .await;
    assert!(messages["messages"]
        .as_array()
        .unwrap()
        .iter()
        .all(|message| !message["id"]
            .as_str()
            .is_some_and(|id| id.starts_with("card_message_"))));
}

#[tokio::test]
async fn guide_dm_without_card_shortcut_starts_runtime() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("guide-runtime-chat");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    state.nodes().set_runtime_ready_for_tests("1.2.3");
    let app = build_router(state.clone());
    let guide = post_json(
        &app,
        &token,
        "/v1/agents/guide/bootstrap",
        Some("bootstrap-guide-runtime-chat"),
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
        Some("message-guide-chat"),
        json!({ "body": "你好", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);

    let commands = state.worker_commands();
    let start_run = commands
        .iter()
        .find(|command| command["type"] == "start_run")
        .expect("guide chat should start runtime");
    assert_eq!(start_run["session"]["agent_id"], "agent_guide_local_node");
    assert_eq!(start_run["input"]["prompt"], "你好");
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
    assert_eq!(messages_body["messages"].as_array().unwrap().len(), 2);
    assert_eq!(messages_body["messages"][0]["body"], "帮我看一下初始化流程");
    assert_eq!(messages_body["messages"][1]["authorId"], agent_id);
    assert_eq!(messages_body["messages"][1]["status"], "running");
    assert!(messages_body["messages"][1]["runId"]
        .as_str()
        .unwrap()
        .starts_with("run_"));
    assert!(root.join("conversations/index.json").is_file());
}

#[tokio::test]
async fn dm_send_starts_agent_runtime() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("dm-runtime-start");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state.clone());

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-runtime-agent"),
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
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_body = response_json(created).await;
    let agent = &created_body["agent"];
    let agent_id = agent["id"].as_str().unwrap();
    let workspace = agent["workspacePath"].as_str().unwrap();

    let conversation = post_json(
        &app,
        &token,
        "/v1/conversations/dm",
        Some("runtime-dm-coda"),
        json!({ "agentId": agent_id }),
    )
    .await;
    assert_eq!(conversation.status(), StatusCode::CREATED);
    let conversation_id = response_json(conversation).await["conversation"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let sent = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("runtime-message-1"),
        json!({ "body": "帮我看一下初始化流程", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);

    let commands = state.worker_commands();
    assert_eq!(commands.len(), 1);
    assert_eq!(commands[0]["type"], "start_run");
    assert_eq!(commands[0]["session"]["agent_id"], agent_id);
    assert_eq!(commands[0]["session"]["cwd"], workspace);
    assert_eq!(commands[0]["session"]["persist_session"], true);
    assert_eq!(commands[0]["session"]["resume_session"], false);
    assert!(Uuid::parse_str(commands[0]["session"]["session_id"].as_str().unwrap()).is_ok());
    assert_eq!(commands[0]["input"]["prompt"], "帮我看一下初始化流程");
    assert_eq!(commands[0]["input"]["context"], json!([]));
}

#[tokio::test]
async fn dm_runtime_session_persists_resumes_and_resets() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("dm-runtime-session");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state.clone());

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-session-agent"),
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
    assert_eq!(created.status(), StatusCode::CREATED);
    let agent_id = response_json(created).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let conversation_id = response_json(
        post_json(
            &app,
            &token,
            "/v1/conversations/dm",
            Some("session-dm-coda"),
            json!({ "agentId": agent_id }),
        )
        .await,
    )
    .await["conversation"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let first = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("session-message-1"),
        json!({ "body": "第一句", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let first_command = state.worker_commands()[0].clone();
    let first_run_id = first_command["run_id"].as_str().unwrap().to_string();
    let first_session_id = first_command["session"]["session_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(first_command["session"]["persist_session"], true);
    assert_eq!(first_command["session"]["resume_session"], false);
    assert!(Uuid::parse_str(&first_session_id).is_ok());

    let listed = response_json(get_json(&app, &token, "/v1/conversations").await).await;
    assert_eq!(
        listed["conversations"][0]["runtimeSession"]["status"],
        "pending"
    );
    assert_eq!(
        listed["conversations"][0]["runtimeSession"]["sessionId"],
        first_session_id
    );

    state
        .handle_worker_event(json!({ "type": "completed", "run_id": first_run_id }))
        .await
        .unwrap();
    let listed = response_json(get_json(&app, &token, "/v1/conversations").await).await;
    assert_eq!(
        listed["conversations"][0]["runtimeSession"]["status"],
        "ready"
    );

    let second = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("session-message-2"),
        json!({ "body": "第二句", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(second.status(), StatusCode::CREATED);
    let commands = state.worker_commands();
    assert_eq!(commands[1]["session"]["session_id"], first_session_id);
    assert_eq!(commands[1]["session"]["persist_session"], true);
    assert_eq!(commands[1]["session"]["resume_session"], true);
    assert_eq!(commands[1]["input"]["context"], json!([]));

    let reset = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/runtime-session/reset"),
        None,
        json!({}),
    )
    .await;
    assert_eq!(reset.status(), StatusCode::OK);
    let reset_body = response_json(reset).await;
    assert!(reset_body["conversation"].get("runtimeSession").is_none());
    assert_eq!(
        reset_body["conversation"]["activeSessionId"],
        format!("session:{}:default", conversation_id.replace(':', "_"))
    );
    let reset_sessions = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/sessions"),
        )
        .await,
    )
    .await;
    assert_eq!(reset_sessions["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(reset_sessions["sessions"][0]["title"], "新会话");
    assert!(reset_sessions["sessions"][0]
        .get("runtimeSession")
        .is_none());
    let reset_messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/messages"),
        )
        .await,
    )
    .await;
    assert_eq!(reset_messages["messages"].as_array().unwrap().len(), 0);
    let commands = state.worker_commands();
    assert_eq!(commands[2]["type"], "clear_session");
    assert_eq!(commands[2]["session"]["session_id"], first_session_id);

    let third = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("session-message-3"),
        json!({ "body": "第三句", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(third.status(), StatusCode::CREATED);
    let commands = state.worker_commands();
    let reset_session_id = commands[3]["session"]["session_id"].as_str().unwrap();
    assert_ne!(reset_session_id, first_session_id);
    assert_eq!(commands[3]["session"]["resume_session"], false);
}

#[tokio::test]
async fn dm_sessions_and_attachments_round_trip_through_api() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("dm-sessions-attachments");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let app = build_router(state.clone());

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("session-attachment-agent"),
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
    assert_eq!(created.status(), StatusCode::CREATED);
    let agent_id = response_json(created).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let conversation = response_json(
        post_json(
            &app,
            &token,
            "/v1/conversations/dm",
            Some("session-attachment-dm"),
            json!({ "agentId": agent_id }),
        )
        .await,
    )
    .await;
    let conversation_id = conversation["conversation"]["id"].as_str().unwrap();
    let active_session_id = conversation["conversation"]["activeSessionId"]
        .as_str()
        .unwrap();

    let sessions = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/sessions"),
        )
        .await,
    )
    .await;
    assert_eq!(sessions["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(sessions["sessions"][0]["id"], active_session_id);

    let attachment = response_json(
        post_json(
            &app,
            &token,
            "/v1/attachments",
            Some("upload-notes"),
            json!({ "name": "../notes.md", "mimeType": "text/markdown", "bytesBase64": "aGVsbG8=" }),
        )
        .await,
    )
    .await;
    let attachment_id = attachment["attachment"]["id"].as_str().unwrap();
    assert_eq!(attachment["attachment"]["name"], "notes.md");
    assert!(attachment["attachment"]["cachePath"]
        .as_str()
        .unwrap()
        .contains("/attachments/"));

    let sent = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("message-with-attachment"),
        json!({ "body": "", "authorId": "human:local", "sessionId": active_session_id, "attachmentIds": [attachment_id] }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);
    let messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/messages"),
        )
        .await,
    )
    .await;
    assert_eq!(messages["messages"][0]["sessionId"], active_session_id);
    assert_eq!(messages["messages"][0]["body"], "");
    assert_eq!(
        messages["messages"][0]["attachments"][0]["name"],
        "notes.md"
    );
    assert!(state.worker_commands()[0]["input"]["prompt"]
        .as_str()
        .unwrap()
        .contains("Attachments:"));

    let new_session = response_json(
        post_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/sessions"),
            None,
            json!({}),
        )
        .await,
    )
    .await;
    let new_session_id = new_session["session"]["id"].as_str().unwrap();
    assert_ne!(new_session_id, active_session_id);
    assert_eq!(
        new_session["conversation"]["activeSessionId"],
        new_session_id
    );
    let old_session_messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/messages?sessionId={active_session_id}"),
        )
        .await,
    )
    .await;
    assert_eq!(
        old_session_messages["messages"].as_array().unwrap().len(),
        2
    );
    let new_session_messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/messages?sessionId={new_session_id}"),
        )
        .await,
    )
    .await;
    assert_eq!(
        new_session_messages["messages"].as_array().unwrap().len(),
        0
    );
    let activated = response_json(
        patch_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/sessions/{active_session_id}/active"),
            None,
            json!({}),
        )
        .await,
    )
    .await;
    assert_eq!(
        activated["conversation"]["activeSessionId"],
        active_session_id
    );
}

#[tokio::test]
async fn old_conversation_json_without_runtime_session_still_loads() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("old-conversation-json");
    fs::create_dir_all(root.join("conversations")).unwrap();
    fs::create_dir_all(root.join("conversations/messages")).unwrap();
    fs::write(
        root.join("conversations/messages/dm_agent_coda.json"),
        r#"[
          {
            "id": "msg_legacy",
            "conversationId": "dm:agent_coda",
            "authorId": "human:local",
            "body": "旧消息",
            "createdAt": "1"
          }
        ]"#,
    )
    .unwrap();
    fs::write(
        root.join("conversations/index.json"),
        r#"[
          {
            "id": "dm:agent_coda",
            "kind": "dm",
            "agentId": "agent_coda",
            "createdAt": "1",
            "updatedAt": "1"
          }
        ]"#,
    )
    .unwrap();
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state);

    let response = get_json(&app, &token, "/v1/conversations").await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["conversations"][0]["id"], "dm:agent_coda");
    assert!(body["conversations"][0].get("runtimeSession").is_none());
    let conversation_id = body["conversations"][0]["id"].as_str().unwrap();
    let legacy_session_id = body["conversations"][0]["activeSessionId"]
        .as_str()
        .unwrap();
    let messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/messages?sessionId={legacy_session_id}"),
        )
        .await,
    )
    .await;
    assert_eq!(messages["messages"][0]["sessionId"], legacy_session_id);
}

#[tokio::test]
async fn dm_send_carries_previous_five_rounds_as_runtime_context() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("dm-runtime-context-window");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state.clone());

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-context-agent"),
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
    assert_eq!(created.status(), StatusCode::CREATED);
    let agent_id = response_json(created).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let conversation = post_json(
        &app,
        &token,
        "/v1/conversations/dm",
        Some("runtime-context-dm-coda"),
        json!({ "agentId": agent_id }),
    )
    .await;
    assert_eq!(conversation.status(), StatusCode::CREATED);
    let conversation_id = response_json(conversation).await["conversation"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    for round in 1..=6 {
        state
            .conversations()
            .append_message_with_metadata(
                &conversation_id,
                "human:local",
                &format!("用户第 {round} 轮"),
                Some(&format!("seed-human-{round}")),
                None,
                &[],
                None,
                None,
            )
            .await
            .unwrap();
        state
            .conversations()
            .append_message_with_metadata(
                &conversation_id,
                &agent_id,
                &format!("Agent 第 {round} 轮"),
                Some(&format!("seed-agent-{round}")),
                None,
                &[],
                None,
                Some("done"),
            )
            .await
            .unwrap();
    }

    let sent = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("runtime-context-message-7"),
        json!({ "body": "用户第 7 轮", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);

    let commands = state.worker_commands();
    assert_eq!(commands.len(), 1);
    assert_eq!(commands[0]["input"]["prompt"], "用户第 7 轮");
    let context = commands[0]["input"]["context"].as_array().unwrap();
    assert_eq!(context.len(), 10);
    assert_eq!(context[0]["role"], "user");
    assert_eq!(context[0]["content"], "用户第 2 轮");
    assert_eq!(context[1]["role"], "assistant");
    assert_eq!(context[1]["content"], "Agent 第 2 轮");
    assert_eq!(context[8]["content"], "用户第 6 轮");
    assert_eq!(context[9]["content"], "Agent 第 6 轮");
    assert!(context
        .iter()
        .all(|message| message["content"] != "用户第 1 轮" && message["content"] != "用户第 7 轮"));
}

#[tokio::test]
async fn dm_runtime_events_append_to_conversation() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("dm-runtime-events");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state.clone());

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-event-agent"),
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
    let agent_id = response_json(created).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let conversation_id = response_json(
        post_json(
            &app,
            &token,
            "/v1/conversations/dm",
            Some("event-dm-coda"),
            json!({ "agentId": agent_id }),
        )
        .await,
    )
    .await["conversation"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let sent = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("event-message-1"),
        json!({ "body": "请给我一个方案", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);
    let run_id = state.worker_commands()[0]["run_id"]
        .as_str()
        .unwrap()
        .to_string();

    state
        .handle_worker_event(json!({ "type": "output_delta", "run_id": run_id, "delta": "收到，" }))
        .await
        .unwrap();
    state
        .handle_worker_event(
            json!({ "type": "output_delta", "run_id": run_id, "delta": "我来处理。" }),
        )
        .await
        .unwrap();
    state
        .handle_worker_event(json!({ "type": "completed", "run_id": run_id }))
        .await
        .unwrap();

    let messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{conversation_id}/messages"),
        )
        .await,
    )
    .await;
    let messages = messages["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[1]["authorId"], agent_id);
    assert_eq!(messages[1]["runId"], run_id);
    assert_eq!(messages[1]["body"], "收到，我来处理。");
    assert_eq!(messages[1]["status"], "done");
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

async fn patch_json(
    app: &axum::Router,
    token: &AuthToken,
    uri: &str,
    idempotency_key: Option<&str>,
    body: Value,
) -> axum::response::Response {
    let mut builder = Request::builder()
        .method("PATCH")
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
