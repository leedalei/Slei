use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::channel_orchestrator_service::SendChannelMessageInput;
use slei_daemon::services::channel_service::{
    ChannelDraft, ChannelMemberReadiness, PermissionPreset,
};
use slei_daemon::services::member_service::{ProductAgentRecord, RuntimeThreadRecord};
use slei_daemon::services::message_service::MessageKind;
use slei_daemon::services::task_service::{TaskQuery, TaskStatus};
use slei_daemon::state::AppState;
use tokio::time::{sleep, Duration};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn channel_messages_ignore_legacy_sessions_and_show_continuous_timeline_through_api() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let app = build_router(state.clone());

    let channels = response_json(get_json(&app, &token, "/v1/channels").await).await;
    let channel = channels["channels"]
        .as_array()
        .unwrap()
        .iter()
        .find(|channel| channel["id"] == "all")
        .expect("default channel");
    let default_session_id = channel["activeSessionId"]
        .as_str()
        .expect("default channel should have active session");

    let sessions = response_json(get_json(&app, &token, "/v1/channels/all/sessions").await).await;
    assert_eq!(sessions["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(sessions["sessions"][0]["id"], default_session_id);

    let sent = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        Some("channel-session-message-1"),
        json!({
            "authorId": "human:local",
            "body": "帮我看看今天的发布风险",
            "asTask": false
        }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::OK);

    let default_messages = response_json(
        get_json(
            &app,
            &token,
            &format!("/v1/channels/all/messages?sessionId={default_session_id}"),
        )
        .await,
    )
    .await;
    assert_eq!(default_messages["messages"].as_array().unwrap().len(), 1);
    assert_eq!(
        default_messages["messages"][0]["sessionId"],
        default_session_id
    );

    let new_session =
        response_json(post_json(&app, &token, "/v1/channels/all/sessions", None, json!({})).await)
            .await;
    let new_session_id = new_session["session"]["id"].as_str().unwrap();
    assert_ne!(new_session_id, default_session_id);
    assert_eq!(new_session["channel"]["activeSessionId"], new_session_id);

    let active_messages =
        response_json(get_json(&app, &token, "/v1/channels/all/messages").await).await;
    assert_eq!(active_messages["messages"].as_array().unwrap().len(), 1);

    let sent_new = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        Some("channel-session-message-2"),
        json!({
            "authorId": "human:local",
            "body": "这是新会话里的消息",
            "asTask": false
        }),
    )
    .await;
    assert_eq!(sent_new.status(), StatusCode::OK);
    let new_messages =
        response_json(get_json(&app, &token, "/v1/channels/all/messages").await).await;
    assert_eq!(new_messages["messages"].as_array().unwrap().len(), 2);
    assert_eq!(new_messages["messages"][0]["sessionId"], default_session_id);
    assert_eq!(new_messages["messages"][1]["sessionId"], new_session_id);

    let activated = response_json(
        patch_json(
            &app,
            &token,
            &format!("/v1/channels/all/sessions/{default_session_id}/active"),
            None,
            json!({}),
        )
        .await,
    )
    .await;
    assert_eq!(activated["channel"]["activeSessionId"], default_session_id);
}

#[tokio::test]
async fn channel_agent_replies_and_cards_inherit_source_message_session() {
    let state = app_state_with_agent_handle("agent_nova", "@nova").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-session-inherit",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_nova")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_nova", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let second_session = state.channels().create_session("dev").await.unwrap();
    state
        .channels()
        .activate_session("dev", &second_session.id)
        .await
        .unwrap();

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "@nova 帮我改 alert 文案".to_string(),
        idempotency_key: "send-explicit-session".to_string(),
        as_task: true,
    };
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();
    assert_eq!(outcome.action, "create_task_and_assign");

    let run_id = state
        .worker_commands()
        .iter()
        .find(|command| {
            command["type"] == "start_run" && command["session"]["agent_id"] == "agent_nova"
        })
        .and_then(|command| command["run_id"].as_str())
        .unwrap()
        .to_string();

    state
        .handle_worker_event(json!({
            "type": "product_tool_requested",
            "run_id": run_id,
            "agent_id": "agent_nova",
            "tool_name": "slei_propose_interactive_card",
            "tool_use_id": "tool-1",
            "payload": {
                "kind": "createAgent",
                "title": "创建临时 Agent",
                "summary": "用于 session 继承测试",
                "actionLabel": "创建",
                "doneLabel": "已创建",
                "draft": {
                    "name": "Temp",
                    "handle": "@temp",
                    "runtimeKind": "ClaudeCode",
                    "model": "Sonnet",
                    "nodeId": "local-node",
                    "description": "临时测试 Agent"
                }
            }
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": run_id,
            "delta": "已处理。",
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "completed",
            "run_id": run_id,
        }))
        .await
        .unwrap();

    let messages = state.channel_messages_for_tests("dev").await;
    let source = messages
        .iter()
        .find(|message| message.id == outcome.message_id)
        .unwrap();
    assert_eq!(
        source.session_id.as_deref(),
        Some(second_session.id.as_str())
    );
    let agent_messages = messages
        .iter()
        .filter(|message| message.author_id == "agent_nova")
        .collect::<Vec<_>>();
    assert_eq!(agent_messages.len(), 1);
    assert!(agent_messages
        .iter()
        .all(|message| message.session_id.as_deref() == Some(second_session.id.as_str())));
}

#[tokio::test]
async fn task_message_without_explicit_mentions_creates_task_and_broadcasts_source_message() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let command_body = "实现频道创建时选择 Agent 的功能";
    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: command_body.to_string(),
        idempotency_key: "send-command".to_string(),
        as_task: true,
    };
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(outcome.assignee_agent_id, None);
    assert_eq!(outcome.assignee_agent_ids, vec!["agent_alice".to_string()]);
    assert_broadcast_deliveries_running(&state, &outcome.message_id, &["agent_alice"]).await;
    assert_broadcast_runs_started(
        &state,
        &["agent_alice"],
        &outcome.message_id,
        &[command_body],
        &[],
    );
    assert!(state
        .orchestration()
        .coordinator_runtime_run_for_idempotency("send-command")
        .await
        .unwrap()
        .is_none());
    let task_id = outcome.task_id.as_deref().unwrap();
    let task = state.tasks().task(task_id).await.unwrap();
    assert_eq!(task.assignee_id, None);
    assert_eq!(
        task.source_message_id.as_deref(),
        Some(outcome.message_id.as_str())
    );
    assert!(task.needs_assignment);
    assert!(task
        .assignment_reason
        .as_deref()
        .unwrap()
        .contains("explicitly converted"));

    let inbox = state.agent_inbox().events_for_agent("agent_alice").await;
    assert!(!inbox.iter().any(|event| {
        event.event_type == "task_assigned" && event.message_id == outcome.message_id
    }));

    let messages = state.channel_messages_for_tests("dev").await;
    assert!(messages
        .iter()
        .all(|message| message.kind != MessageKind::TaskCard));
    assert!(messages
        .iter()
        .any(|message| { message.id == outcome.message_id && message.kind == MessageKind::Human }));

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&outcome.message_id)
        .await;
    assert!(decisions.is_empty());

    let packages = state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&outcome.message_id)
        .await;
    assert!(packages.is_empty());
}

#[tokio::test]
async fn broadcast_channel_message_creates_deliveries_for_all_regular_targets() {
    let state =
        app_state_with_agent_handles(&[("agent_alice", "@alice-win"), ("agent_coda", "@coda-win")])
            .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-broadcast",
        )
        .await
        .unwrap();
    for agent_id in ["agent_alice", "agent_coda"] {
        state
            .channels()
            .add_agent_to_channel("dev", agent_id)
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness("dev", agent_id, ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "大家好，报数".to_string(),
        idempotency_key: "send-broadcast-multi".to_string(),
        as_task: false,
    };

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();
    let retry = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(retry.message_id, outcome.message_id);
    assert_eq!(outcome.decision_status.as_deref(), Some("completed"));
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(
        outcome.assignee_agent_ids,
        vec!["agent_alice".to_string(), "agent_coda".to_string()]
    );
    assert_broadcast_runs_started(
        &state,
        &["agent_alice", "agent_coda"],
        &outcome.message_id,
        &["大家好，报数"],
        &[],
    );

    assert_broadcast_deliveries_running(
        &state,
        &outcome.message_id,
        &["agent_alice", "agent_coda"],
    )
    .await;

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&outcome.message_id)
        .await;
    assert!(decisions.is_empty());
}

