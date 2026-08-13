use mobipwn_core::config::AppConfig;
use mobipwn_core::mudm::ENDPOINT;
use mobipwn_core::{AlertRepository, CaseRepository, SettingsRepository};

use crate::alerts::sync_findings_to_alerts;
use crate::config::{load_platform_config, IronSiftPlatformConfig};
use crate::config_profiles::{active_anomark_config_label, active_ironsift_config_label};
use crate::engine::{execute_run, CreateRunRequest};
use crate::extract::ScopeFilter;
use crate::scope::resolve_scope;
use crate::store::{IronSiftRepository, IronSiftRunRecord};

fn apply_filter_defaults(filter: &mut ScopeFilter, cfg: &IronSiftPlatformConfig) {
    if filter.platform.as_deref().filter(|s| !s.is_empty()).is_none() {
        filter.platform = Some(cfg.mudm_platform.clone());
    }
}

pub async fn run_pipeline(
    config: &AppConfig,
    repo: &IronSiftRepository,
    cases: &CaseRepository,
    alerts: &AlertRepository,
    settings: &SettingsRepository,
    mut req: CreateRunRequest,
) -> anyhow::Result<IronSiftRunRecord> {
    let platform = load_platform_config(settings).await?;
    if !platform.enabled {
        anyhow::bail!("IronSift is disabled in settings");
    }
    resolve_scope(cases, &mut req.filter).await?;
    apply_filter_defaults(&mut req.filter, &platform);
    if req.ironsift_config_name.is_none() {
        req.ironsift_config_name = Some(active_ironsift_config_label(settings).await?);
    }
    if req.anomark_config_name.is_none() {
        req.anomark_config_name = Some(active_anomark_config_label(settings).await?);
    }
    let sync_alerts = req.sync_alerts;
    let outcome = execute_run(config, repo, &platform, req).await?;
    sync_findings_to_alerts(
        alerts,
        repo,
        outcome.run.id,
        outcome.run.mode,
        &outcome.findings,
        platform.min_score,
        sync_alerts,
    )
    .await?;
    repo.get_run(outcome.run.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("run missing after pipeline"))
}

/// Post-ingest temporal diff when a prior completed ingest exists for the same source.
pub async fn maybe_run_post_ingest_temporal(
    config: &AppConfig,
    repo: &IronSiftRepository,
    cases: &CaseRepository,
    alerts: &AlertRepository,
    settings: &SettingsRepository,
    source: &str,
    baseline_before: chrono::DateTime<chrono::Utc>,
    current_from: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<Option<IronSiftRunRecord>> {
    let platform = load_platform_config(settings).await?;
    if !platform.enabled || !platform.post_ingest_temporal {
        return Ok(None);
    }
    let req = CreateRunRequest {
        mode: crate::store::IronSiftRunMode::Temporal,
        scope: crate::store::IronSiftRunScope::Device,
        filter: crate::extract::ScopeFilter {
            source: Some(source.to_string()),
            device_id: Some(source.to_string()),
            platform: Some(ENDPOINT.to_string()),
            baseline_from: Some(baseline_before - chrono::Duration::days(30)),
            baseline_to: Some(baseline_before),
            current_from: Some(current_from),
            current_to: Some(chrono::Utc::now()),
            ..Default::default()
        },
        triggered_by: "post_ingest".into(),
        enable_anomark: false,
        anomark_train_id: None,
        anomark_suspect_percent: crate::anomark::default_suspect_percent(),
        detection_config_override: None,
        sync_alerts: true,
        ironsift_config_name: None,
        anomark_config_name: None,
    };
    match run_pipeline(config, repo, cases, alerts, settings, req).await {
        Ok(run) => Ok(Some(run)),
        Err(e) => {
            tracing::warn!(source, error = %e, "post-ingest IronSift temporal run failed");
            Ok(None)
        }
    }
}

/// Scheduled fleet-wide analysis.
pub async fn run_scheduled_fleet(
    config: &AppConfig,
    repo: &IronSiftRepository,
    cases: &CaseRepository,
    alerts: &AlertRepository,
    settings: &SettingsRepository,
) -> anyhow::Result<Option<IronSiftRunRecord>> {
    let platform = load_platform_config(settings).await?;
    if !platform.enabled {
        return Ok(None);
    }
    let req = CreateRunRequest {
        mode: crate::store::IronSiftRunMode::Fleet,
        scope: crate::store::IronSiftRunScope::Fleet,
        filter: crate::extract::ScopeFilter {
            platform: Some(ENDPOINT.to_string()),
            time_from: Some(chrono::Utc::now() - chrono::Duration::days(7)),
            ..Default::default()
        },
        triggered_by: "scheduled".into(),
        enable_anomark: false,
        anomark_train_id: None,
        anomark_suspect_percent: crate::anomark::default_suspect_percent(),
        detection_config_override: None,
        sync_alerts: true,
        ironsift_config_name: None,
        anomark_config_name: None,
    };
    Ok(Some(
        run_pipeline(config, repo, cases, alerts, settings, req).await?,
    ))
}
