use std::fs;

use slei_daemon::services::approval_service::{
    ApprovalDecision, ApprovalService, PermissionPreset, PolicyDecision, ToolRequest,
};
use slei_daemon::services::artifact_service::{ArtifactInput, ArtifactService};
use slei_daemon::services::delegation_service::{
    DelegationRequest, DelegationService, DelegationSource,
};
use slei_daemon::services::diagnostics_service::{DiagnosticEvent, DiagnosticsService};
use slei_daemon::services::message_service::{MessageService, SendMessageDraft};
use slei_daemon::services::notification_service::NotificationService;
use slei_daemon::services::workspace_service::WorkspaceService;
use uuid::Uuid;

#[tokio::test]
async fn mvp_security_boundaries_reject_escape_hidden_delegation_and_duplicate_mutations() {
    let root = temp_dir("security-root");
    let outside = temp_dir("security-outside");
    let outside_file = outside.join("secret.txt");
    fs::write(&outside_file, "secret").unwrap();

    #[cfg(unix)]
    {
        let link = root.join("escape");
        std::os::unix::fs::symlink(&outside_file, &link).unwrap();
        let workspace_service = WorkspaceService::for_tests();
        let workspace = workspace_service
            .register_workspace(root.to_string_lossy().as_ref(), None, "workspace-key")
            .await
            .unwrap();
        assert!(workspace_service
            .validate_mount_path(&workspace.workspace.id, &link)
            .await
            .unwrap_err()
            .to_string()
            .contains("outside workspace"));
    }

    let message_service = MessageService::for_tests();
    message_service.set_primary_agent_for_tests("channel_dev", "agent_coda");
    let first = message_service
        .send_message(
            SendMessageDraft {
                channel_id: "channel_dev".to_string(),
                author_id: "human_lei".to_string(),
                body: "run once".to_string(),
                as_task: false,
                workspace_count: 0,
            },
            "message-idempotent",
        )
        .await
        .unwrap();
    let retry = message_service
        .send_message(
            SendMessageDraft {
                channel_id: "channel_dev".to_string(),
                author_id: "human_lei".to_string(),
                body: "run twice".to_string(),
                as_task: false,
                workspace_count: 0,
            },
            "message-idempotent",
        )
        .await
        .unwrap();
    assert_eq!(first, retry);

    let delegation_service = DelegationService::for_tests();
    assert!(delegation_service
        .create_delegation(DelegationRequest {
            source: DelegationSource::FreeformText,
            parent_run_id: "run_1".to_string(),
            from_agent_id: "agent_coda".to_string(),
            to_agent_id: "agent_alice".to_string(),
            task_id: "task_1".to_string(),
        })
        .await
        .unwrap_err()
        .to_string()
        .contains("visible delegation"));

    let approval_root = temp_dir("approval-root");
    fs::create_dir_all(approval_root.join("src")).unwrap();
    let approval_service = ApprovalService::for_tests(approval_root.clone());
    let pending = approval_service
        .evaluate_tool_use(
            PermissionPreset::Controlled,
            ToolRequest {
                request_id: "request_1".to_string(),
                run_id: "run_1".to_string(),
                tool_use_id: "tool_1".to_string(),
                agent_id: "agent_coda".to_string(),
                tool_name: "Write".to_string(),
                path: Some(approval_root.join("src/main.ts")),
            },
        )
        .await;
    let PolicyDecision::Pending { approval } = pending else {
        panic!("controlled write should request approval");
    };
    let decision = approval_service
        .resolve(ApprovalDecision {
            request_id: approval.request_id,
            run_id: "run_1".to_string(),
            tool_use_id: "tool_1".to_string(),
            agent_id: "agent_coda".to_string(),
            allow: true,
        })
        .await;
    assert_eq!(decision, PolicyDecision::Allow);
}

#[tokio::test]
async fn mvp_security_outputs_strip_sensitive_paths_tokens_and_content() {
    let workspace = temp_dir("artifact-root");
    let artifact_path = workspace.join("answer.md");
    fs::write(&artifact_path, "safe").unwrap();
    let artifact_service = ArtifactService::for_tests(workspace);
    let artifact = artifact_service
        .register(ArtifactInput {
            channel_id: "channel_dev".to_string(),
            task_id: "task_1".to_string(),
            run_id: "run_1".to_string(),
            path: artifact_path.clone(),
            display_name: "answer.md".to_string(),
        })
        .await
        .unwrap();
    assert!(artifact_service.open_token(&artifact.id).await.is_ok());
    assert!(artifact_service
        .open_token(artifact_path.to_string_lossy().as_ref())
        .await
        .is_err());

    let diagnostics = DiagnosticsService::for_tests();
    let export = diagnostics
        .export_logs(vec![DiagnosticEvent {
            sequence: 1,
            event_type: "runtime.delta".to_string(),
            entity_id: "event-1".to_string(),
            payload: "Bearer token123 /Users/leelei/project output_delta=secret words".to_string(),
            created_at: "2026-06-04 00:00:00".to_string(),
        }])
        .await;
    assert!(!export.contains("token123"));
    assert!(!export.contains("/Users/leelei"));
    assert!(!export.contains("secret words"));

    let notifications = NotificationService::for_tests();
    notifications
        .notify_human_attention("task_1", "human_lei", "check /workspace/secret/file.rs")
        .await;
    let payload = notifications.list_for_user("human_lei").await[0]
        .payload
        .clone();
    assert!(!payload.contains("/workspace/secret"));
}

fn temp_dir(label: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("slei-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    path
}
