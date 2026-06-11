use std::fs;
use std::path::PathBuf;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::card_service::InteractiveCardView;
use slei_daemon::services::channel_service::{ChannelDraft, PermissionPreset};
use slei_daemon::services::conversation_service::ConversationService;
use slei_daemon::state::AppState;
use slei_storage::db::SleiDb;
use slei_storage::repositories::{ConversationRow, Repositories, SavedMessageRow};
use tokio::time::{sleep, Duration};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn creating_agent_generates_workspace_memory_and_docs() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-root");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let app = build_router(state.clone());

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
    assert!(memory.contains("已加入频道：#all"));
    assert!(memory.contains("自发判断是否需要 @ 下一位成员接手"));
    assert!(memory.contains("如果无需接手，应 @ 当前用户进行验收或审阅"));
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
    assert_eq!(
        all_members_body["members"][0]["readiness"],
        "memory_syncing"
    );

    let commands = state.worker_commands();
    let start_run = commands
        .iter()
        .find(|command| command["type"] == "start_run")
        .expect("created all-channel agent should start a runtime join report");
    assert_eq!(start_run["session"]["agent_id"], id);
    assert_eq!(
        start_run["session"]["cwd"].as_str().unwrap(),
        workspace.to_string_lossy()
    );
    assert!(start_run["input"]["prompt"]
        .as_str()
        .unwrap()
        .contains("入场"));
    assert!(state.channel_messages_for_tests("all").await.is_empty());
    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": start_run["run_id"].as_str().unwrap(),
            "delta": "Coda 已完成 all 频道记忆初始化，我负责开发实现。"
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "completed",
            "run_id": start_run["run_id"].as_str().unwrap()
        }))
        .await
        .unwrap();
    let all_members = response_json(get_json(&app, &token, "/v1/channels/all/members").await).await;
    assert_eq!(all_members["members"][0]["readiness"], "ready");
    assert!(state
        .channel_messages_for_tests("all")
        .await
        .iter()
        .any(|message| message.author_id == id
            && message
                .body
                .as_deref()
                .is_some_and(|body| body.contains("Coda"))));
}

#[tokio::test]
async fn deleting_agent_removes_registry_membership_and_workspace() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-delete");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let app = build_router(state);

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("delete-coda-create"),
        json!({
            "name": "Coda",
            "handle": "@coda-delete",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "开发工程师"
        }),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_body = response_json(created).await;
    let agent_id = created_body["agent"]["id"].as_str().unwrap().to_string();
    let workspace = PathBuf::from(created_body["agent"]["workspacePath"].as_str().unwrap());
    assert!(workspace.is_dir());

    let deleted = delete_json(&app, &token, &format!("/v1/agents/{agent_id}")).await;
    assert_eq!(deleted.status(), StatusCode::OK);
    assert!(!workspace.exists());

    let listed = response_json(get_json(&app, &token, "/v1/agents").await).await;
    assert!(!listed["agents"]
        .as_array()
        .unwrap()
        .iter()
        .any(|agent| agent["id"] == agent_id));

    let all_members = response_json(get_json(&app, &token, "/v1/channels/all/members").await).await;
    assert!(!all_members["members"]
        .as_array()
        .unwrap()
        .iter()
        .any(|member| member["agentId"] == agent_id));
}

#[tokio::test]
async fn system_agents_cannot_be_deleted() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("system-agent-delete");
    let app = build_router(AppState::for_tests_with_agent_root(
        token.clone(),
        root.clone(),
    ));
    assert_eq!(
        get_json(&app, &token, "/v1/agents").await.status(),
        StatusCode::OK
    );

    let response = delete_json(&app, &token, "/v1/agents/agent_coordinator_all").await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(root.join("agents/agent_coordinator_all").is_dir());
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
    assert!(!workspace.join("skills/index.json").exists());
    assert!(!workspace.join("skills/guide-create.skill.md").exists());
    assert!(!workspace.join("skills/memory.skill.md").exists());
    assert!(workspace
        .join(".claude/skills/guide-create/SKILL.md")
        .is_file());
    assert!(workspace.join(".claude/skills/memory/SKILL.md").is_file());
    let memory_skill =
        fs::read_to_string(workspace.join(".claude/skills/memory/SKILL.md")).unwrap();
    assert!(memory_skill.starts_with("---\n"));
    assert!(memory_skill.contains("\nname: memory\n"));
    assert!(memory_skill.contains("\ndescription: "));
    let guide_skill =
        fs::read_to_string(workspace.join(".claude/skills/guide-create/SKILL.md")).unwrap();
    assert!(guide_skill.starts_with("---\n"));
    assert!(guide_skill.contains("\nname: guide-create\n"));
    assert!(guide_skill.contains("slei_propose_interactive_card"));
    assert!(guide_skill.contains("Input schema"));
    assert!(guide_skill.contains("Output contract"));
    assert!(guide_skill.contains("Single agent example"));
    assert!(guide_skill.contains("Multiple agents example"));
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
    let listed_body = response_json(listed).await;
    let agents = listed_body["agents"].as_array().unwrap();
    assert!(agents
        .iter()
        .any(|agent| agent["id"] == "agent_guide_local_node"));
    assert!(agents
        .iter()
        .any(|agent| agent["id"] == "agent_coordinator_all"));
}

