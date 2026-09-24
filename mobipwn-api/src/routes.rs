use crate::api_error::{api_error, ApiErrorResponse};
use crate::routes_rules_ext::{sync_rule_realtime_mv, validate_rule_enhanced, ValidateRuleBody};
use crate::AppState;
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use mobipwn_core::auth::AuthContext;
use mobipwn_core::alerts::{parse_status, status_str};
use mobipwn_core::detection::{DetectionMode, DetectionRule, RuleLifecycle};
use mobipwn_core::mudm::{canonical, stamp_ingest_tags, ANDROID, ENDPOINT, IOS, TimelinePlatform};
use mobipwn_ingest::{ingest_jsonl, insert_events};
use mobipwn_search::{
    admission::resolve_time_bounds, execute_detection_rule, generate_clickhouse_sql, parse_mpl,
    ExecuteDetectionOptions, ExecuteDetectionResult, FieldStatsRequest, FieldsInScopeRequest,
    HistogramRequest, PrevalenceScatterRequest, SearchRunRequest,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: &'static str,
    pub clickhouse: &'static str,
}

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let ch = match state.pool.health().await {
        mobipwn_core::db::PoolHealth::Full => "up",
        mobipwn_core::db::PoolHealth::PostgresOnly => "degraded",
    };
    Json(HealthResponse {
        status: "ok",
        clickhouse: ch,
    })
}

// --- Search (proxy to local compile + run via shared libs) ---

#[derive(Deserialize, ToSchema)]
pub struct SearchCompileRequest {
    pub query: String,
    pub time_from: Option<String>,
    pub time_to: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct SearchCompileResponse {
    pub sql: String,
}

pub async fn compile_search(
    State(state): State<AppState>,
    Json(body): Json<SearchCompileRequest>,
) -> Result<Json<SearchCompileResponse>, (axum::http::StatusCode, String)> {
    let mpl = parse_mpl(&body.query)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))?;
    let config = state.effective_config().await;
    let bounds = resolve_time_bounds(
        &mpl,
        body.time_from.as_deref(),
        body.time_to.as_deref(),
        config.search_admission.default_hours,
    );
    let sql = generate_clickhouse_sql(
        &mpl,
        &config.clickhouse_database,
        bounds.time_from.as_deref(),
        bounds.time_to.as_deref(),
    )
    .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(SearchCompileResponse { sql }))
}

pub async fn run_search(
    State(state): State<AppState>,
    Json(body): Json<SearchRunRequest>,
) -> Result<Json<mobipwn_search::SearchRunResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let config = state.effective_config().await;
    mobipwn_search::run_search(&state.pool, &config, body)
        .await
        .map(Json)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
}

pub async fn field_stats(
    State(state): State<AppState>,
    Json(body): Json<FieldStatsRequest>,
) -> Result<Json<mobipwn_search::FieldStatsResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let config = state.effective_config().await;
    mobipwn_search::run_field_stats(&config, body)
        .await
        .map(Json)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
}

pub async fn histogram(
    State(state): State<AppState>,
    Json(body): Json<HistogramRequest>,
) -> Result<Json<mobipwn_search::HistogramResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let config = state.effective_config().await;
    mobipwn_search::run_histogram(&config, body)
        .await
        .map(Json)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
}

pub async fn list_search_fields() -> Json<Vec<&'static str>> {
    Json(mobipwn_search::field_stats::list_sidebar_fields())
}

pub async fn list_mudm_fields() -> Json<Vec<mobipwn_core::mudm::MudmFieldCatalogEntry>> {
    Json(mobipwn_core::mudm::mudm_field_catalog())
}

pub async fn prevalence_scatter(
    State(state): State<AppState>,
    Json(body): Json<PrevalenceScatterRequest>,
) -> Result<Json<mobipwn_search::PrevalenceScatterResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let config = state.effective_config().await;
    mobipwn_search::run_prevalence_scatter(&config, body)
        .await
        .map(Json)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
}

pub async fn fields_in_scope(
    State(state): State<AppState>,
    Json(body): Json<FieldsInScopeRequest>,
) -> Result<Json<mobipwn_search::FieldsInScopeResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let config = state.effective_config().await;
    mobipwn_search::run_fields_in_scope(&config, body)
        .await
        .map(Json)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
}

