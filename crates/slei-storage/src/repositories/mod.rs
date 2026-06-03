use sqlx::{Row, SqlitePool};
use uuid::Uuid;

#[derive(Debug, PartialEq, Eq)]
pub struct MessageRecord {
    pub id: Uuid,
    pub kind: String,
    pub content: Option<String>,
    pub deleted: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct EventRecord {
    pub sequence: i64,
    pub event_type: String,
    pub entity_id: Uuid,
    pub payload: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct TaskThreadSummary {
    pub task_id: Uuid,
    pub root_message_id: Uuid,
    pub reply_count: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CoordinatorDecisionRecord {
    pub id: Uuid,
    pub channel_id: String,
    pub message_id: String,
    pub intent: String,
    pub action: String,
    pub assignee_agent_id: Option<String>,
    pub reason: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AgentInboxEventRecord {
    pub id: Uuid,
    pub agent_id: String,
    pub event_type: String,
    pub delivery_state: String,
    pub payload: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ChannelCoordinatorRecord {
    pub channel_id: String,
    pub strategy: String,
    pub enabled: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RoutingContextPackageRecord {
    pub id: Uuid,
    pub decision_id: Uuid,
    pub source_message_id: String,
    pub payload: String,
    pub contains_deleted_body: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct MemoryUpdateEventRecord {
    pub id: Uuid,
    pub agent_id: String,
    pub event_type: String,
    pub source_message_id: Option<String>,
    pub document_path: Option<String>,
    pub document_section: Option<String>,
    pub status: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct BlockedMemorySectionRecord {
    pub agent_id: String,
    pub document_path: String,
    pub document_section: String,
    pub version_hash: Option<String>,
}

#[derive(Clone)]
pub struct Repositories {
    pool: SqlitePool,
}

impl Repositories {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert_human_message(
        &self,
        id: Uuid,
        channel_id: Uuid,
        content: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO messages(id, channel_id, author_kind, kind, content, deleted)
             VALUES (?, ?, 'human', 'text', ?, 0)",
        )
        .bind(id.to_string())
        .bind(channel_id.to_string())
        .bind(content)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_human_message_to_tombstone(&self, id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE messages
             SET kind = 'tombstone', content = NULL, deleted = 1
             WHERE id = ? AND author_kind = 'human'",
        )
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn message(&self, id: Uuid) -> Result<Option<MessageRecord>, sqlx::Error> {
        let row = sqlx::query("SELECT id, kind, content, deleted FROM messages WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;

        row.map(|row| {
            let id: String = row.try_get("id")?;
            let deleted: i64 = row.try_get("deleted")?;
            Ok(MessageRecord {
                id: Uuid::parse_str(&id).map_err(|err| sqlx::Error::Decode(Box::new(err)))?,
                kind: row.try_get("kind")?,
                content: row.try_get("content")?,
                deleted: deleted != 0,
            })
        })
        .transpose()
    }

    pub async fn upsert_runtime_session(
        &self,
        id: Uuid,
        agent_id: Uuid,
        runtime_kind: &str,
        channel_id: Option<Uuid>,
        token_ciphertext: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO runtime_sessions(id, agent_id, runtime_kind, channel_id, task_id, token_ciphertext)
             VALUES (?, ?, ?, ?, NULL, ?)
             ON CONFLICT(id) DO UPDATE SET token_ciphertext = excluded.token_ciphertext",
        )
        .bind(id.to_string())
        .bind(agent_id.to_string())
        .bind(runtime_kind)
        .bind(channel_id.map(|id| id.to_string()))
        .bind(token_ciphertext)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_task(
        &self,
        id: Uuid,
        channel_id: Uuid,
        root_message_id: Uuid,
        title: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO tasks(id, channel_id, root_message_id, title, status)
             VALUES (?, ?, ?, ?, 'todo')",
        )
        .bind(id.to_string())
        .bind(channel_id.to_string())
        .bind(root_message_id.to_string())
        .bind(title)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_thread_reply(
        &self,
        id: Uuid,
        task_id: Uuid,
        author_message_id: Uuid,
        content: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO thread_replies(id, task_id, author_message_id, content)
             VALUES (?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(task_id.to_string())
        .bind(author_message_id.to_string())
        .bind(content)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn append_event(
        &self,
        event_type: &str,
        entity_id: Uuid,
        payload: &str,
    ) -> Result<i64, sqlx::Error> {
        let result =
            sqlx::query("INSERT INTO event_log(event_type, entity_id, payload) VALUES (?, ?, ?)")
                .bind(event_type)
                .bind(entity_id.to_string())
                .bind(payload)
                .execute(&self.pool)
                .await?;
        Ok(result.last_insert_rowid())
    }

    pub async fn events_after_sequence(
        &self,
        sequence: i64,
    ) -> Result<Vec<EventRecord>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT sequence, event_type, entity_id, payload
             FROM event_log
             WHERE sequence > ?
             ORDER BY sequence ASC",
        )
        .bind(sequence)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let entity_id: String = row.try_get("entity_id")?;
                Ok(EventRecord {
                    sequence: row.try_get("sequence")?,
                    event_type: row.try_get("event_type")?,
                    entity_id: Uuid::parse_str(&entity_id)
                        .map_err(|err| sqlx::Error::Decode(Box::new(err)))?,
                    payload: row.try_get("payload")?,
                })
            })
            .collect()
    }

    pub async fn find_task_thread(
        &self,
        task_id: Uuid,
    ) -> Result<Option<TaskThreadSummary>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT tasks.id AS task_id,
                    tasks.root_message_id AS root_message_id,
                    COUNT(thread_replies.id) AS reply_count
             FROM tasks
             LEFT JOIN thread_replies ON thread_replies.task_id = tasks.id
             WHERE tasks.id = ?
             GROUP BY tasks.id, tasks.root_message_id",
        )
        .bind(task_id.to_string())
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            let task_id: String = row.try_get("task_id")?;
            let root_message_id: String = row.try_get("root_message_id")?;
            Ok(TaskThreadSummary {
                task_id: Uuid::parse_str(&task_id)
                    .map_err(|err| sqlx::Error::Decode(Box::new(err)))?,
                root_message_id: Uuid::parse_str(&root_message_id)
                    .map_err(|err| sqlx::Error::Decode(Box::new(err)))?,
                reply_count: row.try_get("reply_count")?,
            })
        })
        .transpose()
    }

    pub async fn insert_channel_coordinator(
        &self,
        channel_id: &str,
        strategy: &str,
        enabled: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO channel_coordinators(channel_id, strategy, enabled)
             VALUES (?, ?, ?)
             ON CONFLICT(channel_id) DO UPDATE SET
                strategy = excluded.strategy,
                enabled = excluded.enabled,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind(channel_id)
        .bind(strategy)
        .bind(if enabled { 1 } else { 0 })
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn channel_coordinator(
        &self,
        channel_id: &str,
    ) -> Result<Option<ChannelCoordinatorRecord>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT channel_id, strategy, enabled
             FROM channel_coordinators
             WHERE channel_id = ?",
        )
        .bind(channel_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            let channel_id: String = row.try_get("channel_id")?;
            let enabled: i64 = row.try_get("enabled")?;
            Ok(ChannelCoordinatorRecord {
                channel_id,
                strategy: row.try_get("strategy")?,
                enabled: enabled != 0,
            })
        })
        .transpose()
    }

    pub async fn insert_coordinator_decision(
        &self,
        id: Uuid,
        channel_id: &str,
        message_id: &str,
        intent: &str,
        action: &str,
        assignee_agent_id: Option<&str>,
        reason: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO coordinator_decisions(
                id, channel_id, message_id, intent, action, assignee_agent_id, reason
             )
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(channel_id)
        .bind(message_id)
        .bind(intent)
        .bind(action)
        .bind(assignee_agent_id)
        .bind(reason)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn coordinator_decisions_for_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<CoordinatorDecisionRecord>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, channel_id, message_id, intent, action, assignee_agent_id, reason
             FROM coordinator_decisions
             WHERE message_id = ?
             ORDER BY sequence ASC",
        )
        .bind(message_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let id: String = row.try_get("id")?;
                let channel_id: String = row.try_get("channel_id")?;
                let message_id: String = row.try_get("message_id")?;
                Ok(CoordinatorDecisionRecord {
                    id: parse_uuid(&id)?,
                    channel_id,
                    message_id,
                    intent: row.try_get("intent")?,
                    action: row.try_get("action")?,
                    assignee_agent_id: row.try_get("assignee_agent_id")?,
                    reason: row.try_get("reason")?,
                })
            })
            .collect()
    }

    pub async fn coordinator_decision_count(&self) -> Result<u64, sqlx::Error> {
        self.count_rows("coordinator_decisions").await
    }

    pub async fn insert_agent_inbox_event(
        &self,
        id: Uuid,
        agent_id: &str,
        event_type: &str,
        delivery_state: &str,
        payload: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO agent_inbox_events(id, agent_id, event_type, delivery_state, payload)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(agent_id)
        .bind(event_type)
        .bind(delivery_state)
        .bind(payload)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn agent_inbox_events(
        &self,
        agent_id: &str,
    ) -> Result<Vec<AgentInboxEventRecord>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, agent_id, event_type, delivery_state, payload
             FROM agent_inbox_events
             WHERE agent_id = ?
             ORDER BY sequence ASC",
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let id: String = row.try_get("id")?;
                Ok(AgentInboxEventRecord {
                    id: parse_uuid(&id)?,
                    agent_id: row.try_get("agent_id")?,
                    event_type: row.try_get("event_type")?,
                    delivery_state: row.try_get("delivery_state")?,
                    payload: row.try_get("payload")?,
                })
            })
            .collect()
    }

    pub async fn agent_inbox_event_count(&self) -> Result<u64, sqlx::Error> {
        self.count_rows("agent_inbox_events").await
    }

    pub async fn insert_memory_update_event(
        &self,
        id: Uuid,
        agent_id: &str,
        event_type: &str,
        source_message_id: Option<&str>,
        document_path: Option<&str>,
        document_section: Option<&str>,
        status: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO memory_update_events(
                id, agent_id, event_type, source_message_id, document_path, document_section, status
             )
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(agent_id)
        .bind(event_type)
        .bind(source_message_id)
        .bind(document_path)
        .bind(document_section)
        .bind(status)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn memory_update_events_for_agent(
        &self,
        agent_id: &str,
    ) -> Result<Vec<MemoryUpdateEventRecord>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, agent_id, event_type, source_message_id, document_path, document_section, status
             FROM memory_update_events
             WHERE agent_id = ?
             ORDER BY sequence ASC",
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let id: String = row.try_get("id")?;
                Ok(MemoryUpdateEventRecord {
                    id: parse_uuid(&id)?,
                    agent_id: row.try_get("agent_id")?,
                    event_type: row.try_get("event_type")?,
                    source_message_id: row.try_get("source_message_id")?,
                    document_path: row.try_get("document_path")?,
                    document_section: row.try_get("document_section")?,
                    status: row.try_get("status")?,
                })
            })
            .collect()
    }

    pub async fn memory_update_event_count(&self) -> Result<u64, sqlx::Error> {
        self.count_rows("memory_update_events").await
    }

    pub async fn upsert_memory_document_state(
        &self,
        agent_id: &str,
        document_path: &str,
        document_section: &str,
        version_hash: Option<&str>,
        blocked: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO memory_document_states(
                agent_id, document_path, document_section, version_hash, blocked
             )
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(agent_id, document_path, document_section) DO UPDATE SET
                version_hash = excluded.version_hash,
                blocked = excluded.blocked,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind(agent_id)
        .bind(document_path)
        .bind(document_section)
        .bind(version_hash)
        .bind(if blocked { 1 } else { 0 })
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn blocked_memory_sections(
        &self,
        agent_id: &str,
    ) -> Result<Vec<BlockedMemorySectionRecord>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT agent_id, document_path, document_section, version_hash
             FROM memory_document_states
             WHERE agent_id = ? AND blocked = 1
             ORDER BY document_path ASC, document_section ASC",
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(BlockedMemorySectionRecord {
                    agent_id: row.try_get("agent_id")?,
                    document_path: row.try_get("document_path")?,
                    document_section: row.try_get("document_section")?,
                    version_hash: row.try_get("version_hash")?,
                })
            })
            .collect()
    }

    pub async fn insert_routing_context_package(
        &self,
        id: Uuid,
        decision_id: Uuid,
        source_message_id: &str,
        payload: &str,
        contains_deleted_body: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO routing_context_packages(
                id, decision_id, source_message_id, payload, contains_deleted_body
             )
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(decision_id.to_string())
        .bind(source_message_id)
        .bind(payload)
        .bind(if contains_deleted_body { 1 } else { 0 })
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn routing_context_packages_for_decision(
        &self,
        decision_id: Uuid,
    ) -> Result<Vec<RoutingContextPackageRecord>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, decision_id, source_message_id, payload, contains_deleted_body
             FROM routing_context_packages
             WHERE decision_id = ?
             ORDER BY sequence ASC",
        )
        .bind(decision_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let id: String = row.try_get("id")?;
                let decision_id: String = row.try_get("decision_id")?;
                let source_message_id: String = row.try_get("source_message_id")?;
                let contains_deleted_body: i64 = row.try_get("contains_deleted_body")?;
                Ok(RoutingContextPackageRecord {
                    id: parse_uuid(&id)?,
                    decision_id: parse_uuid(&decision_id)?,
                    source_message_id,
                    payload: row.try_get("payload")?,
                    contains_deleted_body: contains_deleted_body != 0,
                })
            })
            .collect()
    }

    pub async fn mark_context_packages_deleted(
        &self,
        source_message_id: &str,
    ) -> Result<(), sqlx::Error> {
        let tombstone_payload = format!(
            r#"{{"sourceMessageId":"{}","bodyRemoved":true}}"#,
            escape_json_string(source_message_id)
        );
        sqlx::query(
            "UPDATE routing_context_packages
             SET payload = ?, contains_deleted_body = 1
             WHERE source_message_id = ?",
        )
        .bind(tombstone_payload)
        .bind(source_message_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn count_rows(&self, table: &str) -> Result<u64, sqlx::Error> {
        let query = format!("SELECT COUNT(*) AS count FROM {table}");
        let row = sqlx::query(&query).fetch_one(&self.pool).await?;
        let count: i64 = row.try_get("count")?;
        Ok(count.max(0) as u64)
    }
}

fn parse_uuid(value: &str) -> Result<Uuid, sqlx::Error> {
    Uuid::parse_str(value).map_err(|err| sqlx::Error::Decode(Box::new(err)))
}

fn escape_json_string(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                escaped.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => escaped.push(character),
        }
    }
    escaped
}
