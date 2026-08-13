use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHistoryEntry {
    pub id: Uuid,
    pub query: String,
    pub query_mode: String,
    pub time_range_type: String,
    pub time_range_preset: Option<String>,
    pub time_range_start: Option<DateTime<Utc>>,
    pub time_range_end: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSearchHistory {
    pub query: String,
    pub query_mode: Option<String>,
    pub time_range_type: Option<String>,
    pub time_range_preset: Option<String>,
    pub time_range_start: Option<DateTime<Utc>>,
    pub time_range_end: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    query: String,
    query_mode: String,
    time_range_type: String,
    time_range_preset: Option<String>,
    time_range_start: Option<DateTime<Utc>>,
    time_range_end: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

fn map(r: Row) -> SearchHistoryEntry {
    SearchHistoryEntry {
        id: r.id,
        query: r.query,
        query_mode: r.query_mode,
        time_range_type: r.time_range_type,
        time_range_preset: r.time_range_preset,
        time_range_start: r.time_range_start,
        time_range_end: r.time_range_end,
        created_at: r.created_at,
    }
}

pub struct SearchHistoryRepository {
    pool: PgPool,
}

impl SearchHistoryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self, limit: i64) -> anyhow::Result<Vec<SearchHistoryEntry>> {
        let rows = sqlx::query_as::<_, Row>(
            "SELECT id, query, query_mode, time_range_type, time_range_preset, time_range_start, time_range_end, created_at \
             FROM search_history ORDER BY created_at DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(map).collect())
    }

    pub async fn create(&self, body: &CreateSearchHistory) -> anyhow::Result<SearchHistoryEntry> {
        let row = sqlx::query_as::<_, Row>(
            "INSERT INTO search_history (query, query_mode, time_range_type, time_range_preset, time_range_start, time_range_end) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             RETURNING id, query, query_mode, time_range_type, time_range_preset, time_range_start, time_range_end, created_at",
        )
        .bind(&body.query)
        .bind(body.query_mode.as_deref().unwrap_or("piped"))
        .bind(body.time_range_type.as_deref().unwrap_or("preset"))
        .bind(&body.time_range_preset)
        .bind(body.time_range_start)
        .bind(body.time_range_end)
        .fetch_one(&self.pool)
        .await?;
        Ok(map(row))
    }

    pub async fn delete(&self, id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("DELETE FROM search_history WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    pub async fn clear(&self) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM search_history").execute(&self.pool).await?;
        Ok(())
    }

    pub async fn history_enabled(&self) -> anyhow::Result<bool> {
        let v: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT value FROM siem_settings WHERE key = 'search_history'",
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(v.and_then(|j| j.get("enabled").and_then(|e| e.as_bool()))
            .unwrap_or(true))
    }

    pub async fn set_history_enabled(&self, enabled: bool) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO siem_settings (key, value, updated_at) VALUES ('search_history', $1, now()) \
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
        )
        .bind(serde_json::json!({ "enabled": enabled }))
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
