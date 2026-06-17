use sqlx::{Row, Sqlite, SqlitePool};
use uuid::Uuid;

pub const RESET_MUTABLE_TABLES: &[&str] = &[
    "agent_activity_logs",
    "agent_statuses",
    "task_claims",
    "message_claims",
    "message_deliveries",
    "routing_context_packages",
    "memory_document_states",
    "memory_update_events",
    "agent_inbox_events",
    "coordinator_runtime_runs",
    "coordinator_decisions",
    "channel_coordinators",
    "idempotent_mutations",
    "event_log",
    "runtime_sessions",
    "thread_replies",
    "tasks",
    "messages",
    "channel_sessions",
    "saved_messages",
    "conversation_messages",
    "conversation_attachments",
    "conversation_sessions",
    "conversations",
    "interactive_cards",
    "channel_workspace_mounts",
    "channel_members",
    "channels",
    "agents",
    "user_preferences",
    "nodes",
    "app_metadata",
];

pub const RESET_MUTABLE_SEQUENCE_TABLES: &[&str] = &[
    "message_deliveries",
    "message_claims",
    "task_claims",
    "agent_activity_logs",
    "event_log",
    "coordinator_decisions",
    "agent_inbox_events",
    "memory_update_events",
    "routing_context_packages",
];

const AGENT_ACTIVITY_RETENTION_LIMIT: i64 = 200;
const MAX_ACTIVITY_PAYLOAD_PREVIEW_CHARS: usize = 2048;
const ACTIVITY_PAYLOAD_TRUNCATED_SUFFIX: &str = " [truncated]";
const SENSITIVE_ACTIVITY_MARKERS: &[&str] = &[
    "authorization",
    "bearer",
    "token",
    "api_key",
    "apikey",
    "secret",
    "password",
    "private_key",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRow {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub agent_kind: String,
    pub system_owned: bool,
    pub runtime_kind: String,
    pub model: String,
    pub node_id: String,
    pub description: String,
    pub workspace_path: String,
    pub memory_path: String,
    pub docs_path: String,
    pub avatar_seed: String,
    pub runtime_status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentUpdateRow {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub agent_kind: String,
    pub system_owned: bool,
    pub runtime_kind: String,
    pub model: String,
    pub node_id: String,
    pub description: String,
    pub workspace_path: String,
    pub memory_path: String,
    pub docs_path: String,
    pub avatar_seed: String,
    pub runtime_status: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InteractiveCardRow {
    pub id: String,
    pub run_id: String,
    pub agent_id: String,
    pub conversation_id: Option<String>,
    pub message_id: Option<String>,
    pub action_payload: String,
    pub template_payload: Option<String>,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationRow {
    pub id: String,
    pub kind: String,
    pub agent_id: String,
    pub active_session_id: Option<String>,
    pub runtime_status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationSessionRow {
    pub id: String,
    pub conversation_id: String,
    pub title: String,
    pub status: String,
    pub runtime_session_payload: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationMessageRow {
    pub id: String,
    pub conversation_id: String,
    pub session_id: Option<String>,
    pub author_id: String,
    pub body: String,
    pub status: Option<String>,
    pub run_id: Option<String>,
    pub attachment_ids: String,
    pub cards_payload: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationAttachmentRow {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub url: Option<String>,
    pub cache_path: Option<String>,
    pub bytes_base64: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedMessageRow {
    pub id: String,
    pub message_id: String,
    pub source_id: String,
    pub source_kind: String,
    pub session_id: Option<String>,
    pub saved_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserPreferencesRow {
    pub locale: String,
    pub time_zone: String,
    pub theme: String,
    pub font_size: String,
    pub notify_mentions: bool,
    pub notify_human_replies: bool,
    pub notify_approvals: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeRow {
    pub id: String,
    pub name: String,
    pub platform: Option<String>,
    pub arch: Option<String>,
    pub hostname: Option<String>,
    pub status: String,
    pub daemon_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub permission: String,
    pub active_session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelSessionRow {
    pub id: String,
    pub channel_id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelMemberRow {
    pub channel_id: String,
    pub agent_id: String,
    pub joined_at: String,
    pub readiness: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceMountRow {
    pub channel_id: String,
    pub path: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewChannelMessageRow {
    pub id: String,
    pub channel_id: String,
    pub session_id: Option<String>,
    pub author_id: String,
    pub body: Option<String>,
    pub as_task: bool,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelMessageRow {
    pub id: String,
    pub sequence: Option<i64>,
    pub channel_id: String,
    pub session_id: Option<String>,
    pub author_id: String,
    pub body: Option<String>,
    pub as_task: bool,
    pub kind: String,
    pub deleted: bool,
    pub edited: bool,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimAttemptRecord {
    pub claimed: bool,
    pub agent_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessageDeliveryRow {
    pub sequence: i64,
    pub id: String,
    pub message_id: String,
    pub channel_id: String,
    pub agent_id: String,
    pub delivery_state: String,
    pub run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentStatusRow {
    pub agent_id: String,
    pub state: String,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentActivityLogRow {
    pub id: String,
    pub agent_id: String,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
    pub state: String,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub event_kind: String,
    pub severity: String,
    pub summary: String,
    pub payload_preview: Option<String>,
    pub tool_name: Option<String>,
    pub ok: Option<bool>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewAgentActivityEventRow {
    pub agent_id: String,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
    pub event_kind: String,
    pub severity: String,
    pub summary: String,
    pub payload_preview: Option<String>,
    pub tool_name: Option<String>,
    pub ok: Option<bool>,
    /// Optional semantic status. For non-status events this can be None;
    /// repository insertion must store event_kind into the legacy NOT NULL
    /// state column so older schema assumptions keep working.
    pub state: Option<String>,
    pub phase: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessageReadQueryRow {
    pub channel_id: String,
    pub limit: Option<i64>,
    pub after_sequence: Option<i64>,
    pub before_sequence: Option<i64>,
    pub around_message_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskRootRow {
    pub id: String,
    pub channel_id: String,
    pub creator_id: String,
    pub assignee_id: Option<String>,
    pub source_message_id: Option<String>,
    pub assignment_reason: Option<String>,
    pub needs_assignment: bool,
    pub title: String,
    pub status: String,
    pub attention_required: bool,
    pub root_deleted: bool,
    pub root_body: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TaskQueryRow {
    pub channel_id: Option<String>,
    pub creator_id: Option<String>,
    pub assignee_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskReplyRow {
    pub id: String,
    pub task_id: String,
    pub sender_id: String,
    pub role: Option<String>,
    pub body: String,
    pub status: Option<String>,
    pub created_at: String,
}

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
    pub created_at: String,
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
    pub assignee_agent_ids: Vec<String>,
    pub reason: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CoordinatorRuntimeRunRecord {
    pub run_id: String,
    pub channel_id: String,
    pub message_id: String,
    pub idempotency_key: String,
    pub prompt: String,
    pub output: String,
    pub status: String,
    pub error: Option<String>,
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

impl std::fmt::Debug for Repositories {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("Repositories").finish()
    }
}

impl Repositories {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn idempotent_response(&self, key: &str) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar::<_, String>(
            "SELECT response_payload
             FROM idempotent_mutations
             WHERE idempotency_key = ?",
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn record_idempotent_response(
        &self,
        key: &str,
        entity_id: &str,
        response_payload: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO idempotent_mutations(idempotency_key, entity_id, response_payload)
             VALUES (?, ?, ?)",
        )
        .bind(key)
        .bind(entity_id)
        .bind(response_payload)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn reset_mutable_state(&self) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("PRAGMA defer_foreign_keys = ON")
            .execute(&mut *tx)
            .await?;

        for table in RESET_MUTABLE_TABLES {
            let sql = format!("DELETE FROM {table}");
            sqlx::query(&sql).execute(&mut *tx).await?;
        }
        for table in RESET_MUTABLE_SEQUENCE_TABLES {
            sqlx::query("DELETE FROM sqlite_sequence WHERE name = ?")
                .bind(table)
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn upsert_agent(
        &self,
        id: &str,
        name: &str,
        handle: &str,
        agent_kind: &str,
        system_owned: bool,
        runtime_kind: &str,
        model: &str,
        node_id: &str,
        description: &str,
        avatar_seed: &str,
    ) -> Result<(), sqlx::Error> {
        let workspace_path = format!("agents/{id}");
        let memory_path = format!("{workspace_path}/MEMORY.md");
        let docs_path = format!("{workspace_path}/docs");
        sqlx::query(
            "INSERT INTO agents(
                id, name, handle, agent_kind, system_owned, runtime_kind, model, node_id,
                description, workspace_path, memory_path, docs_path, avatar_seed, runtime_status
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                handle = excluded.handle,
                agent_kind = excluded.agent_kind,
                system_owned = excluded.system_owned,
                runtime_kind = excluded.runtime_kind,
                model = excluded.model,
                node_id = excluded.node_id,
                description = excluded.description,
                workspace_path = excluded.workspace_path,
                memory_path = excluded.memory_path,
                docs_path = excluded.docs_path,
                avatar_seed = excluded.avatar_seed,
                runtime_status = excluded.runtime_status,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind(id)
        .bind(name)
        .bind(handle)
        .bind(agent_kind)
        .bind(if system_owned { 1 } else { 0 })
        .bind(runtime_kind)
        .bind(model)
        .bind(node_id)
        .bind(description)
        .bind(workspace_path)
        .bind(memory_path)
        .bind(docs_path)
        .bind(avatar_seed)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn agents(&self) -> Result<Vec<AgentRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, name, handle, agent_kind, system_owned, runtime_kind, model, node_id,
                    description, workspace_path, memory_path, docs_path, avatar_seed,
                    runtime_status, created_at, updated_at
             FROM agents
             ORDER BY created_at ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| agent_row_from_sql(row))
            .collect()
    }

    pub async fn agent_by_id(&self, id: &str) -> Result<Option<AgentRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, name, handle, agent_kind, system_owned, runtime_kind, model, node_id,
                    description, workspace_path, memory_path, docs_path, avatar_seed,
                    runtime_status, created_at, updated_at
             FROM agents
             WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(agent_row_from_sql).transpose()
    }

    pub async fn agent_by_handle(&self, handle: &str) -> Result<Option<AgentRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, name, handle, agent_kind, system_owned, runtime_kind, model, node_id,
                    description, workspace_path, memory_path, docs_path, avatar_seed,
                    runtime_status, created_at, updated_at
             FROM agents
             WHERE lower(handle) = lower(?)",
        )
        .bind(handle)
        .fetch_optional(&self.pool)
        .await?;

        row.map(agent_row_from_sql).transpose()
    }

    pub async fn delete_agent(&self, id: &str) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM channel_members WHERE agent_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM agents WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn update_agent(&self, row: AgentUpdateRow) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE agents
             SET name = ?,
                 handle = ?,
                 agent_kind = ?,
                 system_owned = ?,
                 runtime_kind = ?,
                 model = ?,
                 node_id = ?,
                 description = ?,
                 workspace_path = ?,
                 memory_path = ?,
                 docs_path = ?,
                 avatar_seed = ?,
                 runtime_status = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?",
        )
        .bind(row.name)
        .bind(row.handle)
        .bind(row.agent_kind)
        .bind(if row.system_owned { 1 } else { 0 })
        .bind(row.runtime_kind)
        .bind(row.model)
        .bind(row.node_id)
        .bind(row.description)
        .bind(row.workspace_path)
        .bind(row.memory_path)
        .bind(row.docs_path)
        .bind(row.avatar_seed)
        .bind(row.runtime_status)
        .bind(row.id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn upsert_channel(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        is_default: bool,
        permission: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO channels(id, name, description, is_default, permission)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                is_default = excluded.is_default,
                permission = excluded.permission,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(if is_default { 1 } else { 0 })
        .bind(permission)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_channel_active_session(
        &self,
        channel_id: &str,
        session_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE channels
             SET active_session_id = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?",
        )
        .bind(session_id)
        .bind(channel_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn upsert_channel_idempotent(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        is_default: bool,
        permission: &str,
        idempotency_key: &str,
        response_payload: &str,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO channels(id, name, description, is_default, permission)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                is_default = excluded.is_default,
                permission = excluded.permission,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(if is_default { 1 } else { 0 })
        .bind(permission)
        .execute(&mut *tx)
        .await?;
        record_idempotent_response_tx(&mut tx, idempotency_key, id, response_payload).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn delete_channel(&self, channel_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM channels WHERE id = ?")
            .bind(channel_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn channels(&self) -> Result<Vec<ChannelRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, name, description, is_default, permission, active_session_id
             FROM channels
             ORDER BY created_at ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let is_default: i64 = row.try_get("is_default")?;
                Ok(ChannelRow {
                    id: row.try_get("id")?,
                    name: row.try_get("name")?,
                    description: row.try_get("description")?,
                    is_default: is_default != 0,
                    permission: row.try_get("permission")?,
                    active_session_id: row.try_get("active_session_id")?,
                })
            })
            .collect()
    }

    pub async fn upsert_channel_session(&self, row: ChannelSessionRow) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO channel_sessions(id, channel_id, title, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                channel_id = excluded.channel_id,
                title = excluded.title,
                status = excluded.status,
                updated_at = excluded.updated_at",
        )
        .bind(row.id)
        .bind(row.channel_id)
        .bind(row.title)
        .bind(row.status)
        .bind(row.created_at)
        .bind(row.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn channel_sessions(
        &self,
        channel_id: &str,
    ) -> Result<Vec<ChannelSessionRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, channel_id, title, status, created_at, updated_at
             FROM channel_sessions
             WHERE channel_id = ?
             ORDER BY updated_at DESC, id ASC",
        )
        .bind(channel_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(channel_session_row_from_sql).collect()
    }

    pub async fn channel_session(
        &self,
        channel_id: &str,
        session_id: &str,
    ) -> Result<Option<ChannelSessionRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, channel_id, title, status, created_at, updated_at
             FROM channel_sessions
             WHERE channel_id = ? AND id = ?",
        )
        .bind(channel_id)
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(channel_session_row_from_sql).transpose()
    }

    pub async fn upsert_channel_member(
        &self,
        channel_id: &str,
        agent_id: &str,
        readiness: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO channel_members(channel_id, agent_id, readiness)
             VALUES (?, ?, ?)
             ON CONFLICT(channel_id, agent_id) DO UPDATE SET
                readiness = excluded.readiness",
        )
        .bind(channel_id)
        .bind(agent_id)
        .bind(readiness)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_channel_member_if_absent(
        &self,
        channel_id: &str,
        agent_id: &str,
        readiness: &str,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO channel_members(channel_id, agent_id, readiness)
             VALUES (?, ?, ?)
             ON CONFLICT(channel_id, agent_id) DO NOTHING",
        )
        .bind(channel_id)
        .bind(agent_id)
        .bind(readiness)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn channel_members(
        &self,
        channel_id: &str,
    ) -> Result<Vec<ChannelMemberRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT channel_id, agent_id, joined_at, readiness
             FROM channel_members
             WHERE channel_id = ?
             ORDER BY joined_at ASC, agent_id ASC",
        )
        .bind(channel_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(ChannelMemberRow {
                    channel_id: row.try_get("channel_id")?,
                    agent_id: row.try_get("agent_id")?,
                    joined_at: row.try_get("joined_at")?,
                    readiness: row.try_get("readiness")?,
                })
            })
            .collect()
    }

    pub async fn update_channel_member_readiness(
        &self,
        channel_id: &str,
        agent_id: &str,
        readiness: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE channel_members
             SET readiness = ?
             WHERE channel_id = ? AND agent_id = ?",
        )
        .bind(readiness)
        .bind(channel_id)
        .bind(agent_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn remove_channel_member(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<Option<ChannelMemberRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT channel_id, agent_id, joined_at, readiness
             FROM channel_members
             WHERE channel_id = ? AND agent_id = ?",
        )
        .bind(channel_id)
        .bind(agent_id)
        .fetch_optional(&self.pool)
        .await?;

        let member = row
            .map(|row| {
                Ok::<ChannelMemberRow, sqlx::Error>(ChannelMemberRow {
                    channel_id: row.try_get("channel_id")?,
                    agent_id: row.try_get("agent_id")?,
                    joined_at: row.try_get("joined_at")?,
                    readiness: row.try_get("readiness")?,
                })
            })
            .transpose()?;

        if member.is_some() {
            sqlx::query("DELETE FROM channel_members WHERE channel_id = ? AND agent_id = ?")
                .bind(channel_id)
                .bind(agent_id)
                .execute(&self.pool)
                .await?;
        }

        Ok(member)
    }

    pub async fn remove_agent_from_channel_memberships(
        &self,
        agent_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM channel_members WHERE agent_id = ?")
            .bind(agent_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn upsert_channel_workspace_mount(
        &self,
        channel_id: &str,
        path: &str,
        label: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO channel_workspace_mounts(channel_id, path, label)
             VALUES (?, ?, ?)
             ON CONFLICT(channel_id, path) DO UPDATE SET
                label = excluded.label",
        )
        .bind(channel_id)
        .bind(path)
        .bind(label)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn upsert_channel_workspace_mount_idempotent(
        &self,
        channel_id: &str,
        path: &str,
        label: &str,
        idempotency_key: &str,
        response_payload: &str,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO channel_workspace_mounts(channel_id, path, label)
             VALUES (?, ?, ?)
             ON CONFLICT(channel_id, path) DO UPDATE SET
                label = excluded.label",
        )
        .bind(channel_id)
        .bind(path)
        .bind(label)
        .execute(&mut *tx)
        .await?;
        record_idempotent_response_tx(
            &mut tx,
            idempotency_key,
            &format!("{channel_id}:{path}"),
            response_payload,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn channel_workspace_mounts(
        &self,
        channel_id: &str,
    ) -> Result<Vec<WorkspaceMountRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT channel_id, path, label
             FROM channel_workspace_mounts
             WHERE channel_id = ?
             ORDER BY created_at ASC, path ASC",
        )
        .bind(channel_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(WorkspaceMountRow {
                    channel_id: row.try_get("channel_id")?,
                    path: row.try_get("path")?,
                    label: row.try_get("label")?,
                })
            })
            .collect()
    }

    pub async fn insert_channel_message(
        &self,
        row: NewChannelMessageRow,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO messages(id, channel_id, session_id, author_kind, kind, content, deleted, author_id, as_task, edited)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0)",
        )
        .bind(row.id)
        .bind(row.channel_id)
        .bind(row.session_id)
        .bind(row.kind.clone())
        .bind(row.kind)
        .bind(row.body)
        .bind(row.author_id)
        .bind(if row.as_task { 1 } else { 0 })
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_channel_message_idempotent(
        &self,
        row: NewChannelMessageRow,
        idempotency_key: &str,
        response_payload: &str,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO messages(id, channel_id, session_id, author_kind, kind, content, deleted, author_id, as_task, edited)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0)",
        )
        .bind(&row.id)
        .bind(&row.channel_id)
        .bind(&row.session_id)
        .bind(row.kind.clone())
        .bind(&row.kind)
        .bind(&row.body)
        .bind(&row.author_id)
        .bind(if row.as_task { 1 } else { 0 })
        .execute(&mut *tx)
        .await?;
        record_idempotent_response_tx(&mut tx, idempotency_key, &row.id, response_payload).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn channel_messages_by_channel(
        &self,
        channel_id: &str,
    ) -> Result<Vec<ChannelMessageRow>, sqlx::Error> {
        self.channel_messages_by_channel_and_session(channel_id, None)
            .await
    }

    pub async fn channel_messages_by_channel_and_session(
        &self,
        channel_id: &str,
        session_id: Option<&str>,
    ) -> Result<Vec<ChannelMessageRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, channel_id, session_id, author_id, content, as_task, kind, deleted, edited, created_at
             FROM messages
             WHERE channel_id = ?
               AND (? IS NULL OR session_id = ?)
               AND kind NOT IN ('task_root', 'task_reply')
             ORDER BY rowid ASC",
        )
        .bind(channel_id)
        .bind(session_id)
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(channel_message_row_from_sql).collect()
    }

    pub async fn channel_message(
        &self,
        message_id: &str,
    ) -> Result<Option<ChannelMessageRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, channel_id, session_id, author_id, content, as_task, kind, deleted, edited, created_at
             FROM messages
             WHERE id = ?",
        )
        .bind(message_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(channel_message_row_from_sql).transpose()
    }

    pub async fn read_channel_messages(
        &self,
        query: MessageReadQueryRow,
    ) -> Result<Vec<ChannelMessageRow>, sqlx::Error> {
        let limit = normalize_repository_limit(query.limit);

        let rows = if let Some(around_message_id) = query.around_message_id.as_deref() {
            let center = sqlx::query_scalar::<_, i64>(
                "SELECT rowid
                 FROM messages
                 WHERE id = ? AND channel_id = ? AND deleted = 0",
            )
            .bind(around_message_id)
            .bind(&query.channel_id)
            .fetch_optional(&self.pool)
            .await?;

            match center {
                Some(center) => {
                    sqlx::query(
                        "SELECT rowid AS sequence, id, channel_id, session_id, author_id, content, as_task, kind, deleted, edited, created_at
                         FROM messages
                         WHERE rowid IN (
                            SELECT rowid
                            FROM messages
                            WHERE channel_id = ?
                              AND deleted = 0
                              AND kind NOT IN ('task_root', 'task_reply')
                            ORDER BY ABS(rowid - ?) ASC, rowid ASC
                            LIMIT ?
                         )
                         ORDER BY rowid ASC",
                    )
                    .bind(&query.channel_id)
                    .bind(center)
                    .bind(limit)
                    .fetch_all(&self.pool)
                    .await?
                }
                None => Vec::new(),
            }
        } else if query.before_sequence.is_some() && query.after_sequence.is_none() {
            sqlx::query(
                "SELECT sequence, id, channel_id, session_id, author_id, content, as_task, kind, deleted, edited, created_at
                 FROM (
                    SELECT rowid AS sequence, id, channel_id, session_id, author_id, content, as_task, kind, deleted, edited, created_at
                    FROM messages
                    WHERE channel_id = ?
                      AND rowid < ?
                      AND deleted = 0
                      AND kind NOT IN ('task_root', 'task_reply')
                    ORDER BY rowid DESC
                    LIMIT ?
                 )
                 ORDER BY sequence ASC",
            )
            .bind(&query.channel_id)
            .bind(query.before_sequence.unwrap_or_default())
            .bind(limit)
            .fetch_all(&self.pool)
            .await?
        } else if query.after_sequence.is_some() {
            sqlx::query(
                "SELECT rowid AS sequence, id, channel_id, session_id, author_id, content, as_task, kind, deleted, edited, created_at
                 FROM messages
                 WHERE channel_id = ?
                   AND rowid > ?
                   AND (? IS NULL OR rowid < ?)
                   AND deleted = 0
                   AND kind NOT IN ('task_root', 'task_reply')
                 ORDER BY rowid ASC
                 LIMIT ?",
            )
            .bind(&query.channel_id)
            .bind(query.after_sequence.unwrap_or_default())
            .bind(query.before_sequence)
            .bind(query.before_sequence)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                "SELECT sequence, id, channel_id, session_id, author_id, content, as_task, kind, deleted, edited, created_at
                 FROM (
                    SELECT rowid AS sequence, id, channel_id, session_id, author_id, content, as_task, kind, deleted, edited, created_at
                    FROM messages
                    WHERE channel_id = ?
                      AND deleted = 0
                      AND kind NOT IN ('task_root', 'task_reply')
                    ORDER BY rowid DESC
                    LIMIT ?
                 )
                 ORDER BY sequence ASC",
            )
            .bind(&query.channel_id)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?
        };

        rows.into_iter().map(channel_message_row_from_sql).collect()
    }

    pub async fn search_channel_messages(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<ChannelMessageRow>, sqlx::Error> {
        let limit = normalize_repository_limit(Some(limit));
        let pattern = format!("%{}%", escape_like_pattern(query));
        let rows = sqlx::query(
            "SELECT rowid AS sequence, id, channel_id, session_id, author_id, content, as_task, kind, deleted, edited, created_at
             FROM messages
             WHERE content LIKE ? ESCAPE '\\'
               AND deleted = 0
               AND kind NOT IN ('task_root', 'task_reply')
             ORDER BY rowid DESC
             LIMIT ?",
        )
        .bind(pattern)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(channel_message_row_from_sql).collect()
    }

    pub async fn update_message_tombstone(&self, message_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE messages
             SET kind = 'tombstone', author_kind = 'tombstone', content = NULL, deleted = 1
             WHERE id = ?",
        )
        .bind(message_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_human_message_body(
        &self,
        message_id: &str,
        body: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE messages
             SET content = ?, edited = 1
             WHERE id = ? AND kind = 'human'",
        )
        .bind(body)
        .bind(message_id)
        .execute(&self.pool)
        .await?;
        Ok(())
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

    pub async fn try_claim_message(
        &self,
        message_id: &str,
        claim_scope: &str,
        agent_id: &str,
    ) -> Result<ClaimAttemptRecord, sqlx::Error> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO message_claims(id, message_id, claim_scope, agent_id, status)
             VALUES (?, ?, ?, ?, 'claimed')",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(message_id)
        .bind(claim_scope)
        .bind(agent_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 1 {
            return Ok(ClaimAttemptRecord {
                claimed: true,
                agent_id: Some(agent_id.to_string()),
            });
        }

        let holder = sqlx::query_scalar::<_, String>(
            "SELECT agent_id
             FROM message_claims
             WHERE message_id = ? AND claim_scope = ?
             LIMIT 1",
        )
        .bind(message_id)
        .bind(claim_scope)
        .fetch_optional(&self.pool)
        .await?;

        Ok(ClaimAttemptRecord {
            claimed: holder.as_deref() == Some(agent_id),
            agent_id: holder,
        })
    }

    pub async fn try_claim_task(
        &self,
        task_id: &str,
        agent_id: &str,
    ) -> Result<ClaimAttemptRecord, sqlx::Error> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO task_claims(id, task_id, agent_id, status)
             VALUES (?, ?, ?, 'claimed')",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(task_id)
        .bind(agent_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 1 {
            return Ok(ClaimAttemptRecord {
                claimed: true,
                agent_id: Some(agent_id.to_string()),
            });
        }

        let holder = sqlx::query_scalar::<_, String>(
            "SELECT agent_id
             FROM task_claims
             WHERE task_id = ?
             LIMIT 1",
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(ClaimAttemptRecord {
            claimed: holder.as_deref() == Some(agent_id),
            agent_id: holder,
        })
    }

    pub async fn create_message_delivery(
        &self,
        message_id: &str,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT OR IGNORE INTO message_deliveries(
                id, message_id, channel_id, agent_id, delivery_state
             )
             VALUES (?, ?, ?, ?, 'pending')",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(message_id)
        .bind(channel_id)
        .bind(agent_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn pending_message_deliveries(
        &self,
        agent_id: &str,
        limit: i64,
    ) -> Result<Vec<MessageDeliveryRow>, sqlx::Error> {
        let limit = normalize_repository_limit(Some(limit));
        let rows = sqlx::query(
            "SELECT sequence, id, message_id, channel_id, agent_id, delivery_state, run_id, created_at, updated_at
             FROM message_deliveries
             WHERE agent_id = ? AND delivery_state = 'pending'
             ORDER BY sequence ASC
             LIMIT ?",
        )
        .bind(agent_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(message_delivery_row_from_sql)
            .collect()
    }

    pub async fn message_deliveries_for_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<MessageDeliveryRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT sequence, id, message_id, channel_id, agent_id, delivery_state, run_id, created_at, updated_at
             FROM message_deliveries
             WHERE message_id = ?
             ORDER BY sequence ASC",
        )
        .bind(message_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(message_delivery_row_from_sql)
            .collect()
    }

    pub async fn mark_message_delivery_running(
        &self,
        message_id: &str,
        agent_id: &str,
        run_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE message_deliveries
             SET delivery_state = 'running',
                 run_id = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE message_id = ? AND agent_id = ? AND delivery_state = 'pending'",
        )
        .bind(run_id)
        .bind(message_id)
        .bind(agent_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn mark_message_delivery_pending_for_run(
        &self,
        message_id: &str,
        agent_id: &str,
        run_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE message_deliveries
             SET delivery_state = 'pending',
                 run_id = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE message_id = ? AND agent_id = ? AND run_id = ? AND delivery_state = 'running'",
        )
        .bind(message_id)
        .bind(agent_id)
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn mark_message_delivery_completed_for_run(
        &self,
        message_id: &str,
        agent_id: &str,
        run_id: &str,
    ) -> Result<bool, sqlx::Error> {
        self.mark_message_delivery_terminal_for_run(message_id, agent_id, run_id, "completed")
            .await
    }

    pub async fn mark_message_delivery_failed_for_run(
        &self,
        message_id: &str,
        agent_id: &str,
        run_id: &str,
    ) -> Result<bool, sqlx::Error> {
        self.mark_message_delivery_terminal_for_run(message_id, agent_id, run_id, "failed")
            .await
    }

    async fn mark_message_delivery_terminal_for_run(
        &self,
        message_id: &str,
        agent_id: &str,
        run_id: &str,
        delivery_state: &str,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE message_deliveries
             SET delivery_state = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE message_id = ? AND agent_id = ? AND run_id = ? AND delivery_state = 'running'",
        )
        .bind(delivery_state)
        .bind(message_id)
        .bind(agent_id)
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn upsert_agent_status(&self, row: AgentStatusRow) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO agent_statuses(
                agent_id, state, phase, reason, run_id, channel_id, message_id, task_id, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
             ON CONFLICT(agent_id) DO UPDATE SET
                state = excluded.state,
                phase = excluded.phase,
                reason = excluded.reason,
                run_id = excluded.run_id,
                channel_id = excluded.channel_id,
                message_id = excluded.message_id,
                task_id = excluded.task_id,
                updated_at = excluded.updated_at",
        )
        .bind(row.agent_id)
        .bind(row.state)
        .bind(row.phase)
        .bind(row.reason)
        .bind(row.run_id)
        .bind(row.channel_id)
        .bind(row.message_id)
        .bind(row.task_id)
        .bind(row.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn record_agent_activity(
        &self,
        agent_id: &str,
        run_id: Option<&str>,
        channel_id: Option<&str>,
        message_id: Option<&str>,
        task_id: Option<&str>,
        state: &str,
        phase: Option<&str>,
        reason: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        insert_agent_activity_event_tx(
            &mut tx,
            NewAgentActivityEventRow {
                agent_id: agent_id.to_string(),
                run_id: run_id.map(str::to_string),
                channel_id: channel_id.map(str::to_string),
                message_id: message_id.map(str::to_string),
                task_id: task_id.map(str::to_string),
                event_kind: "status.updated".to_string(),
                severity: "info".to_string(),
                summary: state.to_string(),
                payload_preview: None,
                tool_name: None,
                ok: None,
                state: Some(state.to_string()),
                phase: phase.map(str::to_string),
                reason: reason.map(str::to_string),
            },
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn record_agent_activity_event(
        &self,
        row: NewAgentActivityEventRow,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        insert_agent_activity_event_tx(&mut tx, row).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn record_agent_status_idempotent(
        &self,
        idempotency_key: &str,
        response_payload: &str,
        row: AgentStatusRow,
    ) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let idempotency = sqlx::query(
            "INSERT OR IGNORE INTO idempotent_mutations(idempotency_key, entity_id, response_payload)
             VALUES (?, ?, ?)",
        )
        .bind(idempotency_key)
        .bind(&row.agent_id)
        .bind(response_payload)
        .execute(&mut *tx)
        .await?;
        if idempotency.rows_affected() == 0 {
            tx.commit().await?;
            return Ok(false);
        }

        sqlx::query(
            "INSERT INTO agent_statuses(
                agent_id, state, phase, reason, run_id, channel_id, message_id, task_id, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
             ON CONFLICT(agent_id) DO UPDATE SET
                state = excluded.state,
                phase = excluded.phase,
                reason = excluded.reason,
                run_id = excluded.run_id,
                channel_id = excluded.channel_id,
                message_id = excluded.message_id,
                task_id = excluded.task_id,
                updated_at = excluded.updated_at",
        )
        .bind(&row.agent_id)
        .bind(&row.state)
        .bind(&row.phase)
        .bind(&row.reason)
        .bind(&row.run_id)
        .bind(&row.channel_id)
        .bind(&row.message_id)
        .bind(&row.task_id)
        .bind(&row.updated_at)
        .execute(&mut *tx)
        .await?;

        insert_agent_activity_event_tx(
            &mut tx,
            NewAgentActivityEventRow {
                agent_id: row.agent_id.clone(),
                run_id: row.run_id.clone(),
                channel_id: row.channel_id.clone(),
                message_id: row.message_id.clone(),
                task_id: row.task_id.clone(),
                event_kind: "status.updated".to_string(),
                severity: "info".to_string(),
                summary: row.state.clone(),
                payload_preview: None,
                tool_name: None,
                ok: None,
                state: Some(row.state),
                phase: row.phase,
                reason: row.reason,
            },
        )
        .await?;

        tx.commit().await?;
        Ok(true)
    }

    pub async fn agent_activity_logs(
        &self,
        agent_id: &str,
        limit: i64,
    ) -> Result<Vec<AgentActivityLogRow>, sqlx::Error> {
        let limit = normalize_repository_limit(Some(limit)).min(200);
        let rows = sqlx::query(
            "SELECT id, agent_id, run_id, channel_id, message_id, task_id, state, phase, reason,
                    event_kind, severity, summary, payload_preview, tool_name, ok, created_at
             FROM agent_activity_logs
             WHERE agent_id = ?
             ORDER BY sequence DESC
             LIMIT ?",
        )
        .bind(agent_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(agent_activity_log_row_from_sql)
            .collect()
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

    pub async fn upsert_task_root(&self, row: TaskRootRow) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        upsert_task_root_tx(&mut tx, row).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn upsert_task_root_idempotent(
        &self,
        row: TaskRootRow,
        idempotency_key: &str,
        response_payload: &str,
    ) -> Result<(), sqlx::Error> {
        let entity_id = row.id.clone();
        let mut tx = self.pool.begin().await?;
        upsert_task_root_tx(&mut tx, row).await?;
        record_idempotent_response_tx(&mut tx, idempotency_key, &entity_id, response_payload)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn task_by_id(&self, task_id: &str) -> Result<Option<TaskRootRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, channel_id, creator_id, assignee_id, source_message_id,
                    assignment_reason, needs_assignment, title, status, attention_required,
                    root_deleted, root_body, created_at, updated_at
             FROM tasks
             WHERE id = ?",
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(task_root_row_from_sql).transpose()
    }

    pub async fn task_by_source_message(
        &self,
        source_message_id: &str,
    ) -> Result<Option<TaskRootRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, channel_id, creator_id, assignee_id, source_message_id,
                    assignment_reason, needs_assignment, title, status, attention_required,
                    root_deleted, root_body, created_at, updated_at
             FROM tasks
             WHERE source_message_id = ?
             ORDER BY created_at ASC, id ASC
             LIMIT 1",
        )
        .bind(source_message_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(task_root_row_from_sql).transpose()
    }

    pub async fn list_tasks(&self, query: TaskQueryRow) -> Result<Vec<TaskRootRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, channel_id, creator_id, assignee_id, source_message_id,
                    assignment_reason, needs_assignment, title, status, attention_required,
                    root_deleted, root_body, created_at, updated_at
             FROM tasks
             WHERE root_deleted = 0
               AND (? IS NULL OR channel_id = ?)
               AND (? IS NULL OR creator_id = ?)
               AND (? IS NULL OR assignee_id = ?)
             ORDER BY title ASC, id ASC",
        )
        .bind(query.channel_id.as_deref())
        .bind(query.channel_id.as_deref())
        .bind(query.creator_id.as_deref())
        .bind(query.creator_id.as_deref())
        .bind(query.assignee_id.as_deref())
        .bind(query.assignee_id.as_deref())
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(task_root_row_from_sql).collect()
    }

    pub async fn update_task_status(&self, task_id: &str, status: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE tasks
             SET status = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(status)
        .bind(now_string())
        .bind(task_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_task_status_idempotent(
        &self,
        task_id: &str,
        status: &str,
        idempotency_key: &str,
    ) -> Result<String, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        if let Some(payload) = sqlx::query_scalar::<_, String>(
            "SELECT response_payload
             FROM idempotent_mutations
             WHERE idempotency_key = ?",
        )
        .bind(idempotency_key)
        .fetch_optional(&mut *tx)
        .await?
        {
            tx.commit().await?;
            return Ok(payload);
        }

        let updated_at = now_string();
        let result = sqlx::query(
            "UPDATE tasks
             SET status = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(status)
        .bind(updated_at)
        .bind(task_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }

        let row = sqlx::query(
            "SELECT id, channel_id, creator_id, assignee_id, source_message_id,
                    assignment_reason, needs_assignment, title, status, attention_required,
                    root_deleted, root_body, created_at, updated_at
             FROM tasks
             WHERE id = ?",
        )
        .bind(task_id)
        .fetch_one(&mut *tx)
        .await?;
        let task = task_root_row_from_sql(row)?;
        let reply_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)
             FROM thread_replies
             WHERE task_id = ?",
        )
        .bind(task_id)
        .fetch_one(&mut *tx)
        .await?;
        let payload = task_summary_response_payload(&task, reply_count.max(0) as usize);
        record_idempotent_response_tx(&mut tx, idempotency_key, task_id, &payload).await?;
        tx.commit().await?;
        Ok(payload)
    }

    pub async fn update_task_assignment(
        &self,
        task_id: &str,
        assignee_id: Option<&str>,
        needs_assignment: bool,
        attention_required: bool,
        status: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE tasks
             SET assignee_id = ?, needs_assignment = ?, attention_required = ?,
                 status = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(assignee_id)
        .bind(if needs_assignment { 1 } else { 0 })
        .bind(if attention_required { 1 } else { 0 })
        .bind(status)
        .bind(now_string())
        .bind(task_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_task_attention(
        &self,
        task_id: &str,
        required: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE tasks
             SET attention_required = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(if required { 1 } else { 0 })
        .bind(now_string())
        .bind(task_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mark_task_root_deleted(&self, task_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE tasks
             SET root_deleted = 1, updated_at = ?
             WHERE id = ?",
        )
        .bind(now_string())
        .bind(task_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_task_reply(&self, row: TaskReplyRow) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        insert_task_reply_tx(&mut tx, row).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn insert_task_reply_idempotent(
        &self,
        row: TaskReplyRow,
        idempotency_key: &str,
        response_payload: &str,
    ) -> Result<(), sqlx::Error> {
        let entity_id = row.id.clone();
        let mut tx = self.pool.begin().await?;
        insert_task_reply_tx(&mut tx, row).await?;
        record_idempotent_response_tx(&mut tx, idempotency_key, &entity_id, response_payload)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn task_replies(&self, task_id: &str) -> Result<Vec<TaskReplyRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, task_id, COALESCE(sender_id, '') AS sender_id, role, content, status, created_at
             FROM thread_replies
             WHERE task_id = ?
             ORDER BY rowid ASC",
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(task_reply_row_from_sql).collect()
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
            "SELECT sequence, event_type, entity_id, payload, created_at
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
                    created_at: row.try_get("created_at")?,
                })
            })
            .collect()
    }

    pub async fn recent_events(&self, limit: i64) -> Result<Vec<EventRecord>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT sequence, event_type, entity_id, payload, created_at
             FROM event_log
             ORDER BY sequence DESC
             LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        let mut events = rows
            .into_iter()
            .map(|row| {
                let entity_id: String = row.try_get("entity_id")?;
                Ok(EventRecord {
                    sequence: row.try_get("sequence")?,
                    event_type: row.try_get("event_type")?,
                    entity_id: Uuid::parse_str(&entity_id)
                        .map_err(|err| sqlx::Error::Decode(Box::new(err)))?,
                    payload: row.try_get("payload")?,
                    created_at: row.try_get("created_at")?,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()?;
        events.sort_by_key(|event| event.sequence);
        Ok(events)
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
        assignee_agent_ids: &[String],
        reason: &str,
    ) -> Result<(), sqlx::Error> {
        let assignee_agent_ids_json = serde_json::to_string(assignee_agent_ids)
            .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
        sqlx::query(
            "INSERT INTO coordinator_decisions(
                id, channel_id, message_id, intent, action, assignee_agent_id, assignee_agent_ids, reason
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(channel_id)
        .bind(message_id)
        .bind(intent)
        .bind(action)
        .bind(assignee_agent_id)
        .bind(assignee_agent_ids_json)
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
            "SELECT id, channel_id, message_id, intent, action, assignee_agent_id, assignee_agent_ids, reason
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
                let assignee_agent_ids_raw: String = row.try_get("assignee_agent_ids")?;
                let assignee_agent_ids =
                    serde_json::from_str::<Vec<String>>(&assignee_agent_ids_raw)
                        .unwrap_or_default();
                Ok(CoordinatorDecisionRecord {
                    id: parse_uuid(&id)?,
                    channel_id,
                    message_id,
                    intent: row.try_get("intent")?,
                    action: row.try_get("action")?,
                    assignee_agent_id: row.try_get("assignee_agent_id")?,
                    assignee_agent_ids,
                    reason: row.try_get("reason")?,
                })
            })
            .collect()
    }

    pub async fn coordinator_decision_count(&self) -> Result<u64, sqlx::Error> {
        self.count_rows("coordinator_decisions").await
    }

    pub async fn insert_coordinator_runtime_run(
        &self,
        run_id: &str,
        channel_id: &str,
        message_id: &str,
        idempotency_key: &str,
        prompt: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO coordinator_runtime_runs(
                run_id, channel_id, message_id, idempotency_key, prompt
             )
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(run_id)
        .bind(channel_id)
        .bind(message_id)
        .bind(idempotency_key)
        .bind(prompt)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn append_coordinator_runtime_output(
        &self,
        run_id: &str,
        delta: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE coordinator_runtime_runs
             SET output = output || ?, updated_at = CURRENT_TIMESTAMP
             WHERE run_id = ?",
        )
        .bind(delta)
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn finish_coordinator_runtime_run(
        &self,
        run_id: &str,
        status: &str,
        error: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE coordinator_runtime_runs
             SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP
             WHERE run_id = ?",
        )
        .bind(status)
        .bind(error)
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn pending_coordinator_runtime_run_ids(&self) -> Result<Vec<String>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT run_id
             FROM coordinator_runtime_runs
             WHERE status IN ('pending', 'running')
             ORDER BY updated_at ASC, run_id ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(|row| row.try_get("run_id")).collect()
    }

    pub async fn cancel_coordinator_runtime_runs(
        &self,
        run_ids: &[String],
        error: &str,
    ) -> Result<(), sqlx::Error> {
        if run_ids.is_empty() {
            return Ok(());
        }
        let mut tx = self.pool.begin().await?;
        for run_id in run_ids {
            sqlx::query(
                "UPDATE coordinator_runtime_runs
                 SET status = 'cancelled', error = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE run_id = ? AND status IN ('pending', 'running')",
            )
            .bind(error)
            .bind(run_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn coordinator_runtime_run(
        &self,
        run_id: &str,
    ) -> Result<Option<CoordinatorRuntimeRunRecord>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT run_id, channel_id, message_id, idempotency_key, prompt, output, status, error
             FROM coordinator_runtime_runs
             WHERE run_id = ?",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(coordinator_runtime_run_from_row).transpose()
    }

    pub async fn coordinator_runtime_run_for_idempotency(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<CoordinatorRuntimeRunRecord>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT run_id, channel_id, message_id, idempotency_key, prompt, output, status, error
             FROM coordinator_runtime_runs
             WHERE idempotency_key = ?
             ORDER BY updated_at DESC
             LIMIT 1",
        )
        .bind(idempotency_key)
        .fetch_optional(&self.pool)
        .await?;

        row.map(coordinator_runtime_run_from_row).transpose()
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

    pub async fn upsert_conversation(&self, row: ConversationRow) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO conversations(
                id, kind, agent_id, active_session_id, runtime_status, created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                agent_id = excluded.agent_id,
                active_session_id = excluded.active_session_id,
                runtime_status = excluded.runtime_status,
                updated_at = excluded.updated_at",
        )
        .bind(row.id)
        .bind(row.kind)
        .bind(row.agent_id)
        .bind(row.active_session_id)
        .bind(row.runtime_status)
        .bind(row.created_at)
        .bind(row.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn conversations(&self) -> Result<Vec<ConversationRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, kind, agent_id, active_session_id, runtime_status, created_at, updated_at
             FROM conversations
             ORDER BY created_at ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(conversation_row_from_sql).collect()
    }

    pub async fn conversation(&self, id: &str) -> Result<Option<ConversationRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, kind, agent_id, active_session_id, runtime_status, created_at, updated_at
             FROM conversations
             WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(conversation_row_from_sql).transpose()
    }

    pub async fn upsert_conversation_session(
        &self,
        row: ConversationSessionRow,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO conversation_sessions(
                id, conversation_id, title, status, runtime_session_payload, created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                conversation_id = excluded.conversation_id,
                title = excluded.title,
                status = excluded.status,
                runtime_session_payload = excluded.runtime_session_payload,
                updated_at = excluded.updated_at",
        )
        .bind(row.id)
        .bind(row.conversation_id)
        .bind(row.title)
        .bind(row.status)
        .bind(row.runtime_session_payload)
        .bind(row.created_at)
        .bind(row.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn conversation_sessions(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationSessionRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, conversation_id, title, status, runtime_session_payload, created_at, updated_at
             FROM conversation_sessions
             WHERE conversation_id = ?
             ORDER BY updated_at DESC, id ASC",
        )
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(conversation_session_row_from_sql)
            .collect()
    }

    pub async fn insert_conversation_message(
        &self,
        row: ConversationMessageRow,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO conversation_messages(
                id, conversation_id, session_id, author_id, body, status, run_id,
                attachment_ids, cards_payload, created_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                session_id = excluded.session_id,
                author_id = excluded.author_id,
                body = excluded.body,
                status = excluded.status,
                run_id = excluded.run_id,
                attachment_ids = excluded.attachment_ids,
                cards_payload = excluded.cards_payload
             WHERE conversation_messages.conversation_id = excluded.conversation_id",
        )
        .bind(row.id)
        .bind(row.conversation_id)
        .bind(row.session_id)
        .bind(row.author_id)
        .bind(row.body)
        .bind(row.status)
        .bind(row.run_id)
        .bind(row.attachment_ids)
        .bind(row.cards_payload)
        .bind(row.created_at)
        .execute(&self.pool)
        .await
        .and_then(|result| {
            if result.rows_affected() == 0 {
                Err(sqlx::Error::RowNotFound)
            } else {
                Ok(result)
            }
        })?;
        Ok(())
    }

    pub async fn conversation_messages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, conversation_id, session_id, author_id, body, status, run_id,
                    attachment_ids, cards_payload, created_at
             FROM conversation_messages
             WHERE conversation_id = ?
             ORDER BY rowid ASC",
        )
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(conversation_message_row_from_sql)
            .collect()
    }

    pub async fn delete_conversation_messages_for_session(
        &self,
        conversation_id: &str,
        session_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "DELETE FROM conversation_messages
             WHERE conversation_id = ? AND session_id = ?",
        )
        .bind(conversation_id)
        .bind(session_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn upsert_conversation_attachment(
        &self,
        row: ConversationAttachmentRow,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO conversation_attachments(
                id, name, mime_type, size, url, cache_path, bytes_base64
             )
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                mime_type = excluded.mime_type,
                size = excluded.size,
                url = excluded.url,
                cache_path = excluded.cache_path,
                bytes_base64 = excluded.bytes_base64",
        )
        .bind(row.id)
        .bind(row.name)
        .bind(row.mime_type)
        .bind(row.size.min(i64::MAX as u64) as i64)
        .bind(row.url)
        .bind(row.cache_path)
        .bind(row.bytes_base64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn conversation_attachment(
        &self,
        id: &str,
    ) -> Result<Option<ConversationAttachmentRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, name, mime_type, size, url, cache_path, bytes_base64
             FROM conversation_attachments
             WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(conversation_attachment_row_from_sql).transpose()
    }

    pub async fn conversation_attachments(
        &self,
    ) -> Result<Vec<ConversationAttachmentRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, name, mime_type, size, url, cache_path, bytes_base64
             FROM conversation_attachments
             ORDER BY id ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(conversation_attachment_row_from_sql)
            .collect()
    }

    pub async fn delete_conversation_attachment(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM conversation_attachments WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn upsert_saved_message(&self, row: SavedMessageRow) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO saved_messages(id, message_id, source_id, source_kind, session_id, saved_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(message_id) DO UPDATE SET
                source_id = excluded.source_id,
                source_kind = excluded.source_kind,
                session_id = excluded.session_id,
                saved_at = excluded.saved_at",
        )
        .bind(row.id)
        .bind(row.message_id)
        .bind(row.source_id)
        .bind(row.source_kind)
        .bind(row.session_id)
        .bind(row.saved_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_saved_message(&self, message_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM saved_messages WHERE message_id = ?")
            .bind(message_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn saved_messages(&self) -> Result<Vec<SavedMessageRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, message_id, source_id, source_kind, session_id, saved_at
             FROM saved_messages
             ORDER BY saved_at DESC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(saved_message_row_from_sql).collect()
    }

    pub async fn upsert_interactive_card(
        &self,
        row: InteractiveCardRow,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO interactive_cards(
                id, run_id, agent_id, conversation_id, message_id, action_payload, template_payload, state
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                run_id = excluded.run_id,
                agent_id = excluded.agent_id,
                conversation_id = excluded.conversation_id,
                message_id = excluded.message_id,
                action_payload = excluded.action_payload,
                template_payload = excluded.template_payload,
                state = excluded.state,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind(row.id)
        .bind(row.run_id)
        .bind(row.agent_id)
        .bind(row.conversation_id)
        .bind(row.message_id)
        .bind(row.action_payload)
        .bind(row.template_payload)
        .bind(row.state)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn upsert_interactive_card_idempotent(
        &self,
        row: InteractiveCardRow,
        idempotency_key: &str,
        response_payload: &str,
    ) -> Result<(), sqlx::Error> {
        let entity_id = row.id.clone();
        let mut tx = self.pool.begin().await?;
        upsert_interactive_card_tx(&mut tx, row).await?;
        record_idempotent_response_tx(&mut tx, idempotency_key, &entity_id, response_payload)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn interactive_card(
        &self,
        id: &str,
    ) -> Result<Option<InteractiveCardRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, run_id, agent_id, conversation_id, message_id, action_payload, template_payload, state
             FROM interactive_cards
             WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(interactive_card_row_from_sql).transpose()
    }

    pub async fn interactive_cards(&self) -> Result<Vec<InteractiveCardRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, run_id, agent_id, conversation_id, message_id, action_payload, template_payload, state
             FROM interactive_cards
             ORDER BY created_at ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(interactive_card_row_from_sql)
            .collect()
    }

    pub async fn upsert_user_preferences(
        &self,
        row: UserPreferencesRow,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO user_preferences(
                profile_id, locale, time_zone, theme, font_size,
                notify_mentions, notify_human_replies, notify_approvals
             )
             VALUES ('local', ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(profile_id) DO UPDATE SET
                locale = excluded.locale,
                time_zone = excluded.time_zone,
                theme = excluded.theme,
                font_size = excluded.font_size,
                notify_mentions = excluded.notify_mentions,
                notify_human_replies = excluded.notify_human_replies,
                notify_approvals = excluded.notify_approvals,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind(row.locale)
        .bind(row.time_zone)
        .bind(row.theme)
        .bind(row.font_size)
        .bind(if row.notify_mentions { 1 } else { 0 })
        .bind(if row.notify_human_replies { 1 } else { 0 })
        .bind(if row.notify_approvals { 1 } else { 0 })
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn user_preferences(&self) -> Result<Option<UserPreferencesRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT locale, time_zone, theme, font_size,
                    notify_mentions, notify_human_replies, notify_approvals
             FROM user_preferences
             WHERE profile_id = 'local'",
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(user_preferences_row_from_sql).transpose()
    }

    pub async fn upsert_node(&self, row: NodeRow) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO nodes(id, name, platform, arch, hostname, status, daemon_version)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                platform = excluded.platform,
                arch = excluded.arch,
                hostname = excluded.hostname,
                status = excluded.status,
                daemon_version = excluded.daemon_version,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind(row.id)
        .bind(row.name)
        .bind(row.platform)
        .bind(row.arch)
        .bind(row.hostname)
        .bind(row.status)
        .bind(row.daemon_version)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn node(&self, id: &str) -> Result<Option<NodeRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, name, platform, arch, hostname, status, daemon_version
             FROM nodes
             WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(node_row_from_sql).transpose()
    }

    pub async fn nodes(&self) -> Result<Vec<NodeRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, name, platform, arch, hostname, status, daemon_version
             FROM nodes
             ORDER BY id ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(node_row_from_sql).collect()
    }

    async fn count_rows(&self, table: &str) -> Result<u64, sqlx::Error> {
        let query = format!("SELECT COUNT(*) AS count FROM {table}");
        let row = sqlx::query(&query).fetch_one(&self.pool).await?;
        let count: i64 = row.try_get("count")?;
        Ok(count.max(0) as u64)
    }
}

async fn insert_agent_activity_event_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    row: NewAgentActivityEventRow,
) -> Result<(), sqlx::Error> {
    let legacy_state = row.state.as_deref().unwrap_or(row.event_kind.as_str());
    let payload_preview = row.payload_preview.as_deref().map(|preview| {
        sanitize_activity_payload_preview(preview, MAX_ACTIVITY_PAYLOAD_PREVIEW_CHARS)
    });
    let ok = row.ok.map(|value| if value { 1_i64 } else { 0_i64 });

    sqlx::query(
        "INSERT INTO agent_activity_logs(
            id, agent_id, run_id, channel_id, message_id, task_id, state, phase, reason,
            event_kind, severity, summary, payload_preview, tool_name, ok
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&row.agent_id)
    .bind(&row.run_id)
    .bind(&row.channel_id)
    .bind(&row.message_id)
    .bind(&row.task_id)
    .bind(legacy_state)
    .bind(&row.phase)
    .bind(&row.reason)
    .bind(&row.event_kind)
    .bind(&row.severity)
    .bind(&row.summary)
    .bind(&payload_preview)
    .bind(&row.tool_name)
    .bind(ok)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        "DELETE FROM agent_activity_logs
         WHERE agent_id = ?
           AND sequence NOT IN (
             SELECT sequence FROM agent_activity_logs
             WHERE agent_id = ?
             ORDER BY sequence DESC
             LIMIT ?
           )",
    )
    .bind(&row.agent_id)
    .bind(&row.agent_id)
    .bind(AGENT_ACTIVITY_RETENTION_LIMIT)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub fn sanitize_activity_payload_preview(input: &str, max_chars: usize) -> String {
    let redacted = redact_sensitive_activity_text(input);
    truncate_activity_payload_preview(&redacted, max_chars)
}

fn redact_sensitive_activity_text(input: &str) -> String {
    let mut redacted = String::new();
    let mut redact_next = false;

    for (index, token) in input.split_whitespace().enumerate() {
        if index > 0 {
            redacted.push(' ');
        }

        let lower = token.to_ascii_lowercase();
        let is_sensitive = SENSITIVE_ACTIVITY_MARKERS
            .iter()
            .any(|marker| lower.contains(marker));

        if redact_next && !is_sensitive {
            redacted.push_str("[redacted]");
            redact_next = false;
            continue;
        }

        if is_sensitive {
            redacted.push_str(redact_sensitive_token(token).as_str());
            redact_next = token.ends_with(':') || token.eq_ignore_ascii_case("bearer");
        } else {
            redacted.push_str(token);
            redact_next = false;
        }
    }

    redacted
}

fn redact_sensitive_token(token: &str) -> String {
    if let Some((key, value)) = token.split_once('=') {
        if !value.is_empty() {
            return format!("{key}=[redacted]");
        }
    }

    if let Some((key, value)) = token.split_once(':') {
        if !value.is_empty() {
            return format!("{key}:[redacted]");
        }
        return token.to_string();
    }

    "[redacted]".to_string()
}

fn truncate_activity_payload_preview(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }

    if max_chars == 0 {
        return String::new();
    }

    let suffix_len = ACTIVITY_PAYLOAD_TRUNCATED_SUFFIX.chars().count();
    if max_chars <= suffix_len {
        return ACTIVITY_PAYLOAD_TRUNCATED_SUFFIX
            .chars()
            .take(max_chars)
            .collect();
    }

    let mut truncated = input
        .chars()
        .take(max_chars - suffix_len)
        .collect::<String>();
    truncated.push_str(ACTIVITY_PAYLOAD_TRUNCATED_SUFFIX);
    truncated
}

async fn record_idempotent_response_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    key: &str,
    entity_id: &str,
    response_payload: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO idempotent_mutations(idempotency_key, entity_id, response_payload)
         VALUES (?, ?, ?)",
    )
    .bind(key)
    .bind(entity_id)
    .bind(response_payload)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn upsert_task_root_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    row: TaskRootRow,
) -> Result<(), sqlx::Error> {
    let root_message_id = if let Some(source_message_id) = row.source_message_id.as_deref() {
        let source_exists =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages WHERE id = ? LIMIT 1")
                .bind(source_message_id)
                .fetch_one(&mut **tx)
                .await?;
        if source_exists > 0 {
            source_message_id.to_string()
        } else {
            insert_synthetic_task_message(
                tx,
                &row.id,
                &row.channel_id,
                &row.creator_id,
                "task_root",
                &row.root_body,
            )
            .await?
        }
    } else {
        insert_synthetic_task_message(
            tx,
            &row.id,
            &row.channel_id,
            &row.creator_id,
            "task_root",
            &row.root_body,
        )
        .await?
    };

    sqlx::query(
        "INSERT INTO tasks(
            id, channel_id, root_message_id, title, status, created_at, creator_id,
            assignee_id, source_message_id, assignment_reason, needs_assignment,
            attention_required, root_deleted, root_body, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            channel_id = excluded.channel_id,
            root_message_id = excluded.root_message_id,
            title = excluded.title,
            status = excluded.status,
            creator_id = excluded.creator_id,
            assignee_id = excluded.assignee_id,
            source_message_id = excluded.source_message_id,
            assignment_reason = excluded.assignment_reason,
            needs_assignment = excluded.needs_assignment,
            attention_required = excluded.attention_required,
            root_deleted = excluded.root_deleted,
            root_body = excluded.root_body,
            updated_at = excluded.updated_at",
    )
    .bind(row.id)
    .bind(row.channel_id)
    .bind(root_message_id)
    .bind(row.title)
    .bind(row.status)
    .bind(row.created_at)
    .bind(row.creator_id)
    .bind(row.assignee_id)
    .bind(row.source_message_id)
    .bind(row.assignment_reason)
    .bind(if row.needs_assignment { 1 } else { 0 })
    .bind(if row.attention_required { 1 } else { 0 })
    .bind(if row.root_deleted { 1 } else { 0 })
    .bind(row.root_body)
    .bind(row.updated_at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn insert_task_reply_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    row: TaskReplyRow,
) -> Result<(), sqlx::Error> {
    let task = sqlx::query("SELECT channel_id FROM tasks WHERE id = ?")
        .bind(&row.task_id)
        .fetch_optional(&mut **tx)
        .await?;
    let Some(task) = task else {
        return Err(sqlx::Error::RowNotFound);
    };
    let channel_id: String = task.try_get("channel_id")?;
    let author_message_id = insert_synthetic_task_message(
        tx,
        &row.id,
        &channel_id,
        &row.sender_id,
        "task_reply",
        &row.body,
    )
    .await?;

    sqlx::query(
        "INSERT INTO thread_replies(
            id, task_id, author_message_id, content, created_at, sender_id, role, status
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING",
    )
    .bind(&row.id)
    .bind(&row.task_id)
    .bind(author_message_id)
    .bind(&row.body)
    .bind(&row.created_at)
    .bind(&row.sender_id)
    .bind(&row.role)
    .bind(&row.status)
    .execute(&mut **tx)
    .await?;

    sqlx::query("UPDATE tasks SET updated_at = ? WHERE id = ?")
        .bind(now_string())
        .bind(&row.task_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn upsert_interactive_card_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    row: InteractiveCardRow,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO interactive_cards(
            id, run_id, agent_id, conversation_id, message_id, action_payload, template_payload, state
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            run_id = excluded.run_id,
            agent_id = excluded.agent_id,
            conversation_id = excluded.conversation_id,
            message_id = excluded.message_id,
            action_payload = excluded.action_payload,
            template_payload = excluded.template_payload,
            state = excluded.state,
            updated_at = CURRENT_TIMESTAMP",
    )
    .bind(row.id)
    .bind(row.run_id)
    .bind(row.agent_id)
    .bind(row.conversation_id)
    .bind(row.message_id)
    .bind(row.action_payload)
    .bind(row.template_payload)
    .bind(row.state)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn insert_synthetic_task_message(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    entity_id: &str,
    channel_id: &str,
    author_id: &str,
    kind: &str,
    body: &str,
) -> Result<String, sqlx::Error> {
    let message_id = match kind {
        "task_reply" => format!("task_reply_msg_{entity_id}"),
        _ => format!("task_root_msg_{entity_id}"),
    };
    sqlx::query(
        "INSERT INTO messages(id, channel_id, author_kind, kind, content, deleted, author_id, as_task, edited)
         VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0)
         ON CONFLICT(id) DO UPDATE SET
            channel_id = excluded.channel_id,
            author_kind = excluded.author_kind,
            kind = excluded.kind,
            content = excluded.content,
            deleted = 0,
            author_id = excluded.author_id,
            as_task = 0,
            edited = 0",
    )
    .bind(&message_id)
    .bind(channel_id)
    .bind(author_kind_for(author_id))
    .bind(kind)
    .bind(body)
    .bind(author_id)
    .execute(&mut **tx)
    .await?;
    Ok(message_id)
}

fn author_kind_for(author_id: &str) -> &'static str {
    if author_id.starts_with("agent") {
        "agent"
    } else if author_id.starts_with("system") {
        "system"
    } else {
        "human"
    }
}

fn channel_message_row_from_sql(
    row: sqlx::sqlite::SqliteRow,
) -> Result<ChannelMessageRow, sqlx::Error> {
    let deleted: i64 = row.try_get("deleted")?;
    let as_task: i64 = row.try_get("as_task")?;
    let edited: i64 = row.try_get("edited")?;
    let sequence = match row.try_get::<Option<i64>, _>("sequence") {
        Ok(sequence) => sequence,
        Err(sqlx::Error::ColumnNotFound(_)) => None,
        Err(error) => return Err(error),
    };
    Ok(ChannelMessageRow {
        id: row.try_get("id")?,
        sequence,
        channel_id: row.try_get("channel_id")?,
        session_id: row.try_get("session_id")?,
        author_id: row
            .try_get::<Option<String>, _>("author_id")?
            .unwrap_or_default(),
        body: row.try_get("content")?,
        as_task: as_task != 0,
        kind: row.try_get("kind")?,
        deleted: deleted != 0,
        edited: edited != 0,
        created_at: row.try_get("created_at")?,
    })
}

fn normalize_repository_limit(limit: Option<i64>) -> i64 {
    const DEFAULT_LIMIT: i64 = 20;
    const MAX_LIMIT: i64 = 200;

    match limit {
        Some(limit) if limit > 0 => limit.min(MAX_LIMIT),
        _ => DEFAULT_LIMIT,
    }
}

fn message_delivery_row_from_sql(
    row: sqlx::sqlite::SqliteRow,
) -> Result<MessageDeliveryRow, sqlx::Error> {
    Ok(MessageDeliveryRow {
        sequence: row.try_get("sequence")?,
        id: row.try_get("id")?,
        message_id: row.try_get("message_id")?,
        channel_id: row.try_get("channel_id")?,
        agent_id: row.try_get("agent_id")?,
        delivery_state: row.try_get("delivery_state")?,
        run_id: row.try_get("run_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn agent_activity_log_row_from_sql(
    row: sqlx::sqlite::SqliteRow,
) -> Result<AgentActivityLogRow, sqlx::Error> {
    let ok = row.try_get::<Option<i64>, _>("ok")?.map(|value| value != 0);

    Ok(AgentActivityLogRow {
        id: row.try_get("id")?,
        agent_id: row.try_get("agent_id")?,
        run_id: row.try_get("run_id")?,
        channel_id: row.try_get("channel_id")?,
        message_id: row.try_get("message_id")?,
        task_id: row.try_get("task_id")?,
        state: row.try_get("state")?,
        phase: row.try_get("phase")?,
        reason: row.try_get("reason")?,
        event_kind: row.try_get("event_kind")?,
        severity: row.try_get("severity")?,
        summary: row.try_get("summary")?,
        payload_preview: row.try_get("payload_preview")?,
        tool_name: row.try_get("tool_name")?,
        ok,
        created_at: row.try_get("created_at")?,
    })
}

fn escape_like_pattern(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '%' | '_' | '\\' => {
                escaped.push('\\');
                escaped.push(character);
            }
            _ => escaped.push(character),
        }
    }
    escaped
}

fn agent_row_from_sql(row: sqlx::sqlite::SqliteRow) -> Result<AgentRow, sqlx::Error> {
    let system_owned: i64 = row.try_get("system_owned")?;
    Ok(AgentRow {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        handle: row.try_get("handle")?,
        agent_kind: row.try_get("agent_kind")?,
        system_owned: system_owned != 0,
        runtime_kind: row.try_get("runtime_kind")?,
        model: row.try_get("model")?,
        node_id: row.try_get("node_id")?,
        description: row.try_get("description")?,
        workspace_path: row.try_get("workspace_path")?,
        memory_path: row.try_get("memory_path")?,
        docs_path: row.try_get("docs_path")?,
        avatar_seed: row.try_get("avatar_seed")?,
        runtime_status: row.try_get("runtime_status")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn task_root_row_from_sql(row: sqlx::sqlite::SqliteRow) -> Result<TaskRootRow, sqlx::Error> {
    let needs_assignment: i64 = row.try_get("needs_assignment")?;
    let attention_required: i64 = row.try_get("attention_required")?;
    let root_deleted: i64 = row.try_get("root_deleted")?;
    Ok(TaskRootRow {
        id: row.try_get("id")?,
        channel_id: row.try_get("channel_id")?,
        creator_id: row.try_get("creator_id")?,
        assignee_id: row.try_get("assignee_id")?,
        source_message_id: row.try_get("source_message_id")?,
        assignment_reason: row.try_get("assignment_reason")?,
        needs_assignment: needs_assignment != 0,
        title: row.try_get("title")?,
        status: row.try_get("status")?,
        attention_required: attention_required != 0,
        root_deleted: root_deleted != 0,
        root_body: row.try_get("root_body")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn task_reply_row_from_sql(row: sqlx::sqlite::SqliteRow) -> Result<TaskReplyRow, sqlx::Error> {
    Ok(TaskReplyRow {
        id: row.try_get("id")?,
        task_id: row.try_get("task_id")?,
        sender_id: row.try_get("sender_id")?,
        role: row.try_get("role")?,
        body: row.try_get("content")?,
        status: row.try_get("status")?,
        created_at: row.try_get("created_at")?,
    })
}

fn task_summary_response_payload(task: &TaskRootRow, reply_count: usize) -> String {
    serde_json::json!({
        "id": &task.id,
        "channelId": &task.channel_id,
        "creatorId": &task.creator_id,
        "assigneeId": &task.assignee_id,
        "sourceMessageId": &task.source_message_id,
        "title": &task.title,
        "status": &task.status,
        "attentionRequired": task.attention_required,
        "replyCount": reply_count,
        "updatedAt": &task.updated_at,
    })
    .to_string()
}

fn interactive_card_row_from_sql(
    row: sqlx::sqlite::SqliteRow,
) -> Result<InteractiveCardRow, sqlx::Error> {
    Ok(InteractiveCardRow {
        id: row.try_get("id")?,
        run_id: row.try_get("run_id")?,
        agent_id: row.try_get("agent_id")?,
        conversation_id: row.try_get("conversation_id")?,
        message_id: row.try_get("message_id")?,
        action_payload: row.try_get("action_payload")?,
        template_payload: row.try_get("template_payload")?,
        state: row.try_get("state")?,
    })
}

fn conversation_row_from_sql(row: sqlx::sqlite::SqliteRow) -> Result<ConversationRow, sqlx::Error> {
    Ok(ConversationRow {
        id: row.try_get("id")?,
        kind: row.try_get("kind")?,
        agent_id: row
            .try_get::<Option<String>, _>("agent_id")?
            .unwrap_or_default(),
        active_session_id: row.try_get("active_session_id")?,
        runtime_status: row.try_get("runtime_status")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn conversation_session_row_from_sql(
    row: sqlx::sqlite::SqliteRow,
) -> Result<ConversationSessionRow, sqlx::Error> {
    Ok(ConversationSessionRow {
        id: row.try_get("id")?,
        conversation_id: row.try_get("conversation_id")?,
        title: row.try_get("title")?,
        status: row.try_get("status")?,
        runtime_session_payload: row.try_get("runtime_session_payload")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn channel_session_row_from_sql(
    row: sqlx::sqlite::SqliteRow,
) -> Result<ChannelSessionRow, sqlx::Error> {
    Ok(ChannelSessionRow {
        id: row.try_get("id")?,
        channel_id: row.try_get("channel_id")?,
        title: row.try_get("title")?,
        status: row.try_get("status")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn conversation_message_row_from_sql(
    row: sqlx::sqlite::SqliteRow,
) -> Result<ConversationMessageRow, sqlx::Error> {
    Ok(ConversationMessageRow {
        id: row.try_get("id")?,
        conversation_id: row.try_get("conversation_id")?,
        session_id: row.try_get("session_id")?,
        author_id: row.try_get("author_id")?,
        body: row.try_get("body")?,
        status: row.try_get("status")?,
        run_id: row.try_get("run_id")?,
        attachment_ids: row.try_get("attachment_ids")?,
        cards_payload: row.try_get("cards_payload")?,
        created_at: row.try_get("created_at")?,
    })
}

fn conversation_attachment_row_from_sql(
    row: sqlx::sqlite::SqliteRow,
) -> Result<ConversationAttachmentRow, sqlx::Error> {
    let size: i64 = row.try_get("size")?;
    Ok(ConversationAttachmentRow {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        mime_type: row.try_get("mime_type")?,
        size: size.max(0) as u64,
        url: row.try_get("url")?,
        cache_path: row.try_get("cache_path")?,
        bytes_base64: row.try_get("bytes_base64")?,
    })
}

fn saved_message_row_from_sql(
    row: sqlx::sqlite::SqliteRow,
) -> Result<SavedMessageRow, sqlx::Error> {
    Ok(SavedMessageRow {
        id: row.try_get("id")?,
        message_id: row.try_get("message_id")?,
        source_id: row.try_get("source_id")?,
        source_kind: row.try_get("source_kind")?,
        session_id: row.try_get("session_id")?,
        saved_at: row.try_get("saved_at")?,
    })
}

fn user_preferences_row_from_sql(
    row: sqlx::sqlite::SqliteRow,
) -> Result<UserPreferencesRow, sqlx::Error> {
    let notify_mentions: i64 = row.try_get("notify_mentions")?;
    let notify_human_replies: i64 = row.try_get("notify_human_replies")?;
    let notify_approvals: i64 = row.try_get("notify_approvals")?;
    Ok(UserPreferencesRow {
        locale: row.try_get("locale")?,
        time_zone: row.try_get("time_zone")?,
        theme: row.try_get("theme")?,
        font_size: row.try_get("font_size")?,
        notify_mentions: notify_mentions != 0,
        notify_human_replies: notify_human_replies != 0,
        notify_approvals: notify_approvals != 0,
    })
}

fn node_row_from_sql(row: sqlx::sqlite::SqliteRow) -> Result<NodeRow, sqlx::Error> {
    Ok(NodeRow {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        platform: row.try_get("platform")?,
        arch: row.try_get("arch")?,
        hostname: row.try_get("hostname")?,
        status: row.try_get("status")?,
        daemon_version: row.try_get("daemon_version")?,
    })
}

fn now_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn parse_uuid(value: &str) -> Result<Uuid, sqlx::Error> {
    Uuid::parse_str(value).map_err(|err| sqlx::Error::Decode(Box::new(err)))
}

fn coordinator_runtime_run_from_row(
    row: sqlx::sqlite::SqliteRow,
) -> Result<CoordinatorRuntimeRunRecord, sqlx::Error> {
    Ok(CoordinatorRuntimeRunRecord {
        run_id: row.try_get("run_id")?,
        channel_id: row.try_get("channel_id")?,
        message_id: row.try_get("message_id")?,
        idempotency_key: row.try_get("idempotency_key")?,
        prompt: row.try_get("prompt")?,
        output: row.try_get("output")?,
        status: row.try_get("status")?,
        error: row.try_get("error")?,
    })
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