#[tokio::test]
async fn member_service_startup_migrates_legacy_default_skill_files() {
    let root = make_temp_dir("legacy-skill-migration");
    let workspace = root.join("agents/agent_legacy");
    fs::create_dir_all(workspace.join("docs")).unwrap();
    fs::create_dir_all(workspace.join("skills")).unwrap();
    fs::write(
        workspace.join("MEMORY.md"),
        "# Legacy\n\n## Role\nLegacy agent",
    )
    .unwrap();
    fs::write(workspace.join("skills/index.json"), "[]").unwrap();
    fs::write(workspace.join("skills/memory.skill.md"), "legacy memory").unwrap();
    fs::write(workspace.join("skills/custom.skill.md"), "keep me").unwrap();
    fs::write(workspace.join("memory.skill.md"), "legacy root memory").unwrap();
    let agent = json!([{
        "id": "agent_legacy",
        "name": "Legacy",
        "handle": "@legacy",
        "agentKind": "agent",
        "systemOwned": false,
        "runtimeKind": "ClaudeCode",
        "model": "Sonnet",
        "nodeId": "local-node",
        "description": "Legacy agent",
        "workspacePath": workspace.to_string_lossy(),
        "memoryPath": workspace.join("MEMORY.md").to_string_lossy(),
        "docsPath": workspace.join("docs").to_string_lossy(),
        "avatarSeed": "agent_legacy",
        "runtimeThread": { "runtimeKind": "ClaudeCode", "status": "ready", "createdAt": "1" },
        "channelIds": ["all"],
        "createdAt": "1",
        "updatedAt": "1"
    }]);
    fs::write(
        root.join("agents/index.json"),
        serde_json::to_string_pretty(&agent).unwrap(),
    )
    .unwrap();

    let state = AppState::for_tests_with_agent_root(AuthToken::from_static("token"), root.clone());
    let skills = state
        .members()
        .list_agent_skills("agent_legacy")
        .await
        .unwrap();

    assert_eq!(skills[0].id, "memory");
    assert!(workspace.join(".claude/skills/memory/SKILL.md").is_file());
    assert!(!workspace.join("skills/index.json").exists());
    assert!(!workspace.join("skills/memory.skill.md").exists());
    assert!(!workspace.join("memory.skill.md").exists());
    assert!(workspace.join("skills/custom.skill.md").is_file());
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
async fn list_agents_exposes_default_channel_coordinator_as_system_agent() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-coordinator-default");
    let app = build_router(AppState::for_tests_with_agent_root(
        token.clone(),
        root.clone(),
    ));

    let listed = get_json(&app, &token, "/v1/agents").await;

    assert_eq!(listed.status(), StatusCode::OK);
    let body = response_json(listed).await;
    let agents = body["agents"].as_array().unwrap();
    let coordinator = agents
        .iter()
        .find(|agent| agent["agentKind"] == "coordinator")
        .expect("default channel coordinator should be listed as an agent");
    assert_eq!(coordinator["id"], "agent_coordinator_all");
    assert_eq!(coordinator["handle"], "@all-coordinator");
    assert_eq!(coordinator["systemOwned"], true);
    assert_eq!(coordinator["runtimeKind"], "ClaudeCode");
    assert_eq!(coordinator["channelIds"], json!(["all"]));
    assert!(
        PathBuf::from(coordinator["workspacePath"].as_str().unwrap())
            .ends_with("agent_coordinator_all")
    );
    assert!(root
        .join("agents/agent_coordinator_all/MEMORY.md")
        .is_file());
}

#[tokio::test]
async fn coordinator_agents_cannot_be_used_for_direct_messages() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-coordinator-no-dm");
    let app = build_router(AppState::for_tests_with_agent_root(token.clone(), root));
    assert_eq!(
        get_json(&app, &token, "/v1/agents").await.status(),
        StatusCode::OK
    );

    let response = post_json(
        &app,
        &token,
        "/v1/conversations/dm",
        Some("dm-coordinator"),
        json!({ "agentId": "agent_coordinator_all" }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(response).await["error"],
        "coordinator agents do not support direct messages"
    );
}

#[tokio::test]
async fn coordinator_runtime_configuration_updates_runtime_thread() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-coordinator-runtime");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    state.nodes().set_runtimes_for_tests(vec![
        slei_daemon::services::node_service::RuntimeReadinessDto {
            kind: "ClaudeCode".to_string(),
            readiness: "ready".to_string(),
            version: Some("1.2.3".to_string()),
        },
        slei_daemon::services::node_service::RuntimeReadinessDto {
            kind: "OpenCode".to_string(),
            readiness: "ready".to_string(),
            version: Some("0.1.0".to_string()),
        },
    ]);
    let app = build_router(state);
    assert_eq!(
        get_json(&app, &token, "/v1/agents").await.status(),
        StatusCode::OK
    );

    let response = patch_json(
        &app,
        &token,
        "/v1/agents/agent_coordinator_all",
        None,
        json!({ "runtimeKind": "OpenCode", "model": "Planner" }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["agent"]["agentKind"], "coordinator");
    assert_eq!(body["agent"]["runtimeKind"], "OpenCode");
    assert_eq!(body["agent"]["runtimeThread"]["runtimeKind"], "OpenCode");
    assert_eq!(body["agent"]["model"], "Planner");
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
    assert!(root.join("slei.sqlite").is_file());
    assert!(!root.join("channels/index.json").exists());
}

