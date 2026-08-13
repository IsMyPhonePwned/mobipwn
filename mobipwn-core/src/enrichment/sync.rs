use crate::config::AppConfig;
use crate::marketplace::EnrichmentProvider;
use serde::Serialize;
use sqlx::PgPool;
use std::time::Instant;

use super::ch::reload_enrichment_dictionaries;
use super::options::SyncOptions;
use super::progress::SyncProgress;
use super::provider::{adapter_for, SyncResult};
use super::sync_metrics::SyncStats;
use super::sync_status::{
    dev_dir, update_enrichment_sync_provider_stats, SyncStatusGuard,
};

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProviderSyncResult {
    pub slug: String,
    pub name: String,
    pub status: String,
    pub rows_written: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<SyncStats>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct SyncSummary {
    pub synced: usize,
    pub failed: usize,
    pub skipped: usize,
    pub rows_written: usize,
    pub elapsed_ms: u64,
    pub dictionaries_reloaded: bool,
    pub mode: String,
    pub providers: Vec<ProviderSyncResult>,
}

/// Sync enabled enrichment providers into ClickHouse tables (one adapter per provider).
/// Pass `source` (`"api"` or `"jobs"`) to publish running state for GET /v1/dev/logs.
pub async fn sync_all_providers(
    pool: &PgPool,
    config: &AppConfig,
    providers: &[EnrichmentProvider],
    source: Option<&str>,
    options: SyncOptions,
) -> anyhow::Result<SyncSummary> {
    sync_all_providers_with_progress(pool, config, providers, &SyncProgress::none(), source, options)
        .await
}

pub async fn sync_single_provider(
    pool: &PgPool,
    config: &AppConfig,
    provider: &EnrichmentProvider,
    source: Option<&str>,
    options: SyncOptions,
) -> anyhow::Result<SyncSummary> {
    sync_single_provider_with_progress(
        pool,
        config,
        provider,
        &SyncProgress::none(),
        source,
        options,
    )
    .await
}

pub async fn sync_single_provider_with_progress(
    pool: &PgPool,
    config: &AppConfig,
    provider: &EnrichmentProvider,
    progress: &SyncProgress,
    source: Option<&str>,
    options: SyncOptions,
) -> anyhow::Result<SyncSummary> {
    let started = Instant::now();
    let mode = sync_mode_label(options.full_resync);
    let _status_guard = source.map(|src| {
        SyncStatusGuard::begin(
            src,
            format!("Starting {mode} enrichment sync for {}", provider.name),
        )
    });
    emit_sync_mode_progress(progress, options.full_resync);
    progress.info(
        "start",
        format!("Starting enrichment sync for {} ({mode})", provider.name),
    );

    let mut summary = SyncSummary {
        mode: mode.into(),
        ..Default::default()
    };
    run_provider_sync(pool, config, provider, progress, source, options, mode, &mut summary).await?;
    finalize_sync_summary(config, progress, source, mode, started, &mut summary).await;
    Ok(summary)
}

pub async fn sync_all_providers_with_progress(
    pool: &PgPool,
    config: &AppConfig,
    providers: &[EnrichmentProvider],
    progress: &SyncProgress,
    source: Option<&str>,
    options: SyncOptions,
) -> anyhow::Result<SyncSummary> {
    let started = Instant::now();
    let enabled_count = providers.iter().filter(|p| p.enabled).count();
    let mode = sync_mode_label(options.full_resync);
    let _status_guard = source.map(|src| {
        SyncStatusGuard::begin(
            src,
            format!("Starting {mode} enrichment sync for {enabled_count} enabled provider(s)"),
        )
    });
    emit_sync_mode_progress(progress, options.full_resync);
    progress.info(
        "start",
        format!("Starting enrichment sync for {enabled_count} enabled provider(s) ({mode})"),
    );

    let mut summary = SyncSummary {
        mode: mode.into(),
        ..Default::default()
    };
    for p in providers {
        progress.ensure_not_cancelled()?;
        if !p.enabled {
            summary.skipped += 1;
            progress.provider(&p.slug, "skipped", format!("{} — disabled", p.name));
            summary.providers.push(ProviderSyncResult {
                slug: p.slug.clone(),
                name: p.name.clone(),
                status: "skipped".into(),
                rows_written: 0,
                error: None,
                duration_ms: 0,
                stats: None,
            });
            continue;
        }
        run_provider_sync(pool, config, p, progress, source, options, mode, &mut summary).await?;
    }
    finalize_sync_summary(config, progress, source, mode, started, &mut summary).await;
    Ok(summary)
}

fn sync_mode_label(full_resync: bool) -> &'static str {
    if full_resync {
        "full"
    } else {
        "incremental"
    }
}