#[tokio::test]
async fn user_plain_channel_message_broadcasts_pending_deliveries_to_regular_agents_only() {
    let state = app_state_with_agent_specs(&[
        TestAgentSpec::regular("agent_alice", "@alice-win"),
        TestAgentSpec::regular("agent_coda", "@coda-win"),
        TestAgentSpec::coordinator("agent_coordinator_dev", "@dev-coordinator"),
        TestAgentSpec::system_owned("agent_system_guide", "@guide"),
    ])
    .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-broadcast-delivery",
        )
        .await
        .unwrap();
    for agent_id in [
        "agent_alice",
        "agent_coda",
        "agent_coordinator_dev",
        "agent_system_guide",
    ] {
        state
            .channels()
            .add_agent_to_channel("dev", agent_id)
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness("dev", agent_id, ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    state
        .messages()
        .create_human_channel_message(
            "dev",
            "human_lei",
            "旧历史不应进 broadcast prompt",
            "plain-broadcast-prior-history",
            false,
        )
        .await
        .unwrap();
    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "大家看一下这个发布风险".to_string(),
        idempotency_key: "send-plain-broadcast-delivery".to_string(),
        as_task: false,
    };

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();
    let retry = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.message_id, retry.message_id);
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(outcome.decision_status.as_deref(), Some("completed"));
    assert_eq!(
        outcome.assignee_agent_ids,
        vec!["agent_alice".to_string(), "agent_coda".to_string()]
    );
    assert_broadcast_runs_started(
        &state,
        &["agent_alice", "agent_coda"],
        &outcome.message_id,
        &["大家看一下这个发布风险"],
        &["旧历史不应进 broadcast prompt"],
    );
    assert!(state
        .orchestration()
        .coordinator_runtime_run_for_idempotency("send-plain-broadcast-delivery")
        .await
        .unwrap()
        .is_none());

    assert_broadcast_deliveries_running(
        &state,
        &outcome.message_id,
        &["agent_alice", "agent_coda"],
    )
    .await;
    for agent_id in ["agent_coordinator_dev", "agent_system_guide"] {
        assert!(state
            .claims()
            .pending_message_deliveries(agent_id, 20)
            .await
            .unwrap()
            .is_empty());
    }
}

#[tokio::test]
async fn mentioned_channel_message_still_broadcasts_deliveries_without_coordinator_runtime() {
    let state =
        app_state_with_agent_handles(&[("agent_alice", "@alice-win"), ("agent_coda", "@coda-win")])
            .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-mention-broadcast-delivery",
        )
        .await
        .unwrap();
    for agent_id in ["agent_alice", "agent_coda"] {
        state
            .channels()
            .add_agent_to_channel("dev", agent_id)
            .await
            .unwrap();
    }

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "@alice-win 你先看一下，Coda 也可以决定是否 claim".to_string(),
            idempotency_key: "send-mention-broadcast-delivery".to_string(),
            as_task: false,
        })
        .await
        .unwrap();

    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(
        outcome.assignee_agent_ids,
        vec!["agent_alice".to_string(), "agent_coda".to_string()]
    );
    assert_broadcast_runs_started(
        &state,
        &["agent_alice", "agent_coda"],
        &outcome.message_id,
        &["@alice-win 你先看一下"],
        &[],
    );
    assert!(state
        .orchestration()
        .coordinator_runtime_run_for_idempotency("send-mention-broadcast-delivery")
        .await
        .unwrap()
        .is_none());
    assert_broadcast_deliveries_running(
        &state,
        &outcome.message_id,
        &["agent_alice", "agent_coda"],
    )
    .await;
}

#[tokio::test]
async fn broadcast_start_failure_rolls_delivery_back_for_retry() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-broadcast-start-failure",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "这次启动 worker 会先失败，然后重试".to_string(),
        idempotency_key: "send-broadcast-start-failure".to_string(),
        as_task: false,
    };

    state.fail_next_worker_send_for_tests();
    let first = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await;
    assert!(first.is_err());
    assert!(
        state.worker_commands().is_empty(),
        "failed worker send should not leave a start_run command behind"
    );

    let message = state
        .messages()
        .channel_message_for_idempotency("send-broadcast-start-failure")
        .await
        .unwrap();
    let deliveries = state
        .claims()
        .message_deliveries_for_message(&message.id)
        .await
        .unwrap();
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].agent_id, "agent_alice");
    assert_eq!(deliveries[0].delivery_state, "pending");
    assert!(deliveries[0].run_id.is_none());

    let retry = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();
    assert_eq!(retry.action, "broadcast_delivered");
    assert_eq!(retry.message_id, message.id);
    assert_broadcast_deliveries_running(&state, &retry.message_id, &["agent_alice"]).await;
    assert_broadcast_runs_started(
        &state,
        &["agent_alice"],
        &retry.message_id,
        &["这次启动 worker 会先失败，然后重试"],
        &[],
    );
}

#[tokio::test]
async fn broadcast_worker_completed_marks_delivery_completed_and_logs_diagnostics() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-broadcast-completed",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "看一下这条广播".to_string(),
            idempotency_key: "send-broadcast-completed".to_string(),
            as_task: false,
        })
        .await
        .unwrap();
    let run_id = state
        .claims()
        .message_deliveries_for_message(&outcome.message_id)
        .await
        .unwrap()[0]
        .run_id
        .clone()
        .unwrap();

    state
        .handle_worker_event(serde_json::json!({
            "type": "output_delta",
            "run_id": run_id,
            "delta": "我不能直接回复，因为 CLI 不可用",
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(serde_json::json!({
            "type": "completed",
            "run_id": run_id,
        }))
        .await
        .unwrap();

    let delivery = state
        .claims()
        .message_deliveries_for_message(&outcome.message_id)
        .await
        .unwrap()
        .pop()
        .unwrap();
    assert_eq!(delivery.delivery_state, "completed");

    let events = state
        .orchestration()
        .recent_diagnostic_events(20)
        .await
        .unwrap();
    assert!(events.iter().any(|event| {
        event.event_type == "channel_agent_runtime.delivery_completed"
            && event.payload.contains(&format!("run_id={run_id}"))
            && event.payload.contains("marked=true")
    }));
    assert!(events.iter().any(|event| {
        event.event_type == "channel_agent_runtime.broadcast_stdout_suppressed"
            && event
                .payload
                .contains("visible_replies_require_slei_cli_claim_send")
    }));
}

#[tokio::test]
async fn pure_consultation_broadcasts_without_creating_task() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-consultation",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "这个架构方案应该先怎么拆？".to_string(),
        idempotency_key: "send-pure-consultation".to_string(),
        as_task: false,
    };
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();

    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.decision_status.as_deref(), Some("completed"));
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(outcome.assignee_agent_ids, vec!["agent_alice".to_string()]);
    let retry = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();
    assert_eq!(retry.message_id, outcome.message_id);
    assert_eq!(outcome.task_id, None);
    assert!(state
        .tasks()
        .list_tasks(TaskQuery::default())
        .await
        .is_empty());

    assert_broadcast_deliveries_running(&state, &outcome.message_id, &["agent_alice"]).await;
    assert_broadcast_runs_started(
        &state,
        &["agent_alice"],
        &outcome.message_id,
        &["这个架构方案应该先怎么拆？"],
        &[],
    );
}

#[tokio::test]
async fn normal_channel_message_replay_recovers_completed_reply_route_side_effects() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-recover-reply-side-effects",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let body = "这个设计方案是否合理？";
    let idempotency_key = "send-normal-recover-reply-side-effects";
    let message = state
        .messages()
        .create_human_channel_message("dev", "human_lei", body, idempotency_key, false)
        .await
        .unwrap();
    let decision_id = Uuid::new_v4();
    state
        .orchestration()
        .record_decision(
            decision_id,
            "dev",
            &message.id,
            "consultation",
            "request_agent_reply",
            Some("agent_alice"),
            &["agent_alice".to_string()],
            "consultation should be answered by Alice",
        )
        .await
        .unwrap();
    state
        .orchestration()
        .record_routing_context_package(
            Uuid::new_v4(),
            decision_id,
            &message.id,
            &json!({
                "currentMessageId": message.id,
                "targetAgentId": "agent_alice",
                "targetAgentIds": ["agent_alice"],
                "action": "request_agent_reply",
                "sourceBody": body,
            })
            .to_string(),
            false,
        )
        .await
        .unwrap();

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: body.to_string(),
            idempotency_key: idempotency_key.to_string(),
            as_task: false,
        })
        .await
        .unwrap();

    assert_eq!(outcome.action, "request_agent_reply");
    assert_eq!(outcome.message_id, message.id);
    let inbox = state.agent_inbox().events_for_agent("agent_alice").await;
    assert_eq!(
        inbox
            .iter()
            .filter(|event| event.event_type == "human_mention" && event.message_id == message.id)
            .count(),
        1
    );
    assert!(state.worker_commands().iter().any(|command| {
        command["type"] == "start_run"
            && command["session"]["agent_id"] == "agent_alice"
            && command["input"]["prompt"] == body
    }));
}

#[tokio::test]
async fn explicit_multi_mention_routes_all_targets_without_coordinator_and_writes_each_reply() {
    let state =
        app_state_with_agent_handles(&[("agent_alice", "@alice-win"), ("agent_coda", "@coda-win")])
            .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-explicit-multi",
        )
        .await
        .unwrap();
    for agent_id in ["agent_alice", "agent_coda"] {
        state
            .channels()
            .add_agent_to_channel("dev", agent_id)
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness("dev", agent_id, ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    let body = "@alice-win @coda-win 一起看下这个频道路由";
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: body.to_string(),
            idempotency_key: "send-explicit-multi".to_string(),
            as_task: false,
        })
        .await
        .unwrap();

    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(
        outcome.assignee_agent_ids,
        vec!["agent_alice".to_string(), "agent_coda".to_string()]
    );
    assert_broadcast_deliveries_running(
        &state,
        &outcome.message_id,
        &["agent_alice", "agent_coda"],
    )
    .await;

    assert_broadcast_runs_started(
        &state,
        &["agent_alice", "agent_coda"],
        &outcome.message_id,
        &[body],
        &[],
    );
}

