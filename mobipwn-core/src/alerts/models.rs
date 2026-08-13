use super::{AlertContext, AlertStatus};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub id: Uuid,
    pub rule_id: Uuid,
    pub rule_name: String,
    pub status: AlertStatus,
    pub dedup_key: String,
    pub group_id: Option<Uuid>,
    pub title: String,
    pub severity: String,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    /// Start of the current open cycle (reset when reopening from verified / false positive).
    pub opened_at: DateTime<Utc>,
    /// When the alert was last moved to verified or false positive.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<DateTime<Utc>>,
    /// How many times the alert has been closed (verified or false positive).
    #[serde(default)]
    pub resolution_count: u32,
    pub event_count: u32,
    pub sample_event_id: Option<Uuid>,
    #[serde(default)]
    pub context: AlertContext,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissed_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertFacetGroup {
    pub alert_id: Uuid,
    pub rule_id: Uuid,
    pub rule_name: String,
    pub dedup_key: String,
    pub facet_label: String,
    pub status: AlertStatus,
    pub title: String,
    pub severity: String,
    pub event_count: u32,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub opened_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub resolution_count: u32,
    pub sample_event_id: Option<Uuid>,
    #[serde(default)]
    pub context: AlertContext,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissed_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_title: Option<String>,
}

/// Status filter for alert lists (`open` = new + triaged only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusFilter {
    Open,
    Exact(super::AlertStatus),
}

/// Filters for listing alerts.
#[derive(Debug, Clone, Default)]
pub struct AlertListFilter {
    pub status: Option<StatusFilter>,
    pub dismissed: DismissedFilter,
    pub case_id: Option<Uuid>,
    /// Match `alerts.assignee` exactly (username).
    pub assignee: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertGroup {
    pub id: Uuid,
    pub rule_id: Uuid,
    pub title: String,
    pub alert_count: u32,
    pub status: AlertStatus,
    pub created_at: DateTime<Utc>,
}

/// Which alerts to include when listing (default: active / not dismissed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DismissedFilter {
    #[default]
    Active,
    Dismissed,
    All,
}

impl DismissedFilter {
    pub fn parse(s: Option<&str>) -> Self {
        match s {
            Some("dismissed") => Self::Dismissed,
            Some("all") => Self::All,
            _ => Self::Active,
        }
    }

    /// SQL fragment appended after table alias (e.g. `a` → ` AND a.dismissed_at IS NULL`).
    pub fn sql_and(&self, alias: &str) -> String {
        match self {
            Self::Active => format!(" AND {alias}.dismissed_at IS NULL"),
            Self::Dismissed => format!(" AND {alias}.dismissed_at IS NOT NULL"),
            Self::All => String::new(),
        }
    }
}