fn emit_sync_mode_progress(progress: &SyncProgress, full_resync: bool) {
    if full_resync {
        progress.info("mode", "Full resync — re-querying all indicators");
    } else {
        progress.info("mode", "Incremental sync — new indicators only");
    }
}

async fn run_provider_sync(
    pool: &PgPool,
    config: &AppConfig,
    p: &EnrichmentProvider,
    progress: &SyncProgress,
    source: Option<&str>,
    options: SyncOptions,
    mode: &str,
    summary: &mut SyncSummary,
) -> anyhow::Result<()> {
    progress.ensure_not_cancelled()?;
    let provider_started = Instant::now();
    if source.is_some() {
        update_enrichment_sync_provider_stats(
            &p.slug,
            &p.name,
            format!("Syncing {}…", p.name),
            None,
        );
    }
    progress.provider(&p.slug, "provider_start", format!("Syncing {}…", p.name));
    match sync_provider(pool, config, p, progress, options).await {
        Ok(result) => {
            summary.synced += 1;
            summary.rows_written += result.rows_written;
            let stats_summary = result.stats.format_summary();
            progress.provider_stats(&p.slug, &result.stats);
            progress.provider(
                &p.slug,
                "provider_done",
                format!(
                    "{} finished — {} ({})",
                    p.name,
                    stats_summary,
                    format_duration_ms(provider_started.elapsed().as_millis() as u64)
                ),
            );
            if source.is_some() {
                update_enrichment_sync_provider_stats(
                    &p.slug,
                    &p.name,
                    format!("{} — {}", p.name, stats_summary),
                    Some(result.stats.clone()),
                );
            }
            tracing::info!(
                slug = %p.slug,
                rows = result.rows_written,
                api_requests = result.stats.api_requests,
                api_ok = result.stats.api_ok,
                api_miss = result.stats.api_miss,
                api_errors = result.stats.api_errors,
                skipped_already_enriched = result.stats.skipped_already_enriched,
                skipped_invalid = result.stats.skipped_invalid,
                skipped_duplicate = result.stats.skipped_duplicate,
                queued = result.stats.queued,
                duration_ms = provider_started.elapsed().as_millis() as u64,
                mode = %mode,
                "enrichment provider synced"
            );
            summary.providers.push(ProviderSyncResult {
                slug: p.slug.clone(),
                name: p.name.clone(),
                status: "ok".into(),
                rows_written: result.rows_written,
                error: None,
                duration_ms: provider_started.elapsed().as_millis() as u64,
                stats: Some(result.stats),
            });
        }
        Err(e) => {
            let msg = e.to_string();
            if msg == "sync cancelled" {
                progress.info("cancelled", "Sync stopped");
                return Err(e);
            }
            summary.failed += 1;
            mark_sync(pool, p.id, "error", Some(&msg)).await.ok();
            tracing::warn!(slug = %p.slug, error = %msg, "provider sync failed");
            progress.provider(&p.slug, "provider_error", format!("{} failed: {msg}", p.name));
            summary.providers.push(ProviderSyncResult {
                slug: p.slug.clone(),
                name: p.name.clone(),
                status: "error".into(),
                rows_written: 0,
                error: Some(msg),
                duration_ms: provider_started.elapsed().as_millis() as u64,
                stats: None,
            });
        }
    }
    Ok(())
}

