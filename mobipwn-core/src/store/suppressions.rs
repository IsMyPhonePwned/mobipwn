use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SuppressionWindow {
    pub id: Uuid,
    pub name: String,
    /// `None` = all detection rules.
    pub rule_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

pub struct SuppressionRepository {
    pool: PgPool,
}

impl SuppressionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// True when an active maintenance window covers this rule (global or rule-specific).
    pub async fn is_suppressed(&self, rule_id: Uuid) -> anyhow::Result<bool> {
        let active: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM suppression_windows
                WHERE starts_at <= now() AND ends_at > now()
                  AND (rule_id IS NULL OR rule_id = $1)
             )",
        )
        .bind(rule_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(active)
    }

    pub async fn list_active(&self) -> anyhow::Result<Vec<SuppressionWindow>> {
        let rows = sqlx::query_as::<_, (
            Uuid,
            String,
            Option<Uuid>,
            DateTime<Utc>,
            DateTime<Utc>,
            DateTime<Utc>,
        )>(
            "SELECT id, name, rule_id, starts_at, ends_at, created_at \
             FROM suppression_windows WHERE ends_at > now() ORDER BY starts_at",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(
                |(id, name, rule_id, starts_at, ends_at, created_at)| SuppressionWindow {
                    id,
                    name,
                    rule_id,
                    starts_at,
                    ends_at,
                    created_at,
                },
            )
            .collect())
    }

    pub async fn create(
        &self,
        name: &str,
        rule_id: Option<Uuid>,
        starts_at: DateTime<Utc>,
        ends_at: DateTime<Utc>,
    ) -> anyhow::Result<SuppressionWindow> {
        if ends_at <= starts_at {
            anyhow::bail!("ends_at must be after starts_at");
        }
        let row = sqlx::query_as::<_, (
            Uuid,
            String,
            Option<Uuid>,
            DateTime<Utc>,
            DateTime<Utc>,
            DateTime<Utc>,
        )>(
            "INSERT INTO suppression_windows (name, rule_id, starts_at, ends_at) \
             VALUES ($1, $2, $3, $4) \
             RETURNING id, name, rule_id, starts_at, ends_at, created_at",
        )
        .bind(name)
        .bind(rule_id)
        .bind(starts_at)
        .bind(ends_at)
        .fetch_one(&self.pool)
        .await?;
        Ok(SuppressionWindow {
            id: row.0,
            name: row.1,
            rule_id: row.2,
            starts_at: row.3,
            ends_at: row.4,
            created_at: row.5,
        })
    }

    pub async fn delete(&self, id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("DELETE FROM suppression_windows WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }
}