#[tokio::test]
async fn create_channel_with_agents_is_immediately_usable_and_requests_memory_updates() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-join-memory-request");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let app = build_router(state.clone());

    let created_agent = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-alice"),
        json!({
            "name": "Alice",
            "handle": "@alice",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "架构师，负责拆解需求和协调方案。"
        }),
    )
    .await;
    assert_eq!(created_agent.status(), StatusCode::CREATED);
    let alice_id = response_json(created_agent).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let created_channel = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-ready-channel"),
        json!({
            "name": "#Ready Channel",
            "description": "Project readiness",
            "agentIds": [alice_id]
        }),
    )
    .await;
    assert_eq!(created_channel.status(), StatusCode::CREATED);
    let created_channel_body = response_json(created_channel).await;
    assert_eq!(created_channel_body["channel"]["id"], "ready-channel");

    let selected = wait_for_channel_member_readiness(
        &app,
        &token,
        "ready-channel",
        &alice_id,
        "memory_syncing",
    )
    .await;
    assert_eq!(selected["readiness"], "memory_syncing");

    let events = wait_for_memory_update_requests(&state, &alice_id, "ready-channel", 1).await;
    assert!(events
        .iter()
        .any(|event| event.event_type == "memory_update_requested"
            && event.status == "pending"
            && event.channel_id.as_deref() == Some("ready-channel")));
}

#[tokio::test]
async fn memory_update_completion_marks_member_ready_and_posts_ready_message() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-join-memory-complete");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let app = build_router(state.clone());

    let created_agent = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-alice-complete"),
        json!({
            "name": "Alice",
            "handle": "@alice",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "架构师，负责拆解需求和协调方案。"
        }),
    )
    .await;
    assert_eq!(created_agent.status(), StatusCode::CREATED);
    let created_agent_body = response_json(created_agent).await;
    let alice_id = created_agent_body["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let workspace = PathBuf::from(
        created_agent_body["agent"]["workspacePath"]
            .as_str()
            .unwrap(),
    );

    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "#Ready Channel".to_string(),
                description: Some("Project readiness".to_string()),
                permission: PermissionPreset::Controlled,
            },
            "create-ready-channel-complete",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel_with_outcome("ready-channel", &alice_id)
        .await
        .unwrap();
    state
        .memory_events()
        .request_channel_join_update(&alice_id, "ready-channel")
        .await;

    assert!(state
        .messages()
        .reconstructed_context("ready-channel")
        .await
        .is_empty());
    assert!(!state
        .memory_events()
        .events_for_agent(&alice_id)
        .await
        .iter()
        .any(|event| event.event_type == "memory_updated"
            && event.channel_id.as_deref() == Some("ready-channel")));

    state
        .run_channel_join_memory_updates("ready-channel")
        .await
        .unwrap();

    let members =
        response_json(get_json(&app, &token, "/v1/channels/ready-channel/members").await).await;
    let selected = members["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|member| member["agentId"] == alice_id)
        .expect("selected agent should be a channel member");
    assert_eq!(selected["readiness"], "memory_syncing");

    let commands = state.worker_commands();
    let join_command = start_run_command_containing_prompt(&commands, "ready-channel");
    assert_eq!(join_command["session"]["agent_id"], alice_id);
    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": join_command["run_id"].as_str().unwrap(),
            "delta": "Alice 已完成频道记忆初始化。"
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "completed",
            "run_id": join_command["run_id"].as_str().unwrap()
        }))
        .await
        .unwrap();
    let members =
        response_json(get_json(&app, &token, "/v1/channels/ready-channel/members").await).await;
    let selected = members["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|member| member["agentId"] == alice_id)
        .expect("selected agent should be a channel member");
    assert_eq!(selected["readiness"], "ready");
    let messages = state
        .messages()
        .reconstructed_context("ready-channel")
        .await;
    assert!(messages.contains("Alice"));

    let events = state.memory_events().events_for_agent(&alice_id).await;
    let updated_position = events
        .iter()
        .position(|event| {
            event.event_type == "memory_updated"
                && event.status == "ready"
                && event.channel_id.as_deref() == Some("ready-channel")
        })
        .expect("memory update completion event should be emitted before ready message");
    assert!(updated_position < events.len());

    let memory = fs::read_to_string(workspace.join("MEMORY.md")).unwrap();
    let channels = fs::read_to_string(workspace.join("notes/channels.md")).unwrap();
    assert!(memory.contains("notes/channels.md"));
    assert!(memory.contains("notes/relationships.md"));
    assert!(channels.contains("ready-channel"));
}

#[tokio::test]
async fn channel_create_setup_completes_join_memory_updates() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-create-join-memory-auto");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let app = build_router(state.clone());

    let created_agent = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-auto-ready-alice"),
        json!({
            "name": "Alice",
            "handle": "@alice",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "架构师，负责拆解需求和协调方案。"
        }),
    )
    .await;
    assert_eq!(created_agent.status(), StatusCode::CREATED);
    let alice_id = response_json(created_agent).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let created_channel = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-auto-ready-channel"),
        json!({
            "name": "#Auto Ready Channel",
            "description": "Project readiness",
            "agentIds": [alice_id]
        }),
    )
    .await;
    assert_eq!(created_channel.status(), StatusCode::CREATED);

    let selected = wait_for_channel_member_readiness(
        &app,
        &token,
        "auto-ready-channel",
        &alice_id,
        "memory_syncing",
    )
    .await;
    assert_eq!(selected["readiness"], "memory_syncing");
    assert!(state
        .memory_events()
        .events_for_agent(&alice_id)
        .await
        .iter()
        .any(|event| event.event_type == "memory_updated"
            && event.status == "ready"
            && event.channel_id.as_deref() == Some("auto-ready-channel")));
    let messages = state
        .messages()
        .reconstructed_context("auto-ready-channel")
        .await;
    assert!(messages.is_empty());
    let commands = state.worker_commands();
    let join_command = commands
        .iter()
        .find(|command| {
            command["type"] == "start_run"
                && command["session"]["agent_id"] == alice_id
                && command["input"]["prompt"]
                    .as_str()
                    .is_some_and(|prompt| prompt.contains("入场消息"))
        })
        .expect("channel create should start a runtime join report");
    assert_eq!(join_command["session"]["agent_id"], alice_id);
}

