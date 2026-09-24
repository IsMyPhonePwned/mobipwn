use crate::api_error::{api_error, ApiErrorResponse};
use crate::AppState;
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Extension, Json, Router,
};
use futures_util::Stream;
use mobipwn_core::auth::{AuthContext, Permission};
use mobipwn_core::enrichment::{
    clean_enrichment_data, sync_all_providers, sync_all_providers_with_progress,
    sync_single_provider, sync_single_provider_with_progress, CleanSummary, SyncOptions,
    SyncProgress, SyncSummary,
};
use mobipwn_core::marketplace::EnrichmentProvider;
use mobipwn_core::health::fetch_health_detail;
use mobipwn_core::marketplace::coverage_percent;
use mobipwn_core::{
    compile_yara_source, encode_yarc, load_entity_limits_config, load_install_enrichment_config,
    redact_llm_value, redact_mcp_value, save_entity_limits_config, save_install_enrichment_config,
    save_llm_config, save_public_collect_config, save_sysdiagnose_ingest_config, EntityLimitsConfig,
    InstallEnrichmentConfig, LlmConfig, PublicCollectConfig, SysdiagnoseIngestConfig,
    KEY_ENTITY_LIMITS, KEY_INSTALL_ENRICHMENT, KEY_LLM, KEY_MCP, KEY_PUBLIC_COLLECT,
    KEY_SYSDIAGNOSE_INGEST,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::task::{Context, Poll};
use tokio_stream::wrappers::UnboundedReceiverStream;
use uuid::Uuid;

struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

struct CancellableNdjsonStream {
    inner: UnboundedReceiverStream<String>,
    _guard: CancelOnDrop,
}

impl Stream for CancellableNdjsonStream {
    type Item = Result<Bytes, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match Pin::new(&mut self.inner).poll_next(cx) {
            Poll::Ready(Some(line)) => Poll::Ready(Some(Ok(Bytes::from(line)))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ready", get(ready))
        .route("/v1/health/detail", get(health_detail))
        .route("/v1/search/export", post(search_export))
        .route("/v1/events/{id}", get(get_event))
        .route("/v1/data/summary", get(data_summary))
        .route("/v1/data/sources/delete", post(delete_ingest_source))
        .route("/v1/ingest/jobs", get(list_ingest_jobs))
        .route("/v1/ingest/jobs/{id}", get(get_ingest_job))
        .route("/v1/ingest/reingest/case/{case_id}", post(reingest_case_handler))
        .route("/v1/ingest/upload/init", post(init_upload))
        .route(
            "/v1/ingest/upload/{id}",
            put(upload_chunk).layer(DefaultBodyLimit::max(crate::ingest::UPLOAD_CHUNK_SIZE + 1024)),
        )
        .route("/v1/ingest/upload/{id}/complete", post(complete_upload))
        .route("/v1/rules/{id}/runs", get(list_rule_runs))
        .route("/v1/detection-runs/failed", get(list_failed_detection_runs))
        .route("/v1/rules/run-summary", get(rules_run_summary))
        .route("/v1/rules/fleet-health", get(rules_fleet_health))
        .route("/v1/alerts/velocity", get(alerts_velocity))
        .route("/v1/rule-repositories", get(list_rule_repositories))
        .route("/v1/rule-repositories/{id}/rules", get(list_repo_rules))
        .route("/v1/alerts/groups", get(list_alert_groups))
        .route("/v1/alerts/bulk", post(bulk_alerts))
        .route("/v1/alerts/activity", get(list_alert_activity))
        .route("/v1/alerts/deletion-audit", get(list_alert_deletion_audit))
        .route("/v1/alerts/deletion-audit/{id}", get(get_alert_deletion_audit))
        .route("/v1/alerts/bulk-delete", post(bulk_delete_alerts))
        .route("/v1/alerts/{id}/events", get(list_alert_events).post(add_alert_comment))
        .route("/v1/marketplace/coverage", get(marketplace_coverage))
        .route("/v1/marketplace/providers/{id}/config", post(update_provider_config))
        .route("/v1/marketplace/providers/{id}/test", post(test_provider))
        .route("/v1/marketplace/sync", post(sync_marketplace))
        .route("/v1/marketplace/sync/stream", post(sync_marketplace_stream))
        .route("/v1/marketplace/clean", post(clean_marketplace))
        .route(
            "/v1/marketplace/providers/{id}/clean",
            post(clean_marketplace_provider),
        )
        .route(
            "/v1/marketplace/providers/{id}/sync",
            post(sync_marketplace_provider),
        )
        .route(
            "/v1/marketplace/providers/{id}/sync/stream",
            post(sync_marketplace_provider_stream),
        )
        .route("/v1/settings/{key}", get(get_setting).post(set_setting))
        .route("/v1/settings/yara/compile", post(compile_yara_rule))
        .route("/v1/notifications/channels", get(list_webhooks).post(create_webhook))
        .route(
            "/v1/suppressions",
            get(list_suppressions).post(create_suppression),
        )
        .route("/v1/suppressions/{id}", axum::routing::delete(delete_suppression))
}

async fn ready(State(state): State<AppState>) -> Result<&'static str, StatusCode> {
    let h = state.pool.health().await;
    match h {
        mobipwn_core::db::PoolHealth::Full => Ok("ready"),
        mobipwn_core::db::PoolHealth::PostgresOnly => Err(StatusCode::SERVICE_UNAVAILABLE),
    }
}

async fn health_detail(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<mobipwn_core::health::HealthDetail>, StatusCode> {
    let admin = ctx.role.has(Permission::UsersAdmin);
    let mut detail = fetch_health_detail(
        &state.pool,
        &state.config,
        Some(state.settings.as_ref()),
        Some(state.mcp.as_ref()),
        admin,
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !admin {
        detail.auth = None;
        detail.integrations.api_keys.by_user = None;
    }
    Ok(Json(detail))
}

async fn search_export(
    State(state): State<AppState>,
    Json(body): Json<mobipwn_search::SearchExportRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let query = body.query.clone();
    let config = state.effective_config().await;
    let resp = mobipwn_search::run_search_export(&state.pool, &config, body)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    audit_search(&state, &query, resp.row_count).await.ok();
    let disposition = format!("attachment; filename=\"{}\"", resp.filename);
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_str(&resp.content_type)
                    .unwrap_or(HeaderValue::from_static("application/octet-stream")),
            ),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&disposition)
                    .unwrap_or(HeaderValue::from_static("attachment")),
            ),
        ],
        resp.body,
    ))
}

