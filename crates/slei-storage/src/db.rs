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
            self.repair_legacy_coordinator_columns().await?;
            self.repair_legacy_app_state_columns().await?;
        }
        Ok(())
    }

    async fn repair_legacy_sequence_columns(&self) -> Result<(), sqlx::Error> {
        for table in [
            "coordinator_decisions",
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

    async fn repair_legacy_coordinator_columns(&self) -> Result<(), sqlx::Error> {
        if self.table_exists("coordinator_decisions").await?
            && !self
                .column_exists("coordinator_decisions", "assignee_agent_ids")
                .await?
        {
            sqlx::query(
                "ALTER TABLE coordinator_decisions
                 ADD COLUMN assignee_agent_ids TEXT NOT NULL DEFAULT '[]'",
            )
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    async fn repair_legacy_app_state_columns(&self) -> Result<(), sqlx::Error> {
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
