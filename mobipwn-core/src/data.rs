use crate::ch::{post_sql, query_json_each_row};
use crate::config::AppConfig;
use crate::db::{run_migrations, DualPool, PoolHealth};
use crate::store::{AlertRepository, CaseRepository, CollectBlobRepository, IngestJobOptions, IngestJobRepository};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct SourceParserStat {
    pub name: String,
    pub event_count: u64,
}

#[derive(Debug, Serialize)]
pub struct SourceSummary {
    pub source: String,
    pub platform: String,
    pub source_type: String,
    pub event_count: u64,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    /// Earliest ClickHouse `ingest_time` for this source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_ingest: Option<String>,
    pub last_ingest: Option<String>,
    /// Device owner set at ingest time (`?user=` / upload `user` field).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_user: Option<String>,
    /// Parsers present in ClickHouse for this source (with event counts).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parsers: Vec<SourceParserStat>,
    /// Ingest-time options (build features, logarchive decode, etc.).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ingest_options: Option<IngestJobOptions>,
}

#[derive(Debug, Serialize)]
pub struct DataSummary {
    pub total_events: u64,
    pub sources: Vec<SourceSummary>,
    /// Cargo features enabled in the running API / ingest binary.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub build_features: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DeleteIngestResponse {
    pub source: String,
    pub events_deleted: u64,
    pub cases_removed: u64,
    pub ingest_jobs_removed: u64,
    pub collect_blobs_removed: u64,
    pub alerts_removed: u64,
    pub audit_events_deleted: u64,
    pub detection_signals_deleted: u64,
}

#[derive(Debug, Serialize)]
pub struct ClearIngestEventsResponse {
    pub source: String,
    pub events_deleted: u64,
    pub detection_signals_deleted: u64,
}

/// Remove ClickHouse events (and related detection signals) for a source without deleting
/// the investigation case, stored blobs, or ingest job metadata.
pub async fn clear_ingest_events_for_source(
    config: &AppConfig,
    source: &str,
) -> anyhow::Result<ClearIngestEventsResponse> {
    let source = source.trim();
    if source.is_empty() {
        anyhow::bail!("source label is required");
    }
    if source.len() > 500 {
        anyhow::bail!("source label too long (max 500 characters)");
    }

    let detection_signals_deleted =
        delete_clickhouse_detection_signals_for_source(config, source).await?;
    let events_deleted = delete_clickhouse_events_by_source(config, source).await?;
    wait_clickhouse_source_empty(config, source, Duration::from_secs(20)).await;

    tracing::info!(
        %source,
        events_deleted,
        detection_signals_deleted,
        "cleared ingest events for source"
    );

    Ok(ClearIngestEventsResponse {
        source: source.to_string(),
        events_deleted,
        detection_signals_deleted,
    })
}

