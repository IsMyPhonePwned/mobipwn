//! mobipwn-jobs — per-rule cron detections, enrichment sync, prevalence rollup, realtime signals.

mod enrichment_scheduler;
mod scheduler;

use mobipwn_core::ch::signals::{process_realtime_signals, rollup_prevalence};
use mobipwn_core::config::AppConfig;
use mobipwn_core::detection::{drop_materialized_view, sync_materialized_view};
use mobipwn_core::{
    bootstrap_from_env, effective_app_config, run_migrations, AlertRepository,
    DetectionRunRepository, ProviderRepository, RuleRepository, SettingsRepository,
    SuppressionRepository,
};
use mobipwn_search::{generate_events_where_clause, parse_mpl};
use enrichment_scheduler::{EnrichmentScheduler, EnrichmentSchedulerContext};
use scheduler::{DetectionScheduler, SchedulerContext};
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = AppConfig::from_env();
    if !config.jobs_enabled {
        info!("MOBIPWN_JOBS_ENABLED=0 — exiting");
        return Ok(());
    }

    let pg = sqlx::postgres::PgPoolOptions::new()
        .connect(&config.postgres_url)
        .await?;
    run_migrations(&pg).await?;
    bootstrap_from_env(&SettingsRepository::new(pg.clone()), &config).await?;

    let settings = Arc::new(SettingsRepository::new(pg.clone()));
    let ctx = SchedulerContext {
        config: Arc::new(config.clone()),
        settings: settings.clone(),
        rules: Arc::new(RuleRepository::new(pg.clone())),
        alerts: Arc::new(AlertRepository::new(pg.clone())),
        runs: Arc::new(DetectionRunRepository::new(pg.clone())),
        suppressions: Arc::new(SuppressionRepository::new(pg.clone())),
    };
    let providers = Arc::new(ProviderRepository::new(pg.clone()));

    let mut detection_sched = DetectionScheduler::new().await?;
    detection_sched.sync(&ctx).await?;

    let enrichment_ctx = EnrichmentSchedulerContext {
        config: ctx.config.clone(),
        settings: settings.clone(),
        pool: pg.clone(),
        providers: providers.clone(),
    };
    let mut enrichment_sched = EnrichmentScheduler::new().await?;
    enrichment_sched.sync(&enrichment_ctx).await?;

    info!("mobipwn-jobs started (per-rule + per-provider cron schedulers)");

    let mut tick: u64 = 0;
    loop {
        tick += 1;
        if tick % 2 == 0 {
            if let Err(e) = detection_sched.sync(&ctx).await {
                warn!(error = %e, "cron scheduler sync");
            }
            if let Err(e) = enrichment_sched.sync(&enrichment_ctx).await {
                warn!(error = %e, "enrichment cron scheduler sync");
            }
        }
        if tick % 15 == 0 {
            if let Err(e) = rollup_prevalence(&config).await {
                warn!(error = %e, "prevalence rollup");
            }
        }
        if tick % 2 == 0 {
            if let Err(e) = process_realtime_signals(
                &config,
                &pg,
                &ctx.suppressions,
                &ctx.alerts,
                &ctx.rules,
                &ctx.runs,
                &SettingsRepository::new(pg.clone()),
            )
            .await
            {
                warn!(error = %e, "realtime signals");
            }
        }
        if tick % 10 == 0 {
            if let Err(e) = realtime_mv_sync_tick(&settings, &config, &ctx.rules).await {
                warn!(error = %e, "realtime MV sync");
            }
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

async fn realtime_mv_sync_tick(
    settings: &SettingsRepository,
    base: &AppConfig,
    rules: &RuleRepository,
) -> anyhow::Result<()> {
    use mobipwn_search::admission::resolve_realtime_mv_time_bounds;

    let config = effective_app_config(settings, base).await?;

    for rule in rules.list_active_realtime().await? {
        let mpl = match parse_mpl(&rule.query) {
            Ok(m) => m,
            Err(e) => {
                warn!(rule = %rule.name, error = %e, "realtime MV skip");
                continue;
            }
        };
        let bounds = resolve_realtime_mv_time_bounds(&mpl);
        let where_clause = match generate_events_where_clause(
            &mpl,
            bounds.time_from.as_deref(),
            bounds.time_to.as_deref(),
        ) {
            Ok(w) => w,
            Err(e) => {
                warn!(rule = %rule.name, error = %e, "realtime MV skip");
                continue;
            }
        };
        drop_materialized_view(&config, rule.id).await.ok();
        match sync_materialized_view(&config, rule.id, &rule.name, &where_clause).await {
            Ok(mv) => {
                rules.set_realtime_mv(rule.id, Some(&mv)).await?;
            }
            Err(e) => warn!(rule = %rule.name, error = %e, "realtime MV sync failed"),
        }
    }
    Ok(())
}