#[tokio::test]
async fn create_channel_rejects_invalid_selected_agent_without_side_effects() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-invalid-agent");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let app = build_router(state.clone());

    let created_channel = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-invalid-agent-channel"),
        json!({
            "name": "#Invalid Agent Channel",
            "description": "Should not be created",
            "agentIds": ["agent_missing"]
        }),
    )
    .await;

    assert_eq!(created_channel.status(), StatusCode::BAD_REQUEST);
    let missing_members =
        get_json(&app, &token, "/v1/channels/invalid-agent-channel/members").await;
    assert_eq!(missing_members.status(), StatusCode::NOT_FOUND);
    assert!(state
        .memory_events()
        .events_for_agent("agent_missing")
        .await
        .is_empty());
}

#[tokio::test]
async fn create_channel_lists_channel_even_when_later_workspace_setup_fails() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-partial-workspace-failure");
    fs::create_dir_all(root.join("channels/workspaces.json")).unwrap();
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let app = build_router(state);

    let created_channel = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-partial-workspace-channel"),
        json!({
            "name": "#Partial Workspace Channel",
            "description": "Workspace setup should fail after channel creation",
            "projectPaths": ["/workspace/api"]
        }),
    )
    .await;

    assert_eq!(created_channel.status(), StatusCode::CREATED);
    let created_channel_body = response_json(created_channel).await;
    assert_eq!(
        created_channel_body["channel"]["id"],
        "partial-workspace-channel"
    );

    let listed = response_json(get_json(&app, &token, "/v1/channels").await).await;
    assert!(listed["channels"]
        .as_array()
        .unwrap()
        .iter()
        .any(|channel| channel["id"] == "partial-workspace-channel"));
}

#[tokio::test]
async fn create_channel_with_duplicate_agents_and_retries_requests_memory_once() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-dedup-agent");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let app = build_router(state.clone());

    let created_agent = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-alice-dedup"),
        json!({
            "name": "Alice",
            "handle": "@alice",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "架构师。"
        }),
    )
    .await;
    assert_eq!(created_agent.status(), StatusCode::CREATED);
    let alice_id = response_json(created_agent).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    for _ in 0..2 {
        let created_channel = post_json(
            &app,
            &token,
            "/v1/channels",
            Some("create-dedup-channel"),
            json!({
                "name": "#Dedup Channel",
                "description": "Project readiness",
                "agentIds": [alice_id, alice_id]
            }),
        )
        .await;
        assert_eq!(created_channel.status(), StatusCode::CREATED);
    }

    let _ = wait_for_channel_member(&app, &token, "dedup-channel", &alice_id).await;
    let members =
        response_json(get_json(&app, &token, "/v1/channels/dedup-channel/members").await).await;
    let alice_members = members["members"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|member| member["agentId"] == alice_id)
        .count();
    assert_eq!(alice_members, 1);

    let requested_events = wait_for_memory_update_requests(&state, &alice_id, "dedup-channel", 1)
        .await
        .into_iter()
        .filter(|event| {
            event.event_type == "memory_update_requested"
                && event.channel_id.as_deref() == Some("dedup-channel")
        })
        .count();
    assert_eq!(requested_events, 1);
}

#[tokio::test]
async fn sqlite_channel_members_default_to_joining_readiness() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-member-readiness-default");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let app = build_router(state.clone());

    let created_channel = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-legacy-readiness-channel"),
        json!({ "name": "#Legacy Readiness", "description": "Legacy members" }),
    )
    .await;
    assert_eq!(created_channel.status(), StatusCode::CREATED);

    state
        .channels()
        .add_agent_to_channel("legacy-readiness", "agent_legacy")
        .await
        .unwrap();

    let reloaded = build_router(AppState::for_tests_with_agent_root(token.clone(), root));
    let members =
        response_json(get_json(&reloaded, &token, "/v1/channels/legacy-readiness/members").await)
            .await;
    assert_eq!(members["members"][0]["agentId"], "agent_legacy");
    assert_eq!(members["members"][0]["readiness"], "joining");
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
    let stored_card = state
        .cards()
        .card(card["id"].as_str().unwrap())
        .await
        .expect("product tool card is stored");
    assert_eq!(stored_card.run_id, run_id);
    assert_eq!(stored_card.agent_id, "agent_guide_local_node");
    assert_eq!(
        stored_card.conversation_id.as_deref(),
        Some(conversation_id)
    );
    assert_eq!(
        stored_card.message_id.as_deref(),
        card_message["id"].as_str()
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
    let key_knowledge = section_between(&memory, "## Key Knowledge", "## Active Context");
    assert!(key_knowledge.contains("Nancy 优先检查安全漏洞和测试覆盖率"));
    let active_context = section_after(&memory, "## Active Context");
    assert!(!active_context.contains("Nancy 优先检查安全漏洞和测试覆盖率"));
    assert!(memory_path.starts_with(root.join("agents")));
}

