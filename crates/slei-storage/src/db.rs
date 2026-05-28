use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

use crate::migrations::MIGRATION_0001;

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
        for statement in MIGRATION_0001.split(';') {
            let statement = statement.trim();
            if !statement.is_empty() {
                sqlx::query(statement).execute(&self.pool).await?;
            }
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
}
