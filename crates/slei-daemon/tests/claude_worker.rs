use serde_json::json;
use slei_daemon::adapters::claude_worker::{ClaudeWorkerAdapter, CreateSessionRequest};
use slei_daemon::adapters::worker_rpc::{WorkerEvent, WorkerTransport};

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
            vec![json!({"role": "user", "content": "Previous undeleted message"})],
        )
        .unwrap();
    adapter.cancel_run("run_1").unwrap();
    adapter.clear_session(&session).unwrap();

    let commands = transport.commands();
    assert_eq!(commands[0]["type"], "start_run");
    assert_eq!(commands[0]["session"]["persist_session"], true);
    assert_eq!(commands[0]["session"]["resume_session"], true);
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
