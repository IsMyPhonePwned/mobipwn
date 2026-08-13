use clickhouse::Row;
use serde::{Deserialize, Serialize};

/// ClickHouse `events` table row (read/write).
#[derive(Debug, Clone, Row, Serialize, Deserialize)]
pub struct EventRow {
    #[serde(with = "clickhouse::serde::uuid")]
    pub id: uuid::Uuid,
    #[serde(with = "clickhouse::serde::chrono::datetime64::micros")]
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub message: String,
    pub source_type: String,
    pub source: String,
    #[serde(with = "clickhouse::serde::chrono::datetime64::micros")]
    pub ingest_time: chrono::DateTime<chrono::Utc>,
    pub platform: String,
    pub device_id: String,
    pub device_model: String,
    pub os_version: String,
    pub bundle_id: String,
    pub app_name: String,
    pub parser: String,
    pub data_type: String,
    pub event_time_binding: String,
    pub process_name: String,
    pub process_id: u32,
    pub user: String,
    pub src_ip: String,
    pub dest_ip: String,
    pub ssid: String,
    pub permission: String,
    pub file_hash: String,
    pub severity: String,
    pub action: String,
    pub ext: String,
}