#[tokio::test]
async fn explicit_task_mentions_create_assignment_inbox_events_for_all_targets() {
    let state =
        app_state_with_agent_handles(&[("agent_alice", "@alice-win"), ("agent_coda", "@coda-win")])
            .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-task-multi-target",
        )
        .await
        .unwrap();
    for agent_id in ["agent_alice", "agent_coda"] {
        state
            .channels()
            .add_agent_to_channel("dev", agent_id)
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness("dev", agent_id, ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "@alice-win @coda-win 一起实现导出功能".to_string(),
        idempotency_key: "send-task-multi-target".to_string(),
        as_task: true,
    };
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

    assert_eq!(outcome.action, "create_task_and_assign");
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(
        outcome.assignee_agent_ids,
        vec!["agent_alice".to_string(), "agent_coda".to_string()]
    );
    let task_id = outcome.task_id.as_deref().unwrap();
    assert_eq!(
        state
            .tasks()
            .task(task_id)
            .await
            .unwrap()
            .assignee_id
            .as_deref(),
        Some("agent_alice")
    );
    for agent_id in ["agent_alice", "agent_coda"] {
        let inbox = state.agent_inbox().events_for_agent(agent_id).await;
        assert!(inbox.iter().any(|event| {
            event.event_type == "task_assigned"
                && event.task_id.as_deref() == Some(task_id)
                && event.message_id == outcome.message_id
        }));
    }
}

#[tokio::test]
async fn task_message_without_mentions_never_starts_coordinator_or_fallback_assignment() {
    let state =
        app_state_with_agent_handles(&[("agent_alice", "@alice-win"), ("agent_coda", "@coda-win")])
            .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-invalid-json",
        )
        .await
        .unwrap();

    for agent_id in ["agent_alice", "agent_coda"] {
        state
            .channels()
            .add_agent_to_channel("dev", agent_id)
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness("dev", agent_id, ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "请看看这个问题".to_string(),
        idempotency_key: "send-invalid-coordinator-json".to_string(),
        as_task: true,
    };
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(outcome.assignee_agent_id, None);
    assert_eq!(
        outcome.assignee_agent_ids,
        vec!["agent_alice".to_string(), "agent_coda".to_string()]
    );
    assert!(state
        .orchestration()
        .coordinator_runtime_run_for_idempotency("send-invalid-coordinator-json")
        .await
        .unwrap()
        .is_none());

    for agent_id in ["agent_alice", "agent_coda"] {
        let inbox = state.agent_inbox().events_for_agent(agent_id).await;
        assert!(!inbox
            .iter()
            .any(|event| { event.message_id == outcome.message_id }));
    }

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&outcome.message_id)
        .await;
    assert!(decisions.is_empty());
}

#[tokio::test]
async fn explicit_mention_creates_readiness_aware_inbox_without_overriding_target() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "@alice-win 帮我看下".to_string(),
        idempotency_key: "send-explicit".to_string(),
        as_task: false,
    };
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.assignee_agent_id, None);
    assert_eq!(outcome.assignee_agent_ids, vec!["agent_alice".to_string()]);
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(outcome.task_id, None);

    assert_broadcast_deliveries_running(&state, &outcome.message_id, &["agent_alice"]).await;
    assert!(state
        .agent_inbox()
        .events_for_agent("agent_alice")
        .await
        .is_empty());
    assert_broadcast_runs_started(
        &state,
        &["agent_alice"],
        &outcome.message_id,
        &["@alice-win 帮我看下"],
        &[],
    );
    assert!(state
        .tasks()
        .list_tasks(TaskQuery::default())
        .await
        .is_empty());
}

#[tokio::test]
async fn task_thread_visible_agent_mention_creates_task_scoped_inbox_event() {
    let state =
        app_state_with_agent_handles(&[("agent_alice", "@alice-win"), ("agent_coda", "@coda-win")])
            .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-handoff",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_coda")
        .await
        .unwrap();
    state.run_channel_join_memory_updates("dev").await.unwrap();

    let task = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "agent_alice",
            "msg_root",
            "实现频道 Coordinator",
            Some("agent_alice".to_string()),
            "initial architecture assignment",
            "task-handoff-root",
        )
        .await
        .unwrap();

    let reply = state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "agent_alice",
            "架构方案完成。@coda-win 请根据方案实现。",
            "task-handoff-reply",
        )
        .await
        .unwrap();
    let retry = state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "agent_alice",
            "架构方案完成。@coda-win 请根据方案实现。",
            "task-handoff-reply",
        )
        .await
        .unwrap();
    assert_eq!(reply.reply.id, retry.reply.id);

    let inbox = state.agent_inbox().events_for_agent("agent_coda").await;
    let handoffs = inbox
        .iter()
        .filter(|event| {
            event.event_type == "task_handoff"
                && event.task_id.as_deref() == Some(task.id.as_str())
                && event.message_id == reply.reply.id
        })
        .collect::<Vec<_>>();
    assert_eq!(handoffs.len(), 1);
    assert_eq!(handoffs[0].sender_id.as_deref(), Some("agent_alice"));
    assert!(handoffs[0]
        .handoff_text
        .as_deref()
        .unwrap()
        .contains("@coda-win"));
    let commands = state.worker_commands();
    let handoff_start_run = commands
        .iter()
        .find(|command| {
            command["type"] == "start_run"
                && command["session"]["agent_id"] == "agent_coda"
                && command["input"]["prompt"].as_str().is_some_and(|prompt| {
                    prompt.contains("架构方案完成。@coda-win 请根据方案实现。")
                })
        })
        .expect("task handoff should start coda runtime");
    assert_eq!(handoff_start_run["input"]["context"], json!([]));
    let system_prompt = handoff_start_run["input"]["system_prompt"]
        .as_str()
        .unwrap();
    assert!(
        system_prompt.contains(&format!("task id: {}", task.id)),
        "system prompt missing exact task id: {system_prompt}"
    );
    assert!(
        system_prompt.contains(&format!("source message id: {}", reply.reply.id)),
        "system prompt missing exact source reply id: {system_prompt}"
    );
    assert!(
        system_prompt.contains("visible @mention handoff"),
        "system prompt should identify visible handoff: {system_prompt}"
    );
    assert!(
        !system_prompt.contains("task assignment"),
        "handoff prompt should not be labeled as task assignment: {system_prompt}"
    );
    complete_channel_agent_run(&state, "agent_coda", "Coda 已在任务线程继续实现。").await;
    let thread = state.tasks().thread_view(&task.id).await.unwrap();
    assert!(thread.replies.iter().any(|reply| {
        reply.sender_id == "agent_coda" && reply.body == "Coda 已在任务线程继续实现。"
    }));
}

#[tokio::test]
async fn task_agent_reply_does_not_create_implicit_same_agent_handoff() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-agent-no-implicit-handoff",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let task = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "human_lei",
            "msg_root_agent_no_implicit",
            "实现任务线程写回",
            Some("agent_alice".to_string()),
            "initial assignment",
            "task-agent-no-implicit-root",
        )
        .await
        .unwrap();

    let reply = state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "agent_alice",
            "已经完成实现和修复，请继续验证。",
            "task-agent-no-implicit-reply",
        )
        .await
        .unwrap();

    assert!(reply.route.handoff_agent_ids.is_empty());
    let handoffs = state
        .agent_inbox()
        .events_for_agent("agent_alice")
        .await
        .into_iter()
        .filter(|event| event.event_type == "task_handoff")
        .collect::<Vec<_>>();
    assert!(handoffs.is_empty());
}

#[tokio::test]
async fn task_human_reply_without_visible_mention_does_not_handoff_to_assignee() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-human-no-implicit-handoff",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let task = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "human_lei",
            "msg_root_human_no_implicit",
            "实现任务线程写回",
            Some("agent_alice".to_string()),
            "initial assignment",
            "task-human-no-implicit-root",
        )
        .await
        .unwrap();

    let reply = state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "human_lei",
            "这里还需要继续修复一下频道发言。",
            "task-human-no-implicit-reply",
        )
        .await
        .unwrap();

    assert!(reply.route.handoff_agent_ids.is_empty());
    let inbox = state.agent_inbox().events_for_agent("agent_alice").await;
    assert!(inbox
        .iter()
        .filter(|event| event.event_type == "task_handoff")
        .collect::<Vec<_>>()
        .is_empty());
}

