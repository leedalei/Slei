use std::time::Duration;

use slei_daemon::auth::AuthToken;
use slei_daemon::services::task_service::{TaskService, TaskStatus};
use slei_daemon::state::AppState;

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
async fn task_service_rejects_empty_idempotency_keys() {
    let service = TaskService::for_tests();

    let create_error = service
        .create_task_root("channel_dev", "human_lei", "missing key", "")
        .await
        .unwrap_err();
    assert!(create_error.to_string().contains("idempotency-key"));

    let task = service
        .create_task_root(
            "channel_dev",
            "human_lei",
            "has key",
            "task-empty-key-source",
        )
        .await
        .unwrap();
    let reply_error = service
        .add_reply(&task.id, "human_lei", "missing key reply", "   ")
        .await
        .unwrap_err();
    assert!(reply_error.to_string().contains("idempotency-key"));
}

#[tokio::test]
async fn task_create_and_reply_idempotency_keys_do_not_cross_replay_after_reload() {
    let root = std::env::temp_dir().join(format!("slei-task-idem-{}", uuid::Uuid::new_v4()));
    let first = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("task-idem-token"),
        root.clone(),
    )
    .await;
    let task = first
        .tasks()
        .create_task_root("all", "human:local", "root title", "shared-task-key")
        .await
        .unwrap();
    let reply = first
        .tasks()
        .add_reply(&task.id, "human:local", "reply body", "reply-then-create")
        .await
        .unwrap();

    let second =
        AppState::for_tests_with_agent_root_async(AuthToken::from_static("task-idem-token"), root)
            .await;
    let create_after_reply = second
        .tasks()
        .create_task_root("all", "human:local", "new root", "reply-then-create")
        .await
        .unwrap();
    assert_ne!(create_after_reply.id, task.id);
    assert_ne!(create_after_reply.id, reply.id);
    assert_eq!(create_after_reply.title, "new root");

    let reply_after_create = second
        .tasks()
        .add_reply(&task.id, "human:local", "new reply", "shared-task-key")
        .await
        .unwrap();
    assert_ne!(reply_after_create.id, task.id);
    assert_ne!(reply_after_create.id, reply.id);
    assert_eq!(reply_after_create.body, "new reply");
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
        .add_reply(&task.id, "agent_coda", "active task completed", "task-key-2-reply")
        .await
        .unwrap();
    service
        .update_status(&task.id, TaskStatus::Done)
        .await
        .unwrap();
    service.delete_task_root(&task.id).await.unwrap();
    assert!(service.task(&task.id).await.unwrap().root_deleted);
}

#[tokio::test]
async fn task_created_from_source_assignment_keeps_source_and_assignment_reason() {
    let service = TaskService::for_tests();

    let task = service
        .create_from_source_with_assignment(
            "channel_dev",
            "human_lei",
            "msg_1",
            "实现频道 Agent 分派",
            Some("agent_alice".to_string()),
            "command intent requires architecture",
            "task-from-source-assignment",
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

#[tokio::test]
async fn task_created_from_source_message_uses_source_body_and_reuses_source() {
    let root = std::env::temp_dir().join(format!("slei-source-task-{}", uuid::Uuid::new_v4()));
    let state =
        AppState::for_tests_with_agent_root_async(AuthToken::from_static("test-token"), root).await;
    let source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "请把广播 claim CLI 任务语义补齐，正文要完整保留。",
            "source-task-message",
            false,
        )
        .await
        .unwrap();

    let task = state
        .tasks()
        .create_from_source_message(&source.id, "agent_cindy", "source-task-create")
        .await
        .unwrap();
    let retry = state
        .tasks()
        .create_from_source_message(&source.id, "agent_mina", "source-task-create-retry")
        .await
        .unwrap();

    assert_eq!(retry.id, task.id);
    assert_eq!(task.channel_id, "all");
    assert_eq!(task.creator_id, "human_lei");
    assert_eq!(task.source_message_id.as_deref(), Some(source.id.as_str()));
    assert_eq!(
        task.root_body,
        "请把广播 claim CLI 任务语义补齐，正文要完整保留。"
    );
    let thread = state.tasks().thread_view(&task.id).await.unwrap();
    assert_eq!(thread.root.sender_id, "human_lei");
    assert_eq!(state.channel_messages_for_tests("all").await.len(), 1);
}

#[tokio::test]
async fn source_message_create_replays_idempotency_before_same_source_fallback() {
    let root = std::env::temp_dir().join(format!("slei-source-idem-{}", uuid::Uuid::new_v4()));
    let state =
        AppState::for_tests_with_agent_root_async(AuthToken::from_static("test-token"), root).await;
    let first_source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "第一个任务来源",
            "source-idem-first",
            false,
        )
        .await
        .unwrap();
    let second_source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "第二个任务来源",
            "source-idem-second",
            false,
        )
        .await
        .unwrap();

    let first_task = state
        .tasks()
        .create_from_source_message(&first_source.id, "agent_cindy", "shared-source-key")
        .await
        .unwrap();
    let second_task = state
        .tasks()
        .create_from_source_message(&second_source.id, "agent_cindy", "second-source-key")
        .await
        .unwrap();
    let replay = state
        .tasks()
        .create_from_source_message(&second_source.id, "agent_cindy", "shared-source-key")
        .await
        .unwrap();

    assert_ne!(first_task.id, second_task.id);
    assert_eq!(replay.id, first_task.id);
}

