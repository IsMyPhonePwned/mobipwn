use anyhow::Context;
use serde_json::Value;

use crate::ch::{post_sql, query_json_each_row};
use crate::config::AppConfig;
use crate::db::PoolHealth;
use crate::DualPool;

use super::sections::BackupSection;

pub async fn export_clickhouse_section(
    pool: &DualPool,
    config: &AppConfig,
    section: BackupSection,
) -> anyhow::Result<Value> {
    if pool.health().await != PoolHealth::Full {
        anyhow::bail!("ClickHouse unavailable — cannot export {}", section.id());
    }
    let db = &config.clickhouse_database;
    let mut tables = serde_json::Map::new();
    for table in section.clickhouse_tables() {
        let sql = format!("SELECT * FROM {db}.{table}");
        let rows = query_json_each_row(config, db, &sql)
            .await
            .with_context(|| format!("export ClickHouse {table}"))?;
        tables.insert((*table).to_string(), Value::Array(rows));
    }
    Ok(Value::Object(tables))
}

pub async fn import_clickhouse_section(
    pool: &DualPool,
    config: &AppConfig,
    section: BackupSection,
    payload: &Value,
    replace: bool,
) -> anyhow::Result<std::collections::HashMap<String, u64>> {
    if pool.health().await != PoolHealth::Full {
        anyhow::bail!("ClickHouse unavailable — cannot import {}", section.id());
    }
    let db = &config.clickhouse_database;
    let tables = payload
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("section payload must be an object"))?;
    let mut counts = std::collections::HashMap::new();

    for table in section.clickhouse_tables() {
        let rows = tables
            .get(*table)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if replace && !rows.is_empty() {
            post_sql(config, &format!("TRUNCATE TABLE {db}.{table}"))
                .await
                .with_context(|| format!("truncate {table}"))?;
        }
        let mut inserted = 0u64;
        for chunk in rows.chunks(500) {
            if chunk.is_empty() {
                continue;
            }
            let body = chunk
                .iter()
                .map(|row| serde_json::to_string(row))
                .collect::<Result<Vec<_>, _>>()?
                .join("\n");
            let sql = format!("INSERT INTO {db}.{table} FORMAT JSONEachRow\n{body}");
            post_sql(config, &sql)
                .await
                .with_context(|| format!("insert into {table}"))?;
            inserted += chunk.len() as u64;
        }
        counts.insert((*table).to_string(), inserted);
    }
    Ok(counts)
}