#[tokio::test]
async fn task_reply_retry_uses_stored_reply_for_handoff_side_effects() {
    let state = app_state_with_agent_handles(&[
        ("agent_alice", "@alice-win"),
        ("agent_coda", "@coda-win"),
        ("agent_bob", "@bob-win"),
    ])
    .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-replay-handoff",
        )
        .await
        .unwrap();
    for agent_id in ["agent_coda", "agent_bob"] {
        state
            .channels()
            .add_agent_to_channel("dev", agent_id)
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness("dev", agent_id, ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    let task_a = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "agent_alice",
            "msg_root_a",
            "实现频道 Coordinator",
            Some("agent_alice".to_string()),
            "initial architecture assignment",
            "task-handoff-replay-a",
        )
        .await
        .unwrap();
    let task_b = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "agent_bob",
            "msg_root_b",
            "实现频道 Inbox",
            Some("agent_bob".to_string()),
            "retry target should be ignored",
            "task-handoff-replay-b",
        )
        .await
        .unwrap();

    let original_body = "架构方案完成。@coda-win 请根据方案实现。";
    let reply = state
        .channel_orchestrator()
        .add_task_reply(
            &task_a.id,
            "agent_alice",
            original_body,
            "task-handoff-replay",
        )
        .await
        .unwrap();
    state
        .tasks()
        .update_status(&task_a.id, TaskStatus::Done)
        .await
        .unwrap();
    let retry = state
        .channel_orchestrator()
        .add_task_reply(
            &task_b.id,
            "agent_bob",
            "改派：@bob-win 请接手这个重试请求。",
            "task-handoff-replay",
        )
        .await
        .unwrap();
    assert_eq!(reply.reply.id, retry.reply.id);
    assert_eq!(retry.reply.sender_id, "agent_alice");
    assert_eq!(retry.reply.body, original_body);
    assert_eq!(
        state.tasks().task(&task_a.id).await.unwrap().status,
        TaskStatus::Done
    );

    let coda_handoffs = state
        .agent_inbox()
        .events_for_agent("agent_coda")
        .await
        .into_iter()
        .filter(|event| event.event_type == "task_handoff")
        .collect::<Vec<_>>();
    assert_eq!(coda_handoffs.len(), 1);
    assert_eq!(
        coda_handoffs[0].task_id.as_deref(),
        Some(task_a.id.as_str())
    );
    assert_eq!(coda_handoffs[0].message_id, reply.reply.id);
    assert_eq!(coda_handoffs[0].sender_id.as_deref(), Some("agent_alice"));
    assert_eq!(
        coda_handoffs[0].handoff_text.as_deref(),
        Some(original_body)
    );

    let bob_handoffs = state
        .agent_inbox()
        .events_for_agent("agent_bob")
        .await
        .into_iter()
        .filter(|event| event.event_type == "task_handoff")
        .collect::<Vec<_>>();
    assert!(bob_handoffs.is_empty());
}

#[tokio::test]
async fn unassigned_task_reply_replay_preserves_completed_state_and_attention() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-unassigned-reply-replay",
        )
        .await
        .unwrap();

    let task = state
        .tasks()
        .create_task_root(
            "dev",
            "human_lei",
            "收敛一条未分配任务",
            "unassigned-reply-root",
        )
        .await
        .unwrap();
    let first = state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "human_lei",
            "继续实现这个任务分支",
            "unassigned-reply-replay",
        )
        .await
        .unwrap();
    assert!(first.route.needs_assignment);

    state
        .tasks()
        .update_status(&task.id, TaskStatus::Done)
        .await
        .unwrap();
    state
        .tasks()
        .set_attention_required(&task.id, false)
        .await
        .unwrap();

    let replay = state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "human_lei",
            "继续实现这个任务分支",
            "unassigned-reply-replay",
        )
        .await
        .unwrap();
    assert_eq!(first.reply.id, replay.reply.id);
    assert!(replay.route.needs_assignment);

    let task = state.tasks().task(&task.id).await.unwrap();
    assert_eq!(task.status, TaskStatus::Done);
    assert!(!task.attention_required);
}

#[tokio::test]
async fn command_message_retry_replays_outcome_without_duplicate_side_effects() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "实现频道创建时选择 Agent 的功能".to_string(),
        idempotency_key: "send-command-retry".to_string(),
        as_task: true,
    };

    let first = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();
    let retry = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();

    assert_eq!(first.action, "broadcast_delivered");
    assert_eq!(retry.action, "broadcast_delivered");
    assert_eq!(first.message_id, retry.message_id);
    assert_eq!(first.task_id, retry.task_id);
    assert_eq!(first.coordinator_run_id, None);
    assert_eq!(retry.coordinator_run_id, None);
    assert_eq!(first.assignee_agent_id, retry.assignee_agent_id);
    assert_eq!(first.assignee_agent_ids, retry.assignee_agent_ids);

    let task_id = first.task_id.as_deref().unwrap();
    let task = state.tasks().task(task_id).await.unwrap();
    assert_eq!(
        task.source_message_id.as_deref(),
        Some(first.message_id.as_str())
    );
    assert!(state
        .channel_messages_for_tests("dev")
        .await
        .iter()
        .all(|message| message.kind != MessageKind::TaskCard));

    assert_broadcast_deliveries_running(&state, &first.message_id, &["agent_alice"]).await;

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&first.message_id)
        .await;
    assert!(decisions.is_empty());

    let packages = state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&first.message_id)
        .await;
    assert!(packages.is_empty());
}

#[tokio::test]
async fn command_message_partial_retry_recovers_existing_side_effects_without_duplicates() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let idempotency_key = "send-command-partial";
    let body = "实现频道创建时选择 Agent 的功能";
    let message = state
        .messages()
        .create_human_channel_message("dev", "human_lei", body, idempotency_key, false)
        .await
        .unwrap();
    let assignment_reason = "task command assigned to ready agent agent_alice";
    let decision_id = Uuid::new_v4();
    let target_agent_ids = vec!["agent_alice".to_string()];
    state
        .orchestration()
        .record_decision(
            decision_id,
            "dev",
            &message.id,
            "task_command",
            "create_task_and_assign",
            Some("agent_alice"),
            &target_agent_ids,
            assignment_reason,
        )
        .await
        .unwrap();
    let task = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "human_lei",
            &message.id,
            body,
            Some("agent_alice".to_string()),
            assignment_reason,
            &format!("{idempotency_key}:coordinator-task"),
        )
        .await
        .unwrap();
    state
        .messages()
        .create_task_card_message("dev", &task.id, &message.id)
        .await
        .unwrap();
    state
        .agent_inbox()
        .create_task_assignment("agent_alice", "dev", &task.id, &message.id)
        .await;
    state
        .orchestration()
        .record_routing_context_package(
            Uuid::new_v4(),
            decision_id,
            &message.id,
            &serde_json::json!({
                "currentMessageId": message.id,
                "taskId": task.id,
                "assignmentReason": assignment_reason,
                "relatedMessageIds": [message.id],
                "safeMemoryRefs": ["MEMORY.md", "notes/channels.md", "notes/relationships.md"],
            })
            .to_string(),
            false,
        )
        .await
        .unwrap();

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: body.to_string(),
            idempotency_key: idempotency_key.to_string(),
            as_task: false,
        })
        .await
        .unwrap();

    assert_eq!(outcome.message_id, message.id);
    assert_eq!(outcome.task_id.as_deref(), Some(task.id.as_str()));
    assert_eq!(outcome.action, "create_task_and_assign");
    assert_eq!(outcome.assignee_agent_id.as_deref(), Some("agent_alice"));

    let task_cards = state
        .channel_messages_for_tests("dev")
        .await
        .into_iter()
        .filter(|message| message.kind == MessageKind::TaskCard)
        .collect::<Vec<_>>();
    assert_eq!(task_cards.len(), 1);

    let matching_assignments = state
        .agent_inbox()
        .events_for_agent("agent_alice")
        .await
        .into_iter()
        .filter(|event| {
            event.event_type == "task_assigned"
                && event.message_id == outcome.message_id
                && event.task_id.as_deref() == outcome.task_id.as_deref()
        })
        .collect::<Vec<_>>();
    assert_eq!(matching_assignments.len(), 1);

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&outcome.message_id)
        .await;
    assert_eq!(decisions.len(), 1);

    let packages = state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&outcome.message_id)
        .await;
    assert_eq!(packages.len(), 1);
}

#[tokio::test]
async fn deleted_idempotent_message_retry_is_noop_without_routing_changed_body() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let idempotency_key = "send-command-deleted";
    let message = state
        .messages()
        .create_human_channel_message("dev", "human_lei", "先发一条", idempotency_key, false)
        .await
        .unwrap();
    state
        .messages()
        .delete_human_message(&message.id)
        .await
        .unwrap();

    let err = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "实现一个不该被路由的新任务".to_string(),
            idempotency_key: idempotency_key.to_string(),
            as_task: false,
        })
        .await
        .unwrap_err();

    assert!(err.to_string().contains("inactive idempotent message"));
    assert!(state
        .tasks()
        .list_tasks(TaskQuery::default())
        .await
        .is_empty());
    assert!(state
        .channel_messages_for_tests("dev")
        .await
        .into_iter()
        .filter(|message| message.kind == MessageKind::TaskCard)
        .collect::<Vec<_>>()
        .is_empty());
    assert!(state
        .agent_inbox()
        .events_for_agent("agent_alice")
        .await
        .is_empty());
    assert!(state
        .orchestration()
        .decisions_for_message_for_tests(&message.id)
        .await
        .is_empty());
    assert!(state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&message.id)
        .await
        .is_empty());
}