#[tokio::test]
async fn remembering_current_work_replaces_active_context_inside_workspace() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("agent-active-context-memory");
    let app = build_router(AppState::for_tests_with_agent_root(
        token.clone(),
        root.clone(),
    ));

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-active-context-agent"),
        json!({
            "name": "Coda",
            "handle": "@coda",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "开发工程师，负责实现代码和运行验证。"
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
        json!({ "fact": "当前正在处理默认 Agent assets 整理；下次继续替换 desktop mock。" }),
    )
    .await;

    assert_eq!(remembered.status(), StatusCode::OK);
    let memory = fs::read_to_string(&memory_path).unwrap();
    let active_context = section_after(&memory, "## Active Context");
    assert!(active_context.contains("默认 Agent assets 整理"));
    assert!(active_context.contains("下次继续替换 desktop mock"));
    assert!(!active_context.contains("首次启动，等待用户提出需要引导的任务"));
    assert!(memory.contains("## Key Knowledge"));
    assert!(memory_path.starts_with(root.join("agents")));
}

fn section_between<'a>(memory: &'a str, start: &str, end: &str) -> &'a str {
    let Some(start_index) = memory.find(start) else {
        return "";
    };
    let after_start = &memory[start_index + start.len()..];
    if let Some(end_index) = after_start.find(end) {
        &after_start[..end_index]
    } else {
        after_start
    }
}

fn section_after<'a>(memory: &'a str, start: &str) -> &'a str {
    let Some(start_index) = memory.find(start) else {
        return "";
    };
    &memory[start_index + start.len()..]
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

    let agents = body["agents"].as_array().unwrap();
    let alice = agents
        .iter()
        .find(|agent| agent["handle"] == "@alice")
        .expect("persisted agent should still be listed");
    assert!(agents
        .iter()
        .any(|agent| agent["id"] == "agent_coordinator_all"));
    assert!(!root.join("agents/index.json").exists());
    assert!(alice["createdAt"].as_str().unwrap().len() > 4);
}

#[tokio::test]
async fn dm_conversation_and_messages_persist_through_daemon_reload() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("conversation-reload");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let app = build_router(state.clone());

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

    let attachment = response_json(
        post_json(
            &app,
            &token,
            "/v1/attachments",
            Some("reload-attachment"),
            json!({ "name": "reload-notes.txt", "mimeType": "text/plain", "bytesBase64": "cmVsb2FkIG5vdGVz" }),
        )
        .await,
    )
    .await;
    let attachment_id = attachment["attachment"]["id"].as_str().unwrap();
    let cache_path = attachment["attachment"]["cachePath"]
        .as_str()
        .unwrap()
        .to_string();

    let sent = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("message-1"),
        json!({
            "body": "帮我看一下初始化流程",
            "authorId": "human:local",
            "attachmentIds": [attachment_id],
        }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);
    let sent_body = response_json(sent).await;
    let message_id = sent_body["message"]["id"].as_str().unwrap().to_string();
    let saved_session_id = sent_body["message"]["sessionId"]
        .as_str()
        .map(str::to_string);
    state
        .orchestration()
        .repos()
        .upsert_saved_message(SavedMessageRow {
            id: "saved-reload-message".to_string(),
            message_id: message_id.clone(),
            source_id: conversation_id.to_string(),
            source_kind: "conversation".to_string(),
            session_id: saved_session_id.clone(),
            saved_at: "42".to_string(),
        })
        .await
        .unwrap();

    let reloaded_state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let reloaded = build_router(reloaded_state.clone());
    let conversations = response_json(get_json(&reloaded, &token, "/v1/conversations").await).await;
    assert_eq!(conversations["conversations"][0]["id"], conversation_id);
    assert_eq!(
        conversations["conversations"][0]["runtimeSession"]["status"],
        "pending"
    );
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
    assert_eq!(
        messages_body["messages"][0]["attachments"][0]["name"],
        "reload-notes.txt"
    );
    assert_eq!(
        messages_body["messages"][0]["attachments"][0]["cachePath"],
        cache_path
    );
    assert_eq!(messages_body["messages"][1]["authorId"], agent_id);
    assert_eq!(messages_body["messages"][1]["status"], "running");
    assert!(messages_body["messages"][1]["runId"]
        .as_str()
        .unwrap()
        .starts_with("run_"));

    let reloaded_messages = reloaded_state
        .conversations()
        .list_messages(conversation_id)
        .await
        .unwrap();
    let prompt = ConversationService::prompt_with_attachments(&reloaded_messages[0]);
    assert!(prompt.contains("reload-notes.txt"));
    assert!(prompt.contains(&cache_path));

    let saved_messages = reloaded_state
        .orchestration()
        .repos()
        .saved_messages()
        .await
        .unwrap();
    assert_eq!(saved_messages.len(), 1);
    assert_eq!(saved_messages[0].message_id, message_id);
    assert_eq!(saved_messages[0].source_id, conversation_id);
    assert_eq!(saved_messages[0].session_id, saved_session_id);

    assert!(!root.join("conversations/index.json").exists());
    assert!(!root.join("conversations/sessions.json").exists());
    assert!(!root.join("saved/messages.json").exists());
    assert!(!root.join("conversations/messages").exists());
    assert!(!root.join("attachments/index.json").exists());
}

