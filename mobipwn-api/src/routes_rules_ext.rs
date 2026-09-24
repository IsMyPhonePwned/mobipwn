//! Phase 3.1 rule APIs: versions, validate plan, sigma import, mute/disable, realtime MV sync.

use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use mobipwn_core::auth::AuthContext;
use chrono::{Duration, Utc};
use mobipwn_core::detection::{
    drop_materialized_view, sync_materialized_view, DetectionMode, DetectionRule, RuleLifecycle,
};
use mobipwn_core::sigma_convert;
use mobipwn_core::store::RuleVersion;
use mobipwn_search::{
    admission::resolve_realtime_mv_time_bounds, generate_events_where_clause, parse_mpl,
    validate_detection_rule, RuleValidationResult,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub fn router() -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/v1/rules/{id}/versions", get(list_rule_versions))
        .route("/v1/rules/import-sigma", post(import_sigma_rule))
        .route("/v1/rules/{id}/mute", post(mute_rule))
        .route("/v1/rules/{id}/enabled", post(set_rule_enabled))
}

pub async fn sync_rule_realtime_mv(
    state: &AppState,
    rule: &DetectionRule,
) -> Result<(), (StatusCode, String)> {
    let active = rule.enabled
        && !rule.muted_until.is_some_and(|t| t > Utc::now())
        && matches!(rule.lifecycle, RuleLifecycle::Live | RuleLifecycle::Alerting);

    if rule.mode != DetectionMode::Realtime || !active {
        drop_materialized_view(&state.config, rule.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        state
            .rules
            .set_realtime_mv(rule.id, None)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        return Ok(());
    }

    let mpl = parse_mpl(&rule.query)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let bounds = resolve_realtime_mv_time_bounds(&mpl);
    let where_clause = generate_events_where_clause(
        &mpl,
        bounds.time_from.as_deref(),
        bounds.time_to.as_deref(),
    )
    .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    let mv = sync_materialized_view(
        &state.effective_config().await,
        rule.id,
        &rule.name,
        &where_clause,
    )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    state
        .rules
        .set_realtime_mv(rule.id, Some(&mv))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(())
}

pub async fn list_rule_versions(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<RuleVersion>>, (StatusCode, String)> {
    state
        .rules
        .versions()
        .list_for_rule(id, 50)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Deserialize, ToSchema)]
pub struct ImportSigmaRequest {
    pub yaml: String,
    pub author: Option<String>,
}

#[derive(Serialize)]
pub struct ImportSigmaResponse {
    pub rule: DetectionRule,
    pub warnings: Vec<String>,
}

pub async fn import_sigma_rule(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<ImportSigmaRequest>,
) -> Result<Json<ImportSigmaResponse>, (StatusCode, String)> {
    let author = crate::case_audit::resolve_alert_author(
        &state.pool.postgres,
        &ctx,
        body.author.as_deref().or(Some("sigma-import")),
    )
    .await;
    let tmp = std::env::temp_dir().join(format!("mobipwn-sigma-{}.yaml", Uuid::now_v7()));
    std::fs::write(&tmp, &body.yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let converted = sigma_convert::convert_rule_file(&tmp)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("sigma conversion failed: {e}")))?;
    let _ = std::fs::remove_file(&tmp);

    let mut warnings = Vec::new();
    if converted.query.contains('|') {
        warnings.push("Converted query contains pipes; realtime mode not supported.".into());
    }

    let rule = DetectionRule {
        id: Uuid::now_v7(),
        name: converted.name,
        description: converted.description,
        lifecycle: RuleLifecycle::Staging,
        mode: DetectionMode::Scheduled,
        query: converted.query,
        cron: converted.cron,
        severity: converted.severity,
        mitre: vec![],
        prevalence_threshold: None,
        min_hits: 1,
        max_alerts_per_run: 50,
        signal_log_enabled: true,
        enabled: true,
        muted_until: None,
        sigma_yaml: Some(body.yaml),
        realtime_mv: None,
        version: 1,
        updated_at: Utc::now(),
        repository_id: Some(uuid::uuid!("11111111-1111-1111-1111-111111111101")),
        folder_id: Some(uuid::uuid!("11111111-1111-1111-1111-111111111201")),
        tags: vec![],
        maintainer: None,
    };
    let actor = crate::case_audit::resolve_audit_actor(&state.pool.postgres, &ctx).await;
    let mut rule = rule;
    rule.maintainer = Some(actor.name);

    let saved = state
        .rules
        .create(&rule, &author)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ImportSigmaResponse {
        rule: saved,
        warnings,
    }))
}

#[derive(Deserialize, ToSchema)]
pub struct MuteRuleRequest {
    /// ISO-8601 timestamp, or omit with `minutes` to mute relative to now.
    pub muted_until: Option<String>,
    pub minutes: Option<i64>,
}

pub async fn mute_rule(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<MuteRuleRequest>,
) -> Result<Json<DetectionRule>, (StatusCode, String)> {
    let until = if let Some(iso) = body.muted_until.as_deref() {
        Some(
            chrono::DateTime::parse_from_rfc3339(iso)
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
                .with_timezone(&Utc),
        )
    } else if let Some(mins) = body.minutes {
        Some(Utc::now() + Duration::minutes(mins))
    } else {
        None
    };

    let rule = state
        .rules
        .set_muted_until(id, until)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "rule not found".into()))?;

    sync_rule_realtime_mv(&state, &rule).await?;

    Ok(Json(rule))
}

#[derive(Deserialize, ToSchema)]
pub struct SetRuleEnabledRequest {
    pub enabled: bool,
}

pub async fn set_rule_enabled(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<SetRuleEnabledRequest>,
) -> Result<Json<DetectionRule>, (StatusCode, String)> {
    let rule = state
        .rules
        .set_enabled(id, body.enabled)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "rule not found".into()))?;

    sync_rule_realtime_mv(&state, &rule).await?;
    Ok(Json(rule))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ValidateRuleBody {
    /// When set, validate this mPL instead of the persisted rule query (editor draft).
    pub query: Option<String>,
    pub mode: Option<String>,
}

pub async fn validate_rule_enhanced(
    state: &AppState,
    rule: &DetectionRule,
    body: Option<ValidateRuleBody>,
) -> Result<RuleValidationResult, (StatusCode, String)> {
    let query = body
        .as_ref()
        .and_then(|b| b.query.as_deref())
        .unwrap_or(&rule.query);
    let mode = body
        .as_ref()
        .and_then(|b| b.mode.as_deref())
        .unwrap_or(match rule.mode {
            DetectionMode::Realtime => "realtime",
            DetectionMode::Scheduled => "scheduled",
        });
    validate_detection_rule(&state.pool, &state.effective_config().await, query, mode)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}