async fn audit_search(state: &AppState, query: &str, row_count: usize) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO search_audit (query, row_count) VALUES ($1, $2)")
        .bind(query)
        .bind(row_count as i32)
        .execute(&state.pool.postgres)
        .await?;
    Ok(())
}

async fn data_summary(
    State(state): State<AppState>,
) -> Result<Json<mobipwn_core::DataSummary>, (StatusCode, Json<ApiErrorResponse>)> {
    mobipwn_core::fetch_data_summary(
        &state.pool,
        &state.config,
        mobipwn_ingest::ingest_build_features(),
    )
        .await
        .map(Json)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
}

#[derive(Deserialize)]
struct DeleteIngestSourceRequest {
    source: String,
}

async fn delete_ingest_source(
    State(state): State<AppState>,
    Json(body): Json<DeleteIngestSourceRequest>,
) -> Result<Json<mobipwn_core::DeleteIngestResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    mobipwn_core::delete_ingest_source(
        &state.pool,
        &state.config,
        &state.cases,
        &state.ingest_jobs,
        &state.collect_blobs,
        &state.alerts,
        &body.source,
    )
    .await
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
}

async fn get_event(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let sql = format!(
        "SELECT * FROM {}.events WHERE id = '{}' LIMIT 1",
        state.config.clickhouse_database, id
    );
    let rows = mobipwn_core::ch::query_json_each_row(&state.config, &state.config.clickhouse_database, &sql)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    rows.into_iter()
        .next()
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "event not found".into()))
}