pub async fn fetch_data_summary(
    pool: &Arc<DualPool>,
    config: &AppConfig,
    build_features: &[&str],
) -> anyhow::Result<DataSummary> {
    if pool.health().await == PoolHealth::PostgresOnly {
        anyhow::bail!("ClickHouse unavailable — start Docker / ./dev.sh");
    }

    let db = &config.clickhouse_database;
    let total_rows = query_json_each_row(
        config,
        db,
        &format!("SELECT count() AS c FROM {db}.events"),
    )
    .await?;
    let total_events = total_rows
        .first()
        .and_then(|r| r.get("c"))
        .map(json_u64)
        .unwrap_or(0);

    let source_rows = query_json_each_row(
        config,
        db,
        &format!(
            "SELECT source, platform, source_type, \
             count() AS event_count, \
             min(timestamp) AS first_seen, \
             max(timestamp) AS last_seen, \
             min(ingest_time) AS first_ingest, \
             max(ingest_time) AS last_ingest \
             FROM {db}.events \
             GROUP BY source, platform, source_type \
             ORDER BY last_ingest DESC \
             LIMIT 200"
        ),
    )
    .await?;

    let case_users = fetch_case_users_by_source(&pool.postgres).await.unwrap_or_default();

    let parser_stats = fetch_parser_stats_by_source(config).await.unwrap_or_default();
    let ingest_hints = fetch_ingest_option_hints(config).await.unwrap_or_default();
    let source_labels: Vec<String> = source_rows
        .iter()
        .filter_map(|r| json_str(r.get("source")))
        .collect();
    let job_options = IngestJobRepository::new(pool.postgres.clone())
        .latest_done_options_by_sources(&source_labels)
        .await
        .unwrap_or_default();

    let sources = source_rows
        .into_iter()
        .filter_map(|r| {
            let source = json_str(r.get("source"))?;
            let mut parsers = parser_stats.get(&source).cloned().unwrap_or_default();
            parsers.sort_by(|a, b| b.event_count.cmp(&a.event_count).then_with(|| a.name.cmp(&b.name)));

            let ingest_options = job_options
                .get(&source)
                .cloned()
                .or_else(|| ingest_hints.get(&source).cloned())
                .filter(|o| !ingest_options_empty(o));

            Some(SourceSummary {
                platform: json_str(r.get("platform")).unwrap_or_default(),
                source_type: json_str(r.get("source_type")).unwrap_or_default(),
                event_count: r
                    .get("event_count")
                    .map(|v| json_u64(v))
                    .unwrap_or(0),
                first_seen: json_time(r.get("first_seen")),
                last_seen: json_time(r.get("last_seen")),
                first_ingest: json_time(r.get("first_ingest")),
                last_ingest: json_time(r.get("last_ingest")),
                case_user: case_users.get(&source).cloned(),
                parsers,
                ingest_options,
                source,
            })
        })
        .collect::<Vec<SourceSummary>>();

    let tombstoned = fetch_tombstoned_sources(&pool.postgres)
        .await
        .unwrap_or_default();
    let sources: Vec<SourceSummary> = sources
        .into_iter()
        .filter(|s| !tombstoned.contains(&s.source))
        .collect();

    Ok(DataSummary {
        total_events,
        sources,
        build_features: build_features.iter().map(|s| (*s).to_string()).collect(),
    })
}

/// Map ingest source labels to device owner (`cases.case_user`, else latest `ingest_jobs.case_user`).
async fn fetch_case_users_by_source(pool: &sqlx::PgPool) -> anyhow::Result<HashMap<String, String>> {
    let mut out = HashMap::new();

    let case_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT ingest_source, case_user FROM cases \
         WHERE ingest_source IS NOT NULL AND ingest_source <> '' AND case_user <> ''",
    )
    .fetch_all(pool)
    .await?;
    for (source, user) in case_rows {
        out.entry(source).or_insert(user);
    }

    let job_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT DISTINCT ON (source) source, case_user FROM ingest_jobs \
         WHERE case_user IS NOT NULL AND case_user <> '' \
         ORDER BY source, created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    for (source, user) in job_rows {
        out.entry(source).or_insert(user);
    }

    Ok(out)
}

/// Remove all data tied to an ingest `source` label (ClickHouse, Postgres, blobs, alerts).
pub async fn delete_ingest_source(
    pool: &Arc<DualPool>,
    config: &AppConfig,
    cases: &CaseRepository,
    ingest_jobs: &IngestJobRepository,
    collect_blobs: &CollectBlobRepository,
    alerts: &AlertRepository,
    source: &str,
) -> anyhow::Result<DeleteIngestResponse> {
    if pool.health().await == PoolHealth::PostgresOnly {
        anyhow::bail!("ClickHouse unavailable — start Docker / ./dev.sh");
    }

    let source = source.trim();
    if source.is_empty() {
        anyhow::bail!("source label is required");
    }
    if source.len() > 500 {
        anyhow::bail!("source label too long (max 500 characters)");
    }

    let _ = run_migrations(&pool.postgres).await;

    cases.tombstone_ingest_source(source).await?;

    let case_ids = cases.find_ids_for_ingest_source(source).await?;

    let detection_signals_deleted =
        delete_clickhouse_detection_signals_for_source(config, source).await?;
    let audit_events_deleted =
        delete_clickhouse_case_audit_events(config, &case_ids).await?;
    let collect_blobs_removed = collect_blobs.delete_by_source(source).await?;
    let alerts_removed = alerts.delete_for_ingest_source(source, &case_ids).await?;
    let events_deleted = delete_clickhouse_events_by_source(config, source).await?;
    wait_clickhouse_source_empty(config, source, Duration::from_secs(20)).await;
    let cases_removed = cases.delete_by_ingest_source(source).await?;
    let ingest_jobs_removed = ingest_jobs.delete_by_source(source).await?;

    tracing::info!(
        %source,
        events_deleted,
        cases_removed,
        ingest_jobs_removed,
        collect_blobs_removed,
        alerts_removed,
        audit_events_deleted,
        detection_signals_deleted,
        "purged ingest source"
    );

    Ok(DeleteIngestResponse {
        source: source.to_string(),
        events_deleted,
        cases_removed,
        ingest_jobs_removed,
        collect_blobs_removed,
        alerts_removed,
        audit_events_deleted,
        detection_signals_deleted,
    })
}