#[tokio::test]
async fn conversation_service_initial_load_uses_constructor_repositories() {
    let root = make_temp_dir("conversation-shared-repo-root");
    let db_root = make_temp_dir("conversation-shared-repo-db");
    let database_url = format!("sqlite://{}", db_root.join("custom.sqlite").display());
    let db = SleiDb::connect(&database_url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());
    repos
        .upsert_conversation(ConversationRow {
            id: "dm:agent_shared_repo".to_string(),
            kind: "dm".to_string(),
            agent_id: "agent_shared_repo".to_string(),
            active_session_id: None,
            runtime_status: None,
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
        })
        .await
        .unwrap();

    let conversations = ConversationService::new(repos, root.clone())
        .list_conversations()
        .await;

    assert_eq!(conversations.len(), 1);
    assert_eq!(conversations[0].id, "dm:agent_shared_repo");
    assert!(!root.join("slei.sqlite").exists());
}

#[tokio::test]
async fn conversation_messages_scope_idempotency_keys_to_their_conversation() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("conversation-message-idempotency-scope");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let (first_conversation, _) = state
        .conversations()
        .create_dm("agent_first_scope")
        .await
        .unwrap();
    let (second_conversation, _) = state
        .conversations()
        .create_dm("agent_second_scope")
        .await
        .unwrap();

    let first = state
        .conversations()
        .append_message(
            &first_conversation.id,
            "human:local",
            "first body",
            Some("shared-message-key"),
        )
        .await
        .unwrap();
    let first_retry = state
        .conversations()
        .append_message(
            &first_conversation.id,
            "human:local",
            "changed retry body",
            Some("shared-message-key"),
        )
        .await
        .unwrap();
    let second = state
        .conversations()
        .append_message(
            &second_conversation.id,
            "human:local",
            "second body",
            Some("shared-message-key"),
        )
        .await
        .unwrap();

    assert_eq!(first_retry.id, first.id);
    assert_eq!(first_retry.body, "first body");
    assert_ne!(second.id, first.id);

    let reloaded = AppState::for_tests_with_agent_root(token, root);
    let first_messages = reloaded
        .conversations()
        .list_messages(&first_conversation.id)
        .await
        .unwrap();
    let second_messages = reloaded
        .conversations()
        .list_messages(&second_conversation.id)
        .await
        .unwrap();

    assert_eq!(first_messages.len(), 1);
    assert_eq!(first_messages[0].id, first.id);
    assert_eq!(first_messages[0].body, "first body");
    assert_eq!(second_messages.len(), 1);
    assert_eq!(second_messages[0].id, second.id);
    assert_eq!(second_messages[0].body, "second body");
}

