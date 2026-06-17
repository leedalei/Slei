use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::json;
use serde_json::Value;
use slei_daemon::adapters::claude_worker::{ClaudeWorkerAdapter, CreateSessionRequest};
use slei_daemon::adapters::worker_rpc::{WorkerEvent, WorkerTransport};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;
use slei_storage::db::SleiDb;
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn claude_worker_create_session_reports_claude_mvp_capabilities() {
    let transport = WorkerTransport::fake();
    let adapter = ClaudeWorkerAdapter::new(transport);

    let session = adapter
        .create_session(CreateSessionRequest {
            agent_id: "agent_coda".to_string(),
            cwd: "/workspace/app".to_string(),
            session_id: "11111111-1111-4111-8111-111111111111".to_string(),
            resume_session: false,
        })
        .unwrap();

    assert_eq!(session.runtime, "ClaudeCode");
    assert!(session.persist_session);
    assert!(session.capabilities.resume_session);
    assert!(!session.resume_session);
}

#[test]
fn claude_worker_start_run_and_cancel_write_private_worker_commands() {
    let transport = WorkerTransport::fake();
    let adapter = ClaudeWorkerAdapter::new(transport.clone());
    let session = adapter
        .create_session(CreateSessionRequest {
            agent_id: "agent_coda".to_string(),
            cwd: "/workspace/app".to_string(),
            session_id: "11111111-1111-4111-8111-111111111111".to_string(),
            resume_session: true,
        })
        .unwrap();

    adapter
        .start_run(
            "run_1",
            &session,
            "Implement the task",
            "Slei system prompt: claim with slei message claim.",
            vec![json!({"role": "user", "content": "Previous undeleted message"})],
        )
        .unwrap();
    adapter.cancel_run("run_1").unwrap();
    adapter.clear_session(&session).unwrap();

    let commands = transport.commands();
    assert_eq!(commands[0]["type"], "start_run");
    assert_eq!(commands[0]["session"]["persist_session"], true);
    assert_eq!(commands[0]["session"]["resume_session"], true);
    assert_eq!(
        commands[0]["input"]["system_prompt"],
        "Slei system prompt: claim with slei message claim."
    );
    assert_eq!(commands[1], json!({"type": "cancel", "run_id": "run_1"}));
    assert_eq!(commands[2]["type"], "clear_session");
    assert_eq!(commands[2]["session"]["session_id"], session.session_id);
    assert_eq!(commands[2]["session"]["resume_session"], true);
}

#[test]
fn claude_worker_resume_session_is_rejected_for_claude_mvp() {
    let adapter = ClaudeWorkerAdapter::new(WorkerTransport::fake());
    let err = adapter.resume_session("opaque-token").unwrap_err();

    assert!(err
        .to_string()
        .contains("requires a persisted conversation session"));
}

#[test]
fn claude_worker_events_map_to_daemon_events_with_correlation() {
    let event = WorkerEvent::from_json(json!({
        "type": "permission_requested",
        "request_id": "perm_1",
        "run_id": "run_1",
        "tool_use_id": "tool_1",
        "agent_id": "agent_coda",
        "tool_name": "Write",
        "risk": "controlled"
    }))
    .unwrap();

    let mapped = event.to_run_event().unwrap();

    assert_eq!(mapped["type"], "permission_requested");
    assert_eq!(mapped["request_id"], "perm_1");
    assert_eq!(mapped["tool_use_id"], "tool_1");
    assert_eq!(mapped["agent_id"], "agent_coda");
}