async fn fetch_tombstoned_sources(pool: &sqlx::PgPool) -> anyhow::Result<HashSet<String>> {
    let rows: Vec<String> =
        sqlx::query_scalar("SELECT source FROM ingest_source_tombstones")
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().collect())
}

/// Count ClickHouse rows for an ingest `source` label.
pub async fn count_events_by_source(config: &AppConfig, source: &str) -> anyhow::Result<u64> {
    let db = &config.clickhouse_database;
    let esc = escape_clickhouse_literal(source.trim());
    if esc.is_empty() {
        return Ok(0);
    }
    let count_sql = format!("SELECT count() AS c FROM {db}.events WHERE source = '{esc}'");
    let count_rows = query_json_each_row(config, db, &count_sql).await?;
    Ok(count_rows
        .first()
        .and_then(|r| r.get("c"))
        .map(json_u64)
        .unwrap_or(0))
}

#[derive(Debug, Serialize)]
pub struct RenameIngestSourceResponse {
    pub old_source: String,
    pub new_source: String,
    pub events_updated: u64,
    pub ingest_jobs_updated: u64,
}

/// Relabel an ingest source in ClickHouse and Postgres (cases keep same row id).
pub async fn rename_ingest_source(
    pool: &Arc<DualPool>,
    config: &AppConfig,
    ingest_jobs: &IngestJobRepository,
    old_source: &str,
    new_source: &str,
) -> anyhow::Result<RenameIngestSourceResponse> {
    if pool.health().await == PoolHealth::PostgresOnly {
        anyhow::bail!("ClickHouse unavailable — start Docker / ./dev.sh");
    }
    let old_source = old_source.trim();
    let new_source = new_source.trim();
    if old_source.is_empty() || new_source.is_empty() {
        anyhow::bail!("source labels are required");
    }
    if old_source == new_source {
        return Ok(RenameIngestSourceResponse {
            old_source: old_source.to_string(),
            new_source: new_source.to_string(),
            events_updated: 0,
            ingest_jobs_updated: 0,
        });
    }

    let db = &config.clickhouse_database;
    let old_esc = escape_clickhouse_literal(old_source);
    let new_esc = escape_clickhouse_literal(new_source);
    let count_sql = format!("SELECT count() AS c FROM {db}.events WHERE source = '{old_esc}'");
    let count_rows = query_json_each_row(config, db, &count_sql).await?;
    let events_updated = count_rows
        .first()
        .and_then(|r| r.get("c"))
        .map(json_u64)
        .unwrap_or(0);
    if events_updated > 0 {
        let update_sql =
            format!("ALTER TABLE {db}.events UPDATE source = '{new_esc}' WHERE source = '{old_esc}'");
        post_sql(config, &update_sql).await?;
    }

    let ingest_jobs_updated = ingest_jobs.rename_source(old_source, new_source).await?;

    sqlx::query("UPDATE ironsift_run_devices SET source = $2 WHERE source = $1")
        .bind(old_source)
        .bind(new_source)
        .execute(&pool.postgres)
        .await?;

    tracing::info!(
        old = old_source,
        new = new_source,
        events_updated,
        ingest_jobs_updated,
        "renamed ingest source"
    );

    Ok(RenameIngestSourceResponse {
        old_source: old_source.to_string(),
        new_source: new_source.to_string(),
        events_updated,
        ingest_jobs_updated,
    })
}