#[tokio::test]
async fn card_message_external_id_conflict_does_not_move_messages_between_conversations() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("card-message-cross-conversation-id");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let (first_conversation, _) = state
        .conversations()
        .create_dm("agent_card_first")
        .await
        .unwrap();
    let (second_conversation, _) = state
        .conversations()
        .create_dm("agent_card_second")
        .await
        .unwrap();
    let message_id = "externally_supplied_card_message";

    let first = state
        .conversations()
        .upsert_card_message(
            &first_conversation.id,
            "agent_card_first",
            message_id,
            vec![test_card("card-first", "First")],
            Some("approval"),
        )
        .await
        .unwrap();
    let first_update = state
        .conversations()
        .upsert_card_message(
            &first_conversation.id,
            "agent_card_first",
            message_id,
            vec![test_card("card-first", "First updated")],
            Some("done"),
        )
        .await
        .unwrap();
    let second = state
        .conversations()
        .upsert_card_message(
            &second_conversation.id,
            "agent_card_second",
            message_id,
            vec![test_card("card-second", "Second")],
            Some("approval"),
        )
        .await;

    assert_eq!(first.id, message_id);
    assert_eq!(first_update.id, first.id);
    assert_eq!(first_update.status.as_deref(), Some("done"));
    assert_eq!(first_update.cards[0].title, "First updated");
    assert!(second.is_err());

    let reloaded = AppState::for_tests_with_agent_root(token, root);
    let first_messages = reloaded
        .conversations()
        .list_messages(&first_conversation.id)
        .await
        .unwrap();
    let second_messages = reloaded
        .conversations()
        .list_messages(&second_conversation.id)
        .await
        .unwrap();

    assert_eq!(first_messages.len(), 1);
    assert_eq!(first_messages[0].id, message_id);
    assert_eq!(first_messages[0].conversation_id, first_conversation.id);
    assert_eq!(first_messages[0].cards[0].title, "First updated");
    assert_eq!(second_messages.len(), 0);
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
    let command = start_run_command_with_prompt(&commands, "帮我看一下初始化流程");
    assert_eq!(command["session"]["agent_id"], agent_id);
    assert_eq!(command["session"]["cwd"], workspace);
    assert_eq!(command["session"]["persist_session"], true);
    assert_eq!(command["session"]["resume_session"], false);
    assert!(Uuid::parse_str(command["session"]["session_id"].as_str().unwrap()).is_ok());
    assert_eq!(command["input"]["context"], json!([]));
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
    let commands = state.worker_commands();
    let first_command = start_run_command_with_prompt(&commands, "第一句").clone();
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
    let second_command = start_run_command_with_prompt(&commands, "第二句");
    assert_eq!(second_command["session"]["session_id"], first_session_id);
    assert_eq!(second_command["session"]["persist_session"], true);
    assert_eq!(second_command["session"]["resume_session"], true);
    assert_eq!(second_command["input"]["context"], json!([]));

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
    let clear_session = commands
        .iter()
        .find(|command| {
            command["type"] == "clear_session"
                && command["session"]["session_id"] == first_session_id
        })
        .expect("runtime reset should clear the previous session");
    assert_eq!(clear_session["session"]["session_id"], first_session_id);

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
    let third_command = start_run_command_with_prompt(&commands, "第三句");
    let reset_session_id = third_command["session"]["session_id"].as_str().unwrap();
    assert_ne!(reset_session_id, first_session_id);
    assert_eq!(third_command["session"]["resume_session"], false);
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
    let commands = state.worker_commands();
    let attachment_command = start_run_command_containing_prompt(&commands, "Attachments:");
    assert!(attachment_command["input"]["prompt"]
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
async fn legacy_conversation_import_completes_when_sqlite_is_partially_seeded() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("partial-legacy-conversation-import");
    fs::create_dir_all(root.join("conversations/messages")).unwrap();
    fs::write(
        root.join("conversations/index.json"),
        r#"[
          {
            "id": "dm:agent_partial",
            "kind": "dm",
            "agentId": "agent_partial",
            "activeSessionId": "session:dm_agent_partial:legacy",
            "createdAt": "1",
            "updatedAt": "1"
          }
        ]"#,
    )
    .unwrap();
    fs::write(
        root.join("conversations/sessions.json"),
        r#"[
          {
            "id": "session:dm_agent_partial:legacy",
            "conversationId": "dm:agent_partial",
            "title": "旧会话标题",
            "status": "ready",
            "runtimeSession": {
              "runtimeKind": "ClaudeCode",
              "sessionId": "legacy-runtime-session",
              "status": "ready",
              "createdAt": "1",
              "updatedAt": "2"
            },
            "createdAt": "1",
            "updatedAt": "2"
          }
        ]"#,
    )
    .unwrap();
    fs::write(
        root.join("conversations/messages/dm_agent_partial.json"),
        r#"[
          {
            "id": "msg_partial_legacy",
            "conversationId": "dm:agent_partial",
            "authorId": "human:local",
            "body": "半导入前留下的旧消息",
            "createdAt": "3"
          }
        ]"#,
    )
    .unwrap();

    let database_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let db = SleiDb::connect(&database_url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());
    repos
        .upsert_conversation(ConversationRow {
            id: "dm:agent_partial".to_string(),
            kind: "dm".to_string(),
            agent_id: "agent_partial".to_string(),
            active_session_id: Some("session:dm_agent_partial:legacy".to_string()),
            runtime_status: None,
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
        })
        .await
        .unwrap();

    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state.clone());
    let conversations = response_json(get_json(&app, &token, "/v1/conversations").await).await;
    assert_eq!(
        conversations["conversations"][0]["runtimeSession"]["sessionId"],
        "legacy-runtime-session"
    );
    let sessions =
        response_json(get_json(&app, &token, "/v1/conversations/dm:agent_partial/sessions").await)
            .await;
    assert_eq!(sessions["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(
        sessions["sessions"][0]["id"],
        "session:dm_agent_partial:legacy"
    );
    assert_eq!(sessions["sessions"][0]["title"], "旧会话标题");

    let messages = response_json(
        get_json(
            &app,
            &token,
            "/v1/conversations/dm:agent_partial/messages?sessionId=session:dm_agent_partial:legacy",
        )
        .await,
    )
    .await;
    assert_eq!(messages["messages"].as_array().unwrap().len(), 1);
    assert_eq!(messages["messages"][0]["id"], "msg_partial_legacy");
    assert_eq!(
        messages["messages"][0]["sessionId"],
        "session:dm_agent_partial:legacy"
    );

    let (runtime_session, created) = state
        .conversations()
        .ensure_runtime_session("dm:agent_partial", "ClaudeCode")
        .await
        .unwrap();
    assert!(!created);
    assert_eq!(runtime_session.session_id, "legacy-runtime-session");
}

