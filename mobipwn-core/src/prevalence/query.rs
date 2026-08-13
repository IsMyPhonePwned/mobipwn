use crate::ch::query_json_each_row;
use crate::config::AppConfig;
use serde_json::Value;

pub async fn prevalence_score(
    config: &AppConfig,
    field: &str,
    value: &str,
) -> anyhow::Result<f64> {
    if value.is_empty() {
        return Ok(1.0);
    }
    let sql = format!(
        "SELECT sum(event_count) AS cnt FROM {db}.field_prevalence_agg \
         WHERE field = '{field}' AND value = '{value}' AND bucket_day >= today() - 7",
        db = config.clickhouse_database,
        field = field.replace('\'', "''"),
        value = value.replace('\'', "''"),
    );
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    let cnt = rows
        .first()
        .and_then(|r| r.get("cnt"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if cnt == 0 {
        return Ok(1.0);
    }
    // 0.0 = ubiquitous (high cnt), 1.0 = rare (low cnt)
    Ok((1.0 / (1.0 + cnt as f64)).min(1.0))
}

const PREVALENCE_FACETS: &[&str] = &["bundle_id", "process_name", "parser"];

/// Lowest rarity across key facets (most ubiquitous facet wins).
pub async fn row_rarity_score(config: &AppConfig, row: &Value) -> anyhow::Result<f64> {
    let mut min = 1.0f64;
    for field in PREVALENCE_FACETS {
        let value = row.get(*field).and_then(|v| v.as_str()).unwrap_or("");
        if value.is_empty() {
            continue;
        }
        let score = prevalence_score(config, field, value).await?;
        min = min.min(score);
    }
    Ok(min)
}

/// Suppress when any facet is too common (rarity below threshold).
pub async fn should_suppress_prevalence(
    config: &AppConfig,
    threshold: f64,
    row: &Value,
) -> anyhow::Result<bool> {
    let rarity = row_rarity_score(config, row).await?;
    Ok(rarity < threshold)
}