async fn delete_clickhouse_events_by_source(
    config: &AppConfig,
    source: &str,
) -> anyhow::Result<u64> {
    let db = &config.clickhouse_database;
    let esc = escape_clickhouse_literal(source);
    let count_sql = format!("SELECT count() AS c FROM {db}.events WHERE source = '{esc}'");
    let count_rows = query_json_each_row(config, db, &count_sql).await?;
    let n = count_rows
        .first()
        .and_then(|r| r.get("c"))
        .map(json_u64)
        .unwrap_or(0);
    if n == 0 {
        return Ok(0);
    }
    let delete_sql = format!("ALTER TABLE {db}.events DELETE WHERE source = '{esc}'");
    post_sql(config, &delete_sql).await?;
    Ok(n)
}

async fn delete_clickhouse_detection_signals_for_source(
    config: &AppConfig,
    source: &str,
) -> anyhow::Result<u64> {
    let db = &config.clickhouse_database;
    let esc = escape_clickhouse_literal(source);
    let count_sql = format!(
        "SELECT count() AS c FROM {db}.detection_signals \
         WHERE event_id IN (SELECT id FROM {db}.events WHERE source = '{esc}')"
    );
    let count_rows = query_json_each_row(config, db, &count_sql).await?;
    let n = count_rows
        .first()
        .and_then(|r| r.get("c"))
        .map(json_u64)
        .unwrap_or(0);
    if n == 0 {
        return Ok(0);
    }
    let delete_sql = format!(
        "ALTER TABLE {db}.detection_signals DELETE WHERE event_id IN \
         (SELECT id FROM {db}.events WHERE source = '{esc}')"
    );
    post_sql(config, &delete_sql).await?;
    Ok(n)
}

async fn delete_clickhouse_case_audit_events(
    config: &AppConfig,
    case_ids: &[Uuid],
) -> anyhow::Result<u64> {
    if case_ids.is_empty() {
        return Ok(0);
    }
    let db = &config.clickhouse_database;
    let mut total = 0u64;
    for case_id in case_ids {
        let case_id_str = case_id.to_string();
        let count_sql = format!(
            "SELECT count() AS c FROM {db}.events \
             WHERE source_type = 'audit' AND source = 'case' \
             AND JSONExtractString(ext, 'case_id') = '{case_id_str}'"
        );
        let count_rows = query_json_each_row(config, db, &count_sql).await?;
        let n = count_rows
            .first()
            .and_then(|r| r.get("c"))
            .map(json_u64)
            .unwrap_or(0);
        if n == 0 {
            continue;
        }
        let delete_sql = format!(
            "ALTER TABLE {db}.events DELETE WHERE source_type = 'audit' AND source = 'case' \
             AND JSONExtractString(ext, 'case_id') = '{case_id_str}'"
        );
        post_sql(config, &delete_sql).await?;
        total += n;
    }
    Ok(total)
}

async fn wait_clickhouse_source_empty(
    config: &AppConfig,
    source: &str,
    max_wait: Duration,
) {
    let started = Instant::now();
    while started.elapsed() < max_wait {
        match count_events_by_source(config, source).await {
            Ok(0) => return,
            Ok(_) => tokio::time::sleep(Duration::from_millis(400)).await,
            Err(e) => {
                tracing::warn!(source, error = %e, "wait for ClickHouse purge");
                return;
            }
        }
    }
    tracing::warn!(
        source,
        waited_secs = max_wait.as_secs(),
        "ClickHouse events may still be merging after delete"
    );
}

fn escape_clickhouse_literal(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "''")
}

fn json_str(v: Option<&Value>) -> Option<String> {
    let v = v?;
    if let Some(s) = v.as_str() {
        return Some(s.to_string());
    }
    if v.is_null() {
        return None;
    }
    Some(v.to_string().trim_matches('"').to_string())
}

