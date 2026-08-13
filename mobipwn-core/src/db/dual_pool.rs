use crate::config::AppConfig;
use clickhouse::Client;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

/// Health of optional ClickHouse alongside required Postgres.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoolHealth {
    Full,
    PostgresOnly,
}

/// Postgres (metadata) + optional ClickHouse (events).
///
/// Services degrade to Postgres-only when ClickHouse is briefly unavailable,
/// matching the nano-style DualPool pattern.
pub struct DualPool {
    pub postgres: PgPool,
    pub clickhouse: Option<Client>,
    pub clickhouse_database: String,
    health: Arc<RwLock<PoolHealth>>,
}

impl DualPool {
    pub async fn connect(config: &AppConfig) -> anyhow::Result<Self> {
        let postgres = PgPoolOptions::new()
            .max_connections(16)
            .connect(&config.postgres_url)
            .await?;

        let clickhouse = config.clickhouse_client();

        let pool = Self {
            postgres,
            clickhouse: Some(clickhouse),
            clickhouse_database: config.clickhouse_database.clone(),
            health: Arc::new(RwLock::new(PoolHealth::PostgresOnly)),
        };

        pool.probe_clickhouse().await;
        Ok(pool)
    }

    pub fn clickhouse_client(&self) -> Option<&Client> {
        self.clickhouse.as_ref()
    }

    pub async fn health(&self) -> PoolHealth {
        *self.health.read().await
    }

    pub async fn probe_clickhouse(&self) {
        let Some(ch) = self.clickhouse.as_ref() else {
            *self.health.write().await = PoolHealth::PostgresOnly;
            return;
        };
        let ok = ch
            .query("SELECT 1")
            .fetch_one::<u8>()
            .await
            .is_ok();
        let mut h = self.health.write().await;
        if ok {
            *h = PoolHealth::Full;
            info!("ClickHouse reachable");
        } else {
            *h = PoolHealth::PostgresOnly;
            warn!("ClickHouse unreachable — degraded to Postgres-only");
        }
    }
}
