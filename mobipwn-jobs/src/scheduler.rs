//! Per-rule cron jobs via `tokio-cron-scheduler` (replaces 60s poll-all).

use mobipwn_core::config::AppConfig;
use mobipwn_core::detection::DetectionRule;
use mobipwn_core::{
    effective_app_config, AlertRepository, DetectionRunRepository, RuleRepository,
    SettingsRepository, SuppressionRepository,
};
use mobipwn_search::{execute_detection_rule, ExecuteDetectionOptions};
use std::collections::HashMap;
use std::sync::Arc;
use tokio_cron_scheduler::{Job, JobScheduler};
use tracing::{info, warn};
use uuid::Uuid;

struct ActiveJob {
    job_id: Uuid,
    cron: String,
}

pub struct DetectionScheduler {
    sched: JobScheduler,
    active: HashMap<Uuid, ActiveJob>,
}

#[derive(Clone)]
pub struct SchedulerContext {
    pub config: Arc<AppConfig>,
    pub settings: Arc<SettingsRepository>,
    pub rules: Arc<RuleRepository>,
    pub alerts: Arc<AlertRepository>,
    pub runs: Arc<DetectionRunRepository>,
    pub suppressions: Arc<SuppressionRepository>,
}

impl DetectionScheduler {
    pub async fn new() -> anyhow::Result<Self> {
        let sched = JobScheduler::new().await?;
        sched.start().await?;
        Ok(Self {
            sched,
            active: HashMap::new(),
        })
    }

    /// Reconcile cron jobs with current DB rules (call periodically and on startup).
    pub async fn sync(&mut self, ctx: &SchedulerContext) -> anyhow::Result<()> {
        let rules = ctx.rules.list_active_scheduled().await?;
        let mut desired: HashMap<Uuid, String> = HashMap::new();
        for rule in &rules {
            let Some(cron) = rule.cron.as_ref().filter(|c| !c.trim().is_empty()) else {
                continue;
            };
            desired.insert(rule.id, normalize_cron(cron));
        }

        let stale: Vec<Uuid> = self
            .active
            .keys()
            .copied()
            .filter(|id| !desired.contains_key(id))
            .collect();
        for rule_id in stale {
            if let Some(job) = self.active.remove(&rule_id) {
                self.sched.remove(&job.job_id).await.ok();
                info!(rule_id = %rule_id, "removed cron job");
            }
        }

        for rule in rules {
            let Some(cron) = rule.cron.as_ref().filter(|c| !c.trim().is_empty()) else {
                continue;
            };
            let cron = normalize_cron(cron);
            if let Some(existing) = self.active.get(&rule.id) {
                if existing.cron == cron {
                    continue;
                }
                self.sched.remove(&existing.job_id).await.ok();
                self.active.remove(&rule.id);
            }
            match self.register_rule(ctx, &rule, &cron).await {
                Ok(job_id) => {
                    self.active.insert(
                        rule.id,
                        ActiveJob {
                            job_id,
                            cron: cron.clone(),
                        },
                    );
                    info!(rule = %rule.name, cron = %cron, "registered cron job");
                }
                Err(e) => warn!(rule = %rule.name, error = %e, "cron registration failed"),
            }
        }
        Ok(())
    }

    async fn register_rule(
        &self,
        ctx: &SchedulerContext,
        rule: &DetectionRule,
        cron: &str,
    ) -> anyhow::Result<Uuid> {
        let ctx = ctx.clone();
        let rule_id = rule.id;
        let rule_name = rule.name.clone();
        let job = Job::new_async(cron, move |_uuid, _lock| {
            let ctx = ctx.clone();
            let rule_name = rule_name.clone();
            Box::pin(async move {
                let Ok(Some(rule)) = ctx.rules.get(rule_id).await else {
                    return;
                };
                let config = effective_app_config(&ctx.settings, &ctx.config)
                    .await
                    .unwrap_or_else(|_| (*ctx.config).clone());
                if let Err(e) = execute_detection_rule(
                    &config,
                    &ctx.rules,
                    &ctx.alerts,
                    &ctx.runs,
                    &ctx.suppressions,
                    &rule,
                    ExecuteDetectionOptions::default(),
                )
                .await
                {
                    warn!(rule = %rule_name, error = %e, "scheduled detection failed");
                }
            })
        })?;
        let id = self.sched.add(job).await?;
        Ok(id)
    }
}

/// Ensure 6-field cron (sec min hour dom month dow) for tokio-cron-scheduler.
fn normalize_cron(expr: &str) -> String {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() == 5 {
        format!("0 {}", expr.trim())
    } else {
        expr.trim().to_string()
    }
}