async fn list_ingest_jobs(
    State(state): State<AppState>,
    Query(q): Query<ListIngestJobsQuery>,
) -> Result<Json<Vec<mobipwn_core::IngestJob>>, StatusCode> {
    if let Some(source) = q.source.as_deref().filter(|s| !s.is_empty()) {
        state
            .ingest_jobs
            .list_by_source(source, q.limit.unwrap_or(50))
            .await
            .map(Json)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    } else {
        state
            .ingest_jobs
            .list_recent(q.limit.unwrap_or(50))
            .await
            .map(Json)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    }
}

#[derive(Deserialize)]
struct ListIngestJobsQuery {
    source: Option<String>,
    limit: Option<i64>,
}

async fn get_ingest_job(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<crate::ingest::IngestJobResponse>, crate::ingest::IngestErr> {
    crate::ingest::get_ingest_job(State(state), Path(id)).await
}

#[derive(Deserialize)]
struct ReingestCaseBody {
    /// Clear existing ClickHouse events for the case source before re-parsing.
    #[serde(default = "default_clean_reingest")]
    clean: bool,
    blob_id: Option<Uuid>,
}

fn default_clean_reingest() -> bool {
    true
}

async fn reingest_case_handler(
    State(state): State<AppState>,
    Path(case_id): Path<Uuid>,
    Json(body): Json<ReingestCaseBody>,
) -> Result<Json<crate::ingest::IngestResultResponse>, crate::ingest::IngestErr> {
    let result =
        crate::ingest::reingest_case(&state, case_id, body.clean, body.blob_id).await?;
    Ok(Json(result))
}

async fn init_upload(
    State(state): State<AppState>,
    Json(body): Json<crate::ingest::UploadInitRequest>,
) -> Result<Json<crate::ingest::UploadInitResponse>, crate::ingest::IngestErr> {
    crate::ingest::init_upload(State(state), Json(body)).await
}

async fn upload_chunk(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> Result<Json<crate::ingest::IngestJobResponse>, crate::ingest::IngestErr> {
    crate::ingest::upload_chunk(State(state), Path(id), headers, body).await
}

async fn complete_upload(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<crate::ingest::IngestResultResponse>, crate::ingest::IngestErr> {
    crate::ingest::complete_upload(State(state), Path(id)).await
}

async fn list_rule_runs(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<mobipwn_core::DetectionRun>>, StatusCode> {
    state
        .detection_runs
        .list_for_rule(id, 30)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
struct FailedRunsQuery {
    hours: Option<i64>,
    limit: Option<i64>,
}

async fn list_failed_detection_runs(
    State(state): State<AppState>,
    Query(q): Query<FailedRunsQuery>,
) -> Result<Json<Vec<mobipwn_core::FailedDetectionRun>>, StatusCode> {
    state
        .detection_runs
        .list_failed(q.hours.unwrap_or(24), q.limit.unwrap_or(20))
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn rules_run_summary(
    State(state): State<AppState>,
) -> Result<Json<mobipwn_core::AllRuleRunSummaries>, StatusCode> {
    state
        .detection_runs
        .summaries_all()
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn rules_fleet_health(
    State(state): State<AppState>,
) -> Result<Json<mobipwn_core::FleetHealthSummary>, StatusCode> {
    mobipwn_core::fetch_fleet_health(&state.pool.postgres)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
pub struct VelocityQuery {
    pub hours: Option<i64>,
}

async fn alerts_velocity(
    State(state): State<AppState>,
    Query(q): Query<VelocityQuery>,
) -> Result<Json<Vec<mobipwn_core::VelocityBucket>>, StatusCode> {
    mobipwn_core::fetch_alert_velocity(&state.pool.postgres, q.hours.unwrap_or(24))
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn list_rule_repositories() -> Json<mobipwn_core::RuleRepositoriesResponse> {
    Json(mobipwn_core::list_repositories())
}

async fn list_repo_rules(
    Path(id): Path<String>,
) -> Result<Json<Vec<mobipwn_core::RepositoryRuleFile>>, (StatusCode, String)> {
    mobipwn_core::list_repository_rules(&id)
        .map(Json)
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))
}

#[derive(Deserialize)]
pub struct AlertGroupsQuery {
    pub status: Option<String>,
    /// `active` (default), `dismissed`, or `all`
    pub dismissed: Option<String>,
    /// `rule` = aggregate by rule+status; `rule_facet` = one row per dedup facet (default).
    pub by: Option<String>,
    pub case_id: Option<Uuid>,
    /// Filter by assignee username, or `me` for the current session user.
    pub assignee: Option<String>,
}

#[derive(Serialize)]
pub struct AlertRuleGroupSummary {
    pub rule_id: Uuid,
    pub rule_name: String,
    pub status: String,
    pub facet_count: i64,
    pub event_count: i64,
    pub last_seen: chrono::DateTime<chrono::Utc>,
}

async fn list_alert_groups(
    State(state): State<AppState>,
    Extension(ctx): Extension<mobipwn_core::auth::AuthContext>,
    Query(q): Query<AlertGroupsQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let filter = crate::case_audit::build_alert_list_filter(
        &state.pool.postgres,
        &ctx,
        q.status.as_deref(),
        q.dismissed.as_deref(),
        q.case_id,
        q.assignee.as_deref(),
    )
    .await;
    let by = q.by.as_deref().unwrap_or("rule_facet");
    if by == "rule" {
        let rows = state
            .alerts
            .list_rule_summaries_filtered(&filter)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let out: Vec<AlertRuleGroupSummary> = rows
            .into_iter()
            .map(|(rule_id, rule_name, st, facet_count, event_count, last_seen)| {
                AlertRuleGroupSummary {
                    rule_id,
                    rule_name,
                    status: mobipwn_core::alerts::status_str(st).into(),
                    facet_count,
                    event_count,
                    last_seen,
                }
            })
            .collect();
        Ok(Json(serde_json::json!({ "by": "rule", "groups": out })))
    } else {
        let groups = state
            .alerts
            .list_facet_groups_filtered(&filter)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(Json(serde_json::json!({ "by": "rule_facet", "groups": groups })))
    }
}

#[derive(Deserialize)]
pub struct BulkAlertRequest {
    pub ids: Option<Vec<Uuid>>,
    pub rule_id: Option<Uuid>,
    pub from_status: Option<String>,
    pub status: String,
    pub comment: Option<String>,
    pub author: Option<String>,
}

async fn bulk_alerts(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<BulkAlertRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let to = mobipwn_core::alerts::parse_status(&body.status);
    let from_status = body.from_status.as_deref().map(mobipwn_core::alerts::parse_status);
    let author = crate::case_audit::resolve_alert_author(
        &state.pool.postgres,
        &ctx,
        body.author.as_deref(),
    )
    .await;

    let target_ids: Vec<Uuid> = if let Some(rule_id) = body.rule_id {
        if let Some(st) = from_status {
            sqlx::query_scalar(
                "SELECT id FROM alerts WHERE rule_id = $1 AND status = $2::alert_status",
            )
            .bind(rule_id)
            .bind(mobipwn_core::alerts::status_str(st))
            .fetch_all(&state.pool.postgres)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        } else {
            sqlx::query_scalar("SELECT id FROM alerts WHERE rule_id = $1")
                .bind(rule_id)
                .fetch_all(&state.pool.postgres)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        }
    } else {
        body.ids.unwrap_or_default()
    };

    let to_label = body.status.as_str();
    let mut updated = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    for id in target_ids {
        let before = state.alerts.get(id).await.ok().flatten();
        let Some(before) = before else {
            skipped += 1;
            continue;
        };
        if before.status == to {
            skipped += 1;
            continue;
        }
        let from = mobipwn_core::alerts::status_str(before.status);
        match state.alerts.update_status(id, to).await {
            Ok(Some(_)) => {
                updated += 1;
                let _ = state
                    .alert_events
                    .log_status_change(id, from, to_label, &author)
                    .await;
                if let Ok(Some(updated_alert)) = state.alerts.get(id).await {
                    mobipwn_core::maybe_forward_status_change_alert(
                        &state.pool.postgres,
                        &updated_alert,
                        before.status,
                        to,
                    )
                    .await;
                }
                if let Some(ref comment) = body.comment {
                    if !comment.trim().is_empty() {
                        let _ = state
                            .alert_events
                            .add_comment(id, comment.trim(), &author)
                            .await;
                    }
                }
            }
            Ok(None) => skipped += 1,
            Err(_) => failed += 1,
        }
    }

    Ok(Json(serde_json::json!({
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
    })))
}

#[derive(Deserialize)]
pub struct BulkDeleteAlertsRequest {
    pub ids: Option<Vec<Uuid>>,
    pub rule_id: Option<Uuid>,
    pub status: Option<String>,
    pub author: Option<String>,
    pub reason: Option<String>,
}

async fn bulk_delete_alerts(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<BulkDeleteAlertsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let target_ids: Vec<Uuid> = if let Some(rule_id) = body.rule_id {
        if let Some(st) = body.status.as_deref() {
            sqlx::query_scalar(
                "SELECT id FROM alerts WHERE rule_id = $1 AND status = $2::alert_status",
            )
            .bind(rule_id)
            .bind(st)
            .fetch_all(&state.pool.postgres)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        } else {
            sqlx::query_scalar("SELECT id FROM alerts WHERE rule_id = $1")
                .bind(rule_id)
                .fetch_all(&state.pool.postgres)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        }
    } else if let Some(st) = body.status.as_deref() {
        sqlx::query_scalar("SELECT id FROM alerts WHERE status = $1::alert_status")
            .bind(st)
            .fetch_all(&state.pool.postgres)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        body.ids.unwrap_or_default()
    };

    let deleted = crate::alert_delete::audited_delete_many(
        &state,
        &ctx,
        &target_ids,
        body.author.as_deref(),
        body.reason.as_deref(),
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "deleted": deleted, "requested": target_ids.len() })))
}

#[derive(Deserialize)]
struct ListDeletionAuditQuery {
    limit: Option<i64>,
}

#[derive(Deserialize)]
struct ListAlertActivityQuery {
    limit: Option<i64>,
    alert_id: Option<Uuid>,
    kind: Option<String>,
}

async fn list_alert_activity(
    State(state): State<AppState>,
    Query(q): Query<ListAlertActivityQuery>,
) -> Result<Json<Vec<mobipwn_core::AlertActivityEntry>>, StatusCode> {
    let filter = mobipwn_core::AlertActivityFilter {
        alert_id: q.alert_id,
        kind: q.kind,
        limit: q.limit.unwrap_or(200),
    };
    state
        .alert_activity
        .list_recent(&filter)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn list_alert_deletion_audit(
    State(state): State<AppState>,
    Query(q): Query<ListDeletionAuditQuery>,
) -> Result<Json<Vec<mobipwn_core::AlertDeletionAuditSummary>>, StatusCode> {
    state
        .alert_deletion_audit
        .list_recent(q.limit.unwrap_or(100).min(500))
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn get_alert_deletion_audit(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<mobipwn_core::AlertDeletionAuditDetail>, StatusCode> {
    state
        .alert_deletion_audit
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)
        .map(Json)
}

async fn list_alert_events(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<mobipwn_core::AlertEvent>>, StatusCode> {
    state
        .alert_events
        .list(id)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
pub struct CommentRequest {
    pub body: String,
    pub author: Option<String>,
}

async fn add_alert_comment(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Json(body): Json<CommentRequest>,
) -> Result<Json<mobipwn_core::AlertEvent>, StatusCode> {
    let author = crate::case_audit::resolve_alert_author(
        &state.pool.postgres,
        &ctx,
        body.author.as_deref(),
    )
    .await;
    state
        .alert_events
        .add_comment(id, &body.body, &author)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn marketplace_coverage(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let (enabled, fields) = state
        .providers
        .coverage_summary()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let pct = coverage_percent(fields);
    Ok(Json(serde_json::json!({
        "enabled_providers": enabled,
        "covered_fields": fields,
        "coverage_percent": pct,
    })))
}

#[derive(Deserialize)]
pub struct ProviderConfigRequest {
    pub config: serde_json::Value,
}

async fn update_provider_config(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<ProviderConfigRequest>,
) -> Result<Json<mobipwn_core::marketplace::EnrichmentProvider>, StatusCode> {
    state
        .providers
        .update_config(id, body.config)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn test_provider(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let list = state
        .providers
        .list()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let provider = list
        .into_iter()
        .find(|p| p.id == id)
        .ok_or((StatusCode::NOT_FOUND, "provider not found".into()))?;

    match provider.slug.as_str() {
        "virustotal" => {
            let api_key = provider
                .config
                .get("api_key")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or((StatusCode::BAD_REQUEST, "api_key required".into()))?;
            let msg = mobipwn_core::enrichment::test_virustotal_api_key(api_key)
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
            Ok(Json(serde_json::json!({ "ok": true, "message": msg })))
        }
        "google_play" => {
            let sample = provider
                .config
                .get("test_package")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("com.ubergeek42.WeechatAndroid.dev");
            let msg = mobipwn_core::enrichment::test_google_play_lookup(sample)
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
            Ok(Json(serde_json::json!({ "ok": true, "message": msg })))
        }
        _ => Err((
            StatusCode::NOT_IMPLEMENTED,
            format!("test not supported for {}", provider.slug),
        )),
    }
}

async fn sync_marketplace(
    State(state): State<AppState>,
    body: Option<Json<SyncMarketplaceRequest>>,
) -> Result<Json<SyncSummary>, StatusCode> {
    let options = sync_options_from_body(body);
    let list = state.providers.list().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let config = state.effective_config().await;
    let summary = sync_all_providers(&state.pool.postgres, &config, &list, Some("api"), options)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(summary))
}

async fn sync_marketplace_stream(
    State(state): State<AppState>,
    body: Option<Json<SyncMarketplaceRequest>>,
) -> Response {
    let options = sync_options_from_body(body);
    spawn_enrichment_sync_stream(state, None, options)
}

async fn sync_marketplace_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<SyncMarketplaceRequest>>,
) -> Result<Json<SyncSummary>, StatusCode> {
    let options = sync_options_from_body(body);
    let provider = marketplace_provider_by_id(&state, &id).await?;
    let config = state.effective_config().await;
    let summary = sync_single_provider(
        &state.pool.postgres,
        &config,
        &provider,
        Some("api"),
        options,
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(summary))
}

async fn sync_marketplace_provider_stream(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<SyncMarketplaceRequest>>,
) -> Result<Response, StatusCode> {
    let options = sync_options_from_body(body);
    let provider = marketplace_provider_by_id(&state, &id).await?;
    Ok(spawn_enrichment_sync_stream(state, Some(provider), options))
}

async fn marketplace_provider_by_id(
    state: &AppState,
    id: &str,
) -> Result<EnrichmentProvider, StatusCode> {
    let uuid = Uuid::parse_str(id).map_err(|_| StatusCode::BAD_REQUEST)?;
    state
        .providers
        .list()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .into_iter()
        .find(|p| p.id == uuid)
        .ok_or(StatusCode::NOT_FOUND)
}

fn spawn_enrichment_sync_stream(
    state: AppState,
    provider: Option<EnrichmentProvider>,
    options: SyncOptions,
) -> Response {
    let (progress, rx) = SyncProgress::ndjson_channel();
    progress.info("connected", "Sync stream connected");
    let cancel = progress.cancel_token();
    tokio::spawn(async move {
        let run = async {
            let config = state.effective_config().await;
            let summary = if let Some(provider) = provider {
                sync_single_provider_with_progress(
                    &state.pool.postgres,
                    &config,
                    &provider,
                    &progress,
                    Some("api"),
                    options,
                )
                .await?
            } else {
                let list = state.providers.list().await?;
                sync_all_providers_with_progress(
                    &state.pool.postgres,
                    &config,
                    &list,
                    &progress,
                    Some("api"),
                    options,
                )
                .await?
            };
            progress.done(&summary);
            anyhow::Ok(())
        }
        .await;
        if let Err(e) = run {
            if e.to_string() == "sync cancelled" {
                progress.info("cancelled", "Sync cancelled");
            } else {
                progress.error(format!("Sync failed: {e}"));
            }
        }
    });

    let stream = CancellableNdjsonStream {
        inner: UnboundedReceiverStream::new(rx),
        _guard: CancelOnDrop(cancel),
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-ndjson; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(Body::from_stream(stream))
        .unwrap()
}

#[derive(Debug, Deserialize, Default)]
struct SyncMarketplaceRequest {
    full_resync: Option<bool>,
}

fn sync_options_from_body(body: Option<Json<SyncMarketplaceRequest>>) -> SyncOptions {
    if body.and_then(|Json(b)| b.full_resync).unwrap_or(false) {
        SyncOptions::full_resync()
    } else {
        SyncOptions::incremental()
    }
}

#[derive(Debug, Deserialize, Default)]
struct CleanMarketplaceRequest {
    slug: Option<String>,
}

async fn clean_marketplace(
    State(state): State<AppState>,
    body: Option<Json<CleanMarketplaceRequest>>,
) -> Result<Json<CleanSummary>, StatusCode> {
    let slug = body.and_then(|Json(b)| b.slug);
    clean_enrichment_data(&state.pool.postgres, &state.config, slug.as_deref())
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn clean_marketplace_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<CleanSummary>, StatusCode> {
    let slug: Option<String> = sqlx::query_scalar("SELECT slug FROM enrichment_providers WHERE id = $1")
        .bind(&id)
        .fetch_optional(&state.pool.postgres)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let slug = slug.ok_or(StatusCode::NOT_FOUND)?;

    clean_enrichment_data(&state.pool.postgres, &state.config, Some(&slug))
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn get_setting(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let value = state
        .settings
        .get(&key)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if key == KEY_LLM {
        return Ok(Json(redact_llm_value(&value)));
    }
    if key == KEY_MCP {
        return Ok(Json(redact_mcp_value(&value)));
    }
    if key == KEY_ENTITY_LIMITS {
        let cfg = load_entity_limits_config(&state.settings)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(Json(
            serde_json::to_value(cfg).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        ));
    }
    if key == KEY_INSTALL_ENRICHMENT {
        let cfg = load_install_enrichment_config(&state.settings)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(Json(
            serde_json::to_value(cfg).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        ));
    }
    if key == KEY_SYSDIAGNOSE_INGEST {
        let cfg = mobipwn_core::load_sysdiagnose_ingest_config(&state.settings)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(Json(
            serde_json::to_value(cfg).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        ));
    }
    Ok(Json(value))
}

async fn set_setting(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<StatusCode, StatusCode> {
    if key == KEY_LLM {
        let incoming: LlmConfig = serde_json::from_value(body).map_err(|_| StatusCode::BAD_REQUEST)?;
        save_llm_config(&state.settings, &incoming)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if key == KEY_MCP {
        crate::routes_mcp::save_mcp_setting(&state, body).await?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if key == KEY_PUBLIC_COLLECT {
        let incoming: PublicCollectConfig =
            serde_json::from_value(body).map_err(|_| StatusCode::BAD_REQUEST)?;
        save_public_collect_config(&state.settings, &incoming)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if key == KEY_SYSDIAGNOSE_INGEST {
        let incoming: SysdiagnoseIngestConfig =
            serde_json::from_value(body).map_err(|_| StatusCode::BAD_REQUEST)?;
        save_sysdiagnose_ingest_config(&state.settings, &incoming)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if key == KEY_ENTITY_LIMITS {
        let incoming: EntityLimitsConfig =
            serde_json::from_value(body).map_err(|_| StatusCode::BAD_REQUEST)?;
        save_entity_limits_config(&state.settings, &incoming)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if key == KEY_INSTALL_ENRICHMENT {
        let incoming: InstallEnrichmentConfig =
            serde_json::from_value(body).map_err(|_| StatusCode::BAD_REQUEST)?;
        save_install_enrichment_config(&state.settings, &incoming)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(StatusCode::NO_CONTENT);
    }
    state
        .settings
        .set(&key, &body)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CompileYaraRequest {
    source: String,
}

#[derive(Serialize)]
struct CompileYaraResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    compiled_b64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

async fn compile_yara_rule(
    Json(body): Json<CompileYaraRequest>,
) -> Result<Json<CompileYaraResponse>, StatusCode> {
    match compile_yara_source(&body.source) {
        Ok(bytes) => Ok(Json(CompileYaraResponse {
            ok: true,
            compiled_b64: Some(encode_yarc(&bytes)),
            error: None,
        })),
        Err(err) => Ok(Json(CompileYaraResponse {
            ok: false,
            compiled_b64: None,
            error: Some(err),
        })),
    }
}

#[derive(Serialize)]
pub struct WebhookChannel {
    pub id: Uuid,
    pub name: String,
    pub url: String,
}

async fn list_webhooks(State(state): State<AppState>) -> Result<Json<Vec<WebhookChannel>>, StatusCode> {
    let rows = sqlx::query_as::<_, (Uuid, String, String)>(
        "SELECT id, name, url FROM notification_channels WHERE kind = 'webhook' ORDER BY name",
    )
    .fetch_all(&state.pool.postgres)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, name, url)| WebhookChannel { id, name, url })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct CreateWebhookRequest {
    pub name: String,
    pub url: String,
}

async fn create_webhook(
    State(state): State<AppState>,
    Json(body): Json<CreateWebhookRequest>,
) -> Result<StatusCode, StatusCode> {
    sqlx::query(
        "INSERT INTO notification_channels (name, kind, url) VALUES ($1, 'webhook', $2)",
    )
    .bind(&body.name)
    .bind(&body.url)
    .execute(&state.pool.postgres)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::CREATED)
}

async fn list_suppressions(
    State(state): State<AppState>,
) -> Result<Json<Vec<mobipwn_core::SuppressionWindow>>, StatusCode> {
    state
        .suppressions
        .list_active()
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
pub struct CreateSuppressionRequest {
    pub name: String,
    pub rule_id: Option<Uuid>,
    pub starts_at: chrono::DateTime<chrono::Utc>,
    pub ends_at: chrono::DateTime<chrono::Utc>,
}

async fn create_suppression(
    State(state): State<AppState>,
    Json(body): Json<CreateSuppressionRequest>,
) -> Result<Json<mobipwn_core::SuppressionWindow>, (StatusCode, String)> {
    state
        .suppressions
        .create(&body.name, body.rule_id, body.starts_at, body.ends_at)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn delete_suppression(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let ok = state
        .suppressions
        .delete(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if ok {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

pub fn file_hash(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}
