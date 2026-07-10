use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

use crate::migrations::MIGRATIONS;

pub struct SleiDb {
    pool: SqlitePool,
}

impl SleiDb {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        sqlx::query("PRAGMA secure_delete = ON")
            .execute(&pool)
            .await?;
        Ok(Self { pool })
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn migrate(&self) -> Result<(), sqlx::Error> {
        self.migrate_versions(MIGRATIONS).await
    }

    #[cfg(test)]
    pub(crate) async fn migrate_for_test(
        &self,
        migrations: &[(i64, &str)],
    ) -> Result<(), sqlx::Error> {
        self.migrate_versions(migrations).await
    }

    async fn migrate_versions(&self, migrations: &[(i64, &str)]) -> Result<(), sqlx::Error> {
        for (version, migration) in migrations {
            for statement in migration.split(';') {
                let statement = statement.trim();
                if !statement.is_empty() {
                    sqlx::query(statement).execute(&self.pool).await?;
                }
            }
            self.repair_after_migration(*version).await?;
        }
        Ok(())
    }

    pub async fn table_exists(&self, table: &str) -> Result<bool, sqlx::Error> {
        let row = sqlx::query(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(&self.pool)
        .await?;
        let count: i64 = row.try_get("count")?;
        Ok(count > 0)
    }

    async fn repair_after_migration(&self, version: i64) -> Result<(), sqlx::Error> {
        if version >= 1 {
            self.repair_legacy_sequence_columns().await?;
            self.repair_legacy_app_state_columns().await?;
        }
        if version >= 5 {
            self.repair_agent_activity_event_columns().await?;
        }
        if version >= 7 {
            self.repair_message_thread_columns().await?;
        }
        if version >= 12 {
            self.add_column_if_missing("messages", "attachment_ids", "TEXT NOT NULL DEFAULT '[]'")
                .await?;
        }
        if version >= 13 {
            self.repair_agent_profession_columns().await?;
        }
        Ok(())
    }

    async fn repair_legacy_sequence_columns(&self) -> Result<(), sqlx::Error> {
        for table in [
            "agent_inbox_events",
            "memory_update_events",
            "routing_context_packages",
        ] {
            if self.table_exists(table).await? && !self.column_exists(table, "sequence").await? {
                let add_column = format!("ALTER TABLE {table} ADD COLUMN sequence INTEGER");
                sqlx::query(&add_column).execute(&self.pool).await?;
                let backfill =
                    format!("UPDATE {table} SET sequence = rowid WHERE sequence IS NULL");
                sqlx::query(&backfill).execute(&self.pool).await?;
            }
        }
        Ok(())
    }

    async fn repair_legacy_app_state_columns(&self) -> Result<(), sqlx::Error> {
        self.add_column_if_missing("channels", "active_session_id", "TEXT")
            .await?;
        self.add_column_if_missing("messages", "session_id", "TEXT")
            .await?;
        self.ensure_channel_sessions_table().await?;
        self.add_column_if_missing("messages", "author_id", "TEXT")
            .await?;
        self.add_column_if_missing("messages", "as_task", "INTEGER NOT NULL DEFAULT 0")
            .await?;
        self.add_column_if_missing("messages", "edited", "INTEGER NOT NULL DEFAULT 0")
            .await?;
        self.add_column_if_missing("tasks", "creator_id", "TEXT NOT NULL DEFAULT 'human:local'")
            .await?;
        self.add_column_if_missing("tasks", "assignee_id", "TEXT")
            .await?;
        self.add_column_if_missing("tasks", "source_message_id", "TEXT")
            .await?;
        self.add_column_if_missing("tasks", "assignment_reason", "TEXT")
            .await?;
        self.add_column_if_missing("tasks", "needs_assignment", "INTEGER NOT NULL DEFAULT 1")
            .await?;
        self.add_column_if_missing("tasks", "attention_required", "INTEGER NOT NULL DEFAULT 1")
            .await?;
        self.add_column_if_missing("tasks", "root_deleted", "INTEGER NOT NULL DEFAULT 0")
            .await?;
        self.add_column_if_missing("tasks", "root_body", "TEXT NOT NULL DEFAULT ''")
            .await?;
        self.add_column_if_missing("tasks", "updated_at", "TEXT NOT NULL DEFAULT ''")
            .await?;
        self.add_column_if_missing("thread_replies", "sender_id", "TEXT")
            .await?;
        self.add_column_if_missing("thread_replies", "role", "TEXT")
            .await?;
        self.add_column_if_missing("thread_replies", "status", "TEXT")
            .await?;
        sqlx::query("UPDATE tasks SET updated_at = created_at WHERE updated_at = ''")
            .execute(&self.pool)
            .await?;
        self.backfill_channel_sessions().await?;
        Ok(())
    }

    async fn repair_agent_activity_event_columns(&self) -> Result<(), sqlx::Error> {
        self.add_column_if_missing(
            "agent_activity_logs",
            "event_kind",
            "TEXT NOT NULL DEFAULT 'status.updated'",
        )
        .await?;
        self.add_column_if_missing(
            "agent_activity_logs",
            "severity",
            "TEXT NOT NULL DEFAULT 'info'",
        )
        .await?;
        self.add_column_if_missing("agent_activity_logs", "summary", "TEXT NOT NULL DEFAULT ''")
            .await?;
        self.add_column_if_missing("agent_activity_logs", "payload_preview", "TEXT")
            .await?;
        self.add_column_if_missing("agent_activity_logs", "tool_name", "TEXT")
            .await?;
        self.add_column_if_missing("agent_activity_logs", "ok", "INTEGER")
            .await?;

        if self.table_exists("agent_activity_logs").await?
            && self.column_exists("agent_activity_logs", "summary").await?
            && self.column_exists("agent_activity_logs", "state").await?
        {
            sqlx::query(
                "UPDATE agent_activity_logs
                 SET summary = state
                 WHERE summary = ''",
            )
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    async fn repair_message_thread_columns(&self) -> Result<(), sqlx::Error> {
        self.add_column_if_missing("tasks", "thread_id", "TEXT")
            .await?;
        if self.table_exists("tasks").await? && self.column_exists("tasks", "thread_id").await? {
            sqlx::query("CREATE INDEX IF NOT EXISTS idx_tasks_thread_id ON tasks(thread_id)")
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    async fn repair_agent_profession_columns(&self) -> Result<(), sqlx::Error> {
        self.add_column_if_missing("agents", "profession", "TEXT NOT NULL DEFAULT '智能体'")
            .await?;
        self.add_column_if_missing("agent_role_presets", "profession", "TEXT NOT NULL DEFAULT ''")
            .await?;
        self.add_column_if_missing("agent_role_presets", "category_id", "TEXT NOT NULL DEFAULT 'general'")
            .await?;

        if self.table_exists("agent_role_presets").await?
            && self.column_exists("agent_role_presets", "profession").await?
        {
            sqlx::query("UPDATE agent_role_presets SET profession = title WHERE profession = ''")
                .execute(&self.pool)
                .await?;
        }
        if self.table_exists("agent_role_presets").await?
            && self.column_exists("agent_role_presets", "category_id").await?
        {
            sqlx::query(
                "UPDATE agent_role_presets
                 SET category_id = CASE id
                     WHEN 'xiaohongshu-researcher' THEN 'market-content'
                     WHEN 'research-analyst' THEN 'research-analysis'
                     WHEN 'product-planner' THEN 'product-design'
                     WHEN 'engineering-implementer' THEN 'engineering'
                     WHEN 'system-architect' THEN 'engineering'
                     WHEN 'qa-reviewer' THEN 'quality'
                     WHEN 'teaching-assistant' THEN 'education'
                     WHEN 'legal-researcher' THEN 'legal-finance'
                     WHEN 'finance-analyst' THEN 'legal-finance'
                     WHEN 'operations-planner' THEN 'operations'
                     ELSE 'general'
                 END
                 WHERE category_id = 'general'",
            )
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    async fn ensure_channel_sessions_table(&self) -> Result<(), sqlx::Error> {
        if !self.table_exists("channel_sessions").await? {
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS channel_sessions (
                    id TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ready',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )",
            )
            .execute(&self.pool)
            .await?;
        }
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_channel_sessions_channel_id
             ON channel_sessions(channel_id)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_messages_session_id
             ON messages(session_id)",
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn backfill_channel_sessions(&self) -> Result<(), sqlx::Error> {
        if !self.table_exists("channels").await?
            || !self.table_exists("channel_sessions").await?
            || !self.column_exists("channels", "active_session_id").await?
        {
            return Ok(());
        }
        let channels = sqlx::query("SELECT id, active_session_id FROM channels")
            .fetch_all(&self.pool)
            .await?;
        for row in channels {
            let channel_id: String = row.try_get("id")?;
            let active_session_id: Option<String> = row.try_get("active_session_id")?;
            let session_id = active_session_id
                .filter(|id| !id.trim().is_empty())
                .unwrap_or_else(|| default_channel_session_id(&channel_id));
            sqlx::query(
                "INSERT OR IGNORE INTO channel_sessions(id, channel_id, title, status)
                 VALUES (?, ?, '新会话', 'ready')",
            )
            .bind(&session_id)
            .bind(&channel_id)
            .execute(&self.pool)
            .await?;
            sqlx::query(
                "UPDATE channels
                 SET active_session_id = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND (active_session_id IS NULL OR active_session_id = '')",
            )
            .bind(&session_id)
            .bind(&channel_id)
            .execute(&self.pool)
            .await?;
            if self.column_exists("messages", "session_id").await? {
                sqlx::query(
                    "UPDATE messages
                     SET session_id = ?
                     WHERE channel_id = ? AND (session_id IS NULL OR session_id = '')",
                )
                .bind(&session_id)
                .bind(&channel_id)
                .execute(&self.pool)
                .await?;
            }
        }
        Ok(())
    }

    async fn add_column_if_missing(
        &self,
        table: &str,
        column: &str,
        definition: &str,
    ) -> Result<(), sqlx::Error> {
        if self.table_exists(table).await? && !self.column_exists(table, column).await? {
            let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {definition}");
            sqlx::query(&sql).execute(&self.pool).await?;
        }
        Ok(())
    }

    async fn column_exists(&self, table: &str, column: &str) -> Result<bool, sqlx::Error> {
        let pragma = format!("PRAGMA table_info({table})");
        let rows = sqlx::query(&pragma).fetch_all(&self.pool).await?;
        for row in rows {
            let name: String = row.try_get("name")?;
            if name == column {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

fn default_channel_session_id(channel_id: &str) -> String {
    format!("session:channel:{channel_id}:default")
}
