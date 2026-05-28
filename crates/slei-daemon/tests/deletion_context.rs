use std::fs;
use std::path::PathBuf;

use slei_daemon::services::run_orchestrator::{ContextAssembler, ContextMessageRecord};
use slei_storage::db::SleiDb;
use slei_storage::repositories::Repositories;
use uuid::Uuid;

#[tokio::test]
async fn deletion_context_deleted_human_message_is_absent_after_restart() {
    let sentinel = "SENTINEL_DELETED_MESSAGE";
    let db_path = temp_db_path();
    let database_url = format!("sqlite://{}", db_path.display());
    let message_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();

    {
        let db = SleiDb::connect(&database_url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());
        repos
            .insert_human_message(message_id, channel_id, sentinel)
            .await
            .unwrap();
        repos
            .delete_human_message_to_tombstone(message_id)
            .await
            .unwrap();
    }

    let restarted = SleiDb::connect(&database_url).await.unwrap();
    let repos = Repositories::new(restarted.pool().clone());
    let deleted = repos.message(message_id).await.unwrap().unwrap();
    let raw_bytes = fs::read(&db_path).unwrap();

    let context = ContextAssembler::assemble(vec![
        ContextMessageRecord {
            channel_id: "channel_dev".to_string(),
            task_id: None,
            agent_id: "agent_coda".to_string(),
            role: "user".to_string(),
            content: deleted.content,
            deleted: deleted.deleted,
        },
        ContextMessageRecord {
            channel_id: "channel_dev".to_string(),
            task_id: None,
            agent_id: "agent_coda".to_string(),
            role: "user".to_string(),
            content: Some("safe message".to_string()),
            deleted: false,
        },
    ]);

    assert!(!String::from_utf8_lossy(&raw_bytes).contains(sentinel));
    assert!(!serde_json::to_string(&context).unwrap().contains(sentinel));
    assert_eq!(context[0].content, "safe message");
}

fn temp_db_path() -> PathBuf {
    std::env::temp_dir().join(format!("slei-deletion-context-{}.sqlite", Uuid::new_v4()))
}
