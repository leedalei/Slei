//! Durable local storage for Slei domain data.

pub mod db;
pub mod migrations;
pub mod repositories;

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::db::SleiDb;
    use super::repositories::Repositories;

    fn sqlite_file_url(name: &str) -> (String, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("slei-{name}-{}.sqlite", Uuid::new_v4()));
        (format!("sqlite://{}", path.display()), path)
    }

    #[tokio::test]
    async fn migration_creates_core_tables_and_indexes() {
        let (url, _path) = sqlite_file_url("migration");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();

        for table in [
            "messages",
            "tasks",
            "thread_replies",
            "runtime_sessions",
            "event_log",
            "idempotent_mutations",
            "channel_coordinators",
            "coordinator_decisions",
            "coordinator_runtime_runs",
            "agent_inbox_events",
            "memory_update_events",
            "memory_document_states",
            "routing_context_packages",
            "schema_migrations",
        ] {
            assert!(db.table_exists(table).await.unwrap(), "missing {table}");
        }
    }

    #[tokio::test]
    async fn deleting_human_message_clears_content_and_raw_storage() {
        let (url, path) = sqlite_file_url("delete");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());
        let message_id = Uuid::new_v4();
        let secret = "delete-me-sentinel";

        repos
            .insert_human_message(message_id, Uuid::new_v4(), secret)
            .await
            .unwrap();
        repos
            .delete_human_message_to_tombstone(message_id)
            .await
            .unwrap();

        let message = repos.message(message_id).await.unwrap().unwrap();
        assert_eq!(message.kind, "tombstone");
        assert!(message.deleted);
        assert_eq!(message.content, None);

        drop(repos);
        drop(db);

        let bytes = fs::read(path).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains(secret));
    }

    #[tokio::test]
    async fn stores_runtime_tokens_as_ciphertext_only() {
        let (url, path) = sqlite_file_url("token");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());
        let plaintext = "plain-runtime-token";
        let ciphertext = "cipher-runtime-token";

        repos
            .upsert_runtime_session(
                Uuid::new_v4(),
                Uuid::new_v4(),
                "ClaudeCode",
                None,
                ciphertext,
            )
            .await
            .unwrap();

        drop(repos);
        drop(db);

        let bytes = fs::read(path).unwrap();
        let raw = String::from_utf8_lossy(&bytes);
        assert!(raw.contains(ciphertext));
        assert!(!raw.contains(plaintext));
    }

    #[tokio::test]
    async fn events_replay_in_sequence_and_task_thread_refs_survive_reload() {
        let (url, _path) = sqlite_file_url("recovery");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());
        let channel_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();

        repos
            .insert_human_message(message_id, channel_id, "task root")
            .await
            .unwrap();
        repos
            .insert_task(task_id, channel_id, message_id, "Demo")
            .await
            .unwrap();
        repos
            .insert_thread_reply(Uuid::new_v4(), task_id, message_id, "reply")
            .await
            .unwrap();
        repos
            .append_event("message.created", message_id, "{}")
            .await
            .unwrap();
        repos
            .append_event("task.created", task_id, "{}")
            .await
            .unwrap();

        let events = repos.events_after_sequence(0).await.unwrap();
        assert_eq!(
            events
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );

        let thread = repos.find_task_thread(task_id).await.unwrap().unwrap();
        assert_eq!(thread.task_id, task_id);
        assert_eq!(thread.root_message_id, message_id);
        assert_eq!(thread.reply_count, 1);
    }

    #[tokio::test]
    async fn coordinator_decisions_persist_full_assignee_target_list() {
        let (url, _path) = sqlite_file_url("decision-targets");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());
        let decision_id = Uuid::new_v4();

        repos
            .insert_coordinator_decision(
                decision_id,
                "all",
                "msg_broadcast",
                "consultation",
                "request_agent_reply",
                Some("agent_alice"),
                &["agent_alice".to_string(), "agent_coda".to_string()],
                "broadcast routed to all selected agents",
            )
            .await
            .unwrap();

        let decisions = repos
            .coordinator_decisions_for_message("msg_broadcast")
            .await
            .unwrap();

        assert_eq!(
            decisions[0].assignee_agent_id.as_deref(),
            Some("agent_alice")
        );
        assert_eq!(
            decisions[0].assignee_agent_ids,
            vec!["agent_alice".to_string(), "agent_coda".to_string()]
        );
    }

    #[tokio::test]
    async fn coordinator_runtime_runs_persist_pending_output_and_status() {
        let (url, _path) = sqlite_file_url("coordinator-runs");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());

        repos
            .insert_coordinator_runtime_run("coord_run_1", "dev", "msg_1", "idem-1", "prompt body")
            .await
            .unwrap();
        repos
            .append_coordinator_runtime_output("coord_run_1", "{\"intent\"")
            .await
            .unwrap();
        repos
            .append_coordinator_runtime_output("coord_run_1", ":\"consultation\"}")
            .await
            .unwrap();
        repos
            .finish_coordinator_runtime_run("coord_run_1", "completed", None)
            .await
            .unwrap();

        let run = repos
            .coordinator_runtime_run("coord_run_1")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(run.status, "completed");
        assert_eq!(run.output, "{\"intent\":\"consultation\"}");
        assert_eq!(run.message_id, "msg_1");
        assert_eq!(run.idempotency_key, "idem-1");
    }

    #[tokio::test]
    async fn migration_repairs_legacy_orchestration_tables_missing_sequence_columns() {
        let (url, _path) = sqlite_file_url("legacy-sequence");
        let db = SleiDb::connect(&url).await.unwrap();
        sqlx::query(
            "CREATE TABLE coordinator_decisions (
                id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                intent TEXT NOT NULL,
                action TEXT NOT NULL,
                assignee_agent_id TEXT,
                reason TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE agent_inbox_events (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                delivery_state TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
        )
        .execute(db.pool())
        .await
        .unwrap();

        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());
        let decision_id = Uuid::new_v4();
        let inbox_id = Uuid::new_v4();

        repos
            .insert_coordinator_decision(
                decision_id,
                "all",
                "message-legacy",
                "conversation",
                "request_agent_reply",
                Some("agent_coordinator_all"),
                &["agent_coordinator_all".to_string()],
                "legacy repaired",
            )
            .await
            .unwrap();
        repos
            .insert_agent_inbox_event(
                inbox_id,
                "agent_coordinator_all",
                "human_mention",
                "pending",
                "{}",
            )
            .await
            .unwrap();

        assert_eq!(
            repos
                .coordinator_decisions_for_message("message-legacy")
                .await
                .unwrap()[0]
                .id,
            decision_id
        );
        assert_eq!(
            repos
                .agent_inbox_events("agent_coordinator_all")
                .await
                .unwrap()[0]
                .id,
            inbox_id
        );
    }
}
