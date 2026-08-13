use chrono::{DateTime, Utc};
use clickhouse::Client;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::alerts::{detection_facets_from_event_row, AlertContext};
use crate::ch::fetch_events_by_ids;
use crate::ch::DetectionSignalRow;
use crate::store::{AlertRepository, DetectionRunRepository, RuleRepository, SettingsRepository, SuppressionRepository};

pub async fn insert_detection_signal(
    config: &AppConfig,
    rule_id: Uuid,
    rule_name: &str,
    event_id: Option<Uuid>,
    platform: &str,
    dedup_key: &str,
    prevalence: f64,
    payload: &str,
) -> anyhow::Result<()> {
    insert_detection_signals(
        config,
        &[DetectionSignalRow {
            rule_id,
            rule_name: rule_name.to_string(),
            matched_at: Utc::now(),
            event_id: event_id.unwrap_or(Uuid::nil()),
            platform: platform.to_string(),
            dedup_key: dedup_key.to_string(),
            prevalence,
            payload: payload.to_string(),
        }],
    )
    .await
}

pub async fn insert_detection_signals(
    config: &AppConfig,
    rows: &[DetectionSignalRow],
) -> anyhow::Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let client = config.clickhouse_client();
    insert_detection_signals_client(&client, rows).await
}

pub async fn insert_detection_signals_client(
    client: &Client,
    rows: &[DetectionSignalRow],
) -> anyhow::Result<()> {
    let mut insert = client
        .insert::<DetectionSignalRow>("detection_signals")
        .await?;
    for row in rows {
        insert.write(row).await?;
    }
    insert.end().await?;
    Ok(())
}

pub async fn rollup_prevalence(config: &AppConfig) -> anyhow::Result<()> {
    let db = &config.clickhouse_database;
    for (field, col) in [
        ("bundle_id", "bundle_id"),
        ("process_name", "process_name"),
        ("parser", "parser"),
        ("file_hash", "file_hash"),
        ("dest_ip", "dest_ip"),
    ] {
        let sql = format!(
            "INSERT INTO {db}.field_prevalence_agg (field, value, bucket_day, event_count, device_count) \
             SELECT '{field}', {col}, toDate(timestamp), count(), uniq(device_id) \
             FROM {db}.events WHERE timestamp >= now() - INTERVAL 1 DAY AND {col} != '' \
             GROUP BY {col}, bucket_day",
        );
        crate::ch::post_sql(config, &sql).await?;
    }
    Ok(())
}

const WATERMARK_KEY: &str = "realtime_signals_watermark";

async fn load_watermark(settings: &SettingsRepository) -> anyhow::Result<DateTime<Utc>> {
    let v = settings.get(WATERMARK_KEY).await?;
    if let Some(s) = v.as_str() {
        if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
            return Ok(dt.with_timezone(&Utc));
        }
    }
    Ok(Utc::now() - chrono::Duration::minutes(5))
}

async fn save_watermark(settings: &SettingsRepository, at: DateTime<Utc>) -> anyhow::Result<()> {
    settings
        .set(WATERMARK_KEY, &serde_json::json!(at.to_rfc3339()))
        .await
}

fn parse_event_id(row: &Value) -> Option<Uuid> {
    row.get("event_id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
}

pub async fn process_realtime_signals(
    config: &AppConfig,
    _pool: &PgPool,
    suppressions: &SuppressionRepository,
    alerts: &AlertRepository,
    rules: &RuleRepository,
    runs: &DetectionRunRepository,
    settings: &SettingsRepository,
) -> anyhow::Result<u32> {
    let watermark = load_watermark(settings).await?;
    let watermark_str = watermark.format("%Y-%m-%d %H:%M:%S").to_string();
    let sql = format!(
        "SELECT rule_id, rule_name, event_id, platform, dedup_key, payload, matched_at \
         FROM {db}.detection_signals \
         WHERE matched_at > toDateTime('{watermark_str}') \
         ORDER BY matched_at ASC LIMIT 100",
        db = config.clickhouse_database,
    );
    let rows = crate::ch::query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    if rows.is_empty() {
        return Ok(0);
    }

    let event_ids: Vec<Uuid> = rows.iter().filter_map(parse_event_id).collect();
    let events_by_id = fetch_events_by_ids(config, &event_ids).await?;

    let mut n = 0u32;
    let mut max_matched = watermark;
    let mut hits_by_rule: std::collections::HashMap<Uuid, u32> = std::collections::HashMap::new();

    for row in rows {
        let rule_id = row
            .get("rule_id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());
        let Some(rule_id) = rule_id else { continue };

        if let Some(ts) = row.get("matched_at").and_then(|v| v.as_str()) {
            if let Ok(dt) = DateTime::parse_from_rfc3339(ts) {
                let dt = dt.with_timezone(&Utc);
                if dt > max_matched {
                    max_matched = dt;
                }
            }
        }

        if suppressions.is_suppressed(rule_id).await? {
            continue;
        }

        let rule = rules.get(rule_id).await?;
        let (severity, rule_name, title) = if let Some(ref r) = rule {
            (r.severity.clone(), r.name.clone(), r.name.clone())
        } else {
            let rule_name = row
                .get("rule_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = if rule_name.is_empty() {
                "realtime detection".into()
            } else {
                rule_name.clone()
            };
            ("medium".into(), rule_name, title)
        };

        let platform = row
            .get("platform")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let sample = parse_event_id(&row);
        let event_row = sample.and_then(|id| events_by_id.get(&id));
        let facet_owned = event_row
            .map(detection_facets_from_event_row)
            .unwrap_or_else(|| {
                // Fallback when the event row is gone — keep platform-only grouping.
                if platform.is_empty() {
                    vec![]
                } else {
                    vec![("platform", platform.to_string())]
                }
            });
        let facets: Vec<(&str, &str)> = facet_owned
            .iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();
        let context = event_row
            .map(AlertContext::from_event_row)
            .unwrap_or_else(|| AlertContext {
                platform: (!platform.is_empty()).then(|| platform.to_string()),
                ..Default::default()
            });
        let source_hint = context.source.as_deref();
        alerts
            .upsert_from_detection(
                rule_id,
                &rule_name,
                &severity,
                &title,
                &facets,
                sample,
                &context,
                source_hint,
            )
            .await?;
        *hits_by_rule.entry(rule_id).or_insert(0) += 1;
        n += 1;
    }

    for (rule_id, hit_count) in hits_by_rule {
        let run_id = runs.start(rule_id).await?;
        runs
            .finish(run_id, hit_count as i32, hit_count as i32, 0, None)
            .await?;
    }

    if max_matched > watermark {
        save_watermark(settings, max_matched).await?;
    }

    Ok(n)
}
