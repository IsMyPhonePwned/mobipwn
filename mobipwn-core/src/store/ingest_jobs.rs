use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

/// Runtime / build options recorded at ingest time (shown on Data page per source).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IngestJobOptions {
    /// Cargo features enabled in the ingest binary (e.g. `logarchive-decode`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub build_features: Vec<String>,
    /// `enabled` (decoded events), `deferred` (inventory only), or `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logarchive_decode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logarchive_decode_max_lines: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ioservice_full_tree: Option<bool>,
    /// Uncapped unified-log decode + raised tar member size for large logarchive files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logarchive_uncapped: Option<bool>,
    /// Max tar member size in MiB (`0` = unlimited).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_entry_mb: Option<u32>,
    /// Rusty Magpie enrichment ran during Android bugreport ingest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub magpie: Option<bool>,
}

impl IngestJobOptions {
    /// Replay effective iOS knobs from a prior ingest as per-job overrides.
    pub fn to_sysdiagnose_overrides(&self) -> crate::platform_settings::SysdiagnoseIngestOverrides {
        crate::platform_settings::SysdiagnoseIngestOverrides {
            logarchive_uncapped: self.logarchive_uncapped,
            logarchive_decode_max_lines: self.logarchive_decode_max_lines,
            max_entry_mb: self.max_entry_mb,
            ioservice_full_tree: self.ioservice_full_tree,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestParserProgress {
    pub name: String,
    pub ok: bool,
    pub events: usize,
    pub duration_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// `running`, `done`, or `failed` during live sysdiagnose ingest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IngestJobProgress {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parsers: Vec<IngestParserProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeline_events: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mudm_events: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batch: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batches: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows_inserted: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsers_total: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsers_completed: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsers_active: Option<Vec<String>>,
    /// Live unified-log decode progress (iOS logarchive — often the slowest stage).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logarchive: Option<LogarchiveDecodeProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<IngestJobOptions>,
}

/// Progress for the post-parser logarchive decode step.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LogarchiveDecodeProgress {
    /// `starting` | `materializing` | `decoding` | `done` | `skipped` | `failed` | `deferred`
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_lines: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events_decoded: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_materialized: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracev3_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uncapped: Option<bool>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IngestJob {
    pub id: Uuid,
    pub source: String,
    pub platform: String,
    pub file_hash: String,
    pub status: String,
    pub events_count: i32,
    pub error: Option<String>,
    pub archive_path: Option<String>,
    pub file_size: i64,
    pub bytes_received: i64,
    pub case_user: Option<String>,
    pub ingest_tags: Vec<String>,
    pub stage: String,
    pub stage_detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<IngestJobProgress>,
    pub created_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

impl IngestJob {
    pub fn upload_progress_percent(&self) -> u8 {
        if self.file_size <= 0 {
            return 0;
        }
        ((self.bytes_received * 100) / self.file_size).min(100) as u8
    }

    /// Upload + server-side processing percent for UI progress bars.
    pub fn progress_percent(&self) -> u8 {
        match self.status.as_str() {
            "uploading" => self.upload_progress_percent(),
            "pending" => 90,
            "running" => self.running_progress_percent(),
            "done" => 100,
            _ => 0,
        }
    }

    fn running_progress_percent(&self) -> u8 {
        match self.stage.as_str() {
            "opening" => 91,
            "parsing" => {
                let Some(progress) = &self.progress else {
                    return 92;
                };
                let completed = progress.parsers_completed.unwrap_or(0);
                let total = progress.parsers_total.unwrap_or(1).max(1);
                (92 + ((completed * 2) / total).min(2)) as u8
            }
            "logarchive" => {
                let Some(progress) = &self.progress else {
                    return 93;
                };
                let Some(la) = &progress.logarchive else {
                    return 93;
                };
                match la.phase.as_str() {
                    "done" | "skipped" | "failed" | "deferred" => 94,
                    "decoding" => {
                        let decoded = la.events_decoded.unwrap_or(0);
                        let max = la.max_lines.unwrap_or(0);
                        if max > 0 && max != usize::MAX && decoded > 0 {
                            let pct = ((decoded * 2) / max).min(2) as u8;
                            93 + pct
                        } else {
                            93
                        }
                    }
                    _ => 93,
                }
            }
            "parsed" => 94,
            "inserting" => {
                let Some(progress) = &self.progress else {
                    return 95;
                };
                let batch = progress.batch.unwrap_or(0).max(1);
                let batches = progress.batches.unwrap_or(1).max(1);
                (95 + ((batch * 4) / batches).min(4)) as u8
            }
            "verifying" => 98,
            "syncing" => 99,
            _ => 93,
        }
    }
}

#[derive(sqlx::FromRow)]
struct JobRow {
    id: Uuid,
    source: String,
    platform: String,
    file_hash: String,
    status: String,
    events_count: i32,
    error: Option<String>,
    archive_path: Option<String>,
    file_size: i64,
    bytes_received: i64,
    case_user: Option<String>,
    ingest_tags: Vec<String>,
    stage: String,
    stage_detail: String,
    progress_json: Option<JsonValue>,
    created_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
}

fn row_to_job(r: JobRow) -> IngestJob {
    let progress = r.progress_json.and_then(|v| serde_json::from_value(v).ok());
    IngestJob {
        id: r.id,
        source: r.source,
        platform: r.platform,
        file_hash: r.file_hash,
        status: r.status,
        events_count: r.events_count,
        error: r.error,
        archive_path: r.archive_path,
        file_size: r.file_size,
        bytes_received: r.bytes_received,
        case_user: r.case_user,
        ingest_tags: r.ingest_tags,
        stage: r.stage,
        stage_detail: r.stage_detail,
        progress,
        created_at: r.created_at,
        finished_at: r.finished_at,
    }
}

const JOB_SELECT: &str = "SELECT id, source, platform, file_hash, status, events_count, error, \
    archive_path, file_size, bytes_received, case_user, ingest_tags, stage, stage_detail, progress_json, \
    created_at, finished_at FROM ingest_jobs";

#[derive(Clone)]
pub struct IngestJobRepository {
    pool: PgPool,
}

impl IngestJobRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<IngestJob>> {
        let row = sqlx::query_as::<_, JobRow>(&format!("{JOB_SELECT} WHERE id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(row_to_job))
    }

    pub async fn get_by_source_hash(
        &self,
        source: &str,
        file_hash: &str,
    ) -> anyhow::Result<Option<IngestJob>> {
        let row = sqlx::query_as::<_, JobRow>(&format!(
            "{JOB_SELECT} WHERE source = $1 AND file_hash = $2"
        ))
        .bind(source)
        .bind(file_hash)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(row_to_job))
    }

    /// Reserve or reset an upload session for `source` + `file_hash`.
    pub async fn begin_upload(
        &self,
        id: Uuid,
        source: &str,
        platform: &str,
        file_hash: &str,
        file_size: i64,
        archive_path: &str,
        case_user: Option<&str>,
        ingest_tags: &[String],
    ) -> anyhow::Result<IngestJob> {
        let row = sqlx::query_as::<_, JobRow>(
            "INSERT INTO ingest_jobs (id, source, platform, file_hash, status, file_size, bytes_received, archive_path, case_user, ingest_tags) \
             VALUES ($1, $2, $3, $4, 'uploading', $5, 0, $6, $7, $8) \
             ON CONFLICT (source, file_hash) DO UPDATE SET \
               platform = EXCLUDED.platform, \
               status = 'uploading', \
               file_size = EXCLUDED.file_size, \
               bytes_received = 0, \
               events_count = 0, \
               error = NULL, \
               finished_at = NULL, \
               archive_path = EXCLUDED.archive_path, \
               case_user = EXCLUDED.case_user, \
               ingest_tags = EXCLUDED.ingest_tags \
             RETURNING id, source, platform, file_hash, status, events_count, error, \
               archive_path, file_size, bytes_received, case_user, ingest_tags, stage, stage_detail, \
               progress_json, created_at, finished_at",
        )
        .bind(id)
        .bind(source)
        .bind(platform)
        .bind(file_hash)
        .bind(file_size)
        .bind(archive_path)
        .bind(case_user)
        .bind(ingest_tags)
        .fetch_one(&self.pool)
        .await?;
        Ok(row_to_job(row))
    }

    pub async fn update_upload_progress(
        &self,
        id: Uuid,
        bytes_received: i64,
    ) -> anyhow::Result<()> {
        sqlx::query("UPDATE ingest_jobs SET bytes_received = $2 WHERE id = $1")
            .bind(id)
            .bind(bytes_received)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn try_start(
        &self,
        source: &str,
        platform: &str,
        file_hash: &str,
    ) -> anyhow::Result<Option<IngestJob>> {
        let row = sqlx::query_as::<_, JobRow>(
            "INSERT INTO ingest_jobs (source, platform, file_hash, status) \
             VALUES ($1, $2, $3, 'running') \
             ON CONFLICT (source, file_hash) DO NOTHING \
             RETURNING id, source, platform, file_hash, status, events_count, error, \
               archive_path, file_size, bytes_received, case_user, ingest_tags, stage, stage_detail, \
               progress_json, created_at, finished_at",
        )
        .bind(source)
        .bind(platform)
        .bind(file_hash)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(r) = row {
            return Ok(Some(row_to_job(r)));
        }

        self.get_by_source_hash(source, file_hash).await
    }

    /// Allow re-ingest when ClickHouse was wiped but the dedup row remains in Postgres.
    ///
    /// Clears live progress, but keeps `progress_json.options` so re-ingest can replay
    /// the same sysdiagnose knobs (uncapped logarchive, max entry size, etc.).
    pub async fn mark_running(&self, id: Uuid) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE ingest_jobs SET status = 'running', events_count = 0, error = NULL, finished_at = NULL, \
             stage = 'opening', stage_detail = 'Opening archive…', \
             progress_json = CASE \
               WHEN progress_json IS NOT NULL AND progress_json ? 'options' \
                 THEN jsonb_build_object('options', progress_json->'options') \
               ELSE NULL \
             END \
             WHERE id = $1",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mark_pending(&self, id: Uuid) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE ingest_jobs SET status = 'pending', error = NULL, finished_at = NULL, \
             stage = 'queued', stage_detail = 'Queued for server processing…', progress_json = NULL WHERE id = $1",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_stage(
        &self,
        id: Uuid,
        stage: &str,
        stage_detail: &str,
        progress: Option<&IngestJobProgress>,
    ) -> anyhow::Result<()> {
        let progress_json = progress
            .map(serde_json::to_value)
            .transpose()
            .map_err(|e| anyhow::anyhow!("progress json: {e}"))?;
        sqlx::query(
            "UPDATE ingest_jobs SET stage = $2, stage_detail = $3, progress_json = $4 WHERE id = $1",
        )
        .bind(id)
        .bind(stage)
        .bind(stage_detail)
        .bind(progress_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn finish(
        &self,
        id: Uuid,
        events: i32,
        error: Option<&str>,
        final_progress: Option<&IngestJobProgress>,
    ) -> anyhow::Result<()> {
        let status = if error.is_some() { "failed" } else { "done" };
        let progress_json = final_progress
            .map(serde_json::to_value)
            .transpose()
            .map_err(|e| anyhow::anyhow!("progress json: {e}"))?;
        sqlx::query(
            "UPDATE ingest_jobs SET status = $2, events_count = $3, error = $4, \
             finished_at = now(), progress_json = COALESCE($5, progress_json) WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .bind(events)
        .bind(error)
        .bind(progress_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Latest completed ingest job `progress_json.options` per source label.
    pub async fn latest_done_options_by_sources(
        &self,
        sources: &[String],
    ) -> anyhow::Result<HashMap<String, IngestJobOptions>> {
        if sources.is_empty() {
            return Ok(HashMap::new());
        }
        let rows: Vec<(String, Option<JsonValue>)> = sqlx::query_as(
            "SELECT DISTINCT ON (source) source, progress_json FROM ingest_jobs \
             WHERE status = 'done' AND source = ANY($1) \
             ORDER BY source, finished_at DESC NULLS LAST, created_at DESC",
        )
        .bind(sources)
        .fetch_all(&self.pool)
        .await?;
        let mut out = HashMap::new();
        for (source, progress_json) in rows {
            let Some(progress_json) = progress_json else {
                continue;
            };
            let progress: IngestJobProgress = match serde_json::from_value(progress_json) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if let Some(options) = progress.options {
                out.insert(source, options);
            }
        }
        Ok(out)
    }

    pub async fn delete_by_source(&self, source: &str) -> anyhow::Result<u64> {
        let r = sqlx::query("DELETE FROM ingest_jobs WHERE source = $1")
            .bind(source)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected())
    }

    pub async fn rename_source(&self, old_source: &str, new_source: &str) -> anyhow::Result<u64> {
        let r = sqlx::query("UPDATE ingest_jobs SET source = $2 WHERE source = $1")
            .bind(old_source)
            .bind(new_source)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected())
    }

    pub async fn list_by_source(&self, source: &str, limit: i64) -> anyhow::Result<Vec<IngestJob>> {
        let rows = sqlx::query_as::<_, JobRow>(&format!(
            "{JOB_SELECT} WHERE source = $1 ORDER BY created_at DESC LIMIT $2"
        ))
        .bind(source)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(row_to_job).collect())
    }

    /// Count completed ingest runs per source (used to detect re-ingest on case search).
    pub async fn count_done_by_sources(
        &self,
        sources: &[String],
    ) -> anyhow::Result<HashMap<String, i64>> {
        if sources.is_empty() {
            return Ok(HashMap::new());
        }
        let rows: Vec<(String, i64)> = sqlx::query_as(
            "SELECT source, COUNT(*)::bigint FROM ingest_jobs \
             WHERE status = 'done' AND source = ANY($1) GROUP BY source",
        )
        .bind(sources)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().collect())
    }

    pub async fn list_recent(&self, limit: i64) -> anyhow::Result<Vec<IngestJob>> {
        let rows = sqlx::query_as::<_, JobRow>(&format!(
            "{JOB_SELECT} ORDER BY created_at DESC LIMIT $1"
        ))
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(row_to_job).collect())
    }
}
