use slei_storage::db::SleiDb;
use slei_storage::repositories::{
    MessageThreadReplyRow, MessageThreadRow, NewChannelMessageRow, Repositories, TaskRootRow,
};
use uuid::Uuid;

fn sqlite_file_url(name: &str) -> (String, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("slei-{name}-{}.sqlite", Uuid::new_v4()));
    (format!("sqlite://{}", path.display()), path)
}

fn source_message(id: &str) -> NewChannelMessageRow {
    NewChannelMessageRow {
        id: id.to_string(),
        channel_id: "all".to_string(),
        session_id: None,
        author_id: "human:local".to_string(),
        body: Some("please split this into a thread".to_string()),
        as_task: false,
        kind: "user".to_string(),
    }
}

fn thread(id: &str, source_message_id: &str) -> MessageThreadRow {
    MessageThreadRow {
        id: id.to_string(),
        source_message_id: source_message_id.to_string(),
        source_kind: "channel".to_string(),
        source_id: "all".to_string(),
        created_by: "human:local".to_string(),
        reply_count: 0,
        created_at: "2026-06-17T00:00:00Z".to_string(),
        updated_at: "2026-06-17T00:00:00Z".to_string(),
    }
}

fn reply(
    id: &str,
    thread_id: &str,
    sender_id: &str,
    role: &str,
    body: &str,
) -> MessageThreadReplyRow {
    MessageThreadReplyRow {
        id: id.to_string(),
        thread_id: thread_id.to_string(),
        sender_id: sender_id.to_string(),
        role: role.to_string(),
        body: body.to_string(),
        status: None,
        run_id: None,
        created_at: "2026-06-17T00:00:00Z".to_string(),
    }
}

#[tokio::test]
async fn message_thread_is_unique_per_source_message() {
    let (url, _path) = sqlite_file_url("message-thread-unique-source");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    repos
        .insert_channel_message(source_message("msg_source"))
        .await
        .unwrap();

    repos
        .upsert_message_thread_idempotent(
            thread("thread_first", "msg_source"),
            "message-thread:first",
            r#"{"id":"thread_first"}"#,
        )
        .await
        .unwrap();
    repos
        .upsert_message_thread_idempotent(
            thread("thread_second", "msg_source"),
            "message-thread:second",
            r#"{"id":"thread_second"}"#,
        )
        .await
        .unwrap();

    let stored = repos
        .message_thread_by_source_message("msg_source")
        .await
        .unwrap()
        .unwrap();
    let all_for_source = repos
        .message_threads_for_source_messages(&["msg_source".to_string()])
        .await
        .unwrap();

    assert_eq!(stored.id, "thread_first");
    assert_eq!(stored.source_message_id, "msg_source");
    assert_eq!(all_for_source.len(), 1);
}

#[tokio::test]
async fn thread_reply_rows_keep_sender_role_and_stable_order() {
    let (url, _path) = sqlite_file_url("message-thread-replies");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    repos
        .insert_channel_message(source_message("msg_source"))
        .await
        .unwrap();
    repos
        .upsert_message_thread_idempotent(
            thread("thread_source", "msg_source"),
            "message-thread:source",
            r#"{"id":"thread_source"}"#,
        )
        .await
        .unwrap();

    repos
        .insert_message_thread_reply_idempotent(
            reply("reply_1", "thread_source", "human:local", "human", "first"),
            "message-thread-reply:first",
            r#"{"id":"reply_1"}"#,
        )
        .await
        .unwrap();
    repos
        .insert_message_thread_reply_idempotent(
            reply("reply_2", "thread_source", "agent_coda", "agent", "second"),
            "message-thread-reply:second",
            r#"{"id":"reply_2"}"#,
        )
        .await
        .unwrap();

    let replies = repos.message_thread_replies("thread_source").await.unwrap();
    let updated = repos
        .message_thread_by_id("thread_source")
        .await
        .unwrap()
        .unwrap();

    assert_eq!(updated.reply_count, 2);
    assert_eq!(
        replies
            .iter()
            .map(|reply| (
                reply.id.as_str(),
                reply.sender_id.as_str(),
                reply.role.as_str()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("reply_1", "human:local", "human"),
            ("reply_2", "agent_coda", "agent"),
        ]
    );
}

#[tokio::test]
async fn task_root_can_reference_message_thread() {
    let (url, _path) = sqlite_file_url("task-thread-link");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    repos
        .insert_channel_message(source_message("msg_source"))
        .await
        .unwrap();
    repos
        .upsert_message_thread_idempotent(
            thread("thread_source", "msg_source"),
            "message-thread:source",
            r#"{"id":"thread_source"}"#,
        )
        .await
        .unwrap();

    repos
        .upsert_task_root_idempotent(
            TaskRootRow {
                id: "task_source".to_string(),
                channel_id: "all".to_string(),
                creator_id: "human:local".to_string(),
                assignee_id: None,
                source_message_id: Some("msg_source".to_string()),
                thread_id: Some("thread_source".to_string()),
                assignment_reason: None,
                needs_assignment: false,
                title: "Follow up".to_string(),
                status: "todo".to_string(),
                attention_required: false,
                root_deleted: false,
                root_body: "please split this into a thread".to_string(),
                created_at: "2026-06-17T00:00:00Z".to_string(),
                updated_at: "2026-06-17T00:00:00Z".to_string(),
            },
            "task-root:source",
            r#"{"id":"task_source"}"#,
        )
        .await
        .unwrap();

    let task = repos.task_by_id("task_source").await.unwrap().unwrap();

    assert_eq!(task.source_message_id.as_deref(), Some("msg_source"));
    assert_eq!(task.thread_id.as_deref(), Some("thread_source"));
}
