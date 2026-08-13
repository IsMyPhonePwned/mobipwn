use crate::alerts::Alert;
use crate::store::{AlertEvent, AlertEventRepository, AlertRepository};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteAuditInput {
    pub deleted_by: String,
    pub reason: Option<String>,
    pub batch_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertDeletionAuditSummary {
    pub id: Uuid,
    pub alert_id: Uuid,
    pub deleted_at: DateTime<Utc>,
    pub deleted_by: String,
    pub reason: Option<String>,
    pub batch_id: Option<Uuid>,
    pub rule_name: Option<String>,
    pub title: Option<String>,
    pub status: Option<String>,
    pub events_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertDeletionAuditDetail {
    pub id: Uuid,
    pub alert_id: Uuid,
    pub deleted_at: DateTime<Utc>,
    pub deleted_by: String,
    pub reason: Option<String>,
    pub batch_id: Option<Uuid>,
    pub alert_snapshot: Value,
    pub events_snapshot: Value,
}

pub struct AlertDeletionAuditRepository {
    pool: PgPool,
}

impl AlertDeletionAuditRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn delete_alerts_with_audit(
        &self,
        alerts: &AlertRepository,
        events: &AlertEventRepository,
        ids: &[Uuid],
        input: &DeleteAuditInput,
    ) -> anyhow::Result<u64> {
        if ids.is_empty() {
            return Ok(0);
        }
        let mut deleted = 0u64;
        for id in ids {
            let Some(alert) = alerts.get(*id).await? else {
                continue;
            };
            let prior_events = events.list(*id).await.unwrap_or_default();
            self.archive_alert(&alert, &prior_events, input).await?;
            if alerts.delete(*id).await? {
                deleted += 1;
            }
        }
        Ok(deleted)
    }

    async fn archive_alert(
        &self,
        alert: &Alert,
        prior_events: &[AlertEvent],
        input: &DeleteAuditInput,
    ) -> anyhow::Result<()> {
        let mut events_snapshot: Vec<Value> = prior_events
            .iter()
            .map(|e| {
                serde_json::json!({
                    "id": e.id,
                    "kind": e.kind,
                    "body": e.body,
                    "author": e.author,
                    "created_at": e.created_at,
                })
            })
            .collect();
        let delete_note = input
            .reason
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(|r| format!("Alert permanently deleted: {r}"))
            .unwrap_or_else(|| "Alert permanently deleted".to_string());
        events_snapshot.push(serde_json::json!({
            "kind": "deleted",
            "body": delete_note,
            "author": input.deleted_by,
            "created_at": Utc::now(),
        }));

        let alert_snapshot = serde_json::to_value(alert)?;
        sqlx::query(
            "INSERT INTO alert_deletion_audit (alert_id, deleted_by, reason, batch_id, alert_snapshot, events_snapshot) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(alert.id)
        .bind(&input.deleted_by)
        .bind(&input.reason)
        .bind(input.batch_id)
        .bind(alert_snapshot)
        .bind(serde_json::Value::Array(events_snapshot))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_recent(&self, limit: i64) -> anyhow::Result<Vec<AlertDeletionAuditSummary>> {
        let rows = sqlx::query_as::<_, (Uuid, Uuid, DateTime<Utc>, String, Option<String>, Option<Uuid>, Value, Value)>(
            "SELECT id, alert_id, deleted_at, deleted_by, reason, batch_id, alert_snapshot, events_snapshot \
             FROM alert_deletion_audit ORDER BY deleted_at DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, alert_id, deleted_at, deleted_by, reason, batch_id, alert_snapshot, events_snapshot)| {
                let rule_name = alert_snapshot.get("rule_name").and_then(|v| v.as_str()).map(str::to_string);
                let title = alert_snapshot.get("title").and_then(|v| v.as_str()).map(str::to_string);
                let status = alert_snapshot
                    .get("status")
                    .and_then(|v| v.as_str().map(str::to_string).or_else(|| Some(v.to_string())));
                let events_count = events_snapshot.as_array().map(|a| a.len()).unwrap_or(0);
                AlertDeletionAuditSummary {
                    id,
                    alert_id,
                    deleted_at,
                    deleted_by,
                    reason,
                    batch_id,
                    rule_name,
                    title,
                    status,
                    events_count,
                }
            })
            .collect())
    }

    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<AlertDeletionAuditDetail>> {
        let row = sqlx::query_as::<_, (Uuid, Uuid, DateTime<Utc>, String, Option<String>, Option<Uuid>, Value, Value)>(
            "SELECT id, alert_id, deleted_at, deleted_by, reason, batch_id, alert_snapshot, events_snapshot \
             FROM alert_deletion_audit WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(
            |(id, alert_id, deleted_at, deleted_by, reason, batch_id, alert_snapshot, events_snapshot)| {
                AlertDeletionAuditDetail {
                    id,
                    alert_id,
                    deleted_at,
                    deleted_by,
                    reason,
                    batch_id,
                    alert_snapshot,
                    events_snapshot,
                }
            },
        ))
    }
}