// --- Ingest ---

type IngestErr = (StatusCode, Json<ApiErrorResponse>);

/// Default Axum body limit is 2MB; bugreports are often much larger.
const INGEST_ARCHIVE_BODY_LIMIT: usize = 512 * 1024 * 1024;

#[derive(Deserialize, ToSchema)]
pub struct IngestJsonlRequest {
    pub platform: String,
    pub source: String,
    pub jsonl: String,
    /// Optional tags merged onto the investigation case (endpoint ingest).
    pub tags: Option<Vec<String>>,
}

#[derive(Serialize, ToSchema)]
pub struct IngestResponse {
    pub ingested: usize,
}

pub async fn ingest_jsonl_handler(
    State(state): State<AppState>,
    Json(body): Json<IngestJsonlRequest>,
) -> Result<Json<IngestResponse>, IngestErr> {
    let platform_label = canonical(&body.platform);
    let platform = match platform_label.as_str() {
        ANDROID => TimelinePlatform::AndroidBugreport,
        IOS => TimelinePlatform::IosSysdiagnose,
        ENDPOINT => TimelinePlatform::Vector,
        _ => {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "platform must be android, ios, endpoint, or vector",
            ));
        }
    };
    let mut events = ingest_jsonl(&body.jsonl, platform, &body.source);
    if let Some(ref extra) = body.tags {
        if !extra.is_empty() {
            stamp_ingest_tags(&mut events, extra);
        }
    }
    let n = insert_events(&state.clickhouse, &events)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    crate::ingest::verify_source_in_clickhouse(&state.config, &body.source, n).await?;
    let plat = platform_label.as_str();
    match state
        .cases
        .ensure_for_ingest_source(&body.source, plat, None)
        .await
    {
        Ok((case, is_new)) => {
            if let Some(ref extra) = body.tags {
                if !extra.is_empty() {
                    let _ = state.cases.patch_tags(case.id, extra, &[]).await;
                }
            }
            if is_new {
                crate::case_audit::audit_ingest_case_created(&state, &case).await;
            }
        }
        Err(e) => tracing::warn!(error = %e, "could not sync case for ingest source"),
    }
    Ok(Json(IngestResponse { ingested: n }))
}

#[derive(Deserialize, ToSchema)]
pub struct IngestArchiveQuery {
    pub source: String,
    /// Device owner (person whose mobile was ingested) for the investigation case.
    pub user: Option<String>,
    /// Comma-separated tags merged onto the investigation case.
    pub tags: Option<String>,
}

fn ingest_case_user<'a>(q: &'a IngestArchiveQuery) -> Option<&'a str> {
    q.user.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

pub async fn ingest_bugreport(
    State(state): State<AppState>,
    Query(q): Query<IngestArchiveQuery>,
    body: Bytes,
) -> Result<Json<IngestResponse>, IngestErr> {
    let extra_tags = crate::ingest::parse_comma_tags(q.tags.as_deref());
    let result = crate::ingest::ingest_archive_bytes(
        &state,
        &q.source,
        "android",
        ingest_case_user(&q),
        &extra_tags,
        &body,
        "bugreport",
    )
    .await?;
    Ok(Json(IngestResponse {
        ingested: result.ingested,
    }))
}

pub async fn ingest_sysdiagnose(
    State(state): State<AppState>,
    Query(q): Query<IngestArchiveQuery>,
    body: Bytes,
) -> Result<Json<IngestResponse>, IngestErr> {
    let extra_tags = crate::ingest::parse_comma_tags(q.tags.as_deref());
    let result = crate::ingest::ingest_archive_bytes(
        &state,
        &q.source,
        "ios",
        ingest_case_user(&q),
        &extra_tags,
        &body,
        "sysdiagnose.tar.gz",
    )
    .await?;
    Ok(Json(IngestResponse {
        ingested: result.ingested,
    }))
}

fn ingest_archive_router() -> Router<AppState> {
    Router::new()
        .route("/v1/ingest/bugreport", post(ingest_bugreport))
        .route("/v1/ingest/sysdiagnose", post(ingest_sysdiagnose))
        .layer(DefaultBodyLimit::max(INGEST_ARCHIVE_BODY_LIMIT))
}

