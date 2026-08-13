//! ClickHouse materialized views for `mode = realtime` detection rules.

use crate::config::AppConfig;
use uuid::Uuid;

pub fn mv_table_name(rule_id: Uuid) -> String {
    format!("mv_rule_{}", rule_id.as_hyphenated().to_string().replace('-', ""))
}

pub fn build_mv_select_sql(
    database: &str,
    rule_id: Uuid,
    rule_name: &str,
    where_sql: &str,
) -> String {
    let rid = rule_id.to_string();
    let name = rule_name.replace('\'', "''");
    format!(
        "SELECT \
         toUUID('{rid}') AS rule_id, \
         '{name}' AS rule_name, \
         now64(6) AS matched_at, \
         id AS event_id, \
         platform, \
         concat(platform, ':', bundle_id, ':', parser) AS dedup_key, \
         0.0 AS prevalence, \
         message AS payload \
         FROM {database}.events \
         WHERE {where_sql}"
    )
}

pub async fn sync_materialized_view(
    config: &AppConfig,
    rule_id: Uuid,
    rule_name: &str,
    where_sql: &str,
) -> anyhow::Result<String> {
    let db = &config.clickhouse_database;
    let mv = mv_table_name(rule_id);
    drop_materialized_view(config, rule_id).await?;
    let select = build_mv_select_sql(db, rule_id, rule_name, where_sql);
    let ddl = format!(
        "CREATE MATERIALIZED VIEW {db}.{mv} TO {db}.detection_signals AS {select}"
    );
    crate::ch::post_sql(config, &ddl).await?;
    Ok(mv)
}

pub async fn drop_materialized_view(config: &AppConfig, rule_id: Uuid) -> anyhow::Result<()> {
    let db = &config.clickhouse_database;
    let mv = mv_table_name(rule_id);
    let ddl = format!("DROP VIEW IF EXISTS {db}.{mv}");
    crate::ch::post_sql(config, &ddl).await.ok();
    Ok(())
}
