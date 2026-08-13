use serde::{Deserialize, Serialize};

/// Counters collected during a provider sync (especially VirusTotal API usage).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncStats {
    #[serde(default, skip_serializing_if = "is_zero")]
    pub queued: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub api_requests: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub api_ok: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub api_miss: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub api_errors: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub skipped_already_enriched: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub skipped_invalid: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub skipped_duplicate: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub rows_written: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

impl SyncStats {
    pub fn with_mode(mode: &str) -> Self {
        Self {
            mode: Some(mode.into()),
            ..Default::default()
        }
    }

    pub fn format_summary(&self) -> String {
        let mut parts = Vec::new();
        if let Some(mode) = &self.mode {
            parts.push(mode.clone());
        }
        if self.api_requests > 0 {
            parts.push(format!(
                "{} API req ({} ok, {} miss, {} err)",
                self.api_requests, self.api_ok, self.api_miss, self.api_errors
            ));
        }
        if self.skipped_already_enriched > 0 {
            parts.push(format!("{} already enriched", self.skipped_already_enriched));
        }
        if self.skipped_invalid > 0 {
            parts.push(format!("{} invalid", self.skipped_invalid));
        }
        if self.skipped_duplicate > 0 {
            parts.push(format!("{} duplicate", self.skipped_duplicate));
        }
        if self.rows_written > 0 {
            parts.push(format!("{} row(s) written", self.rows_written));
        } else if self.api_requests == 0 && self.skipped_already_enriched > 0 {
            parts.push("nothing new to fetch".into());
        }
        if parts.is_empty() {
            "no activity".into()
        } else {
            parts.join(" · ")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_vt_summary() {
        let stats = SyncStats {
            mode: Some("incremental".into()),
            queued: 12,
            api_requests: 3,
            api_ok: 2,
            api_miss: 1,
            skipped_already_enriched: 5,
            rows_written: 2,
            ..Default::default()
        };
        let s = stats.format_summary();
        assert!(s.contains("incremental"));
        assert!(s.contains("3 API req"));
        assert!(s.contains("5 already enriched"));
        assert!(s.contains("2 row(s) written"));
    }

    #[test]
    fn with_mode_sets_mode_only() {
        let stats = SyncStats::with_mode("incremental");
        assert_eq!(stats.mode.as_deref(), Some("incremental"));
        assert_eq!(stats.api_requests, 0);
    }

    #[test]
    fn format_summary_no_activity() {
        assert_eq!(SyncStats::default().format_summary(), "no activity");
    }

    #[test]
    fn format_summary_skips_only_shows_nothing_new() {
        let stats = SyncStats {
            mode: Some("incremental".into()),
            skipped_already_enriched: 10,
            ..Default::default()
        };
        let s = stats.format_summary();
        assert!(s.contains("10 already enriched"));
        assert!(s.contains("nothing new to fetch"));
    }

    #[test]
    fn serde_omits_zero_counters() {
        let stats = SyncStats {
            mode: Some("full".into()),
            rows_written: 1,
            ..Default::default()
        };
        let v = serde_json::to_value(&stats).unwrap();
        assert_eq!(v.get("rows_written").and_then(|x| x.as_u64()), Some(1));
        assert!(v.get("api_requests").is_none());
    }
}
