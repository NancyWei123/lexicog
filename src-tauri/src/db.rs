use anyhow::{Context, Result};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    SqlitePool,
};
use std::{str::FromStr, time::Duration};

#[derive(Clone, Debug)]
pub struct SqliteInterface {
    pool: SqlitePool,
}

impl SqliteInterface {
    pub async fn new(db_path: std::path::PathBuf) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .context("initialize SQLite interface: create database directory")?;
        }

        let connect_options =
            SqliteConnectOptions::from_str(&format!("sqlite:{}?mode=rwc", db_path.display()))?
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Normal)
                .busy_timeout(Duration::from_secs(5))
                .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(3)
            .min_connections(1)
            .acquire_timeout(Duration::from_secs(5))
            .connect_with(connect_options)
            .await
            .context("initialize SQLite interface: connect to database")?;

        Self::run_migrations(&pool).await?;

        Ok(Self { pool })
    }

    async fn run_migrations(pool: &SqlitePool) -> Result<()> {
        sqlx::migrate!("./migrations")
            .run(pool)
            .await
            .context("initialize SQLite interface: run database migrations")?;

        Ok(())
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}
