use crate::api_error::{api_error, ApiErrorResponse};
use crate::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use mobipwn_core::auth::{AuthContext, Permission};
use mobipwn_ironsift::{
    create_anomark_profile, create_ironsift_profile, delete_all_anomark_trains, delete_anomark_profile,
    delete_anomark_train, delete_ironsift_profile, fetch_scope_options, get_anomark_profile,
    get_ironsift_profile, inspect_anomark_train, list_anomark_profiles,
    list_anomark_trains_with_selection, list_ironsift_profiles,
    load_anomark_config, load_ironsift_config_only, load_platform_config, promote_finding_to_alert,
    run_pipeline, save_anomark_config, save_platform_config, select_anomark_profile,
    score_anomark_command, select_anomark_train_for_runs, select_ironsift_profile, train_anomark_model,
    update_anomark_profile, update_ironsift_profile, AnoMarkCommandScore, AnoMarkPlatformConfig,
    AnoMarkTrainInspectResult, AnoMarkTrainRecord, AnoMarkTrainRequest, AnoMarkTrainResult,
    AnoMarkTrainsListResponse, ConfigProfile,
    ConfigProfilesListResponse, CreateConfigProfileRequest, ScoreAnomarkCommandRequest,
    CreateRunRequest, HoneycombCell, IronSiftDashboardStats, IronSiftFindingRecord,
    IronSiftPlatformConfig, IronSiftRepository, IronSiftRunRecord, IronSiftScopeOptions,
    IronSiftTriageRecord, IronSiftTriageVerdict, SaveTriageInput, ScopeFilter, TriageMemoryEntry,
    UpdateConfigProfileRequest,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::require_permission;

type IronSiftErr = (StatusCode, Json<ApiErrorResponse>);

fn ironsift_err(e: impl std::fmt::Display, ctx: &str) -> IronSiftErr {
    tracing::error!(error = %e, context = ctx, "IronSift API error");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("{ctx}: {e}. Restart mobipwn-api if migrations were just added."),
    )
}

fn require_ironsift_perm(ctx: &AuthContext, perm: Permission) -> Result<(), IronSiftErr> {
    require_permission(ctx, perm).map_err(|status| api_error(status, "Insufficient IronSift permissions"))
}

