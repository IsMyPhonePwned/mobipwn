use chrono::{DateTime, Utc};
use clickhouse::Row;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// ClickHouse `detection_signals` row (typed insert).
#[derive(Debug, Clone, Row, Serialize, Deserialize)]
pub struct DetectionSignalRow {
    #[serde(with = "clickhouse::serde::uuid")]
    pub rule_id: Uuid,
    pub rule_name: String,
    #[serde(with = "clickhouse::serde::chrono::datetime64::micros")]
    pub matched_at: DateTime<Utc>,
    #[serde(with = "clickhouse::serde::uuid")]
    pub event_id: Uuid,
    pub platform: String,
    pub dedup_key: String,
    pub prevalence: f64,
    pub payload: String,
}
