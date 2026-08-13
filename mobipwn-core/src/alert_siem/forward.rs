use std::time::Duration;

use crate::alerts::{Alert, AlertStatus, status_str};
use crate::detection::DetectionRule;
use crate::plugins::{is_plugin_enabled, ALERT_TO_SIEM_PLUGIN_ID};
use crate::store::{AlertSiemForwardLogRepository, InsertAlertSiemLog, SettingsRepository};
use serde_json::{json, Value};
use sqlx::PgPool;

use super::config::{
    load_alert_to_siem_config, normalize_splunk_hec_url, passes_open_alert_filter,
    passes_rule_filter, passes_severity_filter, passes_status_forward_filter, resolve_splunk_host,
    AlertToSiemConfig, SiemDestination,
};

#[derive(Debug, Clone)]
pub struct SiemForwardOutcome {
    pub ok: bool,
    pub http_status: Option<u16>,
    pub error: Option<String>,
}

async fn plugin_config_ready(pool: &PgPool) -> anyhow::Result<Option<AlertToSiemConfig>> {
    let settings = SettingsRepository::new(pool.clone());
    if !is_plugin_enabled(&settings, ALERT_TO_SIEM_PLUGIN_ID).await? {
        return Ok(None);
    }
    let cfg = load_alert_to_siem_config(&settings).await?;
    if !cfg.forward_enabled {
        return Ok(None);
    }
    Ok(Some(cfg))
}

pub async fn maybe_forward_detection_alert(
    pool: &PgPool,
    alert: &Alert,
    rule: &DetectionRule,
    sample_row: Option<&Value>,
) {
    let _ = try_forward_detection_alert(pool, alert, rule, sample_row).await;
}

pub async fn maybe_forward_status_change_alert(
    pool: &PgPool,
    alert: &Alert,
    from_status: AlertStatus,
    to_status: AlertStatus,
) {
    let _ = try_forward_status_change_alert(pool, alert, from_status, to_status).await;
}

async fn try_forward_detection_alert(
    pool: &PgPool,
    alert: &Alert,
    rule: &DetectionRule,
    sample_row: Option<&Value>,
) -> anyhow::Result<()> {
    let Some(cfg) = plugin_config_ready(pool).await? else {
        return Ok(());
    };
    if alert.event_count > 1 && !cfg.forward_on_update {
        return Ok(());
    }
    if !passes_severity_filter(&alert.severity, cfg.min_severity.as_deref()) {
        return Ok(());
    }
    if !passes_rule_filter(alert.rule_id, &cfg) {
        return Ok(());
    }
    if !passes_open_alert_filter(alert.status, &cfg) {
        return Ok(());
    }
    let event = build_detection_event(alert, rule, sample_row, &cfg);
    let summary = json!({
        "title": alert.title,
        "rule_name": rule.name,
        "severity": alert.severity,
        "alert_id": alert.id,
    });
    forward_and_log(pool, &cfg, Some(alert.id), "detection", &event, summary, alert).await?;
    Ok(())
}

async fn try_forward_status_change_alert(
    pool: &PgPool,
    alert: &Alert,
    from_status: AlertStatus,
    to_status: AlertStatus,
) -> anyhow::Result<()> {
    if from_status == to_status {
        return Ok(());
    }
    let Some(cfg) = plugin_config_ready(pool).await? else {
        return Ok(());
    };
    if !cfg.forward_on_status_change {
        return Ok(());
    }
    if !passes_status_forward_filter(to_status, &cfg) {
        return Ok(());
    }
    if !passes_severity_filter(&alert.severity, cfg.min_severity.as_deref()) {
        return Ok(());
    }
    if !passes_rule_filter(alert.rule_id, &cfg) {
        return Ok(());
    }
    let event = build_status_change_event(alert, from_status, to_status, &cfg);
    let summary = json!({
        "title": alert.title,
        "rule_name": alert.rule_name,
        "severity": alert.severity,
        "alert_id": alert.id,
        "status_from": status_str(from_status),
        "status_to": status_str(to_status),
    });
    forward_and_log(
        pool,
        &cfg,
        Some(alert.id),
        "status_change",
        &event,
        summary,
        alert,
    )
    .await?;
    Ok(())
}

