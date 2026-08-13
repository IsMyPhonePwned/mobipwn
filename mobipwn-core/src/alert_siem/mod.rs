//! Forward detection alerts to external SIEM destinations (Splunk HEC).

mod config;
mod forward;

pub use config::{
    config_public, load_alert_to_siem_config, normalize_splunk_hec_url, passes_rule_filter,
    passes_severity_filter, redact_config_value, resolve_splunk_host, save_alert_to_siem_config,
    AlertToSiemConfig, AlertToSiemConfigPublic, KEY_ALERT_TO_SIEM_CONFIG, SiemDestination,
    SplunkHecEndpoint, SplunkHostMode,
};
pub use forward::{
    maybe_forward_detection_alert, maybe_forward_status_change_alert, test_siem_connection,
    SiemForwardOutcome,
};