#[tokio::test]
async fn idempotent_retry_with_changed_fields_uses_persisted_message_fields() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    for channel in ["dev", "qa"] {
        state
            .channels()
            .create_channel(
                ChannelDraft {
                    name: channel.to_string(),
                    description: None,
                    permission: PermissionPreset::Controlled,
                },
                &format!("create-{channel}"),
            )
            .await
            .unwrap();
        state
            .channels()
            .add_agent_to_channel(channel, "agent_alice")
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness(channel, "agent_alice", ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    let idempotency_key = "send-command-mismatched-fields";
    let original_body = "实现频道创建时选择 Agent 的功能";
    let message = state
        .messages()
        .create_human_channel_message("dev", "human_lei", original_body, idempotency_key, false)
        .await
        .unwrap();

    let input = SendChannelMessageInput {
        channel_id: "qa".to_string(),
        author_id: "human_other".to_string(),
        body: "实现一个不该被采用的新任务".to_string(),
        idempotency_key: idempotency_key.to_string(),
        as_task: false,
    };
    let outcome = state
        .channel_orchestrator()
        .send_channel_message(input.clone())
        .await
        .unwrap();

    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.message_id, message.id);
    assert_eq!(outcome.coordinator_run_id, None);
    let retry = state
        .channel_orchestrator()
        .send_channel_message(input)
        .await
        .unwrap();
    assert_eq!(retry.message_id, outcome.message_id);
    assert_eq!(retry.action, outcome.action);

    assert_eq!(outcome.message_id, message.id);
    assert_eq!(outcome.task_id, None);
    assert!(state
        .tasks()
        .list_tasks(TaskQuery::default())
        .await
        .is_empty());

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&message.id)
        .await;
    assert!(decisions.is_empty());
    assert!(state
        .channel_messages_for_tests("dev")
        .await
        .iter()
        .all(|message| message.kind != MessageKind::TaskCard));
    assert!(state
        .channel_messages_for_tests("qa")
        .await
        .iter()
        .all(|message| message.kind != MessageKind::TaskCard));

    assert_broadcast_deliveries_running(&state, &message.id, &["agent_alice"]).await;
}

#[tokio::test]
async fn channel_message_replay_uses_original_non_task_flag() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-as-task-replay-false",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let idempotency_key = "as-task-original-false";
    let body = "这是一条普通讨论";
    let message = state
        .messages()
        .create_human_channel_message("dev", "human_lei", body, idempotency_key, false)
        .await
        .unwrap();
    assert!(!message.as_task);

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: body.to_string(),
            idempotency_key: idempotency_key.to_string(),
            as_task: true,
        })
        .await
        .unwrap();

    assert_eq!(outcome.message_id, message.id);
    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(outcome.assignee_agent_ids, vec!["agent_alice".to_string()]);
    assert!(state
        .tasks()
        .list_tasks(TaskQuery::default())
        .await
        .is_empty());

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: body.to_string(),
            idempotency_key: idempotency_key.to_string(),
            as_task: true,
        })
        .await
        .unwrap();

    assert_eq!(outcome.message_id, message.id);
    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(outcome.assignee_agent_ids, vec!["agent_alice".to_string()]);
    assert_eq!(outcome.task_id, None);
    assert!(state
        .tasks()
        .list_tasks(TaskQuery::default())
        .await
        .is_empty());
}

#[tokio::test]
async fn channel_message_replay_uses_original_as_task_flag() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-as-task-replay-true",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let idempotency_key = "as-task-original-true";
    let body = "这是一条需要单独收敛的讨论";
    let message = state
        .messages()
        .create_human_channel_message("dev", "human_lei", body, idempotency_key, true)
        .await
        .unwrap();
    assert!(message.as_task);

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: body.to_string(),
            idempotency_key: idempotency_key.to_string(),
            as_task: false,
        })
        .await
        .unwrap();

    assert_eq!(outcome.message_id, message.id);
    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.coordinator_run_id, None);
    let task_id = outcome.task_id.as_deref().unwrap().to_string();
    let task = state.tasks().task(&task_id).await.unwrap();
    assert_eq!(task.source_message_id.as_deref(), Some(message.id.as_str()));
    assert!(task.needs_assignment);
    assert_broadcast_deliveries_running(&state, &outcome.message_id, &["agent_alice"]).await;

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: body.to_string(),
            idempotency_key: idempotency_key.to_string(),
            as_task: false,
        })
        .await
        .unwrap();

    assert_eq!(outcome.message_id, message.id);
    assert_eq!(outcome.action, "broadcast_delivered");
    assert_eq!(outcome.coordinator_run_id, None);
    assert_eq!(outcome.task_id.as_deref(), Some(task_id.as_str()));
}

#[tokio::test]
async fn concurrent_command_retries_share_outcome_without_duplicate_side_effects() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let input = SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "实现频道创建时选择 Agent 的功能".to_string(),
        idempotency_key: "send-command-concurrent".to_string(),
        as_task: true,
    };

    let (first, second) = tokio::join!(
        state
            .channel_orchestrator()
            .send_channel_message(input.clone()),
        state
            .channel_orchestrator()
            .send_channel_message(input.clone()),
    );
    let first = first.unwrap();
    let second = second.unwrap();

    assert_eq!(first.action, "broadcast_delivered");
    assert_eq!(second.action, "broadcast_delivered");
    assert_eq!(first.message_id, second.message_id);
    assert_eq!(first.task_id, second.task_id);
    assert_eq!(first.coordinator_run_id, None);
    assert_eq!(second.coordinator_run_id, None);
    assert_eq!(first.assignee_agent_id, second.assignee_agent_id);
    assert_eq!(first.assignee_agent_ids, second.assignee_agent_ids);

    let task_id = first.task_id.as_deref().unwrap();
    let task = state.tasks().task(task_id).await.unwrap();
    assert_eq!(
        task.source_message_id.as_deref(),
        Some(first.message_id.as_str())
    );
    assert!(state
        .channel_messages_for_tests("dev")
        .await
        .iter()
        .all(|message| message.kind != MessageKind::TaskCard));

    assert_broadcast_deliveries_running(&state, &first.message_id, &["agent_alice"]).await;

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(&first.message_id)
        .await;
    assert!(decisions.is_empty());

    let packages = state
        .orchestration()
        .routing_context_packages_for_message_for_tests(&first.message_id)
        .await;
    assert!(packages.is_empty());
}

#[tokio::test]
async fn public_channel_message_api_uses_channel_orchestrator() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "api-dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-api-dev",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("api-dev", "agent_alice")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("api-dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());
    let response = post_json(
        &app,
        &token,
        "/v1/channels/api-dev/messages",
        Some("public-api-send"),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "实现一个 API 路由"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["outcome"]["action"], "broadcast_delivered");
    let message_id = body["outcome"]["messageId"].as_str().unwrap();
    assert_broadcast_deliveries_running(&state, message_id, &["agent_alice"]).await;
}

