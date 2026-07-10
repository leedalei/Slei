use std::fs;
use std::path::PathBuf;

use serde_json::json;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::approval_service::{
    ApprovalDecision, ApprovalService, PermissionPreset, PolicyDecision, ToolRequest,
};
use slei_daemon::services::member_service::ProductAgentDraft;
use slei_daemon::state::AppState;
use uuid::Uuid;

#[tokio::test]
async fn approval_flow_permission_matrix_enforces_workspace_policy() {
    let workspace = temp_workspace();
    let service = ApprovalService::for_tests(workspace.clone());

    let read = tool_request("Read", workspace.join("src/main.ts"));
    let write = tool_request("Write", workspace.join("src/main.ts"));
    let delete = tool_request("Delete", workspace.join("src/main.ts"));
    let bash = tool_request("Bash", workspace.join("src/main.ts"));
    let outside = tool_request("Write", std::env::temp_dir().join("outside.txt"));

    assert!(matches!(
        service
            .evaluate_tool_use(PermissionPreset::ReadOnly, read)
            .await,
        PolicyDecision::Allow
    ));
    assert!(matches!(
        service
            .evaluate_tool_use(PermissionPreset::ReadOnly, write.clone())
            .await,
        PolicyDecision::Deny { .. }
    ));
    assert!(matches!(
        service
            .evaluate_tool_use(PermissionPreset::Edit, write.clone())
            .await,
        PolicyDecision::Allow
    ));
    assert!(matches!(
        service
            .evaluate_tool_use(PermissionPreset::Controlled, write)
            .await,
        PolicyDecision::Pending { .. }
    ));
    assert!(matches!(
        service
            .evaluate_tool_use(PermissionPreset::Controlled, delete)
            .await,
        PolicyDecision::Pending { .. }
    ));
    assert!(matches!(
        service
            .evaluate_tool_use(PermissionPreset::Controlled, bash)
            .await,
        PolicyDecision::Pending { .. }
    ));
    assert!(matches!(
        service
            .evaluate_tool_use(PermissionPreset::Controlled, outside)
            .await,
        PolicyDecision::Deny { reason } if reason.contains("outside workspace")
    ));
}

#[tokio::test]
async fn approval_flow_exact_correlation_is_required_to_resume_pending_run() {
    let workspace = temp_workspace();
    let service = ApprovalService::for_tests(workspace.clone());
    let pending = match service
        .evaluate_tool_use(
            PermissionPreset::Controlled,
            tool_request("Write", workspace.join("src/main.ts")),
        )
        .await
    {
        PolicyDecision::Pending { approval } => approval,
        other => panic!("expected pending approval, got {other:?}"),
    };

    let mismatched = service
        .resolve(ApprovalDecision {
            request_id: pending.request_id.clone(),
            run_id: "wrong_run".to_string(),
            tool_use_id: pending.tool_use_id.clone(),
            agent_id: pending.agent_id.clone(),
            allow: true,
        })
        .await;
    assert!(matches!(mismatched, PolicyDecision::Deny { .. }));

    let accepted = service
        .resolve(ApprovalDecision {
            request_id: pending.request_id,
            run_id: pending.run_id,
            tool_use_id: pending.tool_use_id,
            agent_id: pending.agent_id,
            allow: true,
        })
        .await;
    assert!(matches!(accepted, PolicyDecision::Allow));
}

