use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DetectionRun {
    pub id: Uuid,
    pub rule_id: Uuid,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub duration_ms: Option<i32>,
    pub hit_count: i32,
    pub alerts_created: i32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DailyHit {
    pub date: String,
    pub count: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct FailedDetectionRun {
    pub id: Uuid,
    pub rule_id: Uuid,
    pub rule_name: String,
    pub started_at: DateTime<Utc>,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct RuleRunSummary {
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_hit_count: i32,
    pub hits_24h: i32,
    pub daily_hits: Vec<DailyHit>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AllRuleRunSummaries {
    pub summaries: HashMap<Uuid, RuleRunSummary>,
}

pub struct DetectionRunRepository {
    pool: PgPool,
}

impl DetectionRunRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn start(&self, rule_id: Uuid) -> anyhow::Result<Uuid> {
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO detection_runs (rule_id) VALUES ($1) RETURNING id",
        )
        .bind(rule_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(id)
    }

    pub async fn finish(
        &self,
        id: Uuid,
        hit_count: i32,
        alerts_created: i32,
        duration_ms: i32,
        error: Option<&str>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE detection_runs SET finished_at = now(), duration_ms = $2, hit_count = $3, \
             alerts_created = $4, error = $5 WHERE id = $1",
        )
        .bind(id)
        .bind(duration_ms)
        .bind(hit_count)
        .bind(alerts_created)
        .bind(error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_for_rule(&self, rule_id: Uuid, limit: i64) -> anyhow::Result<Vec<DetectionRun>> {
        let rows = sqlx::query_as::<_, (
            Uuid,
            Uuid,
            DateTime<Utc>,
            Option<DateTime<Utc>>,
            Option<i32>,
            i32,
            i32,
            Option<String>,
        )>(
            "SELECT id, rule_id, started_at, finished_at, duration_ms, hit_count, alerts_created, error \
             FROM detection_runs WHERE rule_id = $1 ORDER BY started_at DESC LIMIT $2",
        )
        .bind(rule_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(
                |(id, rule_id, started_at, finished_at, duration_ms, hit_count, alerts_created, error)| {
                    DetectionRun {
                        id,
                        rule_id,
                        started_at,
                        finished_at,
                        duration_ms,
                        hit_count,
                        alerts_created,
                        error,
                    }
                },
            )
            .collect())
    }

    pub async fn list_failed(
        &self,
        hours: i64,
        limit: i64,
    ) -> anyhow::Result<Vec<FailedDetectionRun>> {
        let rows = sqlx::query_as::<_, (Uuid, Uuid, String, DateTime<Utc>, String)>(
            "SELECT dr.id, dr.rule_id, r.name, dr.started_at, dr.error \
             FROM detection_runs dr \
             JOIN detection_rules r ON r.id = dr.rule_id \
             WHERE dr.error IS NOT NULL \
               AND dr.started_at > now() - make_interval(hours => $1) \
             ORDER BY dr.started_at DESC \
             LIMIT $2",
        )
        .bind(hours)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, rule_id, rule_name, started_at, error)| FailedDetectionRun {
                id,
                rule_id,
                rule_name,
                started_at,
                error,
            })
            .collect())
    }

    /// Per-rule last run, 24h hit totals, and 28-day daily buckets for the rules dashboard.
    pub async fn summaries_all(&self) -> anyhow::Result<AllRuleRunSummaries> {
        let mut summaries: HashMap<Uuid, RuleRunSummary> = HashMap::new();

        let last_rows = sqlx::query_as::<_, (Uuid, DateTime<Utc>, i32)>(
            "SELECT DISTINCT ON (rule_id) rule_id, started_at, hit_count \
             FROM detection_runs ORDER BY rule_id, started_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        for (rule_id, started_at, hit_count) in last_rows {
            summaries
                .entry(rule_id)
                .or_default()
                .last_run_at = Some(started_at);
            summaries.entry(rule_id).or_default().last_hit_count = hit_count;
        }

        let h24_rows = sqlx::query_as::<_, (Uuid, i32)>(
            "SELECT rule_id, COALESCE(SUM(hit_count), 0)::int AS hits \
             FROM detection_runs WHERE started_at > now() - interval '24 hours' \
             GROUP BY rule_id",
        )
        .fetch_all(&self.pool)
        .await?;
        for (rule_id, hits) in h24_rows {
            summaries.entry(rule_id).or_default().hits_24h = hits;
        }

        let daily_rows = sqlx::query_as::<_, (Uuid, NaiveDate, i64)>(
            "SELECT rule_id, (started_at AT TIME ZONE 'UTC')::date AS day, SUM(hit_count)::bigint AS c \
             FROM detection_runs WHERE started_at > now() - interval '28 days' \
             GROUP BY rule_id, day ORDER BY rule_id, day",
        )
        .fetch_all(&self.pool)
        .await?;
        for (rule_id, day, count) in daily_rows {
            summaries
                .entry(rule_id)
                .or_default()
                .daily_hits
                .push(DailyHit {
                    date: day.format("%Y-%m-%d").to_string(),
                    count: count.min(i32::MAX as i64) as i32,
                });
        }

        Ok(AllRuleRunSummaries { summaries })
    }
}