#[tokio::test]
async fn public_channel_message_api_covers_normal_mentions_consultation_and_execution_routes() {
    let state =
        app_state_with_agent_handles(&[("agent_alice", "@alice-win"), ("agent_coda", "@coda-win")])
            .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "api-core".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-api-core-route-matrix",
        )
        .await
        .unwrap();
    for agent_id in ["agent_alice", "agent_coda"] {
        state
            .channels()
            .add_agent_to_channel("api-core", agent_id)
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness("api-core", agent_id, ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());

    let consultation = post_json(
        &app,
        &token,
        "/v1/channels/api-core/messages",
        Some("api-core-normal-consultation"),
        json!({
            "authorId": "human_lei",
            "body": "这个频道路由方案是否合理？"
        }),
    )
    .await;
    assert_eq!(consultation.status(), StatusCode::OK);
    let consultation = response_json(consultation).await;
    assert_eq!(consultation["outcome"]["action"], "broadcast_delivered");
    assert_eq!(consultation["outcome"]["coordinatorRunId"], Value::Null);
    assert_eq!(consultation["outcome"]["taskId"], Value::Null);
    assert_eq!(
        consultation["outcome"]["assigneeAgentIds"],
        json!(["agent_alice", "agent_coda"])
    );

    let explicit_single = post_json(
        &app,
        &token,
        "/v1/channels/api-core/messages",
        Some("api-core-explicit-single"),
        json!({
            "authorId": "human_lei",
            "body": "@alice-win 请检查频道发言。"
        }),
    )
    .await;
    assert_eq!(explicit_single.status(), StatusCode::OK);
    let explicit_single = response_json(explicit_single).await;
    assert_eq!(explicit_single["outcome"]["action"], "broadcast_delivered");
    assert_eq!(explicit_single["outcome"]["coordinatorRunId"], Value::Null);
    assert_eq!(
        explicit_single["outcome"]["assigneeAgentIds"],
        json!(["agent_alice", "agent_coda"])
    );

    let explicit_multi = post_json(
        &app,
        &token,
        "/v1/channels/api-core/messages",
        Some("api-core-explicit-multi"),
        json!({
            "authorId": "human_lei",
            "body": "@alice-win @coda-win 一起确认 coordinator 路由。"
        }),
    )
    .await;
    assert_eq!(explicit_multi.status(), StatusCode::OK);
    let explicit_multi = response_json(explicit_multi).await;
    assert_eq!(explicit_multi["outcome"]["action"], "broadcast_delivered");
    assert_eq!(explicit_multi["outcome"]["coordinatorRunId"], Value::Null);
    assert_eq!(
        explicit_multi["outcome"]["assigneeAgentIds"],
        json!(["agent_alice", "agent_coda"])
    );
    let execution = post_json(
        &app,
        &token,
        "/v1/channels/api-core/messages",
        Some("api-core-execution-task"),
        json!({
            "authorId": "human_lei",
            "body": "实现频道发言与 coordinator 路由的修复。",
            "asTask": true
        }),
    )
    .await;
    assert_eq!(execution.status(), StatusCode::OK);
    let execution = response_json(execution).await;
    assert_eq!(execution["outcome"]["action"], "broadcast_delivered");
    assert_eq!(execution["outcome"]["coordinatorRunId"], Value::Null);
    let task_id = execution["outcome"]["taskId"].as_str().unwrap();
    assert_eq!(
        execution["outcome"]["assigneeAgentIds"],
        json!(["agent_alice", "agent_coda"])
    );

    for agent_id in ["agent_alice", "agent_coda"] {
        let inbox = state.agent_inbox().events_for_agent(agent_id).await;
        assert!(!inbox.iter().any(|event| {
            event.event_type == "task_assigned" && event.task_id.as_deref() == Some(task_id)
        }));
    }

    assert_broadcast_deliveries_running(
        &state,
        consultation["outcome"]["messageId"].as_str().unwrap(),
        &["agent_alice", "agent_coda"],
    )
    .await;
    assert_broadcast_deliveries_running(
        &state,
        explicit_single["outcome"]["messageId"].as_str().unwrap(),
        &["agent_alice", "agent_coda"],
    )
    .await;
    assert_broadcast_deliveries_running(
        &state,
        explicit_multi["outcome"]["messageId"].as_str().unwrap(),
        &["agent_alice", "agent_coda"],
    )
    .await;
    assert_broadcast_deliveries_running(
        &state,
        execution["outcome"]["messageId"].as_str().unwrap(),
        &["agent_alice", "agent_coda"],
    )
    .await;
    let visible_messages = state.channel_messages_for_tests("api-core").await;
    assert!(visible_messages
        .iter()
        .all(|message| message.kind != MessageKind::TaskCard));
    let task = state.tasks().task(task_id).await.unwrap();
    assert!(visible_messages.iter().any(|message| {
        task.source_message_id.as_deref() == Some(message.id.as_str())
            && message.kind == MessageKind::Human
    }));
}

#[tokio::test]
async fn agent_send_api_broadcasts_agent_message_to_channel_members() {
    let state =
        app_state_with_agent_handles(&[("agent_alice", "@alice-win"), ("agent_coda", "@coda-win")])
            .await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "api-core".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-api-core-agent-send-broadcast",
        )
        .await
        .unwrap();
    for agent_id in ["agent_alice", "agent_coda"] {
        state
            .channels()
            .add_agent_to_channel("api-core", agent_id)
            .await
            .unwrap();
    }

    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());
    let sent = post_json(
        &app,
        &token,
        "/v1/messages/send",
        Some("agent-send-broadcast-delivery"),
        json!({
            "target": "#api-core",
            "agentId": "agent_alice",
            "body": "Alice 已完成第一轮检查"
        }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::OK);
    let sent = response_json(sent).await;
    let message_id = sent["messageId"].as_str().unwrap();

    assert_broadcast_deliveries_running(&state, message_id, &["agent_alice", "agent_coda"]).await;
    assert_broadcast_runs_started(
        &state,
        &["agent_alice", "agent_coda"],
        message_id,
        &["Alice 已完成第一轮检查"],
        &[],
    );
}

#[tokio::test]
async fn broadcast_channel_agent_worker_completed_or_failed_output_is_suppressed() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-worker-output-suppressed",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();

    let completed = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "广播消息的 stdout 不应自动可见".to_string(),
            idempotency_key: "broadcast-output-suppressed-completed".to_string(),
            as_task: false,
        })
        .await
        .unwrap();
    complete_channel_agent_run(&state, "agent_alice", "这段 stdout 不应成为任务回复").await;

    let failed = state
        .channel_orchestrator()
        .send_channel_message(SendChannelMessageInput {
            channel_id: "dev".to_string(),
            author_id: "human_lei".to_string(),
            body: "广播消息的 failed 也不应自动可见".to_string(),
            idempotency_key: "broadcast-output-suppressed-failed".to_string(),
            as_task: false,
        })
        .await
        .unwrap();
    let failed_run_id = state
        .claims()
        .message_deliveries_for_message(&failed.message_id)
        .await
        .unwrap()
        .into_iter()
        .find(|delivery| delivery.agent_id == "agent_alice")
        .and_then(|delivery| delivery.run_id)
        .expect("failed broadcast run should have started");
    state
        .handle_worker_event(json!({
            "type": "failed",
            "run_id": failed_run_id,
            "message": "失败 stdout 也不应成为任务回复"
        }))
        .await
        .unwrap();

    assert_eq!(completed.action, "broadcast_delivered");
    assert_eq!(failed.action, "broadcast_delivered");
    assert!(state
        .channel_messages_for_tests("dev")
        .await
        .iter()
        .all(|message| message.author_id != "agent_alice"));
    assert!(state
        .tasks()
        .list_tasks(TaskQuery::default())
        .await
        .is_empty());
}

#[tokio::test]
async fn task_channel_agent_worker_completed_or_failed_output_creates_task_replies() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-worker-task-output",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_alice")
        .await
        .unwrap();

    let task = state
        .tasks()
        .create_from_coordinator(
            "dev",
            "human_lei",
            "worker-task-output-source-message",
            "验证任务 worker output 仍写回复",
            Some("agent_alice".to_string()),
            "initial assignment",
            "worker-task-output-source-task",
        )
        .await
        .unwrap();

    state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "human_lei",
            "@alice-win 请验证 completed output 路径。",
            "worker-task-output-handoff-completed",
        )
        .await
        .unwrap();
    complete_channel_agent_run(&state, "agent_alice", "这段 stdout 应成为任务回复").await;

    state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "human_lei",
            "@alice-win 再验证 failed output 路径。",
            "worker-task-output-handoff-failed",
        )
        .await
        .unwrap();
    let failed_run_id = state
        .worker_commands()
        .into_iter()
        .rev()
        .find(|command| {
            command["type"] == "start_run" && command["session"]["agent_id"] == "agent_alice"
        })
        .and_then(|command| command["run_id"].as_str().map(ToOwned::to_owned))
        .expect("second channel agent runtime should have started");
    state
        .handle_worker_event(json!({
            "type": "failed",
            "run_id": failed_run_id,
            "message": "失败 stdout 应成为任务回复"
        }))
        .await
        .unwrap();

    let thread = state.tasks().thread_view(&task.id).await.unwrap();
    assert!(thread.replies.iter().any(|reply| {
        reply.sender_id == "agent_alice" && reply.body == "这段 stdout 应成为任务回复"
    }));
    assert!(thread.replies.iter().any(|reply| {
        reply.sender_id == "agent_alice" && reply.body == "失败 stdout 应成为任务回复"
    }));
    assert!(state
        .channel_messages_for_tests("dev")
        .await
        .iter()
        .all(|message| message.author_id != "agent_alice"));
}

