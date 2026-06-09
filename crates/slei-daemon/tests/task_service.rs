use std::time::Duration;

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

    let agent_reply = service
        .add_reply(&task.id, "agent_coda", "收到", "reply-1")
        .await
        .unwrap();
    let human_reply = service
        .add_reply(&task.id, "human_lei", "补充一下", "reply-2")
        .await
        .unwrap();
    assert_eq!(agent_reply.role.as_deref(), Some("agent"));
    assert_eq!(human_reply.role.as_deref(), Some("human"));

    let thread = service.thread_view(&task.id).await.unwrap();
    assert_eq!(thread.task.reply_count, 2);
    assert_eq!(thread.root.body, "帮我调研");
    assert!(thread.replies.iter().any(|reply| reply.body == "收到"));
    assert!(thread.replies.iter().any(|reply| reply.body == "补充一下"));
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
        .update_status(&task.id, TaskStatus::Done)
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
    assert!(
        task.assignment_reason
            .as_deref()
            .unwrap()
            .contains("command intent")
    );
}

#[tokio::test]
async fn assigning_pending_task_moves_it_to_in_progress() {
    let service = TaskService::for_tests();
    let task = service
        .create_task_root("channel_dev", "human_lei", "needs assignment", "task-key-3")
        .await
        .unwrap();
    assert_eq!(task.status, TaskStatus::PendingAssignment);

    service
        .assign(&task.id, Some("agent_alice".to_string()))
        .await
        .unwrap();

    let assigned = service.task(&task.id).await.unwrap();
    assert_eq!(assigned.status, TaskStatus::InProgress);
    assert_eq!(assigned.assignee_id.as_deref(), Some("agent_alice"));
    assert!(!assigned.needs_assignment);
    assert!(!assigned.attention_required);
}

#[tokio::test]
async fn reassignment_preserves_review_and_done_statuses() {
    let service = TaskService::for_tests();
    let review_task = service
        .create_task_root("channel_dev", "human_lei", "review task", "task-key-4")
        .await
        .unwrap();
    service
        .assign(&review_task.id, Some("agent_alice".to_string()))
        .await
        .unwrap();
    service
        .update_status(&review_task.id, TaskStatus::InReview)
        .await
        .unwrap();

    service
        .assign(&review_task.id, Some("agent_coda".to_string()))
        .await
        .unwrap();
    let reassigned_review = service.task(&review_task.id).await.unwrap();
    assert_eq!(reassigned_review.status, TaskStatus::InReview);
    assert_eq!(reassigned_review.assignee_id.as_deref(), Some("agent_coda"));

    service.assign(&review_task.id, None).await.unwrap();
    let unassigned_review = service.task(&review_task.id).await.unwrap();
    assert_eq!(unassigned_review.status, TaskStatus::InReview);
    assert_eq!(unassigned_review.assignee_id, None);
    assert!(!unassigned_review.needs_assignment);

    let done_task = service
        .create_task_root("channel_dev", "human_lei", "done task", "task-key-5")
        .await
        .unwrap();
    service
        .update_status(&done_task.id, TaskStatus::Done)
        .await
        .unwrap();
    service
        .assign(&done_task.id, Some("agent_coda".to_string()))
        .await
        .unwrap();
    assert_eq!(
        service.task(&done_task.id).await.unwrap().status,
        TaskStatus::Done
    );

    service.assign(&done_task.id, None).await.unwrap();
    let unassigned_done = service.task(&done_task.id).await.unwrap();
    assert_eq!(unassigned_done.status, TaskStatus::Done);
    assert_eq!(unassigned_done.assignee_id, None);
    assert!(!unassigned_done.needs_assignment);
}

#[tokio::test]
async fn task_thread_root_created_at_stays_stable_after_activity() {
    let service = TaskService::for_tests();
    let task = service
        .create_task_root("channel_dev", "human_lei", "stable root", "task-key-6")
        .await
        .unwrap();
    assert_eq!(task.created_at, task.updated_at);

    let initial_thread = service.thread_view(&task.id).await.unwrap();
    let root_created_at = initial_thread.root.created_at.clone();

    tokio::time::sleep(Duration::from_millis(2)).await;
    service
        .add_reply(&task.id, "agent_coda", "收到", "reply-stable-root")
        .await
        .unwrap();
    service
        .update_status(&task.id, TaskStatus::InReview)
        .await
        .unwrap();
    service
        .assign(&task.id, Some("agent_alice".to_string()))
        .await
        .unwrap();

    let updated_thread = service.thread_view(&task.id).await.unwrap();
    assert_eq!(updated_thread.root.created_at, root_created_at);
    assert_ne!(updated_thread.task.updated_at, root_created_at);
    assert_eq!(
        service.task(&task.id).await.unwrap().created_at,
        root_created_at
    );
}