#[tokio::test]
async fn uploaded_attachment_can_be_sent_after_daemon_reload() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("unsent-attachment-reload");
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let app = build_router(state);

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-unsent-attachment-agent"),
        json!({
            "name": "Coda",
            "handle": "@coda-unsent",
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
            Some("unsent-attachment-dm"),
            json!({ "agentId": agent_id }),
        )
        .await,
    )
    .await;
    let conversation_id = conversation["conversation"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let attachment = response_json(
        post_json(
            &app,
            &token,
            "/v1/attachments",
            Some("upload-before-reload"),
            json!({ "name": "unsent-notes.txt", "mimeType": "text/plain", "bytesBase64": "dW5zZW50IG5vdGVz" }),
        )
        .await,
    )
    .await;
    let attachment_id = attachment["attachment"]["id"].as_str().unwrap();
    let cache_path = attachment["attachment"]["cachePath"]
        .as_str()
        .unwrap()
        .to_string();

    let reloaded_state = AppState::for_tests_with_agent_root(token.clone(), root);
    let reloaded = build_router(reloaded_state.clone());
    let sent = post_json(
        &reloaded,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("send-reloaded-attachment"),
        json!({
            "body": "请看附件",
            "authorId": "human:local",
            "attachmentIds": [attachment_id],
        }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);
    let sent_body = response_json(sent).await;
    assert_eq!(
        sent_body["message"]["attachments"][0]["name"],
        "unsent-notes.txt"
    );

    let commands = reloaded_state.worker_commands();
    let prompt = commands[0]["input"]["prompt"].as_str().unwrap();
    assert!(prompt.contains("unsent-notes.txt"));
    assert!(prompt.contains(&cache_path));
}

#[tokio::test]
async fn dm_send_rejects_session_from_another_conversation() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("dm-cross-session-rejection");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state.clone());

    let first = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-cross-session-first"),
        json!({
            "name": "Coda",
            "handle": "@cross-session-first",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "研发团队开发工程师。"
        }),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let first_agent_id = response_json(first).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let second = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("create-cross-session-second"),
        json!({
            "name": "Nova",
            "handle": "@cross-session-second",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "研发团队开发工程师。"
        }),
    )
    .await;
    assert_eq!(second.status(), StatusCode::CREATED);
    let second_agent_id = response_json(second).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let first_conversation = response_json(
        post_json(
            &app,
            &token,
            "/v1/conversations/dm",
            Some("cross-session-first-dm"),
            json!({ "agentId": first_agent_id }),
        )
        .await,
    )
    .await;
    let first_conversation_id = first_conversation["conversation"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let first_session_id = first_conversation["conversation"]["activeSessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let second_conversation = response_json(
        post_json(
            &app,
            &token,
            "/v1/conversations/dm",
            Some("cross-session-second-dm"),
            json!({ "agentId": second_agent_id }),
        )
        .await,
    )
    .await;
    let second_session_id = second_conversation["conversation"]["activeSessionId"]
        .as_str()
        .unwrap()
        .to_string();

    let rejected = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{first_conversation_id}/messages"),
        Some("cross-session-message"),
        json!({
            "body": "不应写入另一个会话",
            "authorId": "human:local",
            "sessionId": second_session_id,
        }),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::NOT_FOUND);

    let listed = response_json(get_json(&app, &token, "/v1/conversations").await).await;
    let first_after = listed["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|conversation| conversation["id"] == first_conversation_id)
        .unwrap();
    assert_eq!(first_after["activeSessionId"], first_session_id);
    let messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/conversations/{first_conversation_id}/messages"),
        )
        .await,
    )
    .await;
    assert_eq!(messages["messages"].as_array().unwrap().len(), 0);
    assert!(state.worker_commands().iter().all(|command| {
        command["input"]["prompt"]
            .as_str()
            .is_none_or(|prompt| !prompt.contains("不应写入另一个会话"))
    }));
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
    let command = start_run_command_with_prompt(&commands, "用户第 7 轮");
    let context = command["input"]["context"].as_array().unwrap();
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
    let commands = state.worker_commands();
    let run_id = start_run_command_with_prompt(&commands, "请给我一个方案")["run_id"]
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

async fn delete_json(app: &axum::Router, token: &AuthToken, uri: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(uri)
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn start_run_command_with_prompt<'a>(commands: &'a [Value], prompt: &str) -> &'a Value {
    commands
        .iter()
        .find(|command| command["type"] == "start_run" && command["input"]["prompt"] == prompt)
        .expect("expected worker start_run command with prompt")
}

fn start_run_command_containing_prompt<'a>(commands: &'a [Value], needle: &str) -> &'a Value {
    commands
        .iter()
        .find(|command| {
            command["type"] == "start_run"
                && command["input"]["prompt"]
                    .as_str()
                    .is_some_and(|prompt| prompt.contains(needle))
        })
        .expect("expected worker start_run command containing prompt")
}

async fn wait_for_channel_member(
    app: &axum::Router,
    token: &AuthToken,
    channel_id: &str,
    agent_id: &str,
) -> Value {
    for _ in 0..50 {
        let members = get_json(app, token, &format!("/v1/channels/{channel_id}/members")).await;
        assert_eq!(members.status(), StatusCode::OK);
        let members_body = response_json(members).await;
        if let Some(member) = members_body["members"]
            .as_array()
            .unwrap()
            .iter()
            .find(|member| member["agentId"] == agent_id)
        {
            return member.clone();
        }
        sleep(Duration::from_millis(20)).await;
    }
    panic!("selected agent should become a channel member");
}

async fn wait_for_channel_member_readiness(
    app: &axum::Router,
    token: &AuthToken,
    channel_id: &str,
    agent_id: &str,
    readiness: &str,
) -> Value {
    for _ in 0..50 {
        let member = wait_for_channel_member(app, token, channel_id, agent_id).await;
        if member["readiness"] == readiness {
            return member;
        }
        sleep(Duration::from_millis(20)).await;
    }
    panic!("selected agent should reach readiness {readiness}");
}

async fn wait_for_memory_update_requests(
    state: &AppState,
    agent_id: &str,
    channel_id: &str,
    minimum_count: usize,
) -> Vec<slei_daemon::services::memory_event_service::MemoryUpdateEvent> {
    for _ in 0..50 {
        let events = state.memory_events().events_for_agent(agent_id).await;
        let count = events
            .iter()
            .filter(|event| {
                event.event_type == "memory_update_requested"
                    && event.channel_id.as_deref() == Some(channel_id)
            })
            .count();
        if count >= minimum_count {
            return events;
        }
        sleep(Duration::from_millis(20)).await;
    }
    panic!("memory update request should be recorded");
}

fn make_temp_dir(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("slei-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    path
}

fn test_card(id: &str, title: &str) -> InteractiveCardView {
    InteractiveCardView {
        id: id.to_string(),
        kind: "test".to_string(),
        state: "pending".to_string(),
        title: title.to_string(),
        summary: String::new(),
        draft: json!({}),
        action_label: "Apply".to_string(),
        done_label: "Done".to_string(),
    }
}
