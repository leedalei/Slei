use slei_daemon::services::task_service::{TaskService, TaskStatus};

#[tokio::test]
async fn task_service_creates_task_root_and_keeps_replies_attached() {
    let service = TaskService::for_tests();

    let task = service
        .create_task_root("channel_dev", "human_lei", "帮我调研", "task-key-1")
        .await
        .unwrap();
    let retry = service
        .create_task_root("channel_dev", "human_lei", "ignored", "task-key-1")
        .await
        .unwrap();
    assert_eq!(task.id, retry.id);

    service
        .add_reply(&task.id, "agent_coda", "收到", "reply-1")
        .await
        .unwrap();
    service
        .add_reply(&task.id, "human_lei", "补充一下", "reply-2")
        .await
        .unwrap();

    let thread = service.thread_context(&task.id).await.unwrap();
    assert_eq!(thread.reply_count, 2);
    assert!(thread.context.contains("收到"));
    assert!(thread.context.contains("补充一下"));
}

#[tokio::test]
async fn task_service_blocks_root_delete_while_active_and_updates_status() {
    let service = TaskService::for_tests();
    let task = service
        .create_task_root("channel_dev", "human_lei", "active task", "task-key-2")
        .await
        .unwrap();

    let err = service.delete_task_root(&task.id).await.unwrap_err();
    assert!(err.to_string().contains("active task"));

    service
        .update_status(&task.id, TaskStatus::Closed)
        .await
        .unwrap();
    service.delete_task_root(&task.id).await.unwrap();
    assert!(service.task(&task.id).await.unwrap().root_deleted);
}

#[tokio::test]
async fn task_created_from_coordinator_keeps_source_and_assignment_reason() {
    let service = TaskService::for_tests();

    let task = service
        .create_from_coordinator(
            "channel_dev",
            "human_lei",
            "msg_1",
            "实现频道 Coordinator",
            Some("agent_alice".to_string()),
            "command intent requires architecture",
            "task-from-coordinator",
        )
        .await
        .unwrap();

    assert_eq!(task.source_message_id.as_deref(), Some("msg_1"));
    assert_eq!(task.assignee_id.as_deref(), Some("agent_alice"));
    assert!(!task.needs_assignment);
    assert!(task
        .assignment_reason
        .as_deref()
        .unwrap()
        .contains("command intent"));
}
