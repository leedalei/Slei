//! Durable local storage for Slei domain data.

pub mod db;
pub mod migrations;
pub mod repositories;

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::db::SleiDb;
    use super::repositories::{
        ChannelSessionRow, MessageReadQueryRow, NewChannelMessageRow, Repositories,
        RESET_MUTABLE_SEQUENCE_TABLES, RESET_MUTABLE_TABLES,
    };

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
            "message_deliveries",
            "message_claims",
            "task_claims",
            "agent_statuses",
            "agent_activity_logs",
        ] {
            assert!(db.table_exists(table).await.unwrap(), "missing {table}");
        }
    }

    #[tokio::test]
    async fn migration_records_every_known_version() {
        let (url, _path) = sqlite_file_url("migration-versions");
        let db = SleiDb::connect(&url).await.unwrap();

        db.migrate().await.unwrap();

        let versions = sqlx::query_scalar::<_, i64>(
            "SELECT version FROM schema_migrations ORDER BY version ASC",
        )
        .fetch_all(db.pool())
        .await
        .unwrap();

        assert_eq!(versions, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn migration_records_broadcast_claim_version() {
        let (url, _path) = sqlite_file_url("broadcast-claim-version");
        let db = SleiDb::connect(&url).await.unwrap();

        db.migrate().await.unwrap();

        let versions = sqlx::query_scalar::<_, i64>(
            "SELECT version FROM schema_migrations ORDER BY version ASC",
        )
        .fetch_all(db.pool())
        .await
        .unwrap();

        assert_eq!(versions, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn message_claim_is_atomic_per_message_scope() {
        let (url, _path) = sqlite_file_url("message-claim");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());

        let first = repos
            .try_claim_message("msg_1", "reply", "agent_a")
            .await
            .unwrap();
        let second = repos
            .try_claim_message("msg_1", "reply", "agent_b")
            .await
            .unwrap();

        assert!(first.claimed);
        assert!(!second.claimed);
        assert_eq!(second.agent_id.as_deref(), Some("agent_a"));
    }

    #[tokio::test]
    async fn agent_activity_logs_keep_latest_100_per_agent() {
        let (url, _path) = sqlite_file_url("activity-log-retention");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());

        for index in 0..105 {
            repos
                .record_agent_activity(
                    "agent_a",
                    Some(&format!("run_{index}")),
                    Some("all"),
                    Some(&format!("msg_{index}")),
                    None,
                    "working",
                    Some("reading_history"),
                    None,
                )
                .await
                .unwrap();
        }

        let logs = repos.agent_activity_logs("agent_a", 200).await.unwrap();
        assert_eq!(logs.len(), 100);
        assert_eq!(logs.first().unwrap().run_id.as_deref(), Some("run_104"));
        assert_eq!(logs.last().unwrap().run_id.as_deref(), Some("run_5"));
    }

    #[tokio::test]
    async fn new_repository_limits_are_normalized() {
        let (url, _path) = sqlite_file_url("repository-limit-normalization");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());

        for index in 0..205 {
            repos
                .insert_channel_message(NewChannelMessageRow {
                    id: format!("msg_{index}"),
                    channel_id: "all".to_string(),
                    session_id: None,
                    author_id: "human".to_string(),
                    body: Some(format!("needle body {index}")),
                    as_task: false,
                    kind: "human".to_string(),
                })
                .await
                .unwrap();
            repos
                .create_message_delivery(&format!("msg_{index}"), "all", "agent_a")
                .await
                .unwrap();
            repos
                .record_agent_activity(
                    "agent_a",
                    Some(&format!("run_{index}")),
                    Some("all"),
                    Some(&format!("msg_{index}")),
                    None,
                    "working",
                    None,
                    None,
                )
                .await
                .unwrap();
        }

        let default_read = repos
            .read_channel_messages(MessageReadQueryRow {
                channel_id: "all".to_string(),
                limit: None,
                after_sequence: None,
                before_sequence: None,
                around_message_id: None,
            })
            .await
            .unwrap();
        let negative_read = repos
            .read_channel_messages(MessageReadQueryRow {
                channel_id: "all".to_string(),
                limit: Some(-5),
                after_sequence: None,
                before_sequence: None,
                around_message_id: None,
            })
            .await
            .unwrap();
        let negative_deliveries = repos
            .pending_message_deliveries("agent_a", -5)
            .await
            .unwrap();
        let negative_logs = repos.agent_activity_logs("agent_a", -5).await.unwrap();
        let negative_search = repos.search_channel_messages("needle", -5).await.unwrap();
        let capped_read = repos
            .read_channel_messages(MessageReadQueryRow {
                channel_id: "all".to_string(),
                limit: Some(500),
                after_sequence: None,
                before_sequence: None,
                around_message_id: None,
            })
            .await
            .unwrap();
        let capped_deliveries = repos
            .pending_message_deliveries("agent_a", 500)
            .await
            .unwrap();
        let capped_search = repos.search_channel_messages("needle", 500).await.unwrap();

        assert_eq!(default_read.len(), 20);
        assert_eq!(negative_read.len(), 20);
        assert_eq!(negative_deliveries.len(), 20);
        assert_eq!(negative_logs.len(), 20);
        assert_eq!(negative_search.len(), 20);
        assert_eq!(capped_read.len(), 200);
        assert_eq!(capped_deliveries.len(), 200);
        assert_eq!(capped_search.len(), 200);
    }

    #[tokio::test]
    async fn message_delivery_running_transition_is_guarded() {
        let (url, _path) = sqlite_file_url("delivery-running-guard");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());

        repos
            .create_message_delivery("msg_1", "all", "agent_a")
            .await
            .unwrap();

        let first = repos
            .mark_message_delivery_running("msg_1", "agent_a", "run_1")
            .await
            .unwrap();
        let second = repos
            .mark_message_delivery_running("msg_1", "agent_a", "run_2")
            .await
            .unwrap();

        let run_id = sqlx::query_scalar::<_, Option<String>>(
            "SELECT run_id FROM message_deliveries WHERE message_id = ? AND agent_id = ?",
        )
        .bind("msg_1")
        .bind("agent_a")
        .fetch_one(db.pool())
        .await
        .unwrap();

        assert!(first);
        assert!(!second);
        assert_eq!(run_id.as_deref(), Some("run_1"));
    }

    #[tokio::test]
    async fn read_channel_messages_returns_usable_sequence_cursors() {
        let (url, _path) = sqlite_file_url("message-read-cursors");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());

        for index in 0..3 {
            repos
                .insert_channel_message(NewChannelMessageRow {
                    id: format!("msg_{index}"),
                    channel_id: "all".to_string(),
                    session_id: None,
                    author_id: "human".to_string(),
                    body: Some(format!("body {index}")),
                    as_task: false,
                    kind: "human".to_string(),
                })
                .await
                .unwrap();
        }

        let messages = repos
            .read_channel_messages(MessageReadQueryRow {
                channel_id: "all".to_string(),
                limit: Some(10),
                after_sequence: None,
                before_sequence: None,
                around_message_id: None,
            })
            .await
            .unwrap();
        let first_sequence = messages[0].sequence.unwrap();
        let third_sequence = messages[2].sequence.unwrap();

        let after_first = repos
            .read_channel_messages(MessageReadQueryRow {
                channel_id: "all".to_string(),
                limit: Some(10),
                after_sequence: Some(first_sequence),
                before_sequence: None,
                around_message_id: None,
            })
            .await
            .unwrap();
        let before_third = repos
            .read_channel_messages(MessageReadQueryRow {
                channel_id: "all".to_string(),
                limit: Some(10),
                after_sequence: None,
                before_sequence: Some(third_sequence),
                around_message_id: None,
            })
            .await
            .unwrap();

        assert_eq!(
            after_first
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            vec!["msg_1", "msg_2"]
        );
        assert_eq!(
            before_third
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            vec!["msg_0", "msg_1"]
        );
    }

    #[tokio::test]
    async fn migration_creates_app_state_tables() {
        let (url, _path) = sqlite_file_url("app-state");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();

        for table in [
            "agents",
            "channels",
            "channel_members",
            "channel_workspace_mounts",
            "conversations",
            "conversation_sessions",
            "conversation_messages",
            "conversation_attachments",
            "saved_messages",
            "interactive_cards",
            "user_preferences",
            "nodes",
        ] {
            assert!(db.table_exists(table).await.unwrap(), "missing {table}");
        }
    }

    #[tokio::test]
    async fn reset_mutable_state_preserves_schema_migrations() {
        let (url, _path) = sqlite_file_url("reset");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());
        let channel_uuid = Uuid::new_v4();
        let agent_uuid = Uuid::new_v4();
        let message_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let thread_reply_id = Uuid::new_v4();
        let runtime_session_id = Uuid::new_v4();
        let event_entity_id = Uuid::new_v4();
        let decision_id = Uuid::new_v4();
        let inbox_event_id = Uuid::new_v4();
        let memory_event_id = Uuid::new_v4();
        let routing_package_id = Uuid::new_v4();
        let conversation_id = Uuid::new_v4();
        let conversation_session_id = Uuid::new_v4();
        let attachment_id = Uuid::new_v4();
        let conversation_message_id = Uuid::new_v4();
        let interactive_card_id = Uuid::new_v4();
        let event_message_id = Uuid::new_v4().to_string();

        sqlx::query("INSERT INTO app_metadata(key, value) VALUES ('boot.mode', 'reset-test')")
            .execute(db.pool())
            .await
            .unwrap();
        repos
            .upsert_agent(
                "agent_reset",
                "Reset Agent",
                "@reset",
                "agent",
                false,
                "Codex",
                "GPT-5",
                "node-reset",
                "reset test agent",
                "reset-avatar",
            )
            .await
            .unwrap();
        repos
            .upsert_channel(
                &channel_uuid.to_string(),
                "reset-channel",
                Some("reset scope"),
                true,
                "Controlled",
            )
            .await
            .unwrap();
        let channel_session_id = Uuid::new_v4().to_string();
        repos
            .upsert_channel_session(ChannelSessionRow {
                id: channel_session_id.clone(),
                channel_id: channel_uuid.to_string(),
                title: "reset session".to_string(),
                status: "ready".to_string(),
                created_at: "2026-06-15T00:00:00Z".to_string(),
                updated_at: "2026-06-15T00:00:00Z".to_string(),
            })
            .await
            .unwrap();
        sqlx::query("UPDATE channels SET active_session_id = ? WHERE id = ?")
            .bind(channel_session_id)
            .bind(channel_uuid.to_string())
            .execute(db.pool())
            .await
            .unwrap();
        repos
            .upsert_channel_member(&channel_uuid.to_string(), "agent_reset", "ready")
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO channel_workspace_mounts(channel_id, path, label) VALUES (?, ?, ?)",
        )
        .bind(channel_uuid.to_string())
        .bind("/tmp/reset-workspace")
        .bind("Reset Workspace")
        .execute(db.pool())
        .await
        .unwrap();
        repos
            .insert_human_message(message_id, channel_uuid, "reset body")
            .await
            .unwrap();
        repos
            .insert_task(task_id, channel_uuid, message_id, "reset task")
            .await
            .unwrap();
        repos
            .insert_thread_reply(thread_reply_id, task_id, message_id, "reset reply")
            .await
            .unwrap();
        repos
            .upsert_runtime_session(
                runtime_session_id,
                agent_uuid,
                "Codex",
                Some(channel_uuid),
                "ciphertext",
            )
            .await
            .unwrap();
        repos
            .append_event("test.event", event_entity_id, "{}")
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO idempotent_mutations(idempotency_key, entity_id, response_payload)
             VALUES (?, ?, ?)",
        )
        .bind("reset-key")
        .bind(Uuid::new_v4().to_string())
        .bind("{\"ok\":true}")
        .execute(db.pool())
        .await
        .unwrap();
        repos
            .insert_channel_coordinator(&channel_uuid.to_string(), "round-robin", true)
            .await
            .unwrap();
        repos
            .insert_coordinator_decision(
                decision_id,
                &channel_uuid.to_string(),
                &event_message_id,
                "route",
                "assign",
                Some("agent_reset"),
                &["agent_reset".to_string()],
                "reset reason",
            )
            .await
            .unwrap();
        repos
            .insert_coordinator_runtime_run(
                "run-reset",
                &channel_uuid.to_string(),
                &event_message_id,
                "idem-reset",
                "prompt",
            )
            .await
            .unwrap();
        repos
            .insert_agent_inbox_event(
                inbox_event_id,
                "agent_reset",
                "task.assigned",
                "pending",
                "{}",
            )
            .await
            .unwrap();
        repos
            .insert_memory_update_event(
                memory_event_id,
                "agent_reset",
                "memory.refresh",
                Some(&message_id.to_string()),
                Some("MEMORY.md"),
                Some("summary"),
                "pending",
            )
            .await
            .unwrap();
        repos
            .upsert_memory_document_state(
                "agent_reset",
                "MEMORY.md",
                "summary",
                Some("hash-1"),
                true,
            )
            .await
            .unwrap();
        repos
            .insert_routing_context_package(
                routing_package_id,
                decision_id,
                &message_id.to_string(),
                "{}",
                false,
            )
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO message_deliveries(id, message_id, channel_id, agent_id, delivery_state, run_id)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(message_id.to_string())
        .bind(channel_uuid.to_string())
        .bind("agent_reset")
        .bind("pending")
        .bind("run-reset")
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO message_claims(id, message_id, claim_scope, agent_id, status)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(message_id.to_string())
        .bind("reply")
        .bind("agent_reset")
        .bind("claimed")
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO task_claims(id, task_id, agent_id, status)
             VALUES (?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(task_id.to_string())
        .bind("agent_reset")
        .bind("claimed")
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_statuses(agent_id, state, phase, reason, run_id, channel_id, message_id, task_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("agent_reset")
        .bind("running")
        .bind("reset")
        .bind("reset test")
        .bind("run-reset")
        .bind(channel_uuid.to_string())
        .bind(message_id.to_string())
        .bind(task_id.to_string())
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_activity_logs(id, agent_id, run_id, channel_id, message_id, task_id, state, phase, reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind("agent_reset")
        .bind("run-reset")
        .bind(channel_uuid.to_string())
        .bind(message_id.to_string())
        .bind(task_id.to_string())
        .bind("running")
        .bind("reset")
        .bind("reset test")
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO conversations(id, kind, agent_id, active_session_id, runtime_status)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(conversation_id.to_string())
        .bind("agent")
        .bind("agent_reset")
        .bind(conversation_session_id.to_string())
        .bind("ready")
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO conversation_sessions(
                id, conversation_id, title, status, runtime_session_payload
             )
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(conversation_session_id.to_string())
        .bind(conversation_id.to_string())
        .bind("Reset Session")
        .bind("ready")
        .bind("{\"runtime\":\"ok\"}")
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO conversation_attachments(
                id, name, mime_type, size, url, cache_path, bytes_base64
             )
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(attachment_id.to_string())
        .bind("reset.txt")
        .bind("text/plain")
        .bind(10_i64)
        .bind("file:///reset.txt")
        .bind("/tmp/reset.txt")
        .bind("cmVzZXQ=")
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO conversation_messages(
                id, conversation_id, session_id, author_id, body, status, run_id, attachment_ids, cards_payload
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(conversation_message_id.to_string())
        .bind(conversation_id.to_string())
        .bind(conversation_session_id.to_string())
        .bind("agent_reset")
        .bind("Reset conversation body")
        .bind("done")
        .bind("run-reset")
        .bind(format!(r#"["{}"]"#, attachment_id))
        .bind("[]")
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO saved_messages(id, message_id, source_id, source_kind, session_id)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(conversation_message_id.to_string())
        .bind(conversation_id.to_string())
        .bind("conversation")
        .bind(conversation_session_id.to_string())
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO interactive_cards(
                id, run_id, agent_id, conversation_id, message_id, action_payload, template_payload, state
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(interactive_card_id.to_string())
        .bind("run-reset")
        .bind("agent_reset")
        .bind(conversation_id.to_string())
        .bind(conversation_message_id.to_string())
        .bind("{\"action\":\"open\"}")
        .bind("{\"template\":\"default\"}")
        .bind("active")
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO user_preferences(
                profile_id, locale, time_zone, theme, font_size,
                notify_mentions, notify_human_replies, notify_approvals
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("local")
        .bind("zh-CN")
        .bind("Asia/Shanghai")
        .bind("dark")
        .bind("medium")
        .bind(1_i64)
        .bind(1_i64)
        .bind(1_i64)
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO nodes(id, name, platform, arch, hostname, status, daemon_version)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("node-reset")
        .bind("Reset Node")
        .bind("macOS")
        .bind("arm64")
        .bind("reset-host")
        .bind("connected")
        .bind("0.1.0")
        .execute(db.pool())
        .await
        .unwrap();

        for table in RESET_MUTABLE_TABLES {
            let query = format!("SELECT COUNT(*) FROM {table}");
            let count: i64 = sqlx::query_scalar(&query)
                .fetch_one(db.pool())
                .await
                .unwrap();
            assert!(count > 0, "expected seeded rows in {table}");
        }

        let seeded_sequence_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_sequence
             WHERE name IN ('message_deliveries', 'message_claims', 'task_claims', 'agent_activity_logs', 'event_log', 'coordinator_decisions', 'agent_inbox_events', 'memory_update_events', 'routing_context_packages')",
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(
            seeded_sequence_count,
            RESET_MUTABLE_SEQUENCE_TABLES.len() as i64
        );

        repos.reset_mutable_state().await.unwrap();

        for table in RESET_MUTABLE_TABLES {
            let query = format!("SELECT COUNT(*) FROM {table}");
            let count: i64 = sqlx::query_scalar(&query)
                .fetch_one(db.pool())
                .await
                .unwrap();
            assert_eq!(count, 0, "expected reset to empty {table}");
        }

        let retained_sequence_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_sequence
             WHERE name IN ('message_deliveries', 'message_claims', 'task_claims', 'agent_activity_logs', 'event_log', 'coordinator_decisions', 'agent_inbox_events', 'memory_update_events', 'routing_context_packages')",
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(retained_sequence_count, 0);

        let migration_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_migrations")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(migration_count, 3);

        let next_sequence = repos
            .append_event("test.event.after_reset", Uuid::new_v4(), "{}")
            .await
            .unwrap();
        assert_eq!(next_sequence, 1);
    }

    #[tokio::test]
    async fn repositories_persist_agents_channels_and_memberships() {
        let (url, _path) = sqlite_file_url("agents-channels");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());

        repos
            .upsert_agent(
                "agent_coda",
                "Coda",
                "@coda",
                "agent",
                false,
                "ClaudeCode",
                "Sonnet",
                "local-node",
                "开发",
                "agent_coda",
            )
            .await
            .unwrap();
        repos
            .upsert_agent(
                "agent_coda",
                "Coda Prime",
                "@coda-prime",
                "coordinator",
                true,
                "Codex",
                "GPT-5",
                "remote-node",
                "协调",
                "coda-prime",
            )
            .await
            .unwrap();
        repos
            .upsert_channel("all", "all", Some("默认团队频道"), true, "Controlled")
            .await
            .unwrap();
        repos
            .upsert_channel("all", "all-hands", None, false, "Open")
            .await
            .unwrap();
        repos
            .upsert_channel_member("all", "missing_agent", "ready")
            .await
            .unwrap_err();
        repos
            .upsert_channel_member("all", "agent_coda", "joining")
            .await
            .unwrap();
        repos
            .upsert_channel_member("all", "agent_coda", "ready")
            .await
            .unwrap();

        let agents = repos.agents().await.unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].id, "agent_coda");
        assert_eq!(agents[0].name, "Coda Prime");
        assert_eq!(agents[0].handle, "@coda-prime");
        assert_eq!(agents[0].agent_kind, "coordinator");
        assert!(agents[0].system_owned);
        assert_eq!(agents[0].runtime_kind, "Codex");
        assert_eq!(agents[0].model, "GPT-5");
        assert_eq!(agents[0].node_id, "remote-node");
        assert_eq!(agents[0].description, "协调");
        assert_eq!(agents[0].workspace_path, "agents/agent_coda");
        assert_eq!(agents[0].memory_path, "agents/agent_coda/MEMORY.md");
        assert_eq!(agents[0].docs_path, "agents/agent_coda/docs");
        assert_eq!(agents[0].avatar_seed, "coda-prime");
        assert_eq!(agents[0].runtime_status, "ready");

        let channels = repos.channels().await.unwrap();
        assert_eq!(channels.len(), 1);
        assert_eq!(channels[0].id, "all");
        assert_eq!(channels[0].name, "all-hands");
        assert_eq!(channels[0].description, None);
        assert!(!channels[0].is_default);
        assert_eq!(channels[0].permission, "Open");

        let members = repos.channel_members("all").await.unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].channel_id, "all");
        assert_eq!(members[0].agent_id, "agent_coda");
        assert_eq!(members[0].readiness, "ready");

        sqlx::query("DELETE FROM agents WHERE id = ?")
            .bind("agent_coda")
            .execute(db.pool())
            .await
            .unwrap();
        assert!(repos.channel_members("all").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn migration_repairs_app_state_columns_before_later_migrations() {
        let (url, _path) = sqlite_file_url("migration-order-repair");
        let db = SleiDb::connect(&url).await.unwrap();

        db.migrate_for_test(&[
            (
                1,
                r#"
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    author_kind TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    content TEXT,
                    deleted INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    root_message_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'todo',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS thread_replies (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    author_message_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
                "#,
            ),
            (
                2,
                r#"
                CREATE TABLE later_migration_probe AS
                SELECT
                    messages.author_id AS message_author_id,
                    messages.as_task AS message_as_task,
                    messages.edited AS message_edited,
                    tasks.creator_id AS task_creator_id,
                    tasks.assignee_id AS task_assignee_id,
                    tasks.updated_at AS task_updated_at,
                    thread_replies.sender_id AS reply_sender_id,
                    thread_replies.role AS reply_role,
                    thread_replies.status AS reply_status
                FROM messages, tasks, thread_replies
                LIMIT 0;
                INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
                "#,
            ),
        ])
        .await
        .unwrap();

        assert!(db.table_exists("later_migration_probe").await.unwrap());
    }

    #[tokio::test]
    async fn migration_repairs_legacy_messages_before_session_index() {
        let (url, _path) = sqlite_file_url("legacy-message-session-index");
        let db = SleiDb::connect(&url).await.unwrap();

        sqlx::query(
            r#"
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                author_kind TEXT NOT NULL,
                kind TEXT NOT NULL,
                content TEXT,
                deleted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )
        .execute(db.pool())
        .await
        .unwrap();

        db.migrate().await.unwrap();

        sqlx::query("SELECT session_id FROM messages LIMIT 0")
            .fetch_all(db.pool())
            .await
            .unwrap();
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