fn config_profile_err(e: impl std::fmt::Display, ctx: &str) -> IronSiftErr {
    let msg = e.to_string();
    if msg.contains("not found") {
        api_error(StatusCode::NOT_FOUND, msg)
    } else if msg.contains("required") || msg.contains("nothing to update") || msg.contains("empty") {
        api_error(StatusCode::BAD_REQUEST, msg)
    } else {
        ironsift_err(e, ctx)
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/ironsift/config", get(get_config).put(put_config))
        .route(
            "/v1/ironsift/config/profiles",
            get(list_ironsift_profiles_handler).post(create_ironsift_profile_handler),
        )
        .route(
            "/v1/ironsift/config/profiles/{id}",
            get(get_ironsift_profile_handler)
                .put(update_ironsift_profile_handler)
                .delete(delete_ironsift_profile_handler),
        )
        .route(
            "/v1/ironsift/config/profiles/{id}/select",
            post(select_ironsift_profile_handler),
        )
        .route(
            "/v1/ironsift/anomark/config",
            get(get_anomark_config).put(put_anomark_config),
        )
        .route(
            "/v1/ironsift/anomark/config/profiles",
            get(list_anomark_profiles_handler).post(create_anomark_profile_handler),
        )
        .route(
            "/v1/ironsift/anomark/config/profiles/{id}",
            get(get_anomark_profile_handler)
                .put(update_anomark_profile_handler)
                .delete(delete_anomark_profile_handler),
        )
        .route(
            "/v1/ironsift/anomark/config/profiles/{id}/select",
            post(select_anomark_profile_handler),
        )
        .route("/v1/ironsift/dashboard", get(dashboard))
        .route("/v1/ironsift/scope-options", get(scope_options))
        .route("/v1/ironsift/triage-memory", get(list_triage_memory).delete(delete_triage_memory))
        .route("/v1/ironsift/runs", get(list_runs).post(create_run).delete(delete_all_runs))
        .route(
            "/v1/ironsift/runs/{id}",
            get(get_run).delete(delete_run),
        )
        .route("/v1/ironsift/runs/{id}/findings", get(list_findings))
        .route(
            "/v1/ironsift/runs/{id}/findings/{finding_id}/alert",
            post(promote_finding_alert),
        )
        .route("/v1/ironsift/runs/{id}/honeycomb", get(honeycomb))
        .route("/v1/ironsift/runs/{id}/triage", get(get_triage).put(save_triage))
        .route(
            "/v1/ironsift/anomark/trains",
            get(list_anomark_trains)
                .post(train_anomark)
                .delete(delete_all_anomark_trains_handler),
        )
        .route(
            "/v1/ironsift/anomark/trains/{id}",
            get(get_anomark_train).delete(delete_anomark_train_handler),
        )
        .route(
            "/v1/ironsift/anomark/trains/{id}/inspect",
            get(inspect_anomark_train_handler),
        )
        .route(
            "/v1/ironsift/anomark/trains/{id}/score-command",
            post(score_anomark_command_handler),
        )
        .route(
            "/v1/ironsift/anomark/trains/{id}/select",
            post(select_anomark_train_handler),
        )
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum FleetCheckMode {
    Process,
    File,
    Both,
    ProcessAnomark,
    Anomark,
}

impl FleetCheckMode {
    fn to_run_mode(self) -> mobipwn_ironsift::IronSiftRunMode {
        match self {
            FleetCheckMode::Process | FleetCheckMode::ProcessAnomark => {
                mobipwn_ironsift::IronSiftRunMode::Fleet
            }
            FleetCheckMode::File => mobipwn_ironsift::IronSiftRunMode::File,
            FleetCheckMode::Both => mobipwn_ironsift::IronSiftRunMode::Both,
            FleetCheckMode::Anomark => mobipwn_ironsift::IronSiftRunMode::Anomark,
        }
    }

    fn enables_anomark(self) -> bool {
        matches!(
            self,
            FleetCheckMode::ProcessAnomark | FleetCheckMode::Both | FleetCheckMode::Anomark
        )
    }
}

#[derive(Debug, Deserialize)]
struct CreateRunBody {
    #[serde(default)]
    pub fleet_check: Option<FleetCheckMode>,
    #[serde(default)]
    pub mode: Option<mobipwn_ironsift::IronSiftRunMode>,
    pub scope: mobipwn_ironsift::IronSiftRunScope,
    #[serde(default)]
    pub filter: ScopeFilter,
    #[serde(default)]
    pub enable_anomark: bool,
    #[serde(default)]
    pub anomark_train_id: Option<Uuid>,
    #[serde(default)]
    pub anomark_suspect_percent: Option<f64>,
    #[serde(default)]
    pub detection_config: Option<serde_json::Value>,
    #[serde(default)]
    pub sync_alerts: bool,
}

#[derive(Debug, Deserialize)]
struct HoneycombQuery {
    min_score: Option<f64>,
    severity: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PromoteAlertBody {
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TriageBody {
    pub entries: Vec<TriageEntry>,
}

#[derive(Debug, Deserialize)]
struct TriageMemoryDeleteQuery {
    detector: String,
    reason: String,
}

async fn dashboard(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<IronSiftDashboardStats>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let scope = fetch_scope_options(&state.config, &state.cases)
        .await
        .map_err(|e| ironsift_err(e, "IronSift scope options"))?;
    let source_count = scope.sources.len() as i64;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    repo.dashboard_stats(source_count)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "IronSift dashboard"))
}

async fn list_triage_memory(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<Vec<TriageMemoryEntry>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    repo.list_triage_memory()
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "list IronSift triage memory"))
}

