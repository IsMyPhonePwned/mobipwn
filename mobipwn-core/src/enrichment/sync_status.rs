use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const STATUS_FILE: &str = "enrichment-sync.json";
const CANCEL_FILE: &str = "enrichment-sync-cancel";
/// Auto-clear status when no heartbeat for this long (stuck/crashed worker).
const STALE_AFTER_SECS: i64 = 2 * 3600;

use super::sync_metrics::SyncStats;

/// Cross-process enrichment sync state (API + mobipwn-jobs), read by GET /v1/dev/logs.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EnrichmentSyncStatus {
    pub running: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub source: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub started_at: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_slug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stats: Option<SyncStats>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stale: bool,
}

pub fn dev_dir() -> PathBuf {
    let dir = std::env::var("MOBIPWN_DEV_DIR").unwrap_or_else(|_| ".dev".into());
    if Path::new(&dir).is_absolute() {
        return PathBuf::from(dir);
    }
    std::env::current_dir()
        .map(|cwd| cwd.join(&dir))
        .unwrap_or_else(|_| PathBuf::from(dir))
}

fn status_path() -> PathBuf {
    dev_dir().join(STATUS_FILE)
}

fn cancel_path() -> PathBuf {
    dev_dir().join(CANCEL_FILE)
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn parse_rfc3339(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&chrono::Utc))
}

pub fn is_enrichment_sync_stale(status: &EnrichmentSyncStatus) -> bool {
    if !status.running {
        return false;
    }
    let anchor = if !status.updated_at.is_empty() {
        Some(status.updated_at.as_str())
    } else if !status.started_at.is_empty() {
        Some(status.started_at.as_str())
    } else {
        None
    };
    let Some(ts) = anchor.and_then(parse_rfc3339) else {
        return true;
    };
    let age = chrono::Utc::now().signed_duration_since(ts);
    age.num_seconds() > STALE_AFTER_SECS
}

pub fn read_enrichment_sync_status() -> Option<EnrichmentSyncStatus> {
    let path = status_path();
    let body = std::fs::read_to_string(path).ok()?;
    let mut status: EnrichmentSyncStatus = serde_json::from_str(&body).ok()?;
    if status.running && is_enrichment_sync_stale(&status) {
        status.stale = true;
    }
    Some(status)
}

pub fn read_enrichment_sync_status_live() -> Option<EnrichmentSyncStatus> {
    read_enrichment_sync_status().and_then(|status| {
        if status.running && status.stale {
            clear_enrichment_sync_status();
            None
        } else {
            Some(status)
        }
    })
}

pub fn write_enrichment_sync_status(status: &EnrichmentSyncStatus) {
    let path = status_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(body) = serde_json::to_string_pretty(status) {
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, body).is_ok() {
            let _ = std::fs::rename(tmp, path);
        }
    }
}

pub fn clear_enrichment_sync_status() {
    let _ = std::fs::remove_file(status_path());
}

pub fn request_enrichment_sync_cancel() {
    let path = cancel_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, now_rfc3339());
    clear_enrichment_sync_status();
}

pub fn clear_enrichment_sync_cancel() {
    let _ = std::fs::remove_file(cancel_path());
}

pub fn is_enrichment_sync_cancel_requested() -> bool {
    cancel_path().exists()
}

pub fn touch_enrichment_sync_if_running() {
    let Some(mut status) = read_enrichment_sync_status() else {
        return;
    };
    if !status.running {
        return;
    }
    status.updated_at = now_rfc3339();
    write_enrichment_sync_status(&status);
}

pub fn start_enrichment_sync_status(source: &str, message: impl Into<String>) {
    clear_enrichment_sync_cancel();
    let now = now_rfc3339();
    write_enrichment_sync_status(&EnrichmentSyncStatus {
        running: true,
        source: source.into(),
        started_at: now.clone(),
        updated_at: now,
        provider_slug: None,
        provider_name: None,
        message: message.into(),
        stats: None,
        stale: false,
    });
}