// --- Rules ---

#[derive(Deserialize, ToSchema)]
pub struct CreateRuleRequest {
    pub name: String,
    pub description: Option<String>,
    pub lifecycle: Option<String>,
    pub mode: Option<String>,
    pub query: String,
    pub cron: Option<String>,
    pub severity: Option<String>,
    pub mitre: Option<Vec<String>>,
    pub prevalence_threshold: Option<f64>,
    pub min_hits: Option<i32>,
    pub max_alerts_per_run: Option<i32>,
    pub signal_log_enabled: Option<bool>,
    pub author: Option<String>,
    pub enabled: Option<bool>,
    pub sigma_yaml: Option<String>,
    pub repository_id: Option<Uuid>,
    pub folder_id: Option<Uuid>,
    pub tags: Option<Vec<String>>,
    pub maintainer: Option<String>,
}

const DEFAULT_RULE_REPO: Uuid = uuid::uuid!("11111111-1111-1111-1111-111111111101");
const DEFAULT_RULE_FOLDER: Uuid = uuid::uuid!("11111111-1111-1111-1111-111111111201");

#[derive(Deserialize)]
pub struct ListRulesQuery {
    pub repository_id: Option<Uuid>,
    pub folder_id: Option<Uuid>,
    pub tag: Option<String>,
    /// Filter by maintainer username, or `me` for the current session user.
    pub maintainer: Option<String>,
}

fn parse_lifecycle(s: &str) -> RuleLifecycle {
    match s {
        "live" => RuleLifecycle::Live,
        "alerting" => RuleLifecycle::Alerting,
        _ => RuleLifecycle::Staging,
    }
}

fn parse_mode(s: &str) -> DetectionMode {
    match s {
        "realtime" => DetectionMode::Realtime,
        _ => DetectionMode::Scheduled,
    }
}

pub async fn list_rules(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Query(q): Query<ListRulesQuery>,
) -> Result<Json<Vec<DetectionRule>>, (axum::http::StatusCode, String)> {
    let filter = crate::case_audit::build_rule_list_filter(
        &state.pool.postgres,
        &ctx,
        q.repository_id,
        q.folder_id,
        q.tag,
        q.maintainer.as_deref(),
    )
    .await;
    let rules = state
        .rules
        .list_filtered(&filter)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rules))
}

pub async fn create_rule(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<CreateRuleRequest>,
) -> Result<Json<DetectionRule>, (axum::http::StatusCode, String)> {
    let rule = DetectionRule {
        id: Uuid::now_v7(),
        name: body.name,
        description: body.description.unwrap_or_default(),
        lifecycle: body
            .lifecycle
            .as_deref()
            .map(parse_lifecycle)
            .unwrap_or(RuleLifecycle::Staging),
        mode: body
            .mode
            .as_deref()
            .map(parse_mode)
            .unwrap_or(DetectionMode::Scheduled),
        query: body.query,
        cron: body.cron,
        severity: body.severity.unwrap_or_else(|| "medium".into()),
        mitre: body.mitre.unwrap_or_default(),
        prevalence_threshold: body.prevalence_threshold,
        min_hits: body.min_hits.unwrap_or(1).max(1),
        max_alerts_per_run: body.max_alerts_per_run.unwrap_or(50).max(1),
        signal_log_enabled: body.signal_log_enabled.unwrap_or(true),
        enabled: body.enabled.unwrap_or(true),
        muted_until: None,
        sigma_yaml: body.sigma_yaml,
        realtime_mv: None,
        version: 1,
        updated_at: chrono::Utc::now(),
        repository_id: Some(body.repository_id.unwrap_or(DEFAULT_RULE_REPO)),
        folder_id: Some(body.folder_id.unwrap_or(DEFAULT_RULE_FOLDER)),
        tags: body.tags.unwrap_or_default(),
        maintainer: body
            .maintainer
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    };
    let actor = crate::case_audit::resolve_audit_actor(&state.pool.postgres, &ctx).await;
    let mut rule = rule;
    if rule.maintainer.is_none() {
        rule.maintainer = Some(actor.name.clone());
    }
    let author = crate::case_audit::resolve_alert_author(
        &state.pool.postgres,
        &ctx,
        body.author.as_deref(),
    )
    .await;
    let saved = state
        .rules
        .create(&rule, &author)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sync_rule_realtime_mv(&state, &saved).await?;
    Ok(Json(saved))
}

