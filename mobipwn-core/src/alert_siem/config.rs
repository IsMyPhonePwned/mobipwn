use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::alerts::{AlertContext, AlertStatus, is_closed};
use crate::platform_settings::is_masked_secret;
use crate::store::SettingsRepository;

pub const KEY_ALERT_TO_SIEM_CONFIG: &str = "alert_to_siem_config";

const MASKED_SECRET: &str = "********";

fn default_splunk_index() -> String {
    "main".into()
}

fn default_splunk_sourcetype() -> String {
    "mobipwn:alert".into()
}

fn default_splunk_source() -> String {
    "mobipwn".into()
}

fn default_splunk_host() -> String {
    "mobipwn".into()
}

fn default_true() -> bool {
    true
}

fn default_timeout_secs() -> u32 {
    15
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SiemDestination {
    #[default]
    SplunkHec,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SplunkHostMode {
    #[default]
    Fixed,
    DeviceId,
    Source,
    Platform,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SplunkHecEndpoint {
    #[default]
    Event,
    Raw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertToSiemConfig {
    #[serde(default)]
    pub forward_enabled: bool,
    #[serde(default)]
    pub destination: SiemDestination,
    #[serde(default)]
    pub splunk_hec_url: String,
    #[serde(default)]
    pub splunk_token: String,
    #[serde(default = "default_splunk_index")]
    pub splunk_index: String,
    #[serde(default = "default_splunk_sourcetype")]
    pub splunk_sourcetype: String,
    #[serde(default = "default_splunk_source")]
    pub splunk_source: String,
    #[serde(default = "default_splunk_host")]
    pub splunk_host: String,
    #[serde(default)]
    pub splunk_host_mode: SplunkHostMode,
    #[serde(default)]
    pub splunk_channel: String,
    #[serde(default)]
    pub hec_endpoint: SplunkHecEndpoint,
    #[serde(default = "default_true")]
    pub verify_tls: bool,
    #[serde(default = "default_timeout_secs")]
    pub http_timeout_secs: u32,
    /// Re-forward when a deduplicated alert receives new matching events.
    #[serde(default)]
    pub forward_on_update: bool,
    /// Forward when alert triage status changes (verified, false positive, etc.).
    #[serde(default)]
    pub forward_on_status_change: bool,
    /// Only forward status changes when the new status is listed (empty = any change).
    #[serde(default)]
    pub status_forward_statuses: Vec<String>,
    /// Skip detection forwards for verified / false-positive alerts.
    #[serde(default = "default_true")]
    pub forward_only_open_alerts: bool,
    #[serde(default)]
    pub min_severity: Option<String>,
    /// Include matching ClickHouse row in the forwarded event.
    #[serde(default = "default_true")]
    pub include_sample_event: bool,
    /// Use alert `last_seen` as the Splunk HEC `time` field.
    #[serde(default = "default_true")]
    pub use_alert_timestamp: bool,
    /// Static JSON object merged into every forwarded event.
    #[serde(default)]
    pub extra_event_fields: Value,
    /// Allowlist of rule UUIDs (empty = all rules).
    #[serde(default)]
    pub rule_ids_include: Vec<String>,
    /// Denylist of rule UUIDs.
    #[serde(default)]
    pub rule_ids_exclude: Vec<String>,
}

impl Default for AlertToSiemConfig {
    fn default() -> Self {
        Self {
            forward_enabled: false,
            destination: SiemDestination::SplunkHec,
            splunk_hec_url: String::new(),
            splunk_token: String::new(),
            splunk_index: default_splunk_index(),
            splunk_sourcetype: default_splunk_sourcetype(),
            splunk_source: default_splunk_source(),
            splunk_host: default_splunk_host(),
            splunk_host_mode: SplunkHostMode::Fixed,
            splunk_channel: String::new(),
            hec_endpoint: SplunkHecEndpoint::Event,
            verify_tls: true,
            http_timeout_secs: default_timeout_secs(),
            forward_on_update: false,
            forward_on_status_change: false,
            status_forward_statuses: Vec::new(),
            forward_only_open_alerts: true,
            min_severity: None,
            include_sample_event: true,
            use_alert_timestamp: true,
            extra_event_fields: Value::Object(Default::default()),
            rule_ids_include: Vec::new(),
            rule_ids_exclude: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertToSiemConfigPublic {
    pub forward_enabled: bool,
    pub destination: SiemDestination,
    pub splunk_hec_url: String,
    pub splunk_token_set: bool,
    pub splunk_index: String,
    pub splunk_sourcetype: String,
    pub splunk_source: String,
    pub splunk_host: String,
    pub splunk_host_mode: SplunkHostMode,
    pub splunk_channel: String,
    pub hec_endpoint: SplunkHecEndpoint,
    pub verify_tls: bool,
    pub http_timeout_secs: u32,
    pub forward_on_update: bool,
    pub forward_on_status_change: bool,
    pub status_forward_statuses: Vec<String>,
    pub forward_only_open_alerts: bool,
    pub min_severity: Option<String>,
    pub include_sample_event: bool,
    pub use_alert_timestamp: bool,
    pub extra_event_fields: Value,
    pub rule_ids_include: Vec<String>,
    pub rule_ids_exclude: Vec<String>,
}

pub fn config_public(cfg: &AlertToSiemConfig) -> AlertToSiemConfigPublic {
    AlertToSiemConfigPublic {
        forward_enabled: cfg.forward_enabled,
        destination: cfg.destination,
        splunk_hec_url: cfg.splunk_hec_url.clone(),
        splunk_token_set: !cfg.splunk_token.is_empty(),
        splunk_index: cfg.splunk_index.clone(),
        splunk_sourcetype: cfg.splunk_sourcetype.clone(),
        splunk_source: cfg.splunk_source.clone(),
        splunk_host: cfg.splunk_host.clone(),
        splunk_host_mode: cfg.splunk_host_mode,
        splunk_channel: cfg.splunk_channel.clone(),
        hec_endpoint: cfg.hec_endpoint,
        verify_tls: cfg.verify_tls,
        http_timeout_secs: cfg.http_timeout_secs,
        forward_on_update: cfg.forward_on_update,
        forward_on_status_change: cfg.forward_on_status_change,
        status_forward_statuses: cfg.status_forward_statuses.clone(),
        forward_only_open_alerts: cfg.forward_only_open_alerts,
        min_severity: cfg.min_severity.clone(),
        include_sample_event: cfg.include_sample_event,
        use_alert_timestamp: cfg.use_alert_timestamp,
        extra_event_fields: cfg.extra_event_fields.clone(),
        rule_ids_include: cfg.rule_ids_include.clone(),
        rule_ids_exclude: cfg.rule_ids_exclude.clone(),
    }
}

pub fn redact_config_value(raw: &Value) -> Value {
    let mut out = raw.clone();
    if let Some(obj) = out.as_object_mut() {
        if obj.contains_key("splunk_token") {
            obj.insert(
                "splunk_token".into(),
                Value::String(if obj
                    .get("splunk_token")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty())
                {
                    MASKED_SECRET.into()
                } else {
                    String::new()
                }),
            );
        }
    }
    out
}

pub async fn load_alert_to_siem_config(
    settings: &SettingsRepository,
) -> anyhow::Result<AlertToSiemConfig> {
    let raw = settings.get(KEY_ALERT_TO_SIEM_CONFIG).await?;
    if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        return Ok(AlertToSiemConfig::default());
    }
    Ok(serde_json::from_value(raw)?)
}

fn normalize_config(mut cfg: AlertToSiemConfig) -> AlertToSiemConfig {
    cfg.http_timeout_secs = cfg.http_timeout_secs.clamp(1, 120);
    if !cfg.extra_event_fields.is_object() {
        cfg.extra_event_fields = Value::Object(Default::default());
    }
    cfg.status_forward_statuses = cfg
        .status_forward_statuses
        .into_iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    cfg.rule_ids_include = normalize_rule_id_list(cfg.rule_ids_include);
    cfg.rule_ids_exclude = normalize_rule_id_list(cfg.rule_ids_exclude);
    cfg
}

fn normalize_rule_id_list(ids: Vec<String>) -> Vec<String> {
    ids.into_iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| Uuid::parse_str(s).is_ok())
        .collect()
}

pub async fn save_alert_to_siem_config(
    settings: &SettingsRepository,
    incoming: &AlertToSiemConfig,
) -> anyhow::Result<()> {
    let mut next = normalize_config(incoming.clone());
    if is_masked_secret(&next.splunk_token) {
        let existing = load_alert_to_siem_config(settings).await?;
        next.splunk_token = existing.splunk_token;
    }
    settings
        .set(KEY_ALERT_TO_SIEM_CONFIG, &serde_json::to_value(next)?)
        .await?;
    Ok(())
}

/// Severity rank for optional minimum filter (higher = more severe).
pub fn severity_rank(severity: &str) -> u8 {
    match severity.trim().to_lowercase().as_str() {
        "critical" => 5,
        "high" => 4,
        "medium" => 3,
        "low" => 2,
        "info" | "informational" => 1,
        _ => 0,
    }
}

pub fn passes_severity_filter(alert_severity: &str, min: Option<&str>) -> bool {
    let Some(min) = min.map(str::trim).filter(|s| !s.is_empty()) else {
        return true;
    };
    severity_rank(alert_severity) >= severity_rank(min)
}

pub fn passes_rule_filter(rule_id: Uuid, cfg: &AlertToSiemConfig) -> bool {
    let id = rule_id.to_string().to_lowercase();
    if cfg.rule_ids_exclude.iter().any(|r| r == &id) {
        return false;
    }
    if cfg.rule_ids_include.is_empty() {
        return true;
    }
    cfg.rule_ids_include.iter().any(|r| r == &id)
}

pub fn passes_open_alert_filter(status: AlertStatus, cfg: &AlertToSiemConfig) -> bool {
    if cfg.forward_only_open_alerts && is_closed(status) {
        return false;
    }
    true
}

pub fn passes_status_forward_filter(new_status: AlertStatus, cfg: &AlertToSiemConfig) -> bool {
    if cfg.status_forward_statuses.is_empty() {
        return true;
    }
    let label = crate::alerts::status_str(new_status).to_lowercase();
    cfg.status_forward_statuses.iter().any(|s| s == &label)
}

pub fn resolve_splunk_host(cfg: &AlertToSiemConfig, context: &AlertContext) -> String {
    let fallback = || {
        let h = cfg.splunk_host.trim();
        if h.is_empty() {
            "mobipwn".to_string()
        } else {
            h.to_string()
        }
    };
    match cfg.splunk_host_mode {
        SplunkHostMode::Fixed => fallback(),
        SplunkHostMode::DeviceId => context
            .device_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(fallback),
        SplunkHostMode::Source => context
            .source
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(fallback),
        SplunkHostMode::Platform => context
            .platform
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(fallback),
    }
}

pub fn normalize_splunk_hec_url(raw: &str, endpoint: SplunkHecEndpoint) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.contains("/services/collector") {
        return trimmed.to_string();
    }
    let path = match endpoint {
        SplunkHecEndpoint::Event => "/services/collector/event",
        SplunkHecEndpoint::Raw => "/services/collector/raw",
    };
    format!("{trimmed}{path}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn rule_filter_allow_and_deny() {
        let rule = Uuid::now_v7();
        let other = Uuid::now_v7();
        let mut cfg = AlertToSiemConfig::default();
        assert!(passes_rule_filter(rule, &cfg));

        cfg.rule_ids_exclude = vec![rule.to_string()];
        assert!(!passes_rule_filter(rule, &cfg));
        assert!(passes_rule_filter(other, &cfg));

        cfg.rule_ids_exclude.clear();
        cfg.rule_ids_include = vec![rule.to_string()];
        assert!(passes_rule_filter(rule, &cfg));
        assert!(!passes_rule_filter(other, &cfg));
    }

    #[test]
    fn host_mode_uses_context() {
        let mut cfg = AlertToSiemConfig::default();
        cfg.splunk_host = "fallback".into();
        cfg.splunk_host_mode = SplunkHostMode::DeviceId;
        let ctx = AlertContext {
            device_id: Some("pixel-7".into()),
            ..Default::default()
        };
        assert_eq!(resolve_splunk_host(&cfg, &ctx), "pixel-7");
        assert_eq!(resolve_splunk_host(&cfg, &AlertContext::default()), "fallback");
    }
}
