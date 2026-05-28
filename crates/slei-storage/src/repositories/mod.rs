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
                id: Uuid::parse_str(&id)
                    .map_err(|err| sqlx::Error::Decode(Box::new(err)))?,
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
        let result = sqlx::query(
            "INSERT INTO event_log(event_type, entity_id, payload) VALUES (?, ?, ?)",
        )
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
}