#[tokio::test]
async fn assigned_and_source_message_create_reuse_same_source_task() {
    let root = std::env::temp_dir().join(format!("slei-source-dedupe-{}", uuid::Uuid::new_v4()));
    let state =
        AppState::for_tests_with_agent_root_async(AuthToken::from_static("test-token"), root).await;
    let source = state
        .messages()
        .create_human_channel_message(
            "all",
            "human_lei",
            "同一条源消息只能有一个任务",
            "source-dedupe-message",
            false,
        )
        .await
        .unwrap();

    let from_source = state
        .tasks()
        .create_from_source_message(&source.id, "agent_cindy", "source-dedupe-api")
        .await
        .unwrap();
    let from_assignment = state
        .tasks()
        .create_from_source_with_assignment(
            "all",
            "human_lei",
            &source.id,
            "assigned title should not duplicate",
            Some("agent_cindy".to_string()),
            "assignment duplicate check",
            "source-dedupe-assignment",
        )
        .await
        .unwrap();

    assert_eq!(from_assignment.id, from_source.id);
    assert_eq!(
        state
            .tasks()
            .list_task_summaries(Default::default())
            .await
            .len(),
        1
    );
}

#[tokio::test]
async fn task_reply_preserves_explicit_role_and_idempotent_status_replays_summary() {
    let service = TaskService::for_tests();
    let task = service
        .create_task_root("all", "human_lei", "role task", "role-task-create")
        .await
        .unwrap();

    let reply = service
        .add_reply_with_role(
            &task.id,
            "agent_cindy",
            Some("agent"),
            "已处理到第一步",
            "role-reply-key",
        )
        .await
        .unwrap();
    let retry = service
        .add_reply_with_role(
            &task.id,
            "agent_cindy",
            Some("human"),
            "重试不能改正文",
            "role-reply-key",
        )
        .await
        .unwrap();

    assert_eq!(retry.reply.id, reply.reply.id);
    assert_eq!(retry.reply.role.as_deref(), Some("agent"));
    assert_eq!(retry.reply.body, "已处理到第一步");

    let updated = service
        .update_status_idempotent(&task.id, TaskStatus::InProgress, "role-status-key")
        .await
        .unwrap();
    let retried = service
        .update_status_idempotent(&task.id, TaskStatus::Done, "role-status-key")
        .await
        .unwrap();

    assert_eq!(updated.id, retried.id);
    assert_eq!(retried.status, TaskStatus::InProgress);
}

#[tokio::test]
async fn task_status_idempotency_replays_original_response_after_service_reload() {
    let root = std::env::temp_dir().join(format!("slei-status-idem-{}", uuid::Uuid::new_v4()));
    let first = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root.clone(),
    )
    .await;
    let task = first
        .tasks()
        .create_task_root("all", "human_lei", "status task", "status-idem-create")
        .await
        .unwrap();
    first
        .tasks()
        .add_reply(
            &task.id,
            "agent_coda",
            "status task has started",
            "status-idem-reply",
        )
        .await
        .unwrap();
    let updated = first
        .tasks()
        .update_status_idempotent(&task.id, TaskStatus::InProgress, "status-idem-update")
        .await
        .unwrap();

    let second =
        AppState::for_tests_with_agent_root_async(AuthToken::from_static("test-token"), root).await;
    let replay = second
        .tasks()
        .update_status_idempotent(&task.id, TaskStatus::Done, "status-idem-update")
        .await
        .unwrap();

    assert_eq!(updated.id, replay.id);
    assert_eq!(replay.status, TaskStatus::InProgress);
    assert_eq!(
        second.tasks().task(&task.id).await.unwrap().status,
        TaskStatus::InProgress
    );
}

#[tokio::test]
async fn tasks_survive_service_reload() {
    let root = std::env::temp_dir().join(format!("slei-task-reload-{}", uuid::Uuid::new_v4()));
    let first = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root.clone(),
    )
    .await;
    let task = first
        .tasks()
        .create_task_root("all", "human:local", "持久化任务", "task-reload-key")
        .await
        .unwrap();
    first
        .tasks()
        .add_reply(&task.id, "human:local", "reply", "reply-reload-key")
        .await
        .unwrap();

    let second =
        AppState::for_tests_with_agent_root_async(AuthToken::from_static("test-token"), root).await;
    let thread = second.tasks().thread_view(&task.id).await.unwrap();

    assert_eq!(thread.task.title, "持久化任务");
    assert_eq!(thread.replies.len(), 1);
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
        .add_reply(
            &review_task.id,
            "agent_alice",
            "review task is ready",
            "task-key-4-reply",
        )
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
        .add_reply(
            &done_task.id,
            "agent_coda",
            "done task completed",
            "task-key-5-reply",
        )
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
