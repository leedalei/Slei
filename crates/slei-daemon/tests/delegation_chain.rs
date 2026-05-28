use slei_daemon::services::delegation_service::{
    DelegationRequest, DelegationService, DelegationSource,
};
use slei_daemon::services::notification_service::NotificationService;

#[tokio::test]
async fn delegation_chain_requires_visible_handoff_before_child_run() {
    let service = DelegationService::for_tests();

    let hidden = service
        .create_delegation(DelegationRequest {
            source: DelegationSource::FreeformText,
            parent_run_id: "run_1".to_string(),
            from_agent_id: "agent_coda".to_string(),
            to_agent_id: "agent_alice".to_string(),
            task_id: "task_1".to_string(),
        })
        .await;
    assert!(hidden.unwrap_err().to_string().contains("visible"));

    let delegated = service
        .create_delegation(DelegationRequest {
            source: DelegationSource::TypedVisibleRequest,
            parent_run_id: "run_1".to_string(),
            from_agent_id: "agent_coda".to_string(),
            to_agent_id: "agent_alice".to_string(),
            task_id: "task_1".to_string(),
        })
        .await
        .unwrap();

    assert_eq!(delegated.child_run_id, "run_1/agent_alice");
    assert!(service.timeline_for_task("task_1").await[0].contains("@agent_alice"));
}

#[tokio::test]
async fn delegation_chain_rejects_depth_and_agent_cycles() {
    let service = DelegationService::for_tests();
    let mut parent = "run_root".to_string();
    let mut from = "agent_0".to_string();
    for depth in 1..=5 {
        let to = format!("agent_{depth}");
        let record = service
            .create_delegation(DelegationRequest {
                source: DelegationSource::UserMention,
                parent_run_id: parent,
                from_agent_id: from,
                to_agent_id: to.clone(),
                task_id: "task_depth".to_string(),
            })
            .await
            .unwrap();
        parent = record.child_run_id;
        from = to;
    }

    let too_deep = service
        .create_delegation(DelegationRequest {
            source: DelegationSource::UserMention,
            parent_run_id: parent.clone(),
            from_agent_id: from,
            to_agent_id: "agent_6".to_string(),
            task_id: "task_depth".to_string(),
        })
        .await;
    assert!(too_deep.unwrap_err().to_string().contains("depth"));

    let cycle = service
        .create_delegation(DelegationRequest {
            source: DelegationSource::UserMention,
            parent_run_id: parent,
            from_agent_id: "agent_5".to_string(),
            to_agent_id: "agent_1".to_string(),
            task_id: "task_depth".to_string(),
        })
        .await;
    assert!(cycle.unwrap_err().to_string().contains("cycle"));
}

#[tokio::test]
async fn delegation_chain_human_attention_creates_notification_without_run() {
    let notifications = NotificationService::for_tests();
    notifications
        .notify_human_attention("task_1", "human_lei", "@lei-lee 请确认")
        .await;

    let entries = notifications.list_for_user("human_lei").await;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].task_id, "task_1");
    assert!(!entries[0].payload.contains("/workspace/secret"));
}
