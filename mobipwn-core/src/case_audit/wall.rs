use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::ch::query_json_each_row;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseWallEntry {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub message: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_name: Option<String>,
    pub severity: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disposition: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_since_creation_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_to_resolve_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_type: Option<String>,
}

pub async fn fetch_case_wall(
    config: &AppConfig,
    case_id: Uuid,
    limit: u32,
) -> anyhow::Result<Vec<CaseWallEntry>> {
    let limit = limit.clamp(1, 500);
    let db = &config.clickhouse_database;
    let case_id_str = case_id.to_string();
    let sql = format!(
        "SELECT id, timestamp, message, action, severity, ext \
         FROM {db}.events \
         WHERE source_type = 'audit' AND source = 'case' \
           AND JSONExtractString(ext, 'case_id') = '{case_id_str}' \
         ORDER BY timestamp DESC \
         LIMIT {limit}"
    );
    let rows = query_json_each_row(config, db, &sql).await?;
    Ok(rows.into_iter().filter_map(row_to_wall_entry).collect())
}

fn row_to_wall_entry(row: Value) -> Option<CaseWallEntry> {
    let id = row.get("id").and_then(|v| v.as_str()).and_then(|s| Uuid::parse_str(s).ok())?;
    let timestamp = row
        .get("timestamp")
        .and_then(parse_timestamp)
        .unwrap_or_else(Utc::now);
    let message = row.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let action = row
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let severity = row
        .get("severity")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let ext = row.get("ext").and_then(parse_ext_object).unwrap_or_default();

    Some(CaseWallEntry {
        id,
        timestamp,
        message,
        action,
        actor_id: ext_str(&ext, "actor_id").and_then(|s| Uuid::parse_str(s).ok()),
        actor_name: ext_str(&ext, "actor_name").map(str::to_string),
        severity: ext_str(&ext, "severity")
            .map(str::to_string)
            .unwrap_or(severity),
        status: ext_str(&ext, "status").unwrap_or("").to_string(),
        previous_status: ext_str(&ext, "previous_status").map(str::to_string),
        disposition: ext_str(&ext, "disposition").map(str::to_string),
        alert_id: ext_str(&ext, "alert_id").and_then(|s| Uuid::parse_str(s).ok()),
        notes: ext_str(&ext, "notes").map(str::to_string),
        time_since_creation_seconds: ext_i64(&ext, "time_since_creation_seconds"),
        time_to_resolve_seconds: ext_i64(&ext, "time_to_resolve_seconds"),
        alert_count: ext_i64(&ext, "alert_count"),
        note_type: ext_str(&ext, "note_type").map(str::to_string),
    })
}

fn parse_ext_object(v: &Value) -> Option<Value> {
    match v {
        Value::Object(_) => Some(v.clone()),
        Value::String(s) => serde_json::from_str(s).ok(),
        _ => None,
    }
}

fn parse_timestamp(v: &Value) -> Option<DateTime<Utc>> {
    if let Some(s) = v.as_str() {
        return DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.with_timezone(&Utc));
    }
    v.as_i64()
        .and_then(|micros| DateTime::from_timestamp_micros(micros))
}

fn ext_str<'a>(ext: &'a Value, key: &str) -> Option<&'a str> {
    ext.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty())
}

fn ext_i64(ext: &Value, key: &str) -> Option<i64> {
    ext.get(key).and_then(|v| v.as_i64())
}
