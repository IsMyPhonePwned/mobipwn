use crate::ch::query_json_each_row;
use crate::config::AppConfig;
use std::collections::HashMap;

/// Global device/event totals for artifact values (7-day rollup window).
pub async fn lookup_artifact_prevalence(
    config: &AppConfig,
    field: &str,
    values: &[String],
) -> anyhow::Result<HashMap<String, (u64, u64, f64)>> {
    let mut out = HashMap::new();
    if values.is_empty() {
        return Ok(out);
    }
    let esc = |s: &str| s.replace('\\', "\\\\").replace('\'', "''");
    let in_list: String = values
        .iter()
        .map(|v| format!("'{}'", esc(v)))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT value, sum(event_count) AS events, sum(device_count) AS devices \
         FROM {db}.field_prevalence_agg \
         WHERE field = '{field}' AND value IN ({in_list}) AND bucket_day >= today() - 7 \
         GROUP BY value",
        db = config.clickhouse_database,
        field = esc(field),
    );
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    for row in rows {
        let value = row
            .get("value")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if value.is_empty() {
            continue;
        }
        let events = row
            .get("events")
            .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .unwrap_or(0);
        let devices = row
            .get("devices")
            .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .unwrap_or(0);
        let score = if devices == 0 {
            1.0
        } else {
            (1.0 / (1.0 + devices as f64)).min(1.0)
        };
        out.insert(value, (events, devices, score));
    }
    for v in values {
        out.entry(v.clone()).or_insert((0, 0, 1.0));
    }
    Ok(out)
}
