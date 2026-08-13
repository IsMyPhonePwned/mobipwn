use serde_json::Value;

/// Default automatic sync cadence when `sync_cron` is unset (matches legacy jobs tick ≈ every 5 min).
pub const DEFAULT_SYNC_CRON: &str = "0 */5 * * *";

const MANUAL_VALUES: &[&str] = &["manual", "disabled", "off", "none"];

/// Cron expression for automatic sync, or `None` when sync is manual-only.
/// Missing `sync_cron` is treated as manual (UI default); use `DEFAULT_SYNC_CRON` explicitly for auto sync.
pub fn parse_sync_cron(config: &Value) -> Option<String> {
    let Some(raw) = config.get("sync_cron") else {
        return None;
    };
    let s = raw.as_str()?.trim();
    if s.is_empty() || MANUAL_VALUES.contains(&s.to_lowercase().as_str()) {
        return None;
    }
    Some(s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unset_sync_cron_is_manual() {
        assert!(parse_sync_cron(&json!({})).is_none());
    }

    #[test]
    fn manual_values_disable_cron() {
        for v in ["manual", "disabled", "off", "none", "MANUAL"] {
            assert!(parse_sync_cron(&json!({ "sync_cron": v })).is_none());
        }
    }

    #[test]
    fn explicit_cron_is_parsed() {
        assert_eq!(
            parse_sync_cron(&json!({ "sync_cron": "0 */5 * * *" })).as_deref(),
            Some("0 */5 * * *")
        );
    }
}

/// Ensure 6-field cron (sec min hour dom month dow) for tokio-cron-scheduler.
pub fn normalize_sync_cron(expr: &str) -> String {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() == 5 {
        format!("0 {}", expr.trim())
    } else {
        expr.trim().to_string()
    }
}
