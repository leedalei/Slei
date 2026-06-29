use slei_daemon::services::task_service::{TaskQuery, TaskService, TaskStatus};

#[tokio::test]
async fn task_board_queries_across_channels_and_preserves_attention_separately() {
    let service = TaskService::for_tests();

    let dev_task = service
        .create_task_root(
            "channel_dev",
            "human_lei",
            "帮我调研下怎么实现这个功能",
            "task-board-1",
        )
        .await
        .unwrap();
    service
        .assign(&dev_task.id, Some("agent_alice".to_string()))
        .await
        .unwrap();
    service
        .set_attention_required(&dev_task.id, true)
        .await
        .unwrap();

    let ai_task = service
        .create_task_root(
            "channel_ai",
            "human_lei",
            "整理 AI 领域的重要动态",
            "task-board-2",
        )
        .await
        .unwrap();
    service
        .assign(&ai_task.id, Some("agent_coda".to_string()))
        .await
        .unwrap();
    service
        .add_reply(
            &ai_task.id,
            "agent_coda",
            "已整理 AI 动态，提交评审",
            "task-board-2-reply",
        )
        .await
        .unwrap();
    service
        .update_status(&ai_task.id, TaskStatus::InReview)
        .await
        .unwrap();

    let done_task = service
        .create_task_root(
            "channel_dev",
            "human_may",
            "检查 release note",
            "task-board-3",
        )
        .await
        .unwrap();
    service
        .add_reply(
            &done_task.id,
            "human_may",
            "release note 已检查",
            "task-board-3-reply",
        )
        .await
        .unwrap();
    service
        .update_status(&done_task.id, TaskStatus::Done)
        .await
        .unwrap();

    service
        .create_task_root("channel_ops", "human_ops", "等待分配的任务", "task-board-4")
        .await
        .unwrap();

    let channel_dev = service
        .list_tasks(TaskQuery {
            channel_id: Some("channel_dev".to_string()),
            ..TaskQuery::default()
        })
        .await;
    assert_eq!(channel_dev.len(), 2);

    let coda_tasks = service
        .list_tasks(TaskQuery {
            assignee_id: Some("agent_coda".to_string()),
            ..TaskQuery::default()
        })
        .await;
    assert_eq!(coda_tasks, vec![service.task(&ai_task.id).await.unwrap()]);

    let lei_tasks = service
        .list_tasks(TaskQuery {
            creator_id: Some("human_lei".to_string()),
            ..TaskQuery::default()
        })
        .await;
    assert_eq!(lei_tasks.len(), 2);

    let board = service.board(TaskQuery::default()).await;
    assert_eq!(
        board
            .columns
            .iter()
            .map(|column| column.status)
            .collect::<Vec<_>>(),
        vec![
            TaskStatus::PendingAssignment,
            TaskStatus::InProgress,
            TaskStatus::InReview,
            TaskStatus::Done,
        ]
    );
    assert_eq!(
        board
            .column(TaskStatus::PendingAssignment)
            .unwrap()
            .tasks
            .len(),
        1
    );
    assert_eq!(board.column(TaskStatus::InProgress).unwrap().tasks.len(), 1);
    assert_eq!(board.column(TaskStatus::InReview).unwrap().tasks.len(), 1);
    assert_eq!(board.column(TaskStatus::Done).unwrap().tasks.len(), 1);

    let visible_dev_task = service.task(&dev_task.id).await.unwrap();
    assert_eq!(visible_dev_task.status, TaskStatus::InProgress);
    assert!(visible_dev_task.attention_required);

    service
        .add_reply(
            &dev_task.id,
            "agent_alice",
            "调研方案已整理，等待评审",
            "task-board-1-reply",
        )
        .await
        .unwrap();
    service
        .update_status(&dev_task.id, TaskStatus::InReview)
        .await
        .unwrap();
    let thread = service.thread_context(&dev_task.id).await.unwrap();
    assert_eq!(thread.task.status, TaskStatus::InReview);
    assert!(service.task(&dev_task.id).await.unwrap().attention_required);
}
