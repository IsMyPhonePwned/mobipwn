use crate::ch::query_json_each_row;
use crate::config::AppConfig;
use crate::db::PoolHealth;
use crate::db::DualPool;
use serde::Serialize;
use serde_json::Value;
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize)]
pub struct TableStorageStats {
    pub name: String,
    pub bytes: u64,
    pub rows: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PostgresStorageStats {
    pub status: &'static str,
    pub database_bytes: u64,
    pub tables: Vec<TableStorageStats>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClickHouseStorageStats {
    pub status: &'static str,
    pub database: String,
    pub database_bytes: u64,
    pub total_rows: u64,
    pub tables: Vec<TableStorageStats>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DatabaseStorageStats {
    pub postgres: PostgresStorageStats,
    pub clickhouse: ClickHouseStorageStats,
}

pub async fn fetch_database_storage(
    pool: &DualPool,
    config: &AppConfig,
) -> DatabaseStorageStats {
    let postgres = fetch_postgres_storage(&pool.postgres).await;
    let clickhouse = if pool.health().await == PoolHealth::Full {
        fetch_clickhouse_storage(config).await
    } else {
        ClickHouseStorageStats {
            status: "unavailable",
            database: config.clickhouse_database.clone(),
            database_bytes: 0,
            total_rows: 0,
            tables: Vec::new(),
        }
    };
    DatabaseStorageStats { postgres, clickhouse }
}

async fn fetch_postgres_storage(pool: &PgPool) -> PostgresStorageStats {
    let database_bytes: i64 =
        match sqlx::query_scalar("SELECT pg_database_size(current_database())::bigint")
            .fetch_one(pool)
            .await
        {
            Ok(n) => n,
            Err(_) => {
                return PostgresStorageStats {
                    status: "unavailable",
                    database_bytes: 0,
                    tables: Vec::new(),
                };
            }
        };

    let table_rows = sqlx::query_as::<_, (String, i64, i64)>(
        "SELECT c.relname, pg_total_relation_size(c.oid)::bigint, GREATEST(c.reltuples, 0)::bigint \
         FROM pg_class c \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = 'public' AND c.relkind = 'r' \
         ORDER BY pg_total_relation_size(c.oid) DESC \
         LIMIT 15",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let tables = table_rows
        .into_iter()
        .map(|(name, bytes, rows)| TableStorageStats {
            name,
            bytes: bytes.max(0) as u64,
            rows: rows.max(0) as u64,
        })
        .collect();

    PostgresStorageStats {
        status: "up",
        database_bytes: database_bytes.max(0) as u64,
        tables,
    }
}

async fn fetch_clickhouse_storage(config: &AppConfig) -> ClickHouseStorageStats {
    let db = &config.clickhouse_database;
    let db_esc = db.replace('\'', "''");

    let totals = match query_json_each_row(
        config,
        db,
        &format!(
            "SELECT sum(bytes_on_disk) AS bytes, sum(rows) AS rows \
             FROM system.parts \
             WHERE active AND database = '{db_esc}'"
        ),
    )
    .await
    {
        Ok(rows) => rows,
        Err(_) => {
            return ClickHouseStorageStats {
                status: "unavailable",
                database: db.clone(),
                database_bytes: 0,
                total_rows: 0,
                tables: Vec::new(),
            };
        }
    };

    let database_bytes = totals
        .first()
        .and_then(|r| r.get("bytes"))
        .map(json_u64)
        .unwrap_or(0);
    let total_rows = totals
        .first()
        .and_then(|r| r.get("rows"))
        .map(json_u64)
        .unwrap_or(0);

    let table_rows = query_json_each_row(
        config,
        db,
        &format!(
            "SELECT table AS name, sum(bytes_on_disk) AS bytes, sum(rows) AS rows \
             FROM system.parts \
             WHERE active AND database = '{db_esc}' \
             GROUP BY table \
             ORDER BY bytes DESC"
        ),
    )
    .await
    .unwrap_or_default();

    let tables = table_rows
        .into_iter()
        .filter_map(|r| {
            Some(TableStorageStats {
                name: json_str(r.get("name"))?,
                bytes: r.get("bytes").map(json_u64).unwrap_or(0),
                rows: r.get("rows").map(json_u64).unwrap_or(0),
            })
        })
        .collect();

    ClickHouseStorageStats {
        status: "up",
        database: db.clone(),
        database_bytes,
        total_rows,
        tables,
    }
}

fn json_str(v: Option<&Value>) -> Option<String> {
    let v = v?;
    v.as_str().map(|s| s.to_string())
}

fn json_u64(v: &Value) -> u64 {
    v.as_u64()
        .or_else(|| v.as_i64().map(|n| n.max(0) as u64))
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0)
}