#[tokio::test]
async fn public_channel_message_api_converts_as_task_messages_to_source_tasks() {
    let state = app_state_with_agent_handle("agent_coda", "@agent_coda").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-dev-explicit-as-task",
        )
        .await
        .unwrap();
    state
        .channels()
        .add_agent_to_channel("dev", "agent_coda")
        .await
        .unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_coda", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/channels/dev/messages")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "explicit-as-task")
                .body(Body::from(
                    serde_json::json!({
                        "authorId": "human_lei",
                        "body": "这是一条需要单独收敛的讨论",
                        "asTask": true
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let json = response_json(response).await;
    assert_eq!(json["outcome"]["action"], "broadcast_delivered");
    assert!(json["outcome"]["coordinatorRunId"].is_null());
    let broadcast_task_id = json["outcome"]["taskId"].as_str().unwrap();
    assert!(!broadcast_task_id.is_empty());
    let listed = response_json(
        app.clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/channels/dev/messages")
                    .header("authorization", token.authorization_header())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap(),
    )
    .await;
    let listed_messages = listed["messages"].as_array().unwrap();
    assert_eq!(
        listed_messages
            .iter()
            .filter(|message| message["kind"] == "task_card")
            .count(),
        0
    );
    let pending_source_message = listed_messages
        .iter()
        .find(|message| message["id"] == json["outcome"]["messageId"])
        .unwrap();
    assert_eq!(pending_source_message["kind"], "human");
    assert_eq!(pending_source_message["task"]["id"], broadcast_task_id);
    assert_eq!(
        pending_source_message["task"]["sourceMessageId"],
        json["outcome"]["messageId"]
    );
    let inbox = state.agent_inbox().events_for_agent("agent_coda").await;
    assert!(!inbox.iter().any(|event| {
        event.event_type == "task_assigned" && event.task_id.as_deref() == Some(broadcast_task_id)
    }));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/channels/dev/messages")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "explicit-as-task-with-mention")
                .body(Body::from(
                    serde_json::json!({
                        "authorId": "human_lei",
                        "body": "@agent_coda 这也要收敛成任务",
                        "asTask": true
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let json = response_json(response).await;
    assert_eq!(json["outcome"]["action"], "create_task_and_assign");
    assert_eq!(json["outcome"]["assigneeAgentId"], "agent_coda");
    assert_eq!(json["outcome"]["assigneeAgentIds"], json!(["agent_coda"]));
    assert!(json["outcome"]["coordinatorRunId"].is_null());
    let mentioned_task_id = json["outcome"]["taskId"].as_str().unwrap();
    assert!(!mentioned_task_id.is_empty());
    let inbox = state.agent_inbox().events_for_agent("agent_coda").await;
    assert!(inbox.iter().any(|event| {
        event.event_type == "task_assigned"
            && event.message_id == json["outcome"]["messageId"]
            && event.task_id.as_deref() == Some(mentioned_task_id)
    }));
    complete_channel_agent_run(&state, "agent_coda", "Coda 已开始处理这个任务。").await;
    let mentioned_thread = state.tasks().thread_view(mentioned_task_id).await.unwrap();
    assert_eq!(mentioned_thread.task.reply_count, 1);
    assert!(mentioned_thread.replies.iter().any(|reply| {
        reply.sender_id == "agent_coda" && reply.body == "Coda 已开始处理这个任务。"
    }));
    let listed = response_json(
        app.clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/channels/dev/messages")
                    .header("authorization", token.authorization_header())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap(),
    )
    .await;
    let task_source_message = listed["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["id"] == json["outcome"]["messageId"])
        .unwrap();
    assert_eq!(task_source_message["task"]["replyCount"], 1);
}

#[tokio::test]
async fn public_channel_message_api_maps_missing_channel_to_not_found() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);
    let response = post_json(
        &app,
        &token,
        "/v1/channels/missing/messages",
        Some("public-api-missing-channel"),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "实现一个 API 路由"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn public_default_all_channel_message_api_accepts_messages() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());
    let response = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        Some("public-api-all-send"),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "hello，报数"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["outcome"]["action"], "broadcast_delivered");
    assert_eq!(body["outcome"]["coordinatorRunId"], Value::Null);
    let message_id = body["outcome"]["messageId"].as_str().unwrap();
    assert!(message_id.starts_with("msg_"));

    let decisions = state
        .orchestration()
        .decisions_for_message_for_tests(message_id)
        .await;
    assert!(decisions.is_empty());

    assert_broadcast_deliveries_running(&state, message_id, &["agent_alice"]).await;

    let diagnostics = get_json(&app, &token, "/v1/diagnostics").await;
    assert_eq!(diagnostics.status(), StatusCode::OK);
    let diagnostics_body = response_json(diagnostics).await;
    let recent_events = diagnostics_body["recentEvents"].as_array().unwrap();
    assert!(recent_events.iter().any(|event| {
        event["eventType"] == "channel_message.received"
            && event["payload"].as_str().is_some_and(|payload| {
                payload.contains("channel_id=all")
                    && payload.contains("body=[redacted-body]")
                    && !payload.contains("hello")
            })
    }));
    assert!(recent_events.iter().any(|event| {
        event["eventType"] == "channel_message.outcome"
            && event["payload"].as_str().is_some_and(|payload| {
                payload.contains("action=broadcast_delivered")
                    && payload.contains("assignee_agent_ids=agent_alice")
            })
    }));
}

#[tokio::test]
async fn public_channel_as_task_message_creates_task_and_broadcasts_without_coordinator_runtime() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());
    let response = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        Some("public-api-as-task-broadcast"),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "整理一下发布检查清单",
            "asTask": true
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["outcome"]["action"], "broadcast_delivered");
    assert_eq!(body["outcome"]["coordinatorRunId"], Value::Null);
    let message_id = body["outcome"]["messageId"].as_str().unwrap();
    let task_id = body["outcome"]["taskId"].as_str().unwrap();

    let task = state.tasks().task(task_id).await.unwrap();
    assert_eq!(task.source_message_id.as_deref(), Some(message_id));
    assert!(state
        .orchestration()
        .coordinator_runtime_run_for_idempotency("public-api-as-task-broadcast")
        .await
        .unwrap()
        .is_none());
    assert_broadcast_deliveries_running(&state, message_id, &["agent_alice"]).await;
}

#[tokio::test]
async fn public_channel_message_api_lists_channel_history() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);

    let sent = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        Some("public-api-list-history"),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "hello history"
        }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::OK);
    let sent_body = response_json(sent).await;
    let message_id = sent_body["outcome"]["messageId"].as_str().unwrap();

    let listed = get_json(&app, &token, "/v1/channels/all/messages").await;
    assert_eq!(listed.status(), StatusCode::OK);
    let body = response_json(listed).await;
    let messages = body["messages"].as_array().unwrap();
    assert!(messages.iter().any(|message| {
        message["id"] == message_id
            && message["channelId"] == "all"
            && message["authorId"] == "human_lei"
            && message["body"] == "hello history"
            && message["kind"] == "human"
    }));
}

#[tokio::test]
async fn public_channel_create_api_mounts_project_paths() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());
    let response = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("public-api-create-projects"),
        serde_json::json!({
            "name": "api-dev",
            "description": "API",
            "agentIds": [],
            "projectPaths": ["/workspace/api", "/workspace/api", "/workspace/web"]
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response_json(response).await;
    assert_eq!(body["channel"]["id"], "api-dev");
    let workspaces = wait_for_channel_workspaces(&state, "api-dev", 2).await;
    assert_eq!(workspaces.len(), 2);
    assert_eq!(workspaces[0].path, "/workspace/api");
    assert_eq!(workspaces[0].label, "api");
    assert_eq!(workspaces[1].path, "/workspace/web");
    assert_eq!(workspaces[1].label, "web");
}

#[tokio::test]
async fn public_channel_create_api_rejects_duplicate_channel_names() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);

    let first = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-duplicate-name-first"),
        json!({
            "name": "Same Project",
            "description": "first",
            "agentIds": []
        }),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);

    let duplicate = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-duplicate-name-second"),
        json!({
            "name": "#same project",
            "description": "second",
            "agentIds": []
        }),
    )
    .await;

    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    let body = response_json(duplicate).await;
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("channel name already exists"));
}

#[tokio::test]
async fn public_channel_create_api_rejects_duplicate_project_paths() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());

    let first = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-project-path-first"),
        json!({
            "name": "api-dev",
            "description": "API",
            "agentIds": [],
            "projectPaths": ["/workspace/api"]
        }),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let _ = wait_for_channel_workspaces(&state, "api-dev", 1).await;

    let duplicate = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-project-path-second"),
        json!({
            "name": "web-dev",
            "description": "Web",
            "agentIds": [],
            "projectPaths": ["/workspace/api/"]
        }),
    )
    .await;

    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    let body = response_json(duplicate).await;
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("workspace path already mounted"));
}

#[tokio::test]
async fn public_channel_create_api_allows_idempotent_project_path_retries() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state.clone());

    let first = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-project-path-idempotent"),
        json!({
            "name": "api-dev",
            "description": "API",
            "agentIds": [],
            "projectPaths": ["/workspace/api"]
        }),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let workspaces = wait_for_channel_workspaces(&state, "api-dev", 1).await;
    assert_eq!(workspaces.len(), 1);

    let retry = post_json(
        &app,
        &token,
        "/v1/channels",
        Some("create-project-path-idempotent"),
        json!({
            "name": "api-dev",
            "description": "API",
            "agentIds": [],
            "projectPaths": ["/workspace/api"]
        }),
    )
    .await;
    assert_eq!(retry.status(), StatusCode::CREATED);

    let workspaces = state.channels().workspaces("api-dev").await.unwrap();
    assert_eq!(workspaces.len(), 1);
    assert_eq!(workspaces[0].path, "/workspace/api");
}

#[tokio::test]
async fn public_channel_create_api_rejects_missing_idempotency_key() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);
    let response = post_json(
        &app,
        &token,
        "/v1/channels",
        None,
        serde_json::json!({
            "name": "api-dev",
            "description": null,
            "agentIds": []
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["error"], "idempotency-key is required");
}

#[tokio::test]
async fn public_channel_create_api_rejects_empty_idempotency_key() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);
    let response = post_json(
        &app,
        &token,
        "/v1/channels",
        Some(""),
        serde_json::json!({
            "name": "api-dev",
            "description": null,
            "agentIds": []
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["error"], "idempotency-key is required");
}

#[tokio::test]
async fn public_channel_message_api_rejects_missing_idempotency_key_before_orchestration() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);
    let response = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        None,
        serde_json::json!({
            "authorId": "human_lei",
            "body": "实现一个 API 路由"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["error"], "idempotency-key is required");
}