#[derive(Serialize)]
pub struct ResolveIdResponse {
    pub id: Uuid,
}

pub async fn resolve_rule_id(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<ResolveIdResponse>, (axum::http::StatusCode, String)> {
    let id = mobipwn_core::resolve_uuid_token(&state.pool.postgres, "detection_rules", &token)
        .await
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("ambiguous") {
                (axum::http::StatusCode::CONFLICT, msg)
            } else {
                (axum::http::StatusCode::NOT_FOUND, msg)
            }
        })?;
    Ok(Json(ResolveIdResponse { id }))
}

pub async fn resolve_alert_id(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<ResolveIdResponse>, (axum::http::StatusCode, String)> {
    let id = mobipwn_core::resolve_uuid_token(&state.pool.postgres, "alerts", &token)
        .await
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("ambiguous") {
                (axum::http::StatusCode::CONFLICT, msg)
            } else {
                (axum::http::StatusCode::NOT_FOUND, msg)
            }
        })?;
    Ok(Json(ResolveIdResponse { id }))
}

pub async fn get_rule(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<DetectionRule>, (axum::http::StatusCode, String)> {
    let rule = state
        .rules
        .get(id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    rule.ok_or((axum::http::StatusCode::NOT_FOUND, "rule not found".into()))
        .map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateRuleRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub lifecycle: Option<String>,
    pub mode: Option<String>,
    pub query: Option<String>,
    pub cron: Option<String>,
    pub severity: Option<String>,
    pub mitre: Option<Vec<String>>,
    pub prevalence_threshold: Option<f64>,
    pub min_hits: Option<i32>,
    pub max_alerts_per_run: Option<i32>,
    pub signal_log_enabled: Option<bool>,
    pub author: Option<String>,
    pub enabled: Option<bool>,
    pub sigma_yaml: Option<String>,
    pub repository_id: Option<Uuid>,
    pub folder_id: Option<Uuid>,
    pub tags: Option<Vec<String>>,
    pub maintainer: Option<String>,
}

pub async fn update_rule(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateRuleRequest>,
) -> Result<Json<DetectionRule>, (axum::http::StatusCode, String)> {
    let mut rule = state
        .rules
        .get(id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "rule not found".into()))?;
    if let Some(n) = body.name {
        rule.name = n;
    }
    if let Some(d) = body.description {
        rule.description = d;
    }
    if let Some(l) = body.lifecycle.as_deref() {
        rule.lifecycle = parse_lifecycle(l);
    }
    if let Some(m) = body.mode.as_deref() {
        rule.mode = parse_mode(m);
    }
    if let Some(q) = body.query {
        rule.query = q;
    }
    if body.cron.is_some() {
        rule.cron = body.cron;
    }
    if let Some(s) = body.severity {
        rule.severity = s;
    }
    if let Some(m) = body.mitre {
        rule.mitre = m;
    }
    if body.prevalence_threshold.is_some() {
        rule.prevalence_threshold = body.prevalence_threshold;
    }
    if let Some(m) = body.min_hits {
        rule.min_hits = m.max(1);
    }
    if let Some(m) = body.max_alerts_per_run {
        rule.max_alerts_per_run = m.max(1);
    }
    if let Some(s) = body.signal_log_enabled {
        rule.signal_log_enabled = s;
    }
    if let Some(e) = body.enabled {
        rule.enabled = e;
    }
    if body.sigma_yaml.is_some() {
        rule.sigma_yaml = body.sigma_yaml;
    }
    if body.repository_id.is_some() {
        rule.repository_id = body.repository_id;
    }
    if body.folder_id.is_some() {
        rule.folder_id = body.folder_id;
    }
    if let Some(tags) = body.tags {
        rule.tags = tags;
    }
    if let Some(m) = body.maintainer {
        let trimmed = m.trim();
        rule.maintainer = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    let author = crate::case_audit::resolve_alert_author(
        &state.pool.postgres,
        &ctx,
        body.author.as_deref(),
    )
    .await;
    let saved = state
        .rules
        .update(&rule, &author)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "rule not found".into()))?;
    sync_rule_realtime_mv(&state, &saved).await?;
    Ok(Json(saved))
}