async fn delete_triage_memory(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Query(q): Query<TriageMemoryDeleteQuery>,
) -> Result<StatusCode, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    repo.delete_triage_memory(&q.detector, &q.reason)
        .await
        .map_err(|e| ironsift_err(e, "delete IronSift triage memory"))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_run(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    let deleted = repo
        .delete_run(id)
        .await
        .map_err(|e| ironsift_err(e, "delete IronSift run"))?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(api_error(StatusCode::NOT_FOUND, "run not found"))
    }
}

async fn delete_all_runs(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<serde_json::Value>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    let n = repo
        .delete_all_runs()
        .await
        .map_err(|e| ironsift_err(e, "delete all IronSift runs"))?;
    Ok(Json(serde_json::json!({ "deleted": n })))
}

async fn get_triage(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<IronSiftTriageRecord>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    repo.list_triage_for_run(id)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "list IronSift triage"))
}

#[derive(Debug, Deserialize)]
struct TriageEntry {
    pub finding_id: Uuid,
    pub detector: String,
    pub reason: String,
    pub verdict: String,
}

async fn get_config(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<IronSiftPlatformConfig>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    load_ironsift_config_only(&state.settings)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "load IronSift config"))
}

async fn put_config(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<IronSiftPlatformConfig>,
) -> Result<Json<IronSiftPlatformConfig>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    save_platform_config(&state.settings, &body)
        .await
        .map_err(|e| ironsift_err(e, "save IronSift config"))?;
    load_ironsift_config_only(&state.settings)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "reload IronSift config"))
}

async fn get_anomark_config(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<AnoMarkPlatformConfig>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    load_anomark_config(&state.settings)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "load AnoMark config"))
}

async fn put_anomark_config(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<AnoMarkPlatformConfig>,
) -> Result<Json<AnoMarkPlatformConfig>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    save_anomark_config(&state.settings, &body)
        .await
        .map_err(|e| ironsift_err(e, "save AnoMark config"))?;
    Ok(Json(body))
}

async fn list_ironsift_profiles_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<ConfigProfilesListResponse>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    list_ironsift_profiles(&state.settings)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "list IronSift config profiles"))
}

async fn create_ironsift_profile_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<CreateConfigProfileRequest<IronSiftPlatformConfig>>,
) -> Result<Json<ConfigProfile<IronSiftPlatformConfig>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    create_ironsift_profile(&state.settings, body)
        .await
        .map(Json)
        .map_err(|e| config_profile_err(e, "create IronSift config profile"))
}

async fn get_ironsift_profile_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<ConfigProfile<IronSiftPlatformConfig>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    get_ironsift_profile(&state.settings, &id)
        .await
        .map(Json)
        .map_err(|e| config_profile_err(e, "get IronSift config profile"))
}

async fn update_ironsift_profile_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(body): Json<UpdateConfigProfileRequest<IronSiftPlatformConfig>>,
) -> Result<Json<ConfigProfile<IronSiftPlatformConfig>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    update_ironsift_profile(&state.settings, &id, body)
        .await
        .map(Json)
        .map_err(|e| config_profile_err(e, "update IronSift config profile"))
}

async fn delete_ironsift_profile_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    delete_ironsift_profile(&state.settings, &id)
        .await
        .map_err(|e| config_profile_err(e, "delete IronSift config profile"))?;
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn select_ironsift_profile_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<IronSiftPlatformConfig>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    select_ironsift_profile(&state.settings, &id)
        .await
        .map(Json)
        .map_err(|e| config_profile_err(e, "select IronSift config profile"))
}

async fn list_anomark_profiles_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<ConfigProfilesListResponse>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    list_anomark_profiles(&state.settings)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "list AnoMark config profiles"))
}

async fn create_anomark_profile_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<CreateConfigProfileRequest<AnoMarkPlatformConfig>>,
) -> Result<Json<ConfigProfile<AnoMarkPlatformConfig>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    create_anomark_profile(&state.settings, body)
        .await
        .map(Json)
        .map_err(|e| config_profile_err(e, "create AnoMark config profile"))
}

