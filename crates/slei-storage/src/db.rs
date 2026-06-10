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
        for (_version, migration) in MIGRATIONS {
            for statement in migration.split(';') {
                let statement = statement.trim();
                if !statement.is_empty() {
                    sqlx::query(statement).execute(&self.pool).await?;
                }
            }
        }
        self.repair_legacy_sequence_columns().await?;
        self.repair_legacy_coordinator_columns().await?;
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