#[derive(Deserialize)]
pub struct BulkDeleteRulesRequest {
    pub ids: Vec<Uuid>,
}

pub async fn bulk_delete_rules(
    State(state): State<AppState>,
    Json(body): Json<BulkDeleteRulesRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let mut deleted = 0u32;
    let mut failed = 0u32;
    for id in body.ids {
        mobipwn_core::detection::drop_materialized_view(&state.config, id)
            .await
            .ok();
        match state.rules.delete(id).await {
            Ok(true) => deleted += 1,
            Ok(false) => failed += 1,
            Err(e) => return Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        }
    }
    Ok(Json(serde_json::json!({ "deleted": deleted, "failed": failed })))
}

pub async fn delete_rule_post(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    mobipwn_core::detection::drop_materialized_view(&state.config, id)
        .await
        .ok();
    let ok = state
        .rules
        .delete(id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if ok {
        Ok(Json(serde_json::json!({ "deleted": true })))
    } else {
        Err((axum::http::StatusCode::NOT_FOUND, "rule not found".into()))
    }
}

pub async fn validate_rule(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    body: Option<Json<ValidateRuleBody>>,
) -> Result<Json<mobipwn_search::RuleValidationResult>, (axum::http::StatusCode, String)> {
    let rule = state
        .rules
        .get(id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "rule not found".into()))?;
    validate_rule_enhanced(&state, &rule, body.map(|b| b.0))
        .await
        .map(Json)
}

/// Validate an mPL query without a persisted rule (editor draft / new rule).
pub async fn validate_rule_query(
    State(state): State<AppState>,
    Json(body): Json<ValidateRuleBody>,
) -> Result<Json<mobipwn_search::RuleValidationResult>, (axum::http::StatusCode, String)> {
    let query = body
        .query
        .filter(|q| !q.trim().is_empty())
        .ok_or((axum::http::StatusCode::BAD_REQUEST, "query is required".into()))?;
    let mode = body.mode.as_deref().unwrap_or("scheduled");
    let config = state.effective_config().await;
    mobipwn_search::validate_detection_rule(&state.pool, &config, &query, mode)
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))
}

pub async fn run_rule_now(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    body: Option<Json<RunRuleBody>>,
) -> Result<Json<ExecuteDetectionResult>, (axum::http::StatusCode, String)> {
    let rule = state
        .rules
        .get(id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "rule not found".into()))?;
    let create_alerts = body.as_ref().map(|b| b.0.create_alerts).unwrap_or(true);
    let mut rule_to_run = rule;
    if let Some(q) = body
        .as_ref()
        .and_then(|b| b.0.query_override.as_ref())
        .filter(|q| !q.trim().is_empty())
    {
        rule_to_run.query = q.clone();
    }
    let config = state.effective_config().await;
    execute_detection_rule(
        &config,
        &state.rules,
        &state.alerts,
        &state.detection_runs,
        &state.suppressions,
        &rule_to_run,
        ExecuteDetectionOptions::manual(create_alerts),
    )
    .await
    .map(Json)
    .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))
}

#[derive(Deserialize, ToSchema)]
pub struct RunRuleBody {
    /// When false, evaluate hits only (dry run) — no alerts, signals, or webhooks.
    #[serde(default = "default_true")]
    pub create_alerts: bool,
    /// Optional query override for sandbox runs (does not persist to the rule).
    pub query_override: Option<String>,
}

fn default_true() -> bool {
    true
}

// --- Alerts ---

#[derive(Deserialize, ToSchema)]
pub struct ListAlertsQuery {
    pub status: Option<String>,
    /// `active` (default), `dismissed`, or `all`
    pub dismissed: Option<String>,
    pub case_id: Option<Uuid>,
    /// Filter by assignee username, or `me` for the current session user.
    pub assignee: Option<String>,
}

