use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AlertSiemForwardLog {
    pub id: Uuid,
    pub alert_id: Option<Uuid>,
    pub event_kind: String,
    pub destination: String,
    pub siem_type: String,
    pub status: String,
    pub http_status: Option<i32>,
    pub error_message: Option<String>,
    pub payload_summary: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct InsertAlertSiemLog {
    pub alert_id: Option<Uuid>,
    pub event_kind: &'static str,
    pub destination: String,
    pub siem_type: &'static str,
    pub status: &'static str,
    pub http_status: Option<u16>,
    pub error_message: Option<String>,
    pub payload_summary: Value,
}

pub struct AlertSiemForwardLogRepository {
    pool: PgPool,
}

impl AlertSiemForwardLogRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn insert(&self, input: InsertAlertSiemLog) -> anyhow::Result<AlertSiemForwardLog> {
        let row = sqlx::query_as::<_, AlertSiemForwardLog>(
            "INSERT INTO alert_siem_forward_log \
             (alert_id, event_kind, destination, siem_type, status, http_status, error_message, payload_summary) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
             RETURNING id, alert_id, event_kind, destination, siem_type, status, http_status, error_message, payload_summary, created_at",
        )
        .bind(input.alert_id)
        .bind(input.event_kind)
        .bind(&input.destination)
        .bind(input.siem_type)
        .bind(input.status)
        .bind(input.http_status.map(|s| s as i32))
        .bind(input.error_message)
        .bind(input.payload_summary)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn list_recent(&self, limit: i64) -> anyhow::Result<Vec<AlertSiemForwardLog>> {
        let limit = limit.clamp(1, 500);
        let rows = sqlx::query_as::<_, AlertSiemForwardLog>(
            "SELECT id, alert_id, event_kind, destination, siem_type, status, http_status, error_message, payload_summary, created_at \
             FROM alert_siem_forward_log ORDER BY created_at DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
}