fn json_time(v: Option<&Value>) -> Option<String> {
    let s = json_str(v)?;
    let t = s.trim();
    // ClickHouse DateTime JSON is typically "YYYY-MM-DD HH:MM:SS[.fff]" in UTC with no
    // zone suffix. Browsers treat that as *local* time, shifting relative labels by the
    // local UTC offset (e.g. CEST +2h → "2h ago" for a fresh ingest). Emit RFC3339 UTC.
    let bytes = t.as_bytes();
    if bytes.len() >= 19
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && (bytes[10] == b' ' || bytes[10] == b'T')
        && bytes[13] == b':'
        && bytes[16] == b':'
    {
        let date = &t[..10];
        let time = &t[11..19];
        return Some(format!("{date}T{time}Z"));
    }
    Some(s)
}

fn json_u64(v: &Value) -> u64 {
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0)
}

async fn fetch_parser_stats_by_source(
    config: &AppConfig,
) -> anyhow::Result<HashMap<String, Vec<SourceParserStat>>> {
    let db = &config.clickhouse_database;
    let rows = query_json_each_row(
        config,
        db,
        &format!(
            "SELECT source, parser, count() AS event_count \
             FROM {db}.events \
             GROUP BY source, parser \
             ORDER BY source, event_count DESC"
        ),
    )
    .await?;
    let mut out: HashMap<String, Vec<SourceParserStat>> = HashMap::new();
    for r in rows {
        let Some(source) = json_str(r.get("source")) else {
            continue;
        };
        let name = json_str(r.get("parser")).unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let event_count = r
            .get("event_count")
            .map(json_u64)
            .unwrap_or(0);
        out.entry(source).or_default().push(SourceParserStat { name, event_count });
    }
    Ok(out)
}

/// Infer ingest options from indexed events when job metadata is missing (CLI ingest, old jobs).
async fn fetch_ingest_option_hints(
    config: &AppConfig,
) -> anyhow::Result<HashMap<String, IngestJobOptions>> {
    let db = &config.clickhouse_database;
    let rows = query_json_each_row(
        config,
        db,
        &format!(
            "SELECT source, \
             countIf(parser = 'logarchive' AND action = 'logarchive_event') AS la_decoded, \
             countIf(parser = 'logarchive' AND action = 'logarchive_inventory') AS la_inventory, \
             countIf(parser = 'magpie') AS magpie_events \
             FROM {db}.events \
             GROUP BY source"
        ),
    )
    .await?;
    let mut out = HashMap::new();
    for r in rows {
        let Some(source) = json_str(r.get("source")) else {
            continue;
        };
        let la_decoded = r.get("la_decoded").map(json_u64).unwrap_or(0);
        let la_inventory = r.get("la_inventory").map(json_u64).unwrap_or(0);
        let magpie_events = r.get("magpie_events").map(json_u64).unwrap_or(0);
        let logarchive_decode = if la_decoded > 0 {
            Some("enabled".into())
        } else if la_inventory > 0 {
            Some("deferred".into())
        } else {
            None
        };
        let magpie = if magpie_events > 0 { Some(true) } else { None };
        if logarchive_decode.is_none() && magpie.is_none() {
            continue;
        }
        out.insert(
            source,
            IngestJobOptions {
                logarchive_decode,
                magpie,
                ..Default::default()
            },
        );
    }
    Ok(out)
}

fn ingest_options_empty(o: &IngestJobOptions) -> bool {
    o.build_features.is_empty()
        && o.logarchive_decode.is_none()
        && o.logarchive_decode_max_lines.is_none()
        && o.ioservice_full_tree.is_none()
        && o.logarchive_uncapped.is_none()
        && o.max_entry_mb.is_none()
        && o.magpie.is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_time_emits_rfc3339_utc() {
        assert_eq!(
            json_time(Some(&json!("2026-08-03 10:15:05.268309"))).as_deref(),
            Some("2026-08-03T10:15:05Z")
        );
        assert_eq!(
            json_time(Some(&json!("2026-08-03T10:15:05"))).as_deref(),
            Some("2026-08-03T10:15:05Z")
        );
    }
}
