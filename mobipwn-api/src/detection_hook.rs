//! After ingest: run live detection rules against the new source and drain realtime signals.

use crate::AppState;
use mobipwn_core::ch::signals::process_realtime_signals;
use mobipwn_search::run_post_ingest_detections;
use tracing::info;

pub async fn after_ingest_detections(state: &AppState, source: &str) {
    let source = source.trim();
    if source.is_empty() {
        return;
    }

    match run_post_ingest_detections(
        &state.config,
        &state.settings,
        &state.rules,
        &state.alerts,
        &state.detection_runs,
        &state.suppressions,
        source,
    )
    .await
    {
        Ok(summary) => {
            if summary.rules_run > 0 {
                info!(
                    source,
                    rules_run = summary.rules_run,
                    hits = summary.hit_count,
                    alerts = summary.alerts_created,
                    "post-ingest detection rules finished"
                );
            }
            // Batch run already upserted alerts for all live/alerting rules on this source.
            return;
        }
        Err(e) => tracing::warn!(source, error = %e, "post-ingest detection rules failed"),
    }

    // Fallback when batch detection failed: promote any realtime MV signals.
    if let Err(e) = process_realtime_signals(
        &state.config,
        &state.pool.postgres,
        &state.suppressions,
        &state.alerts,
        &state.rules,
        &state.detection_runs,
        &state.settings,
    )
    .await
    {
        tracing::warn!(source, error = %e, "post-ingest realtime signal drain failed");
    }
}

pub fn spawn_after_ingest_detections(state: &AppState, source: &str) {
    let source = source.to_string();
    let state = state.clone();
    tokio::spawn(async move {
        after_ingest_detections(&state, &source).await;
    });
}
