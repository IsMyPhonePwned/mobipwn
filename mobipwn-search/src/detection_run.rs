//! Execute a detection rule against ClickHouse and upsert alerts (shared by API and jobs).

use mobipwn_core::alerts::AlertContext;
use mobipwn_core::alerts::detection_facets_from_event_row;
use mobipwn_core::ch::signals::insert_detection_signal;
use mobipwn_core::config::AppConfig;
use mobipwn_core::detection::{DetectionRule, RuleLifecycle};
use mobipwn_core::prevalence::{row_rarity_score, should_suppress_prevalence};
use mobipwn_core::{
    AlertRepository, DetectionRunRepository, RuleRepository, SuppressionRepository,
};
use serde_json::Value;
use std::time::Instant;
use tracing::info;
use uuid::Uuid;

use crate::admission::resolve_time_bounds;
use crate::{apply_row_limit, generate_clickhouse_sql, parse_mpl};

#[derive(Debug, Clone, Copy)]
pub struct ExecuteDetectionOptions {
    /// Manual run from the API/UI: always evaluates and may create alerts regardless of lifecycle.
    pub manual: bool,
    /// When false, count hits but do not upsert alerts, signals, or webhooks.
    pub create_alerts: bool,
}

impl Default for ExecuteDetectionOptions {
    fn default() -> Self {
        Self {
            manual: false,
            create_alerts: true,
        }
    }
}

impl ExecuteDetectionOptions {
    pub fn manual(create_alerts: bool) -> Self {
        Self {
            manual: true,
            create_alerts,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ExecuteDetectionResult {
    pub hit_count: i32,
    pub alerts_created: i32,
    pub duration_ms: i32,
    pub skipped_min_hits: bool,
    pub suppressed: bool,
}

pub async fn execute_detection_rule(
    config: &AppConfig,
    rules: &RuleRepository,
    alerts: &AlertRepository,
    runs: &DetectionRunRepository,
    suppressions: &SuppressionRepository,
    rule: &DetectionRule,
    options: ExecuteDetectionOptions,
) -> anyhow::Result<ExecuteDetectionResult> {
    if !options.manual
        && !matches!(
            rule.lifecycle,
            RuleLifecycle::Live | RuleLifecycle::Alerting
        )
    {
        return Ok(ExecuteDetectionResult {
            hit_count: 0,
            alerts_created: 0,
            duration_ms: 0,
            skipped_min_hits: false,
            suppressed: false,
        });
    }

    let start = Instant::now();
    let run_id = runs.start(rule.id).await?;

    let result = run_detection_inner(
        config,
        rules,
        alerts,
        suppressions,
        rule,
        options.create_alerts,
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as i32;
    match result {
        Ok(inner) => {
            runs
                .finish(
                    run_id,
                    inner.hit_count,
                    inner.alerts_created,
                    duration_ms,
                    None,
                )
                .await?;
            rules.record_run(rule.id, inner.hit_count).await?;
            info!(
                rule = %rule.name,
                hits = inner.hit_count,
                alerts = inner.alerts_created,
                manual = options.manual,
                skipped_min_hits = inner.skipped_min_hits,
                suppressed = inner.suppressed,
                "detection complete"
            );
            Ok(ExecuteDetectionResult {
                hit_count: inner.hit_count,
                alerts_created: inner.alerts_created,
                duration_ms,
                skipped_min_hits: inner.skipped_min_hits,
                suppressed: inner.suppressed,
            })
        }
        Err(e) => {
            let msg = e.to_string();
            runs
                .finish(run_id, 0, 0, duration_ms, Some(&msg))
                .await
                .ok();
            Err(e)
        }
    }
}

struct InnerResult {
    hit_count: i32,
    alerts_created: i32,
    skipped_min_hits: bool,
    suppressed: bool,
}

async fn run_detection_inner(
    config: &AppConfig,
    rules: &RuleRepository,
    alerts: &AlertRepository,
    suppressions: &SuppressionRepository,
    rule: &DetectionRule,
    create_alerts: bool,
) -> anyhow::Result<InnerResult> {
    let mpl = parse_mpl(&rule.query)?;
    let source_hint = mpl.literal_field_eq("source");
    let bounds = resolve_time_bounds(
        &mpl,
        None,
        None,
        config.search_admission.default_hours,
    );
    let sql = generate_clickhouse_sql(
        &mpl,
        &config.clickhouse_database,
        bounds.time_from.as_deref(),
        bounds.time_to.as_deref(),
    )?;
    let sql = apply_row_limit(sql, 100);

    let rows =
        mobipwn_core::ch::query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    let hit_count = rows.len() as i32;
    let min_hits = rule.min_hits.max(1);
    let max_alerts = rule.max_alerts_per_run.max(1);

    if hit_count < min_hits {
        return Ok(InnerResult {
            hit_count,
            alerts_created: 0,
            skipped_min_hits: true,
            suppressed: false,
        });
    }

    if suppressions.is_suppressed(rule.id).await? {
        return Ok(InnerResult {
            hit_count,
            alerts_created: 0,
            skipped_min_hits: false,
            suppressed: true,
        });
    }

    if !create_alerts {
        return Ok(InnerResult {
            hit_count,
            alerts_created: 0,
            skipped_min_hits: false,
            suppressed: false,
        });
    }

    let mut alerts_created = 0i32;

    for row in &rows {
        if should_skip_row(config, rule, row).await? {
            continue;
        }
        let title = rule.name.clone();
        let facets_owned = detection_facets_from_event_row(row);
        let facets: Vec<(&str, &str)> = facets_owned
            .iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();
        let context = AlertContext::from_event_row(row);
        let sample_id = row
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());
        let alert = alerts
            .upsert_from_detection(
                rule.id,
                &rule.name,
                &rule.severity,
                &title,
                &facets,
                sample_id,
                &context,
                source_hint.as_deref(),
            )
            .await?;
        mobipwn_core::maybe_forward_detection_alert(rules.pool(), &alert, rule, Some(row)).await;
        alerts_created += 1;
        if alerts_created >= max_alerts {
            break;
        }
        if rule.signal_log_enabled {
            let payload = row
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let rarity = row_rarity_score(config, row).await.unwrap_or(0.0);
            insert_detection_signal(
                config,
                rule.id,
                &rule.name,
                sample_id,
                row.get("platform").and_then(|v| v.as_str()).unwrap_or(""),
                &mobipwn_core::alerts::dedup_key(&rule.id.to_string(), &facets),
                rarity,
                payload,
            )
            .await
            .ok();
        }
        notify_webhooks(rules.pool(), &title, &rule.name).await.ok();
    }

    Ok(InnerResult {
        hit_count,
        alerts_created,
        skipped_min_hits: false,
        suppressed: false,
    })
}

async fn should_skip_row(
    config: &AppConfig,
    rule: &DetectionRule,
    row: &Value,
) -> anyhow::Result<bool> {
    let Some(threshold) = rule.prevalence_threshold else {
        return Ok(false);
    };
    should_suppress_prevalence(config, threshold, row).await
}

async fn notify_webhooks(pool: &sqlx::PgPool, title: &str, rule_name: &str) -> anyhow::Result<()> {
    let urls: Vec<String> = sqlx::query_scalar(
        "SELECT url FROM notification_channels WHERE enabled = true AND kind = 'webhook'",
    )
    .fetch_all(pool)
    .await?;
    let body = serde_json::json!({ "title": title, "rule": rule_name });
    let client = reqwest::Client::new();
    for url in urls {
        client.post(&url).json(&body).send().await.ok();
    }
    Ok(())
}