async fn finalize_sync_summary(
    config: &AppConfig,
    progress: &SyncProgress,
    source: Option<&str>,
    mode: &str,
    started: Instant,
    summary: &mut SyncSummary,
) {
    if summary.rows_written > 0 {
        progress.info("dict_reload", "Reloading ClickHouse enrichment dictionaries…");
        summary.dictionaries_reloaded = reload_enrichment_dictionaries(config)
            .await
            .inspect_err(|e| tracing::warn!(error = %e, "failed to reload enrichment dictionaries"))
            .is_ok();
        if summary.dictionaries_reloaded {
            progress.info("dict_reload", "Enrichment dictionaries reloaded");
        } else {
            progress.info("dict_reload", "Dictionary reload failed — search may be stale until TTL");
        }
    }
    summary.elapsed_ms = started.elapsed().as_millis() as u64;
    progress.info(
        "complete",
        format!(
            "Sync finished ({mode}) — {} ok, {} failed, {} skipped, {} row(s) in {}",
            summary.synced,
            summary.failed,
            summary.skipped,
            summary.rows_written,
            format_duration_ms(summary.elapsed_ms)
        ),
    );
    append_sync_history(source.unwrap_or("unknown"), summary);
}

fn format_duration_ms(ms: u64) -> String {
    if ms < 1000 {
        format!("{ms} ms")
    } else {
        format!("{:.1}s", ms as f64 / 1000.0)
    }
}

fn append_sync_history(source: &str, summary: &SyncSummary) {
    let path = dev_dir().join("enrichment-sync-history.jsonl");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    #[derive(Serialize)]
    struct HistoryLine<'a> {
        finished_at: String,
        source: &'a str,
        summary: &'a SyncSummary,
    }
    let line = HistoryLine {
        finished_at: chrono::Utc::now().to_rfc3339(),
        source,
        summary,
    };
    if let Ok(body) = serde_json::to_string(&line) {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(f, "{body}");
        }
    }
}

async fn sync_provider(
    pool: &PgPool,
    config: &AppConfig,
    provider: &EnrichmentProvider,
    progress: &SyncProgress,
    options: SyncOptions,
) -> anyhow::Result<SyncResult> {
    let adapter = adapter_for(provider.kind, &provider.slug).ok_or_else(|| {
        anyhow::anyhow!("no built-in adapter for kind={:?} slug={}", provider.kind, provider.slug)
    })?;

    let result = adapter
        .sync(config, &provider.config, progress, &options)
        .await?;
    mark_sync(pool, provider.id, "ok", None).await?;
    Ok(result)
}

async fn mark_sync(
    pool: &PgPool,
    id: uuid::Uuid,
    status: &str,
    error: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE enrichment_providers SET last_sync_at = now(), last_sync_status = $2, last_sync_error = $3 WHERE id = $1",
    )
    .bind(id)
    .bind(status)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::enrichment::test_util::dev_dir_test_lock;

    #[test]
    fn format_duration_ms_under_one_second() {
        assert_eq!(format_duration_ms(500), "500 ms");
        assert_eq!(format_duration_ms(0), "0 ms");
    }

    #[test]
    fn format_duration_ms_as_seconds() {
        assert_eq!(format_duration_ms(1500), "1.5s");
        assert_eq!(format_duration_ms(2000), "2.0s");
    }

    #[test]
    fn append_sync_history_appends_jsonl() {
        let _lock = dev_dir_test_lock();
        let dir = std::env::temp_dir().join(format!("mobipwn_sync_hist_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        std::env::set_var("MOBIPWN_DEV_DIR", dir.to_string_lossy().as_ref());

        let summary = SyncSummary {
            mode: "incremental".into(),
            synced: 2,
            failed: 0,
            skipped: 1,
            rows_written: 3,
            elapsed_ms: 250,
            dictionaries_reloaded: true,
            providers: vec![ProviderSyncResult {
                slug: "virustotal".into(),
                name: "VirusTotal".into(),
                status: "ok".into(),
                rows_written: 3,
                error: None,
                duration_ms: 200,
                stats: None,
            }],
        };
        append_sync_history("api", &summary);

        let path = dir.join("enrichment-sync-history.jsonl");
        let body = std::fs::read_to_string(&path).expect("history file");
        assert!(body.contains("\"source\":\"api\""));
        assert!(body.contains("\"rows_written\":3"));
        assert!(body.contains("virustotal"));

        std::env::remove_var("MOBIPWN_DEV_DIR");
        let _ = std::fs::remove_dir_all(dir);
    }
}