#[tokio::test]
async fn dm_runtime_records_output_delta_and_completed_activity_events() {
    let token = AuthToken::from_static("test-token");
    let root = std::env::temp_dir().join(format!("slei-claude-worker-dm-{}", Uuid::new_v4()));
    let state = AppState::for_tests_with_agent_root(token.clone(), root.clone());
    let app = build_router(state.clone());

    let created = post_json(
        &app,
        &token,
        "/v1/agents",
        Some("dm-activity-agent"),
        json!({
            "name": "Coda",
            "handle": "@coda-dm-activity",
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
        Some("dm-activity-conversation"),
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
        Some("dm-activity-message"),
        json!({ "body": "请给我一个方案", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::CREATED);
    let commands = state.worker_commands();
    let run_id = commands
        .iter()
        .find(|command| {
            command["type"] == "start_run"
                && command["input"]["prompt"]
                    .as_str()
                    .is_some_and(|prompt| prompt.contains("请给我一个方案"))
        })
        .and_then(|command| command["run_id"].as_str())
        .expect("DM runtime should have started")
        .to_string();

    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": run_id,
            "delta": "收到，"
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": run_id,
            "delta": "我来处理。"
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "completed",
            "run_id": run_id
        }))
        .await
        .unwrap();

    let failed_sent = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("dm-activity-failed-message"),
        json!({ "body": "请运行一个会失败的工具", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(failed_sent.status(), StatusCode::CREATED);
    let failed_run_id = state
        .worker_commands()
        .into_iter()
        .rev()
        .find(|command| {
            command["type"] == "start_run"
                && command["input"]["prompt"]
                    .as_str()
                    .is_some_and(|prompt| prompt.contains("请运行一个会失败的工具"))
        })
        .and_then(|command| command["run_id"].as_str().map(ToOwned::to_owned))
        .expect("second DM runtime should have started");
    state
        .handle_worker_event(json!({
            "type": "tool_started",
            "run_id": failed_run_id,
            "tool_use_id": "tool-dm-read-1",
            "name": "Read"
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "tool_completed",
            "run_id": failed_run_id,
            "tool_use_id": "tool-dm-read-1",
            "name": "Read",
            "ok": true
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "product_tool_requested",
            "run_id": failed_run_id,
            "agent_id": agent_id,
            "tool_name": "Bash",
            "tool_use_id": "tool-dm-activity-1",
            "payload": {
                "command": "echo preparing"
            }
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "tool_completed",
            "run_id": failed_run_id,
            "agent_id": agent_id,
            "tool_name": "Bash",
            "tool_use_id": "tool-dm-activity-1",
            "ok": false,
            "payload": { "exitCode": 1 }
        }))
        .await
        .unwrap();
    let long_sensitive_tail = "x".repeat(2300);
    state
        .handle_worker_event(json!({
            "type": "failed",
            "run_id": failed_run_id,
            "agent_id": agent_id,
            "message": format!(
                "DM 工具失败 Authorization: Bearer secret-token password=abc {long_sensitive_tail}"
            ),
            "payload": {
                "authorization": "Bearer secret-token",
                "password": "abc",
                "notes": long_sensitive_tail
            }
        }))
        .await
        .unwrap();

    let terminal_failure_sent = post_json(
        &app,
        &token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some("dm-activity-terminal-failure-message"),
        json!({ "body": "请触发完成持久化失败", "authorId": "human:local" }),
    )
    .await;
    assert_eq!(terminal_failure_sent.status(), StatusCode::CREATED);
    let terminal_failure_run_id = state
        .worker_commands()
        .into_iter()
        .rev()
        .find(|command| {
            command["type"] == "start_run"
                && command["input"]["prompt"]
                    .as_str()
                    .is_some_and(|prompt| prompt.contains("请触发完成持久化失败"))
        })
        .and_then(|command| command["run_id"].as_str().map(ToOwned::to_owned))
        .expect("third DM runtime should have started");
    let db_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let db = SleiDb::connect(&db_url).await.unwrap();
    sqlx::query(
        "CREATE TRIGGER fail_conversation_message_update
         BEFORE UPDATE ON conversation_messages
         BEGIN
             SELECT RAISE(FAIL, 'forced conversation message failure');
         END",
    )
    .execute(db.pool())
    .await
    .unwrap();
    let terminal_error = state
        .handle_worker_event(json!({
            "type": "completed",
            "run_id": terminal_failure_run_id,
        }))
        .await
        .expect_err("completed side effect should still return the persistence error");
    assert!(
        terminal_error.contains("forced conversation message failure"),
        "{terminal_error}"
    );

    let activity = get_json(
        &app,
        &token,
        &format!("/v1/agents/{agent_id}/activity?limit=200"),
    )
    .await;
    assert_eq!(activity.status(), StatusCode::OK);
    let activity_json = response_json(activity).await;
    let logs = activity_json["logs"].as_array().unwrap();
    let event_kinds = logs
        .iter()
        .map(|log| log["eventKind"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(event_kinds.contains(&"run.started"));
    assert!(event_kinds.contains(&"input.received"));
    assert!(event_kinds.contains(&"tool.started"));
    assert!(event_kinds.contains(&"tool.completed"));
    assert!(event_kinds.contains(&"run.completed"));
    assert!(event_kinds.contains(&"run.failed"));
    assert!(
        !event_kinds.contains(&"output.delta"),
        "output_delta fragments should be aggregated into the terminal activity event"
    );

    let completed = logs
        .iter()
        .find(|log| log["eventKind"] == "run.completed" && log["runId"] == run_id)
        .expect("run completed activity event");
    assert_eq!(completed["runId"], run_id);
    let completed_preview = completed["payloadPreview"].as_str().unwrap();
    assert!(completed_preview.contains(&conversation_id));
    assert!(completed_preview.contains("output_chars=8"));
    assert!(completed_preview.contains("收到，我来处理。"));

    let failed = logs
        .iter()
        .find(|log| log["eventKind"] == "run.failed" && log["runId"] == failed_run_id)
        .expect("failed activity event");
    let preview = failed["payloadPreview"].as_str().unwrap();
    assert!(!preview.contains("secret-token"));
    assert!(!preview.contains("abc"));
    assert!(preview.contains("[redacted]"));
    assert!(preview.contains("[truncated]"));

    let read_started = logs
        .iter()
        .find(|log| {
            log["eventKind"] == "tool.started"
                && log["runId"] == failed_run_id
                && log["toolName"] == "Read"
        })
        .expect("ordinary tool_started name should be preserved");
    assert!(read_started["summary"].as_str().unwrap().contains("Read"));

    let read_completed = logs
        .iter()
        .find(|log| {
            log["eventKind"] == "tool.completed"
                && log["runId"] == failed_run_id
                && log["toolName"] == "Read"
        })
        .expect("ordinary tool_completed name should be preserved");
    assert!(read_completed["summary"].as_str().unwrap().contains("Read"));

    assert!(logs.iter().any(|log| {
        log["eventKind"] == "run.completed" && log["runId"] == terminal_failure_run_id
    }));
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