async fn get_anomark_profile_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<ConfigProfile<AnoMarkPlatformConfig>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    get_anomark_profile(&state.settings, &id)
        .await
        .map(Json)
        .map_err(|e| config_profile_err(e, "get AnoMark config profile"))
}

async fn update_anomark_profile_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(body): Json<UpdateConfigProfileRequest<AnoMarkPlatformConfig>>,
) -> Result<Json<ConfigProfile<AnoMarkPlatformConfig>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    update_anomark_profile(&state.settings, &id, body)
        .await
        .map(Json)
        .map_err(|e| config_profile_err(e, "update AnoMark config profile"))
}

async fn delete_anomark_profile_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    delete_anomark_profile(&state.settings, &id)
        .await
        .map_err(|e| config_profile_err(e, "delete AnoMark config profile"))?;
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn select_anomark_profile_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<AnoMarkPlatformConfig>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    select_anomark_profile(&state.settings, &id)
        .await
        .map(Json)
        .map_err(|e| config_profile_err(e, "select AnoMark config profile"))
}

async fn scope_options(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<IronSiftScopeOptions>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    fetch_scope_options(&state.config, &state.cases)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "IronSift scope options"))
}

async fn list_runs(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<Vec<IronSiftRunRecord>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    repo.list_runs(50)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "list IronSift runs"))
}

async fn get_run(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<Json<IronSiftRunRecord>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    repo.get_run(id)
        .await
        .map_err(|e| ironsift_err(e, "get IronSift run"))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "run not found"))
        .map(Json)
}

async fn create_run(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<CreateRunBody>,
) -> Result<Json<IronSiftRunRecord>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    let platform_cfg = load_platform_config(&state.settings)
        .await
        .map_err(|e| ironsift_err(e, "load IronSift config"))?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    let mode = body
        .fleet_check
        .map(FleetCheckMode::to_run_mode)
        .or(body.mode)
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "fleet_check or mode is required"))?;
    let enable_anomark = body.enable_anomark
        || body.fleet_check.map(|fc| fc.enables_anomark()).unwrap_or(false)
        || matches!(
            mode,
            mobipwn_ironsift::IronSiftRunMode::Anomark | mobipwn_ironsift::IronSiftRunMode::Both
        );
    if enable_anomark && body.anomark_train_id.is_none() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "This fleet check requires anomark_train_id",
        ));
    }
    let req = CreateRunRequest {
        mode,
        scope: body.scope,
        filter: body.filter,
        triggered_by: format!(
            "user:{}",
            ctx.user_id.map(|u| u.to_string()).unwrap_or_else(|| "api".into())
        ),
        enable_anomark,
        anomark_train_id: body.anomark_train_id,
        anomark_suspect_percent: body
            .anomark_suspect_percent
            .unwrap_or(platform_cfg.anomark_config.default_suspect_percent),
        detection_config_override: body.detection_config,
        sync_alerts: body.sync_alerts,
        ironsift_config_name: None,
        anomark_config_name: None,
    };
    run_pipeline(
        &state.config,
        &repo,
        &state.cases,
        &state.alerts,
        &state.settings,
        req,
    )
    .await
    .map(Json)
    .map_err(|e| ironsift_err(e, "IronSift run failed"))
}

async fn list_findings(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<IronSiftFindingRecord>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    repo.list_findings(id)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "list IronSift findings"))
}

async fn promote_finding_alert(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path((run_id, finding_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<PromoteAlertBody>,
) -> Result<Json<IronSiftFindingRecord>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    promote_finding_to_alert(
        &state.alerts,
        &repo,
        run_id,
        finding_id,
        body.reason.as_deref(),
    )
    .await
    .map(Json)
    .map_err(|e| {
        if e.to_string().contains("not found") {
            api_error(StatusCode::NOT_FOUND, e.to_string())
        } else {
            ironsift_err(e, "promote IronSift finding to alert")
        }
    })
}

async fn honeycomb(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Query(q): Query<HoneycombQuery>,
) -> Result<Json<Vec<HoneycombCell>>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    repo.honeycomb(id, q.min_score.unwrap_or(0.0), q.severity.as_deref())
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "IronSift honeycomb"))
}

