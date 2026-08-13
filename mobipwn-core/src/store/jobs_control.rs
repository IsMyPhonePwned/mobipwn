use serde::Serialize;
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize)]
pub struct JobsControlSummary {
    pub enrichment_cancel_requested: bool,
    pub enrichment_status_cleared: bool,
    pub ingest_jobs_failed: u64,
    pub ironsift_runs_failed: u64,
}

/// Request enrichment worker cancellation, clear stuck sync banner, and fail in-flight DB jobs.
pub async fn cancel_running_jobs(pool: &PgPool) -> anyhow::Result<JobsControlSummary> {
    crate::enrichment::request_enrichment_sync_cancel();
    let enrichment_cancel_requested = crate::enrichment::is_enrichment_sync_cancel_requested();
    let had_status = crate::enrichment::read_enrichment_sync_status().is_some();
    crate::enrichment::clear_enrichment_sync_status();

    let ingest_jobs_failed = cancel_ingest_jobs(pool).await?;
    let ironsift_runs_failed = cancel_ironsift_runs(pool).await?;

    Ok(JobsControlSummary {
        enrichment_cancel_requested,
        enrichment_status_cleared: had_status || enrichment_cancel_requested,
        ingest_jobs_failed,
        ironsift_runs_failed,
    })
}

/// Clear operator flags without failing DB-backed jobs (dismiss stuck UI state).
pub fn clear_stuck_enrichment_status() -> bool {
    let had = crate::enrichment::read_enrichment_sync_status().is_some();
    crate::enrichment::clear_enrichment_sync_status();
    crate::enrichment::clear_enrichment_sync_cancel();
    had
}

async fn cancel_ingest_jobs(pool: &PgPool) -> anyhow::Result<u64> {
    let r = sqlx::query(
        "UPDATE ingest_jobs SET status = 'failed', error = 'cancelled by operator', \
         finished_at = COALESCE(finished_at, now()) \
         WHERE status IN ('pending', 'running', 'uploading')",
    )
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

async fn cancel_ironsift_runs(pool: &PgPool) -> anyhow::Result<u64> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'ironsift_runs'
        )",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);
    if !exists {
        return Ok(0);
    }
    let r = sqlx::query(
        "UPDATE ironsift_runs SET status = 'failed', error = 'cancelled by operator', \
         finished_at = COALESCE(finished_at, now()) WHERE status = 'running'",
    )
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}
