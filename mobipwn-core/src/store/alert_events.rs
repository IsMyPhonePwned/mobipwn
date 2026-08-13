use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize)]
pub struct AlertEvent {
    pub id: Uuid,
    pub alert_id: Uuid,
    pub kind: String,
    pub body: String,
    pub author: String,
    pub created_at: DateTime<Utc>,
}

pub struct AlertEventRepository {
    pool: PgPool,
}

impl AlertEventRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn record(
        &self,
        alert_id: Uuid,
        kind: &str,
        body: &str,
        author: &str,
    ) -> anyhow::Result<AlertEvent> {
        let row = sqlx::query_as::<_, (Uuid, String, String, String, DateTime<Utc>)>(
            "INSERT INTO alert_events (alert_id, kind, body, author) VALUES ($1, $2, $3, $4) \
             RETURNING id, kind, body, author, created_at",
        )
        .bind(alert_id)
        .bind(kind)
        .bind(body)
        .bind(author)
        .fetch_one(&self.pool)
        .await?;
        Ok(AlertEvent {
            id: row.0,
            alert_id,
            kind: row.1,
            body: row.2,
            author: row.3,
            created_at: row.4,
        })
    }

    pub async fn add_comment(
        &self,
        alert_id: Uuid,
        body: &str,
        author: &str,
    ) -> anyhow::Result<AlertEvent> {
        self.record(alert_id, "comment", body, author).await
    }

    pub async fn log_status_change(
        &self,
        alert_id: Uuid,
        from: &str,
        to: &str,
        author: &str,
    ) -> anyhow::Result<AlertEvent> {
        self.record(
            alert_id,
            "status",
            &format!("Status changed: {from} → {to}"),
            author,
        )
        .await
    }

    pub async fn log_assignee_change(
        &self,
        alert_id: Uuid,
        assignee: &str,
        author: &str,
    ) -> anyhow::Result<AlertEvent> {
        self.record(
            alert_id,
            "assignee",
            &format!("Assignee set to {assignee}"),
            author,
        )
        .await
    }

    pub async fn log_tags_change(
        &self,
        alert_id: Uuid,
        tags: &[String],
        author: &str,
    ) -> anyhow::Result<AlertEvent> {
        self.record(
            alert_id,
            "tags",
            &format!("Tags: {}", tags.join(", ")),
            author,
        )
        .await
    }

    pub async fn log_dismissed(&self, alert_id: Uuid, author: &str) -> anyhow::Result<AlertEvent> {
        self.record(alert_id, "dismissed", "Alert dismissed", author)
            .await
    }

    pub async fn log_restored(&self, alert_id: Uuid, author: &str) -> anyhow::Result<AlertEvent> {
        self.record(alert_id, "restored", "Alert restored", author)
            .await
    }

    pub async fn list(&self, alert_id: Uuid) -> anyhow::Result<Vec<AlertEvent>> {
        let rows = sqlx::query_as::<_, (Uuid, String, String, String, DateTime<Utc>)>(
            "SELECT id, kind, body, author, created_at FROM alert_events WHERE alert_id = $1 ORDER BY created_at ASC",
        )
        .bind(alert_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, kind, body, author, created_at)| AlertEvent {
                id,
                alert_id,
                kind,
                body,
                author,
                created_at,
            })
            .collect())
    }
}
