use super::sync_metrics::SyncStats;
use super::sync::SyncSummary;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;

#[derive(Debug, Clone, Serialize)]
pub struct SyncProgressEvent {
    pub kind: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indicator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<SyncStats>,
}

#[derive(Clone)]
pub struct SyncProgress {
    tx: Option<UnboundedSender<String>>,
    cancelled: Arc<AtomicBool>,
}

impl Default for SyncProgress {
    fn default() -> Self {
        Self {
            tx: None,
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl SyncProgress {
    pub fn none() -> Self {
        Self::default()
    }

    pub fn ndjson_channel() -> (Self, tokio::sync::mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        (
            Self {
                tx: Some(tx),
                cancelled,
            },
            rx,
        )
    }

    pub fn cancel_token(&self) -> Arc<AtomicBool> {
        self.cancelled.clone()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        if self.cancelled.load(Ordering::Relaxed) {
            return true;
        }
        super::sync_status::is_enrichment_sync_cancel_requested()
    }

    pub fn ensure_not_cancelled(&self) -> anyhow::Result<()> {
        if self.is_cancelled() {
            anyhow::bail!("sync cancelled");
        }
        Ok(())
    }

    pub async fn sleep_cancellable(&self, ms: u64) -> anyhow::Result<()> {
        let step = 250u64;
        let mut remaining = ms;
        while remaining > 0 {
            self.ensure_not_cancelled()?;
            let wait = remaining.min(step);
            tokio::time::sleep(Duration::from_millis(wait)).await;
            remaining = remaining.saturating_sub(wait);
        }
        Ok(())
    }

    fn trace_event(event: &SyncProgressEvent) {
        let slug = event.slug.as_deref().unwrap_or("");
        let field = event.field.as_deref().unwrap_or("");
        let indicator = event.indicator.as_deref().unwrap_or("");
        match event.kind.as_str() {
            "query_err" | "provider_error" | "error" => {
                if slug.is_empty() {
                    tracing::warn!(kind = %event.kind, "{}", event.message);
                } else if field.is_empty() {
                    tracing::warn!(slug = %slug, kind = %event.kind, "{}", event.message);
                } else {
                    tracing::warn!(
                        slug = %slug,
                        field = %field,
                        indicator = %indicator,
                        kind = %event.kind,
                        "{}",
                        event.message
                    );
                }
            }
            "skip" | "query_miss" | "wait" | "collect" | "collect_done" => {
                if slug.is_empty() {
                    tracing::debug!(kind = %event.kind, "{}", event.message);
                } else if field.is_empty() {
                    tracing::debug!(slug = %slug, kind = %event.kind, "{}", event.message);
                } else {
                    tracing::debug!(
                        slug = %slug,
                        field = %field,
                        indicator = %indicator,
                        kind = %event.kind,
                        "{}",
                        event.message
                    );
                }
            }
            _ => {
                if slug.is_empty() {
                    tracing::info!(kind = %event.kind, "{}", event.message);
                } else if field.is_empty() {
                    tracing::info!(slug = %slug, kind = %event.kind, "{}", event.message);
                } else {
                    tracing::info!(
                        slug = %slug,
                        field = %field,
                        indicator = %indicator,
                        kind = %event.kind,
                        "{}",
                        event.message
                    );
                }
            }
        }
    }

    fn send(&self, event: SyncProgressEvent) {
        Self::trace_event(&event);
        if let Some(tx) = &self.tx {
            if let Ok(line) = serde_json::to_string(&event) {
                let _ = tx.send(format!("{line}\n"));
            }
        }
    }

    pub fn info(&self, kind: &str, message: impl Into<String>) {
        self.send(SyncProgressEvent {
            kind: kind.into(),
            message: message.into(),
            slug: None,
            field: None,
            indicator: None,
            stats: None,
        });
    }

    pub fn provider(&self, slug: &str, kind: &str, message: impl Into<String>) {
        self.send(SyncProgressEvent {
            kind: kind.into(),
            message: message.into(),
            slug: Some(slug.into()),
            field: None,
            indicator: None,
            stats: None,
        });
    }

    pub fn provider_stats(&self, slug: &str, stats: &SyncStats) {
        let message = stats.format_summary();
        self.send(SyncProgressEvent {
            kind: "stats".into(),
            message,
            slug: Some(slug.into()),
            field: None,
            indicator: None,
            stats: Some(stats.clone()),
        });
    }

    pub fn request(
        &self,
        slug: &str,
        field: &str,
        indicator: &str,
        kind: &str,
        message: impl Into<String>,
    ) {
        super::sync_status::touch_enrichment_sync_if_running();
        self.send(SyncProgressEvent {
            kind: kind.into(),
            message: message.into(),
            slug: Some(slug.into()),
            field: Some(field.into()),
            indicator: Some(indicator.into()),
            stats: None,
        });
    }

    pub fn done(&self, summary: &SyncSummary) {
        tracing::info!(
            synced = summary.synced,
            failed = summary.failed,
            skipped = summary.skipped,
            rows = summary.rows_written,
            elapsed_ms = summary.elapsed_ms,
            mode = %summary.mode,
            "enrichment sync complete"
        );
        if let Some(tx) = &self.tx {
            if let Ok(line) = serde_json::to_string(summary) {
                let _ = tx.send(format!("{{\"kind\":\"done\",\"summary\":{line}}}\n"));
            }
        }
    }

    pub fn error(&self, message: impl Into<String>) {
        self.info("error", message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_token_blocks_progress() {
        let progress = SyncProgress::none();
        assert!(!progress.is_cancelled());
        progress.cancel();
        assert!(progress.is_cancelled());
        assert!(progress.ensure_not_cancelled().is_err());
    }

    #[test]
    fn ndjson_channel_emits_serialized_events() {
        let (progress, mut rx) = SyncProgress::ndjson_channel();
        progress.provider("virustotal", "plan", "Queued 2 VirusTotal API request(s)");
        let line = rx.try_recv().expect("event line");
        assert!(line.contains("\"kind\":\"plan\""));
        assert!(line.contains("\"slug\":\"virustotal\""));
        assert!(line.contains("Queued 2"));
    }

    #[test]
    fn request_event_includes_field_and_indicator() {
        let (progress, mut rx) = SyncProgress::ndjson_channel();
        progress.request(
            "virustotal",
            "dest_ip",
            "8.8.8.8",
            "query",
            "GET /api/v3/ip 8.8.8.8",
        );
        let line = rx.try_recv().unwrap();
        assert!(line.contains("\"field\":\"dest_ip\""));
        assert!(line.contains("\"indicator\":\"8.8.8.8\""));
    }

    #[test]
    fn provider_stats_serializes_counters() {
        let (progress, mut rx) = SyncProgress::ndjson_channel();
        let stats = SyncStats {
            api_requests: 2,
            api_ok: 1,
            mode: Some("incremental".into()),
            ..Default::default()
        };
        progress.provider_stats("virustotal", &stats);
        let line = rx.try_recv().unwrap();
        assert!(line.contains("\"kind\":\"stats\""));
        assert!(line.contains("\"api_requests\":2"));
    }

    #[test]
    fn done_emits_summary_wrapper() {
        let (progress, mut rx) = SyncProgress::ndjson_channel();
        let summary = SyncSummary {
            mode: "incremental".into(),
            synced: 1,
            rows_written: 1,
            elapsed_ms: 10,
            ..Default::default()
        };
        progress.done(&summary);
        let line = rx.try_recv().unwrap();
        assert!(line.contains("\"kind\":\"done\""));
        assert!(line.contains("\"summary\""));
        assert!(line.contains("\"mode\":\"incremental\""));
    }

    #[tokio::test]
    async fn sleep_cancellable_respects_cancel() {
        let progress = SyncProgress::none();
        progress.cancel();
        assert!(progress.sleep_cancellable(500).await.is_err());
    }

    #[tokio::test]
    async fn sleep_cancellable_completes_when_not_cancelled() {
        let progress = SyncProgress::none();
        progress.sleep_cancellable(50).await.unwrap();
    }
}