#[tokio::test]
async fn approval_flow_pending_approval_exposes_safe_task_context_and_retry_is_idempotent() {
    let workspace = temp_workspace();
    let service = ApprovalService::for_tests(workspace.clone());
    let pending = match service
        .evaluate_tool_use(
            PermissionPreset::Controlled,
            tool_request("Write", workspace.join("src/main.ts")),
        )
        .await
    {
        PolicyDecision::Pending { approval } => approval,
        other => panic!("expected pending approval, got {other:?}"),
    };

    let safe = service.safe_context(&pending.request_id).await.unwrap();
    assert!(safe.contains("Write"));
    assert!(!safe.contains("secret"));

    let decision = ApprovalDecision {
        request_id: pending.request_id,
        run_id: pending.run_id,
        tool_use_id: pending.tool_use_id,
        agent_id: pending.agent_id,
        allow: false,
    };
    let first = service
        .resolve_idempotent(decision.clone(), "decision-1")
        .await;
    let retry = service.resolve_idempotent(decision, "decision-1").await;

    assert_eq!(first, retry);
    assert!(matches!(retry, PolicyDecision::Deny { .. }));
}

#[tokio::test]
async fn approval_flow_worker_permission_request_creates_session_card_and_resolves_to_worker() {
    let root = temp_workspace();
    let state = AppState::for_tests_with_agent_root(AuthToken::from_static("test-token"), root);
    let agent = state
        .members()
        .create_product_agent(
            ProductAgentDraft {
                name: "Coda".to_string(),
                handle: "@coda".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                profession: "研发工程师".to_string(),
                description: "研发工程师".to_string(),
                avatar_seed: None,
            },
            "create-coda",
        )
        .await
        .unwrap();
    let (conversation, _) = state.conversations().create_dm(&agent.id).await.unwrap();
    let session_id = conversation.active_session_id.clone().unwrap();
    let human = state
        .conversations()
        .append_message_with_session(
            &conversation.id,
            "human:lei",
            "write outside",
            Some("human-message"),
            Some(&session_id),
            &[],
        )
        .await
        .unwrap();
    let run_id = state
        .agent_dm()
        .start_for_human_message(&conversation.id, &human)
        .await
        .unwrap()
        .unwrap();

    state
        .handle_worker_event(json!({
            "type": "permission_requested",
            "request_id": "perm_1",
            "run_id": run_id,
            "tool_use_id": "tool_1",
            "agent_id": agent.id,
            "tool_name": "Write",
            "risk": "controlled",
            "input": { "file_path": "/Users/lei/outside.ts" },
            "target_path": "/Users/lei/outside.ts",
            "session_id": session_id,
        }))
        .await
        .unwrap();

    let messages = state
        .conversations()
        .list_messages(&conversation.id)
        .await
        .unwrap();
    let approval_message = messages
        .iter()
        .find(|message| message.status.as_deref() == Some("approval"))
        .expect("permission request should create an approval message");
    let card = approval_message.cards.first().expect("approval card");
    assert_eq!(card.kind, "permissionApproval");
    assert_eq!(card.state, "pending");
    assert_eq!(card.draft["requestId"], "perm_1");
    assert_eq!(card.draft["targetPath"], "/Users/lei/outside.ts");
    assert_eq!(card.draft["sessionId"], session_id);

    let resolved = state
        .agent_dm()
        .resolve_permission("perm_1", "approve_session")
        .await
        .unwrap();
    assert_eq!(resolved.cards[0].state, "done");

    let commands = state.worker_commands();
    let last = commands
        .last()
        .expect("resolve command should be sent to worker");
    assert_eq!(last["type"], "resolve_permission");
    assert_eq!(last["request_id"], "perm_1");
    assert_eq!(last["decision"], "approve_session");
}

fn tool_request(tool_name: &str, path: PathBuf) -> ToolRequest {
    ToolRequest {
        request_id: format!("perm_{}", Uuid::new_v4().simple()),
        run_id: "run_1".to_string(),
        tool_use_id: format!("tool_{}", Uuid::new_v4().simple()),
        agent_id: "agent_coda".to_string(),
        tool_name: tool_name.to_string(),
        path: Some(path),
    }
}

fn temp_workspace() -> PathBuf {
    let path = std::env::temp_dir().join(format!("slei-approval-{}", Uuid::new_v4()));
    fs::create_dir_all(path.join("src")).unwrap();
    path
}