pub fn update_enrichment_sync_provider_stats(
    slug: &str,
    name: &str,
    message: impl Into<String>,
    stats: Option<SyncStats>,
) {
    let mut status = read_enrichment_sync_status().unwrap_or_default();
    if !status.running {
        return;
    }
    status.provider_slug = Some(slug.into());
    status.provider_name = Some(name.into());
    status.message = message.into();
    status.updated_at = now_rfc3339();
    if stats.is_some() {
        status.stats = stats;
    }
    write_enrichment_sync_status(&status);
}

/// Keeps enrichment-sync.json cleared when sync exits (success, error, or cancel).
pub struct SyncStatusGuard {
    active: bool,
}

impl SyncStatusGuard {
    pub fn begin(source: &str, message: impl Into<String>) -> Self {
        start_enrichment_sync_status(source, message);
        Self { active: true }
    }
}

impl Drop for SyncStatusGuard {
    fn drop(&mut self) {
        if self.active {
            clear_enrichment_sync_status();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::enrichment::test_util::dev_dir_test_lock;

    #[test]
    fn round_trip_status_json() {
        let _lock = dev_dir_test_lock();
        let dir = std::env::temp_dir().join(format!("mobipwn_sync_status_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        std::env::set_var("MOBIPWN_DEV_DIR", dir.to_string_lossy().as_ref());

        start_enrichment_sync_status("jobs", "Starting enrichment sync");
        update_enrichment_sync_provider_stats(
            "virustotal",
            "VirusTotal",
            "Syncing VirusTotal…",
            None,
        );
        let status = read_enrichment_sync_status().expect("status file");
        assert!(status.running);
        assert_eq!(status.source, "jobs");
        assert_eq!(status.provider_slug.as_deref(), Some("virustotal"));

        clear_enrichment_sync_status();
        assert!(read_enrichment_sync_status().is_none());

        std::env::remove_var("MOBIPWN_DEV_DIR");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn dev_dir_uses_env_override() {
        let _lock = dev_dir_test_lock();
        let dir = std::env::temp_dir().join(format!("mobipwn_devdir_{}", std::process::id()));
        std::env::set_var("MOBIPWN_DEV_DIR", dir.to_string_lossy().as_ref());
        assert_eq!(dev_dir(), dir);
        std::env::remove_var("MOBIPWN_DEV_DIR");
    }

    #[test]
    fn update_provider_stats_persisted() {
        let _lock = dev_dir_test_lock();
        let dir = std::env::temp_dir().join(format!("mobipwn_sync_stats_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        std::env::set_var("MOBIPWN_DEV_DIR", dir.to_string_lossy().as_ref());

        start_enrichment_sync_status("api", "Starting sync");
        let stats = SyncStats {
            api_requests: 5,
            api_ok: 4,
            api_miss: 1,
            mode: Some("incremental".into()),
            ..Default::default()
        };
        update_enrichment_sync_provider_stats(
            "virustotal",
            "VirusTotal",
            "VT — 4 ok",
            Some(stats),
        );
        let status = read_enrichment_sync_status().expect("status");
        assert_eq!(status.stats.as_ref().unwrap().api_requests, 5);
        assert_eq!(status.message, "VT — 4 ok");

        clear_enrichment_sync_status();
        std::env::remove_var("MOBIPWN_DEV_DIR");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn guard_clears_status_on_drop() {
        let _lock = dev_dir_test_lock();
        let dir = std::env::temp_dir().join(format!("mobipwn_sync_guard_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        std::env::set_var("MOBIPWN_DEV_DIR", dir.to_string_lossy().as_ref());

        {
            let _guard = SyncStatusGuard::begin("jobs", "running");
            assert!(read_enrichment_sync_status().is_some());
        }
        assert!(read_enrichment_sync_status().is_none());

        std::env::remove_var("MOBIPWN_DEV_DIR");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn update_ignored_when_not_running() {
        let _lock = dev_dir_test_lock();
        let dir = std::env::temp_dir().join(format!("mobipwn_sync_idle_{}", std::process::id()));
        std::env::set_var("MOBIPWN_DEV_DIR", dir.to_string_lossy().as_ref());
        clear_enrichment_sync_status();

        update_enrichment_sync_provider_stats("virustotal", "VT", "should not write", None);
        assert!(read_enrichment_sync_status().is_none());

        std::env::remove_var("MOBIPWN_DEV_DIR");
    }
}
