//! Per-provider enrichment sync cron jobs (replaces global 5-minute tick).

use mobipwn_core::config::AppConfig;
use mobipwn_core::enrichment::{normalize_sync_cron, parse_sync_cron, sync_single_provider, SyncOptions};
use mobipwn_core::{effective_app_config, ProviderRepository, SettingsRepository};
use std::collections::HashMap;
use std::sync::Arc;
use tokio_cron_scheduler::{Job, JobScheduler};
use tracing::{info, warn};
use uuid::Uuid;

struct ActiveJob {
    job_id: Uuid,
    cron: String,
}

pub struct EnrichmentScheduler {
    sched: JobScheduler,
    active: HashMap<Uuid, ActiveJob>,
}

#[derive(Clone)]
pub struct EnrichmentSchedulerContext {
    pub config: Arc<AppConfig>,
    pub settings: Arc<SettingsRepository>,
    pub pool: sqlx::PgPool,
    pub providers: Arc<ProviderRepository>,
}

impl EnrichmentScheduler {
    pub async fn new() -> anyhow::Result<Self> {
        let sched = JobScheduler::new().await?;
        sched.start().await?;
        Ok(Self {
            sched,
            active: HashMap::new(),
        })
    }

    /// Reconcile cron jobs with enabled providers and their `config.sync_cron`.
    pub async fn sync(&mut self, ctx: &EnrichmentSchedulerContext) -> anyhow::Result<()> {
        let list = ctx.providers.list().await?;
        let mut desired: HashMap<Uuid, String> = HashMap::new();

        for provider in &list {
            if !provider.enabled {
                continue;
            }
            let Some(cron) = parse_sync_cron(&provider.config) else {
                continue;
            };
            desired.insert(provider.id, normalize_sync_cron(&cron));
        }

        let stale: Vec<Uuid> = self
            .active
            .keys()
            .copied()
            .filter(|id| !desired.contains_key(id))
            .collect();
        for provider_id in stale {
            if let Some(job) = self.active.remove(&provider_id) {
                self.sched.remove(&job.job_id).await.ok();
                info!(provider_id = %provider_id, "removed enrichment sync cron");
            }
        }

        for provider in list {
            if !provider.enabled {
                continue;
            }
            let Some(cron) = parse_sync_cron(&provider.config) else {
                continue;
            };
            let cron = normalize_sync_cron(&cron);
            if let Some(existing) = self.active.get(&provider.id) {
                if existing.cron == cron {
                    continue;
                }
                self.sched.remove(&existing.job_id).await.ok();
                self.active.remove(&provider.id);
            }
            match self.register_provider(ctx, provider.id, &provider.slug, &cron).await {
                Ok(job_id) => {
                    self.active.insert(
                        provider.id,
                        ActiveJob {
                            job_id,
                            cron: cron.clone(),
                        },
                    );
                    info!(provider = %provider.slug, cron = %cron, "registered enrichment sync cron");
                }
                Err(e) => warn!(provider = %provider.slug, error = %e, "enrichment cron registration failed"),
            }
        }
        Ok(())
    }

    async fn register_provider(
        &self,
        ctx: &EnrichmentSchedulerContext,
        provider_id: Uuid,
        slug: &str,
        cron: &str,
    ) -> anyhow::Result<Uuid> {
        let ctx = ctx.clone();
        let slug = slug.to_string();
        let job = Job::new_async(cron, move |_uuid, _lock| {
            let ctx = ctx.clone();
            let slug = slug.clone();
            Box::pin(async move {
                let Ok(list) = ctx.providers.list().await else {
                    return;
                };
                let Some(provider) = list.into_iter().find(|p| p.id == provider_id) else {
                    return;
                };
                if !provider.enabled {
                    return;
                }
                if parse_sync_cron(&provider.config).is_none() {
                    return;
                }
                let config = effective_app_config(&ctx.settings, &ctx.config)
                    .await
                    .unwrap_or_else(|_| (*ctx.config).clone());
                match sync_single_provider(
                    &ctx.pool,
                    &config,
                    &provider,
                    Some("jobs"),
                    SyncOptions::incremental(),
                )
                .await
                {
                    Ok(summary) => {
                        if summary.synced > 0 || summary.failed > 0 {
                            info!(
                                provider = %slug,
                                synced = summary.synced,
                                failed = summary.failed,
                                rows = summary.rows_written,
                                elapsed_ms = summary.elapsed_ms,
                                "scheduled enrichment sync"
                            );
                        }
                    }
                    Err(e) => warn!(provider = %slug, error = %e, "scheduled enrichment sync failed"),
                }
            })
        })?;
        let id = self.sched.add(job).await?;
        Ok(id)
    }
}