pub async fn test_siem_connection(
    pool: &PgPool,
    cfg: &AlertToSiemConfig,
) -> anyhow::Result<SiemForwardOutcome> {
    let event = json!({
        "event_type": "mobipwn_test",
        "message": "Mobipwn AlertToSiem connectivity test",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    let summary = json!({
        "title": "Mobipwn SIEM test",
        "rule_name": "alert_to_siem.test",
    });
    let outcome = send_event(cfg, &event, None).await;
    let logs = AlertSiemForwardLogRepository::new(pool.clone());
    logs.insert(InsertAlertSiemLog {
        alert_id: None,
        event_kind: "test",
        destination: destination_label(cfg),
        siem_type: siem_type_label(cfg.destination),
        status: if outcome.ok { "success" } else { "error" },
        http_status: outcome.http_status,
        error_message: outcome.error.clone(),
        payload_summary: summary,
    })
    .await?;
    Ok(outcome)
}

async fn forward_and_log(
    pool: &PgPool,
    cfg: &AlertToSiemConfig,
    alert_id: Option<uuid::Uuid>,
    event_kind: &'static str,
    event: &Value,
    summary: Value,
    alert: &Alert,
) -> anyhow::Result<SiemForwardOutcome> {
    let outcome = send_event(cfg, event, Some(alert)).await;
    let logs = AlertSiemForwardLogRepository::new(pool.clone());
    logs.insert(InsertAlertSiemLog {
        alert_id,
        event_kind,
        destination: destination_label(cfg),
        siem_type: siem_type_label(cfg.destination),
        status: if outcome.ok { "success" } else { "error" },
        http_status: outcome.http_status,
        error_message: outcome.error.clone(),
        payload_summary: summary,
    })
    .await?;
    Ok(outcome)
}

fn merge_extra_fields(mut event: Value, cfg: &AlertToSiemConfig) -> Value {
    if let (Some(base), Some(extra)) = (event.as_object_mut(), cfg.extra_event_fields.as_object()) {
        for (k, v) in extra {
            base.entry(k.clone()).or_insert_with(|| v.clone());
        }
    }
    event
}

fn build_detection_event(
    alert: &Alert,
    rule: &DetectionRule,
    sample_row: Option<&Value>,
    cfg: &AlertToSiemConfig,
) -> Value {
    let mut event = json!({
        "event_type": "mobipwn_alert",
        "alert_id": alert.id,
        "rule_id": rule.id,
        "rule_name": rule.name,
        "title": alert.title,
        "severity": alert.severity,
        "status": alert.status,
        "dedup_key": alert.dedup_key,
        "event_count": alert.event_count,
        "first_seen": alert.first_seen,
        "last_seen": alert.last_seen,
        "opened_at": alert.opened_at,
        "context": alert.context,
        "tags": alert.tags,
        "sample_event_id": alert.sample_event_id,
    });
    if cfg.include_sample_event {
        if let Some(row) = sample_row {
            event["sample_event"] = row.clone();
        }
    }
    merge_extra_fields(event, cfg)
}

fn build_status_change_event(
    alert: &Alert,
    from_status: AlertStatus,
    to_status: AlertStatus,
    cfg: &AlertToSiemConfig,
) -> Value {
    let event = json!({
        "event_type": "mobipwn_alert_status_change",
        "alert_id": alert.id,
        "rule_id": alert.rule_id,
        "rule_name": alert.rule_name,
        "title": alert.title,
        "severity": alert.severity,
        "status": alert.status,
        "status_from": status_str(from_status),
        "status_to": status_str(to_status),
        "dedup_key": alert.dedup_key,
        "event_count": alert.event_count,
        "context": alert.context,
        "tags": alert.tags,
    });
    merge_extra_fields(event, cfg)
}

async fn send_event(
    cfg: &AlertToSiemConfig,
    event: &Value,
    alert: Option<&Alert>,
) -> SiemForwardOutcome {
    if cfg.splunk_hec_url.trim().is_empty() {
        return SiemForwardOutcome {
            ok: false,
            http_status: None,
            error: Some("Splunk HEC URL is required".into()),
        };
    }
    if cfg.splunk_token.trim().is_empty() {
        return SiemForwardOutcome {
            ok: false,
            http_status: None,
            error: Some("Splunk HEC token is required".into()),
        };
    }
    match cfg.destination {
        SiemDestination::SplunkHec => send_splunk_hec(cfg, event, alert).await,
    }
}

fn hec_time(cfg: &AlertToSiemConfig, alert: Option<&Alert>) -> f64 {
    if cfg.use_alert_timestamp {
        if let Some(a) = alert {
            return a.last_seen.timestamp_millis() as f64 / 1000.0;
        }
    }
    chrono::Utc::now().timestamp_millis() as f64 / 1000.0
}

async fn send_splunk_hec(
    cfg: &AlertToSiemConfig,
    event: &Value,
    alert: Option<&Alert>,
) -> SiemForwardOutcome {
    let url = normalize_splunk_hec_url(&cfg.splunk_hec_url, cfg.hec_endpoint);
    let host = alert
        .map(|a| resolve_splunk_host(cfg, &a.context))
        .unwrap_or_else(|| resolve_splunk_host(cfg, &Default::default()));
    let mut body = json!({
        "time": hec_time(cfg, alert),
        "host": host,
        "source": cfg.splunk_source,
        "sourcetype": cfg.splunk_sourcetype,
        "index": cfg.splunk_index,
        "event": event,
    });
    if !cfg.splunk_channel.trim().is_empty() {
        body["channel"] = json!(cfg.splunk_channel.trim());
    }
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(cfg.http_timeout_secs as u64))
        .danger_accept_invalid_certs(!cfg.verify_tls)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return SiemForwardOutcome {
                ok: false,
                http_status: None,
                error: Some(e.to_string()),
            };
        }
    };
    let token = cfg.splunk_token.trim();
    let resp = match client
        .post(&url)
        .header("Authorization", format!("Splunk {token}"))
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return SiemForwardOutcome {
                ok: false,
                http_status: None,
                error: Some(e.to_string()),
            };
        }
    };
    let status = resp.status();
    let http_status = Some(status.as_u16());
    if status.is_success() {
        SiemForwardOutcome {
            ok: true,
            http_status,
            error: None,
        }
    } else {
        let body = resp.text().await.unwrap_or_default();
        let msg = if body.is_empty() {
            format!("HTTP {status}")
        } else {
            format!("HTTP {status}: {body}")
        };
        SiemForwardOutcome {
            ok: false,
            http_status,
            error: Some(msg),
        }
    }
}

fn destination_label(cfg: &AlertToSiemConfig) -> String {
    match cfg.destination {
        SiemDestination::SplunkHec => cfg.splunk_hec_url.trim().to_string(),
    }
}

fn siem_type_label(dest: SiemDestination) -> &'static str {
    match dest {
        SiemDestination::SplunkHec => "splunk_hec",
    }
}