async fn save_triage(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Json(body): Json<TriageBody>,
) -> Result<StatusCode, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    let entries: Vec<SaveTriageInput> = body
        .entries
        .into_iter()
        .map(|e| SaveTriageInput {
            finding_id: e.finding_id,
            detector: e.detector,
            reason: e.reason,
            verdict: parse_verdict(&e.verdict),
            actor_id: ctx.user_id,
        })
        .collect();
    repo.save_triage(id, &entries)
        .await
        .map_err(|e| ironsift_err(e, "save IronSift triage"))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_anomark_trains(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<AnoMarkTrainsListResponse>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    list_anomark_trains_with_selection(&repo, &state.settings)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "list AnoMark trainings"))
}

async fn select_anomark_train_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    select_anomark_train_for_runs(&repo, &state.settings, id)
        .await
        .map(|_| Json(serde_json::json!({ "status": "ok", "selected_id": id })))
        .map_err(|e| {
            if e.to_string().contains("not found") {
                api_error(StatusCode::NOT_FOUND, e.to_string())
            } else {
                ironsift_err(e, "select AnoMark train for runs")
            }
        })
}

async fn get_anomark_train(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<Json<AnoMarkTrainRecord>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    repo.get_anomark_train(id)
        .await
        .map_err(|e| ironsift_err(e, "get AnoMark training"))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "training not found"))
        .map(Json)
}

async fn train_anomark(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<AnoMarkTrainRequest>,
) -> Result<Json<AnoMarkTrainResult>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    train_anomark_model(&state.config, &state.cases, &state.settings, &repo, body)
        .await
        .map(Json)
        .map_err(|e| ironsift_err(e, "AnoMark train failed"))
}

async fn inspect_anomark_train_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<Json<AnoMarkTrainInspectResult>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    inspect_anomark_train(&repo, id)
        .await
        .map(Json)
        .map_err(|e| {
            if e.to_string().contains("not found") {
                api_error(StatusCode::NOT_FOUND, e.to_string())
            } else {
                ironsift_err(e, "AnoMark inspect failed")
            }
        })
}

async fn score_anomark_command_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Json(body): Json<ScoreAnomarkCommandRequest>,
) -> Result<Json<AnoMarkCommandScore>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftRead)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    let anomark_cfg = load_anomark_config(&state.settings)
        .await
        .map_err(|e| ironsift_err(e, "load AnoMark config"))?;
    score_anomark_command(&repo, id, body, anomark_cfg.default_suspect_percent)
        .await
        .map(Json)
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("not found") {
                api_error(StatusCode::NOT_FOUND, msg)
            } else if msg.contains("empty") || msg.contains("exceeds") {
                api_error(StatusCode::BAD_REQUEST, msg)
            } else {
                ironsift_err(e, "AnoMark score command failed")
            }
        })
}

async fn delete_anomark_train_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    delete_anomark_train(&repo, &state.settings, id).await.map_err(|e| {
        if e.to_string().contains("not found") {
            api_error(StatusCode::NOT_FOUND, e.to_string())
        } else {
            ironsift_err(e, "AnoMark delete failed")
        }
    })?;
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn delete_all_anomark_trains_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<serde_json::Value>, IronSiftErr> {
    require_ironsift_perm(&ctx, Permission::IronSiftWrite)?;
    let repo = IronSiftRepository::new(state.pool.postgres.clone());
    let removed = delete_all_anomark_trains(&repo, &state.settings)
        .await
        .map_err(|e| ironsift_err(e, "AnoMark purge failed"))?;
    Ok(Json(serde_json::json!({ "status": "ok", "removed": removed })))
}

fn parse_verdict(s: &str) -> IronSiftTriageVerdict {
    match s {
        "false_positive" => IronSiftTriageVerdict::FalsePositive,
        "malicious" => IronSiftTriageVerdict::Malicious,
        _ => IronSiftTriageVerdict::Unset,
    }
}