pub async fn list_alerts(
    State(state): State<AppState>,
    Extension(ctx): Extension<mobipwn_core::auth::AuthContext>,
    Query(q): Query<ListAlertsQuery>,
) -> Result<Json<Vec<mobipwn_core::alerts::Alert>>, (axum::http::StatusCode, String)> {
    let filter = crate::case_audit::build_alert_list_filter(
        &state.pool.postgres,
        &ctx,
        q.status.as_deref(),
        q.dismissed.as_deref(),
        q.case_id,
        q.assignee.as_deref(),
    )
    .await;
    state
        .alerts
        .list_filtered(&filter)
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn get_alert(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<mobipwn_core::alerts::Alert>, (axum::http::StatusCode, String)> {
    state
        .alerts
        .get(id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "alert not found".into()))
        .map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct PatchAlertRequest {
    pub status: Option<String>,
    pub assignee: Option<String>,
    pub tags: Option<Vec<String>>,
    pub comment: Option<String>,
    pub author: Option<String>,
    /// Set `true` to dismiss (hide) or `false` to restore.
    pub dismissed: Option<bool>,
}

pub async fn patch_alert(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchAlertRequest>,
) -> Result<Json<mobipwn_core::alerts::Alert>, (axum::http::StatusCode, String)> {
    let author = crate::case_audit::resolve_alert_author(
        &state.pool.postgres,
        &ctx,
        body.author.as_deref(),
    )
    .await;
    let before = state
        .alerts
        .get(id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "alert not found".into()))?;

    if let Some(ref st) = body.status {
        let to = parse_status(st);
        if before.status != to {
            let from = status_str(before.status);
            if let Some(updated) = state
                .alerts
                .update_status(id, to)
                .await
                .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))?
            {
                state
                    .alert_events
                    .log_status_change(id, from, st, &author)
                    .await
                    .ok();
                mobipwn_core::maybe_forward_status_change_alert(
                    &state.pool.postgres,
                    &updated,
                    before.status,
                    to,
                )
                .await;
            } else {
                return Err((axum::http::StatusCode::NOT_FOUND, "alert not found".into()));
            }
        }
    }

    if body.assignee.is_some() || body.tags.is_some() {
        let assignee = body.assignee.clone().map(Some);
        if let Some(ref a) = body.assignee {
            let label = if a.is_empty() { "unassigned" } else { a.as_str() };
            state
                .alert_events
                .log_assignee_change(id, label, &author)
                .await
                .ok();
        }
        if let Some(ref tags) = body.tags {
            state
                .alert_events
                .log_tags_change(id, tags, &author)
                .await
                .ok();
        }
        state
            .alerts
            .update_meta(id, assignee, body.tags.clone())
            .await
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((axum::http::StatusCode::NOT_FOUND, "alert not found".into()))?;
    }

    if let Some(ref comment) = body.comment {
        if !comment.trim().is_empty() {
            state
                .alert_events
                .add_comment(id, comment.trim(), &author)
                .await
                .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
    }

    if let Some(dismissed) = body.dismissed {
        if dismissed && before.dismissed_at.is_none() {
            state
                .alerts
                .set_dismissed(id, true)
                .await
                .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or((axum::http::StatusCode::NOT_FOUND, "alert not found".into()))?;
            state.alert_events.log_dismissed(id, &author).await.ok();
        } else if !dismissed && before.dismissed_at.is_some() {
            state
                .alerts
                .set_dismissed(id, false)
                .await
                .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or((axum::http::StatusCode::NOT_FOUND, "alert not found".into()))?;
            state.alert_events.log_restored(id, &author).await.ok();
        }
    }

    state
        .alerts
        .get(id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "alert not found".into()))
        .map(Json)
}

#[derive(Deserialize)]
pub struct DeleteAlertQuery {
    pub reason: Option<String>,
    pub author: Option<String>,
}

pub async fn delete_alert(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Query(q): Query<DeleteAlertQuery>,
) -> Result<StatusCode, (axum::http::StatusCode, String)> {
    let deleted = crate::alert_delete::audited_delete_many(
        &state,
        &ctx,
        &[id],
        q.author.as_deref(),
        q.reason.as_deref(),
    )
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if deleted > 0 {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((axum::http::StatusCode::NOT_FOUND, "alert not found".into()))
    }
}

