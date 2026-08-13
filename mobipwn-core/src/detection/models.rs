use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Rule lifecycle: staging → live → alerting (nano detection editor model).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleLifecycle {
    Staging,
    Live,
    Alerting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectionMode {
    /// Cron-driven batch query (scheduled).
    Scheduled,
    /// ClickHouse materialized view / streaming path (real-time).
    Realtime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionRule {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub lifecycle: RuleLifecycle,
    pub mode: DetectionMode,
    /// mPL / nPL-style query against `events`.
    pub query: String,
    pub cron: Option<String>,
    pub severity: String,
    pub mitre: Vec<String>,
    pub prevalence_threshold: Option<f64>,
    /// Minimum CH hits before creating alerts (scheduled / manual runs).
    pub min_hits: i32,
    /// Cap alerts created per run.
    pub max_alerts_per_run: i32,
    pub signal_log_enabled: bool,
    pub enabled: bool,
    pub muted_until: Option<DateTime<Utc>>,
    pub sigma_yaml: Option<String>,
    pub realtime_mv: Option<String>,
    pub version: u32,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<Uuid>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maintainer: Option<String>,
}
