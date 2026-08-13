use std::collections::HashMap;

use serde_json::Value;
use uuid::Uuid;

use crate::config::AppConfig;

use super::query_json_each_row;

const EVENT_LOOKUP_COLS: &str =
    "id, source, platform, parser, bundle_id, process_name, device_id, timestamp, message";

/// Load events by id for alert facet enrichment (realtime signal drain).
pub async fn fetch_events_by_ids(
    config: &AppConfig,
    ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, Value>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let db = &config.clickhouse_database;
    let id_list = ids
        .iter()
        .map(|id| format!("'{id}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT {EVENT_LOOKUP_COLS} FROM {db}.events WHERE id IN ({id_list})"
    );
    let rows = query_json_each_row(config, db, &sql).await?;
    let mut out = HashMap::with_capacity(rows.len());
    for row in rows {
        let Some(id_str) = row.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Ok(id) = Uuid::parse_str(id_str) else {
            continue;
        };
        out.insert(id, row);
    }
    Ok(out)
}