pub async fn overview(
    State(state): State<AppState>,
) -> Result<Json<mobipwn_core::OverviewStats>, (axum::http::StatusCode, String)> {
    mobipwn_core::fetch_overview(&state.pool.postgres, &state.config)
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn list_providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<mobipwn_core::marketplace::EnrichmentProvider>>, (axum::http::StatusCode, String)> {
    let mut providers = state
        .providers
        .list()
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Ok(stats) =
        mobipwn_core::enrichment::enrichment_field_stats(&state.config, &providers).await
    {
        for provider in &mut providers {
            if let Some(fields) = stats.get(&provider.slug) {
                provider.enriched_fields = fields.clone();
                provider.enriched_field_count = fields.len();
            }
        }
    }

    Ok(Json(providers))
}

#[derive(Deserialize)]
pub struct EnableProviderRequest {
    pub enabled: bool,
}

pub async fn enable_provider(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<EnableProviderRequest>,
) -> Result<Json<mobipwn_core::marketplace::EnrichmentProvider>, (axum::http::StatusCode, String)> {
    state
        .providers
        .set_enabled(id, body.enabled)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "provider not found".into()))
        .map(Json)
}

pub async fn list_saved_queries(
    State(state): State<AppState>,
) -> Result<Json<mobipwn_core::SavedQueriesBundle>, (axum::http::StatusCode, String)> {
    state
        .saved_queries
        .bundle(&state.saved_query_folders)
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Deserialize)]
pub struct CreateSavedQueryRequest {
    pub name: String,
    pub description: Option<String>,
    pub query: String,
    pub folder_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct PatchSavedQueryRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub query: Option<String>,
    pub folder_id: Option<Option<Uuid>>,
}

pub async fn create_saved_query(
    State(state): State<AppState>,
    Json(body): Json<CreateSavedQueryRequest>,
) -> Result<Json<mobipwn_core::SavedQuery>, (axum::http::StatusCode, String)> {
    state
        .saved_queries
        .create(
            &body.name,
            body.description.as_deref().unwrap_or(""),
            &body.query,
            body.folder_id,
        )
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn patch_saved_query(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchSavedQueryRequest>,
) -> Result<Json<mobipwn_core::SavedQuery>, (axum::http::StatusCode, String)> {
    state
        .saved_queries
        .update(id, body.name.as_deref(), body.description.as_deref(), body.query.as_deref(), body.folder_id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "saved query not found".into()))
        .map(Json)
}

#[derive(Deserialize)]
pub struct CreateSavedQueryFolderRequest {
    pub name: String,
    pub parent_id: Option<Uuid>,
}

pub async fn list_saved_query_folders(
    State(state): State<AppState>,
) -> Result<Json<Vec<mobipwn_core::SavedQueryFolder>>, (axum::http::StatusCode, String)> {
    state
        .saved_query_folders
        .list()
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn create_saved_query_folder(
    State(state): State<AppState>,
    Json(body): Json<CreateSavedQueryFolderRequest>,
) -> Result<Json<mobipwn_core::SavedQueryFolder>, (axum::http::StatusCode, String)> {
    state
        .saved_query_folders
        .create(&body.name, body.parent_id)
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

// --- Rule organization (repositories, folders, tags) ---

pub async fn rule_org_bundle(
    State(state): State<AppState>,
) -> Result<Json<mobipwn_core::RuleOrganizationBundle>, (axum::http::StatusCode, String)> {
    state
        .rule_org
        .bundle()
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Deserialize)]
pub struct CreateRuleRepositoryRequest {
    pub name: String,
    pub description: Option<String>,
}

pub async fn create_rule_repository(
    State(state): State<AppState>,
    Json(body): Json<CreateRuleRepositoryRequest>,
) -> Result<Json<mobipwn_core::RuleRepositoryRecord>, (axum::http::StatusCode, String)> {
    state
        .rule_org
        .create_repository(&body.name, body.description.as_deref())
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Deserialize)]
pub struct CreateRuleFolderRequest {
    pub repository_id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
}

