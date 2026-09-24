use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Where a detection match occurred (stored on alert create/update).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AlertContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parser: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

impl AlertContext {
    pub fn from_event_row(row: &Value) -> Self {
        fn opt_str(row: &Value, key: &str) -> Option<String> {
            row.get(key)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        }
        Self {
            source: opt_str(row, "source"),
            platform: opt_str(row, "platform"),
            parser: opt_str(row, "parser"),
            bundle_id: opt_str(row, "bundle_id"),
            process_name: opt_str(row, "process_name"),
            device_id: opt_str(row, "device_id"),
            timestamp: opt_str(row, "timestamp"),
            ..Default::default()
        }
    }

    /// Short label for tables, e.g. `case-001 · android · Process`.
    pub fn location_label(&self) -> String {
        let mut parts = Vec::new();
        if let Some(s) = &self.source {
            parts.push(s.as_str());
        }
        if let Some(p) = &self.platform {
            parts.push(p.as_str());
        }
        if let Some(p) = &self.parser {
            parts.push(p.as_str());
        }
        if let Some(p) = &self.process_name {
            parts.push(p.as_str());
        } else if let Some(b) = &self.bundle_id {
            parts.push(b.as_str());
        }
        if parts.is_empty() {
            return "—".into();
        }
        parts.join(" · ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn from_event_row_extracts_location() {
        let row = json!({
            "source": "case-001",
            "platform": "android",
            "parser": "Process",
            "process_name": "com.google.android.gms",
            "timestamp": "2025-12-18 11:50:32.000000"
        });
        let ctx = AlertContext::from_event_row(&row);
        assert_eq!(ctx.source.as_deref(), Some("case-001"));
        assert_eq!(ctx.location_label(), "case-001 · android · Process · com.google.android.gms");
    }
}
