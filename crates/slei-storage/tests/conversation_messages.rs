use slei_storage::db::SleiDb;
use slei_storage::repositories::{ConversationMessageRow, ConversationRow, Repositories};
use uuid::Uuid;

fn sqlite_file_url(name: &str) -> (String, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("slei-{name}-{}.sqlite", Uuid::new_v4()));
    (format!("sqlite://{}", path.display()), path)
}

fn conversation(id: &str, agent_id: &str) -> ConversationRow {
    ConversationRow {
        id: id.to_string(),
        kind: "dm".to_string(),
        agent_id: agent_id.to_string(),
        active_session_id: None,
        runtime_status: None,
        created_at: "1".to_string(),
        updated_at: "1".to_string(),
    }
}

fn message(id: &str, conversation_id: &str, body: &str) -> ConversationMessageRow {
    ConversationMessageRow {
        id: id.to_string(),
        conversation_id: conversation_id.to_string(),
        session_id: None,
        author_id: "agent".to_string(),
        body: body.to_string(),
        status: None,
        run_id: None,
        attachment_ids: "[]".to_string(),
        cards_payload: "[]".to_string(),
        created_at: "1".to_string(),
    }
}

#[tokio::test]
async fn conversation_message_upsert_does_not_move_id_across_conversations() {
    let (url, _path) = sqlite_file_url("conversation-message-conflict");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    repos
        .upsert_conversation(conversation("conversation:first", "agent_first"))
        .await
        .unwrap();
    repos
        .upsert_conversation(conversation("conversation:second", "agent_second"))
        .await
        .unwrap();

    repos
        .insert_conversation_message(message("shared-message-id", "conversation:first", "first"))
        .await
        .unwrap();
    repos
        .insert_conversation_message(message(
            "shared-message-id",
            "conversation:first",
            "first updated",
        ))
        .await
        .unwrap();
    let conflict = repos
        .insert_conversation_message(message(
            "shared-message-id",
            "conversation:second",
            "second",
        ))
        .await;

    assert!(conflict.is_err());

    let first = repos
        .conversation_messages("conversation:first")
        .await
        .unwrap();
    let second = repos
        .conversation_messages("conversation:second")
        .await
        .unwrap();

    assert_eq!(first.len(), 1);
    assert_eq!(first[0].id, "shared-message-id");
    assert_eq!(first[0].conversation_id, "conversation:first");
    assert_eq!(first[0].body, "first updated");
    assert!(second.is_empty());
}