pub async fn create_rule_folder(
    State(state): State<AppState>,
    Json(body): Json<CreateRuleFolderRequest>,
) -> Result<Json<mobipwn_core::RuleFolderRecord>, (axum::http::StatusCode, String)> {
    state
        .rule_org
        .create_folder(body.repository_id, &body.name, body.parent_id)
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Deserialize)]
pub struct RenameRuleFolderRequest {
    pub name: String,
}

pub async fn rename_rule_folder(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<RenameRuleFolderRequest>,
) -> Result<Json<mobipwn_core::RuleFolderRecord>, (axum::http::StatusCode, String)> {
    state
        .rule_org
        .rename_folder(id, &body.name)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "folder not found".into()))
        .map(Json)
}

pub async fn delete_rule_folder(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let ok = state
        .rule_org
        .delete_folder(id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if ok {
        Ok(Json(serde_json::json!({ "deleted": true })))
    } else {
        Err((axum::http::StatusCode::NOT_FOUND, "folder not found".into()))
    }
}

#[derive(Deserialize)]
pub struct MoveRuleRequest {
    pub repository_id: Option<Uuid>,
    pub folder_id: Option<Uuid>,
}

pub async fn move_rule(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<MoveRuleRequest>,
) -> Result<Json<DetectionRule>, (axum::http::StatusCode, String)> {
    state
        .rules
        .move_rule(id, body.repository_id, body.folder_id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "rule not found".into()))
        .map(Json)
}

pub async fn delete_saved_query(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let ok = state
        .saved_queries
        .delete(id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if ok {
        Ok(Json(serde_json::json!({ "deleted": true })))
    } else {
        Err((axum::http::StatusCode::NOT_FOUND, "not found".into()))
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/overview", get(overview))
        .route("/v1/search/compile", post(compile_search))
        .route("/v1/search/run", post(run_search))
        .route("/v1/search/fields", get(list_search_fields))
        .route("/v1/mudm/fields", get(list_mudm_fields))
        .route("/v1/search/fields-in-scope", post(fields_in_scope))
        .route("/v1/search/field-stats", post(field_stats))
        .route("/v1/search/histogram", post(histogram))
        .route("/v1/prevalence/scatter", post(prevalence_scatter))
        .route("/v1/ingest/jsonl", post(ingest_jsonl_handler))
        .merge(ingest_archive_router())
        .route("/v1/rule-org", get(rule_org_bundle))
        .route("/v1/rule-org/repositories", post(create_rule_repository))
        .route("/v1/rule-org/folders", post(create_rule_folder))
        .route("/v1/rule-org/folders/{id}", post(rename_rule_folder))
        .route("/v1/rule-org/folders/{id}/delete", post(delete_rule_folder))
        .route("/v1/rules/bulk-delete", post(bulk_delete_rules))
        .route("/v1/rules/resolve/{token}", get(resolve_rule_id))
        .route("/v1/rules", get(list_rules).post(create_rule))
        .route("/v1/rules/{id}", get(get_rule).post(update_rule))
        .route("/v1/rules/{id}/move", post(move_rule))
        .route("/v1/rules/{id}/delete", post(delete_rule_post))
        .route("/v1/rules/validate-query", post(validate_rule_query))
        .route("/v1/rules/{id}/validate", post(validate_rule))
        .route("/v1/rules/{id}/run", post(run_rule_now))
        .route("/v1/alerts/resolve/{token}", get(resolve_alert_id))
        .route("/v1/alerts", get(list_alerts))
        .route(
            "/v1/alerts/{id}",
            get(get_alert).post(patch_alert).delete(delete_alert),
        )
        .route("/v1/marketplace/providers", get(list_providers))
        .route("/v1/marketplace/providers/{id}", post(enable_provider))
        .route("/v1/saved-queries", get(list_saved_queries).post(create_saved_query))
        .route("/v1/saved-queries/{id}", post(patch_saved_query))
        .route("/v1/saved-queries/{id}/delete", post(delete_saved_query))
        .route("/v1/saved-query-folders", get(list_saved_query_folders).post(create_saved_query_folder))
}
