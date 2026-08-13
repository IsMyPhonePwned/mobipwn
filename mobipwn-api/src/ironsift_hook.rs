use crate::AppState;
use mobipwn_core::mudm::{is_endpoint, is_mobile};
use mobipwn_ironsift::{maybe_run_post_ingest_temporal, IronSiftRepository};

/// Run IronSift temporal diff after a successful endpoint re-ingest when a prior job exists.
pub async fn after_ingest(state: &AppState, source: &str, platform: &str) {
    if is_mobile(platform) || !is_endpoint(platform) {
        return;
    }
    let Ok(jobs) = state.ingest_jobs.list_by_source(source, 2).await else {
        return;
    };
    if jobs.len() < 2 || jobs[0].status != "done" || jobs[1].status != "done" {
        return;
    }
    let baseline_before = jobs[1]
        .finished_at
        .unwrap_or(jobs[1].created_at);
    let current_from = jobs[0].created_at;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    if let Ok(Some(run)) = maybe_run_post_ingest_temporal(
        &state.config,
        &repo,
        &state.cases,
        &state.alerts,
        &state.settings,
        source,
        baseline_before,
        current_from,
    )
    .await
    {
        tracing::info!(
            run_id = %run.id,
            source,
            platform,
            anomalies = run.anomaly_count,
            "IronSift post-ingest temporal run completed"
        );
    }
}