#[tokio::test]
async fn public_channel_message_api_rejects_empty_idempotency_key_before_orchestration() {
    let state = app_state_with_agent_handle("agent_alice", "@alice-win").await;
    let token = AuthToken::from_static("test-token");
    let app = build_router(state);
    let response = post_json(
        &app,
        &token,
        "/v1/channels/all/messages",
        Some(""),
        serde_json::json!({
            "authorId": "human_lei",
            "body": "实现一个 API 路由"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["error"], "idempotency-key is required");
}

async fn app_state_with_agent_handle(agent_id: &str, handle: &str) -> AppState {
    app_state_with_agent_handles(&[(agent_id, handle)]).await
}

fn assert_broadcast_runs_started(
    state: &AppState,
    expected_agent_ids: &[&str],
    message_id: &str,
    expected_prompt_fragments: &[&str],
    forbidden_prompt_fragments: &[&str],
) {
    let commands = state.worker_commands();
    let start_runs = commands
        .iter()
        .filter(|command| command["type"] == "start_run")
        .collect::<Vec<_>>();
    assert_eq!(
        start_runs.len(),
        expected_agent_ids.len(),
        "expected one broadcast run per regular agent; commands={commands:?}"
    );
    for agent_id in expected_agent_ids {
        let command = start_runs
            .iter()
            .find(|command| command["session"]["agent_id"] == *agent_id)
            .unwrap_or_else(|| panic!("missing start_run for {agent_id}; commands={commands:?}"));
        let prompt = command["input"]["prompt"].as_str().unwrap();
        assert!(
            prompt.contains(&format!("- Agent ID: `{agent_id}`")),
            "prompt missing agent metadata: {prompt}"
        );
        assert!(
            prompt.contains(&format!("- Message ID: `{message_id}`")),
            "prompt missing message metadata: {prompt}"
        );
        assert!(
            prompt.contains(&format!(
                "slei message claim {message_id} --agent {agent_id}"
            )),
            "prompt missing claim instruction: {prompt}"
        );
        assert!(
            prompt.contains("slei message read") && prompt.contains("slei message send"),
            "prompt should direct agent to use Slei CLI for history/reply operations: {prompt}"
        );
        assert!(
            prompt.contains("printf \"...\" | slei message send"),
            "prompt should show message send reading the body from stdin: {prompt}"
        );
        assert!(
            !prompt.contains("--body"),
            "prompt should not mention unsupported --body flag: {prompt}"
        );
        assert!(
            prompt.contains(&format!("slei agent status --agent {agent_id} --state")),
            "prompt should use the real agent status command shape: {prompt}"
        );
        assert!(
            !prompt.contains("slei status"),
            "prompt should not include obsolete status command: {prompt}"
        );
        for fragment in expected_prompt_fragments {
            assert!(
                prompt.contains(fragment),
                "prompt missing triggering message fragment {fragment:?}: {prompt}"
            );
        }
        for fragment in forbidden_prompt_fragments {
            assert!(
                !prompt.contains(fragment),
                "prompt should not include unrelated prior history {fragment:?}: {prompt}"
            );
        }
        assert_eq!(command["input"]["context"], json!([]));
        assert!(
            prompt.contains("# Slei Channel Run Packet")
                && prompt.contains("## Runtime Context")
                && prompt.contains("## Triggering Message")
                && prompt.contains("```text\n[target=#")
                && prompt.contains("## Required First Action")
                && prompt.contains("```bash")
                && prompt.contains(&format!(
                    "slei message claim {message_id} --agent {agent_id}"
                ))
                && prompt.contains("## Optional Context Lookup"),
            "prompt should be a Markdown run packet with fenced trigger and claim command: {prompt}"
        );
        let system_prompt = command["input"]["system_prompt"].as_str().unwrap();
        assert!(
            system_prompt.contains("## Claim Intent Classes")
                && system_prompt.contains("### 2. Channel Group Address")
                && system_prompt.contains("`@all` always means Channel Group Address")
                && system_prompt
                    .contains("read nearby previous messages before claiming when needed"),
            "system prompt missing markdown claim intent classes: {system_prompt}"
        );
        assert!(
            system_prompt.contains("slei message read --channel \"#channel\" --around <msgId>"),
            "system prompt missing around-history command: {system_prompt}"
        );
        assert!(
            system_prompt.contains(&format!("Agent ID: {agent_id}")),
            "system prompt missing agent identity: {system_prompt}"
        );
    }
}

async fn assert_broadcast_deliveries_running(
    state: &AppState,
    message_id: &str,
    expected_agent_ids: &[&str],
) {
    let deliveries = state
        .claims()
        .message_deliveries_for_message(message_id)
        .await
        .unwrap();
    assert_eq!(
        deliveries.len(),
        expected_agent_ids.len(),
        "unexpected deliveries for message {message_id}: {deliveries:?}"
    );
    for agent_id in expected_agent_ids {
        let delivery = deliveries
            .iter()
            .find(|delivery| delivery.agent_id == *agent_id)
            .unwrap_or_else(|| panic!("missing delivery for {agent_id}: {deliveries:?}"));
        assert_eq!(delivery.delivery_state, "running");
        assert!(delivery.run_id.is_some());
        let commands = state.worker_commands();
        assert!(
            commands.iter().any(|command| {
                command["type"] == "start_run"
                    && command["run_id"] == delivery.run_id.as_deref().unwrap()
                    && command["session"]["agent_id"] == *agent_id
            }),
            "delivery run_id was not started for {agent_id}: delivery={delivery:?} commands={commands:?}"
        );
    }
}

struct TestAgentSpec {
    id: String,
    handle: String,
    agent_kind: String,
    system_owned: bool,
}

impl TestAgentSpec {
    fn regular(id: impl Into<String>, handle: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            handle: handle.into(),
            agent_kind: "agent".to_string(),
            system_owned: false,
        }
    }

    fn coordinator(id: impl Into<String>, handle: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            handle: handle.into(),
            agent_kind: "coordinator".to_string(),
            system_owned: true,
        }
    }

    fn system_owned(id: impl Into<String>, handle: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            handle: handle.into(),
            agent_kind: "agent".to_string(),
            system_owned: true,
        }
    }
}

async fn complete_channel_agent_run(state: &AppState, agent_id: &str, output: &str) {
    let run_id = state
        .worker_commands()
        .into_iter()
        .rev()
        .find(|command| {
            command["type"] == "start_run" && command["session"]["agent_id"] == agent_id
        })
        .and_then(|command| command["run_id"].as_str().map(ToOwned::to_owned))
        .expect("channel agent runtime should have started");
    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": run_id,
            "delta": output,
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "completed",
            "run_id": run_id,
        }))
        .await
        .unwrap();
}

async fn app_state_with_agent_handles(agents: &[(&str, &str)]) -> AppState {
    let specs = agents
        .iter()
        .map(|(agent_id, handle)| TestAgentSpec::regular(*agent_id, *handle))
        .collect::<Vec<_>>();
    app_state_with_agent_specs(&specs).await
}

async fn app_state_with_agent_specs(agents: &[TestAgentSpec]) -> AppState {
    let root = std::env::temp_dir().join(format!("slei-channel-flow-{}", Uuid::new_v4()));
    std::fs::create_dir_all(root.join("agents")).unwrap();
    let agents = agents
        .iter()
        .map(|agent| {
            let workspace_path = root.join("agents").join(&agent.id);
            std::fs::create_dir_all(workspace_path.join("docs")).unwrap();
            std::fs::write(
                workspace_path.join("MEMORY.md"),
                format!("# {}\n\n## Active Context\n", agent.id),
            )
            .unwrap();
            ProductAgentRecord {
                id: agent.id.clone(),
                name: agent.id.trim_start_matches("agent_").to_string(),
                handle: agent.handle.clone(),
                agent_kind: agent.agent_kind.clone(),
                system_owned: agent.system_owned,
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "工程协作 Agent".to_string(),
                workspace_path: workspace_path.to_string_lossy().to_string(),
                memory_path: workspace_path
                    .join("MEMORY.md")
                    .to_string_lossy()
                    .to_string(),
                docs_path: workspace_path.join("docs").to_string_lossy().to_string(),
                avatar_seed: agent.id.trim_start_matches("agent_").to_string(),
                runtime_thread: RuntimeThreadRecord {
                    runtime_kind: "ClaudeCode".to_string(),
                    status: "ready".to_string(),
                    created_at: "0".to_string(),
                },
                channel_ids: vec!["all".to_string()],
                created_at: "0".to_string(),
                updated_at: "0".to_string(),
            }
        })
        .collect::<Vec<_>>();
    std::fs::write(
        root.join("agents/index.json"),
        serde_json::to_string_pretty(&agents).unwrap(),
    )
    .unwrap();
    AppState::for_tests_with_agent_root_async(AuthToken::from_static("test-token"), root).await
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

async fn wait_for_channel_workspaces(
    state: &AppState,
    channel_id: &str,
    minimum_count: usize,
) -> Vec<slei_daemon::services::channel_service::WorkspaceMount> {
    for _ in 0..50 {
        let workspaces = state.channels().workspaces(channel_id).await.unwrap();
        if workspaces.len() >= minimum_count {
            return workspaces;
        }
        sleep(Duration::from_millis(20)).await;
    }
    panic!("channel workspaces should be mounted");
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

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}
