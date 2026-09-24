use crate::case_audit::{
    audit_alert_link, audit_case_created, audit_case_patch, resolve_audit_actor,
};
use crate::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Extension, Json, Router,
};
use mobipwn_core::auth::AuthContext;
use mobipwn_core::{
    cancel_running_jobs, clear_stuck_enrichment_status, emit_case_comment, fetch_case_entities_with_config,
    fetch_case_wall, is_masked_secret, load_entity_limits_config, load_llm_config, llm_public,
    normalize_note_type, test_connection, CaseWallEntry, CreateCase, CreateSearchHistory,
    JobsControlSummary, LlmChatRequest, LlmChatResponse, LlmTestResult, UpdateCase,
};
use crate::llm_chat::run_assistant_chat;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/search/history", get(list_history).post(create_history).delete(clear_history))
        .route("/v1/search/history/{id}", delete(delete_history))
        .route("/v1/search/history/settings", put(history_settings))
        .route("/v1/cases/owners", get(list_case_owners))
        .route("/v1/cases", get(list_cases).post(create_case))
        .route("/v1/cases/{id}", get(get_case).post(patch_case).delete(delete_case))
        .route("/v1/cases/{id}/tags", post(patch_case_tags))
        .route("/v1/cases/{id}/primary-anchor", post(set_case_primary_anchor).delete(clear_case_primary_anchor))
        .route("/v1/cases/{id}/alerts", get(list_case_alerts))
        .route("/v1/cases/{id}/entities", get(get_case_entities))
        .route("/v1/cases/{id}/wall", get(get_case_wall))
        .route("/v1/cases/{id}/comments", post(add_case_comment))
        .route("/v1/cases/{id}/alerts/{alert_id}", post(link_alert).delete(unlink_alert))
        .route("/v1/dashboards", get(list_dashboards).post(create_dashboard))
        .route("/v1/dashboards/default", get(get_default_dashboard).put(save_default_dashboard))
        .route(
            "/v1/dashboards/{id}",
            get(get_dashboard).put(update_dashboard).delete(delete_dashboard),
        )
        .route("/v1/llm/chat", post(llm_chat))
        .route("/v1/llm/test", post(llm_test))
        .route("/v1/llm/status", get(llm_status))
        .route("/v1/dev/logs", get(dev_logs))
        .route("/v1/jobs/control", post(jobs_control))
}

#[derive(Serialize)]
struct HistoryListResponse {
    entries: Vec<mobipwn_core::SearchHistoryEntry>,
    history_enabled: bool,
}

async fn list_history(State(state): State<AppState>) -> Result<Json<HistoryListResponse>, StatusCode> {
    let enabled = state
        .search_history
        .history_enabled()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let entries = state
        .search_history
        .list(100)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(HistoryListResponse {
        entries,
        history_enabled: enabled,
    }))
}

async fn create_history(
    State(state): State<AppState>,
    Json(body): Json<CreateSearchHistory>,
) -> Result<Json<mobipwn_core::SearchHistoryEntry>, StatusCode> {
    let enabled = state
        .search_history
        .history_enabled()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !enabled {
        return Err(StatusCode::FORBIDDEN);
    }
    state
        .search_history
        .create(&body)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn delete_history(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let ok = state
        .search_history
        .delete(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if ok {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn clear_history(State(state): State<AppState>) -> Result<StatusCode, StatusCode> {
    state
        .search_history
        .clear()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct HistorySettingsBody {
    enabled: bool,
}

async fn history_settings(
    State(state): State<AppState>,
    Json(body): Json<HistorySettingsBody>,
) -> Result<StatusCode, StatusCode> {
    state
        .search_history
        .set_history_enabled(body.enabled)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ListCasesQuery {
    status: Option<String>,
    q: Option<String>,
    /// Exact filter on device owner (`cases.case_user`, JSON `user`).
    owner: Option<String>,
}

async fn list_case_owners(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    state
        .cases
        .list_device_owners()
        .await
        .map(Json)
        .map_err(|e| {
            tracing::error!(error = %e, "list_case_owners failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

async fn list_cases(
    State(state): State<AppState>,
    Query(q): Query<ListCasesQuery>,
) -> Result<Json<Vec<mobipwn_core::CaseRecord>>, StatusCode> {
    mobipwn_core::list_cases_with_ingest(
        &state.pool,
        &state.config,
        &state.cases,
        &state.ingest_jobs,
        Some(&state.clickhouse),
        q.status.as_deref(),
        q.q.as_deref(),
        q.owner.as_deref(),
    )
    .await
    .map(Json)
    .map_err(|e| {
        tracing::error!(error = %e, "list_cases failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

async fn get_case(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<mobipwn_core::CaseRecord>, StatusCode> {
    state
        .cases
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)
        .map(Json)
}

async fn get_case_entities(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<mobipwn_core::CaseEntitiesResponse>, StatusCode> {
    let case = state
        .cases
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let Some(source) = case.ingest_source.as_deref() else {
        return Ok(Json(mobipwn_core::apply_primary_anchor(
            mobipwn_core::CaseEntitiesResponse {
                entities: Vec::new(),
                graph: Default::default(),
                primary_entity: None,
                auto_primary_entity: None,
                primary_entity_source: "auto".to_string(),
            },
            case.primary_anchor.as_ref(),
        )));
    };
    let entity_cfg = load_entity_limits_config(&state.settings)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fetch_case_entities_with_config(
        &state.pool,
        &state.config,
        source,
        case.primary_anchor.as_ref(),
        &mobipwn_core::EntityExtractConfig {
            default_limit: entity_cfg.default_limit,
            process_limit: entity_cfg.process_limit,
        },
    )
    .await
    .map(Json)
    .map_err(|e| {
        tracing::error!(error = %e, "get_case_entities failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

#[derive(Debug, Deserialize)]
struct SetPrimaryAnchorBody {
    entity_type: String,
    entity_value: String,
}

async fn set_case_primary_anchor(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Json(body): Json<SetPrimaryAnchorBody>,
) -> Result<Json<mobipwn_core::CaseEntitiesResponse>, StatusCode> {
    let case = state
        .cases
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let Some(source) = case.ingest_source.as_deref() else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let anchor = mobipwn_core::PrimaryEntity {
        entity_type: body.entity_type.trim().to_string(),
        entity_value: body.entity_value.trim().to_string(),
    };
    if anchor.entity_type.is_empty() || anchor.entity_value.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let entity_cfg = load_entity_limits_config(&state.settings)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let entity_extract_cfg = mobipwn_core::EntityExtractConfig {
        default_limit: entity_cfg.default_limit,
        process_limit: entity_cfg.process_limit,
    };
    let extracted = fetch_case_entities_with_config(&state.pool, &state.config, source, None, &entity_extract_cfg)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "set_case_primary_anchor extract failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    if !mobipwn_core::entity_exists_in_response(&extracted, &anchor) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let before = case.clone();
    state
        .cases
        .set_primary_anchor(id, &anchor)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let after = state
        .cases
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let actor = resolve_audit_actor(&state.pool.postgres, &ctx).await;
    audit_case_patch(&state, &before, &after, &actor).await;
    fetch_case_entities_with_config(
        &state.pool,
        &state.config,
        source,
        after.primary_anchor.as_ref(),
        &entity_extract_cfg,
    )
        .await
        .map(Json)
        .map_err(|e| {
            tracing::error!(error = %e, "set_case_primary_anchor failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

async fn clear_case_primary_anchor(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<Json<mobipwn_core::CaseEntitiesResponse>, StatusCode> {
    let case = state
        .cases
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let Some(source) = case.ingest_source.as_deref() else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let before = case.clone();
    let after = state
        .cases
        .clear_primary_anchor(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let actor = resolve_audit_actor(&state.pool.postgres, &ctx).await;
    audit_case_patch(&state, &before, &after, &actor).await;
    let entity_cfg = load_entity_limits_config(&state.settings)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fetch_case_entities_with_config(
        &state.pool,
        &state.config,
        source,
        None,
        &mobipwn_core::EntityExtractConfig {
            default_limit: entity_cfg.default_limit,
            process_limit: entity_cfg.process_limit,
        },
    )
        .await
        .map(Json)
        .map_err(|e| {
            tracing::error!(error = %e, "clear_case_primary_anchor failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[derive(Debug, Deserialize)]
struct CaseCommentBody {
    body: String,
    note_type: Option<String>,
}

async fn add_case_comment(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(case_id): Path<Uuid>,
    Json(body): Json<CaseCommentBody>,
) -> Result<Json<CaseWallEntry>, StatusCode> {
    let case = state
        .cases
        .get(case_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let actor = resolve_audit_actor(&state.pool.postgres, &ctx).await;
    let text = body.body.trim();
    if text.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let note_type = normalize_note_type(body.note_type.as_deref()).to_string();
    let event_id = emit_case_comment(&state.clickhouse, &case, &actor, text, Some(&note_type))
        .await
        .map_err(|e| {
            tracing::error!(error = %e, case_id = %case_id, "add_case_comment failed");
            if e.to_string().contains("empty") {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?;
    let now = chrono::Utc::now();
    let display = if text.chars().count() > 500 {
        text.chars().take(500).collect::<String>()
    } else {
        text.to_string()
    };
    Ok(Json(CaseWallEntry {
        id: event_id,
        timestamp: now,
        message: display.clone(),
        action: "comment".into(),
        actor_id: actor.id,
        actor_name: Some(actor.name),
        severity: case.priority,
        status: case.status.clone(),
        previous_status: None,
        disposition: None,
        alert_id: None,
        notes: Some(display),
        note_type: Some(note_type),
        time_since_creation_seconds: Some((now - case.created_at).num_seconds().max(0)),
        time_to_resolve_seconds: None,
        alert_count: Some(case.alert_count),
    }))
}

async fn get_case_wall(
    State(state): State<AppState>,
    Path(case_id): Path<Uuid>,
    Query(q): Query<WallQuery>,
) -> Result<Json<Vec<mobipwn_core::CaseWallEntry>>, StatusCode> {
    if state.cases.get(case_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }
    let limit = q.limit.unwrap_or(100);
    fetch_case_wall(&state.config, case_id, limit)
        .await
        .map(Json)
        .map_err(|e| {
            tracing::error!(error = %e, case_id = %case_id, "get_case_wall failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[derive(Debug, Deserialize)]
struct WallQuery {
    limit: Option<u32>,
}

async fn create_case(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<CreateCase>,
) -> Result<Json<mobipwn_core::CaseRecord>, StatusCode> {
    let case = state
        .cases
        .create(&body)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let actor = resolve_audit_actor(&state.pool.postgres, &ctx).await;
    audit_case_created(&state, &case, &actor, Some("manual")).await;
    Ok(Json(case))
}

async fn patch_case(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateCase>,
) -> Result<Json<mobipwn_core::CaseRecord>, StatusCode> {
    let before = state
        .cases
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let rename_source = body.rename_ingest_source.unwrap_or(false);
    if let Some(new_title) = body.title.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if rename_source {
            if let Some(old_source) = before.ingest_source.as_deref().filter(|s| !s.is_empty()) {
                if old_source != new_title {
                    mobipwn_core::rename_ingest_source(
                        &state.pool,
                        &state.config,
                        &state.ingest_jobs,
                        old_source,
                        new_title,
                    )
                    .await
                    .map_err(|e| {
                        tracing::error!(error = %e, "rename ingest source failed");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;
                }
            }
        }
        let after = state
            .cases
            .rename(id, new_title, rename_source)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "rename case failed");
                if e.to_string().contains("already taken") {
                    StatusCode::CONFLICT
                } else {
                    StatusCode::INTERNAL_SERVER_ERROR
                }
            })?
            .ok_or(StatusCode::NOT_FOUND)?;
        let actor = resolve_audit_actor(&state.pool.postgres, &ctx).await;
        audit_case_patch(&state, &before, &after, &actor).await;
        return Ok(Json(after));
    }

    let after = state
        .cases
        .update(id, &body)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let actor = resolve_audit_actor(&state.pool.postgres, &ctx).await;
    audit_case_patch(&state, &before, &after, &actor).await;
    Ok(Json(after))
}

#[derive(Debug, Deserialize)]
struct PatchCaseTagsBody {
    add: Option<Vec<String>>,
    remove: Option<Vec<String>>,
}

async fn patch_case_tags(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchCaseTagsBody>,
) -> Result<Json<mobipwn_core::CaseRecord>, StatusCode> {
    let before = state
        .cases
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let add = body.add.unwrap_or_default();
    let remove = body.remove.unwrap_or_default();
    let after = state
        .cases
        .patch_tags(id, &add, &remove)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let actor = resolve_audit_actor(&state.pool.postgres, &ctx).await;
    audit_case_patch(&state, &before, &after, &actor).await;
    Ok(Json(after))
}

#[derive(Debug, Deserialize)]
struct DeleteCaseQuery {
    #[serde(default)]
    delete_data: bool,
}

async fn delete_case(
    State(state): State<AppState>,
    Extension(_ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Query(q): Query<DeleteCaseQuery>,
) -> Result<StatusCode, StatusCode> {
    let case = state
        .cases
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let ingest_label = mobipwn_core::case_ingest_label(&case);

    let full_purge = q.delete_data
        || case
            .ingest_source
            .as_ref()
            .is_some_and(|s| !s.trim().is_empty());

    if full_purge {
        if let Some(source) = ingest_label {
            mobipwn_core::delete_ingest_source(
                &state.pool,
                &state.config,
                &state.cases,
                &state.ingest_jobs,
                &state.collect_blobs,
                &state.alerts,
                &source,
            )
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "delete case ingest data");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            return Ok(StatusCode::NO_CONTENT);
        }
    }

    let ok = state
        .cases
        .delete_by_id(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if ok {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn link_alert(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path((case_id, alert_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let ok = state
        .cases
        .link_alert(case_id, alert_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if ok {
        if let Some(case) = state
            .cases
            .get(case_id)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        {
            let actor = resolve_audit_actor(&state.pool.postgres, &ctx).await;
            audit_alert_link(&state, &case, alert_id, &actor, true).await;
        }
        Ok(Json(serde_json::json!({ "linked": true })))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn unlink_alert(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path((case_id, alert_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, StatusCode> {
    let ok = state
        .cases
        .unlink_alert(case_id, alert_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if ok {
        if let Some(case) = state
            .cases
            .get(case_id)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        {
            let actor = resolve_audit_actor(&state.pool.postgres, &ctx).await;
            audit_alert_link(&state, &case, alert_id, &actor, false).await;
        }
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn list_case_alerts(
    State(state): State<AppState>,
    Path(case_id): Path<Uuid>,
) -> Result<Json<Vec<mobipwn_core::alerts::Alert>>, StatusCode> {
    state
        .alerts
        .list_filtered(&mobipwn_core::alerts::AlertListFilter {
            status: None,
            dismissed: mobipwn_core::alerts::DismissedFilter::Active,
            case_id: Some(case_id),
            assignee: None,
        })
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn list_dashboards(
    State(state): State<AppState>,
) -> Result<Json<Vec<mobipwn_core::Dashboard>>, StatusCode> {
    state
        .dashboards
        .list()
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn get_default_dashboard(
    State(state): State<AppState>,
) -> Result<Json<mobipwn_core::Dashboard>, StatusCode> {
    state
        .dashboards
        .get_default()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)
        .map(Json)
}

#[derive(Deserialize)]
struct SaveLayoutBody {
    layout: Value,
}

async fn save_default_dashboard(
    State(state): State<AppState>,
    Json(body): Json<SaveLayoutBody>,
) -> Result<Json<mobipwn_core::Dashboard>, StatusCode> {
    state
        .dashboards
        .save_default_layout(body.layout)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
struct CreateDashboardBody {
    name: String,
    layout: Value,
}

async fn create_dashboard(
    State(state): State<AppState>,
    Json(body): Json<CreateDashboardBody>,
) -> Result<Json<mobipwn_core::Dashboard>, StatusCode> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    state
        .dashboards
        .create(name, body.layout)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn get_dashboard(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<mobipwn_core::Dashboard>, StatusCode> {
    state
        .dashboards
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)
        .map(Json)
}

#[derive(Deserialize)]
struct UpdateDashboardBody {
    name: Option<String>,
    layout: Option<Value>,
}

async fn update_dashboard(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDashboardBody>,
) -> Result<Json<mobipwn_core::Dashboard>, StatusCode> {
    let name = body.name.as_deref().map(str::trim);
    if name == Some("") {
        return Err(StatusCode::BAD_REQUEST);
    }
    state
        .dashboards
        .update(id, name, body.layout)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)
        .map(Json)
}

async fn delete_dashboard(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    state
        .dashboards
        .delete(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .then_some(())
        .ok_or(StatusCode::NOT_FOUND)
        .map(|_| StatusCode::NO_CONTENT)
}

async fn llm_chat(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<LlmChatRequest>,
) -> Result<Json<LlmChatResponse>, (StatusCode, String)> {
    let cfg = load_llm_config(&state.settings)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    run_assistant_chat(&state, &ctx, &cfg, body.messages)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))
}

#[derive(Serialize)]
struct LlmStatus {
    configured: bool,
    model: String,
    api_url: String,
    local: bool,
}

#[derive(Deserialize)]
struct LlmTestBody {
    api_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
}

async fn llm_test(
    State(state): State<AppState>,
    Json(body): Json<LlmTestBody>,
) -> Result<Json<LlmTestResult>, (StatusCode, String)> {
    let saved = load_llm_config(&state.settings)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let url = body
        .api_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(saved.api_url.as_str());
    let model = body
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(saved.model.as_str());

    let key = match body.api_key.as_deref().map(str::trim) {
        Some(k) if !k.is_empty() && !is_masked_secret(k) => Some(k.to_string()),
        _ if !saved.api_key.is_empty() => Some(saved.api_key.clone()),
        _ => None,
    };

    Ok(Json(
        test_connection(url, key.as_deref(), model).await,
    ))
}

async fn llm_status(State(state): State<AppState>) -> Result<Json<LlmStatus>, StatusCode> {
    let cfg = load_llm_config(&state.settings)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let public = llm_public(&cfg);
    Ok(Json(LlmStatus {
        configured: !public.api_url.is_empty() && !public.model.is_empty(),
        model: public.model,
        api_url: public.api_url,
        local: public.local,
    }))
}

#[derive(Deserialize)]
struct DevLogsQuery {
    service: Option<String>,
    lines: Option<usize>,
}

#[derive(Serialize)]
struct DevLogsResponse {
    service: String,
    path: String,
    lines: Vec<String>,
    enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    enrichment_sync: Option<mobipwn_core::enrichment::EnrichmentSyncStatus>,
}

#[derive(Deserialize)]
struct JobsControlRequest {
    action: String,
}

async fn jobs_control(
    State(state): State<AppState>,
    Json(body): Json<JobsControlRequest>,
) -> Result<Json<JobsControlSummary>, StatusCode> {
    match body.action.as_str() {
        "cancel" => cancel_running_jobs(&state.pool.postgres)
            .await
            .map(Json)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR),
        "clear_sync_status" => Ok(Json(JobsControlSummary {
            enrichment_cancel_requested: false,
            enrichment_status_cleared: clear_stuck_enrichment_status(),
            ingest_jobs_failed: 0,
        })),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

async fn dev_logs(
    State(state): State<AppState>,
    Query(q): Query<DevLogsQuery>,
) -> Result<Json<DevLogsResponse>, StatusCode> {
    let enabled = state.config.expose_dev_logs;
    let service = q.service.as_deref().unwrap_or("api");
    let filename = match service {
        "api" => "api.log",
        "jobs" => "jobs.log",
        "web" => "web.log",
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    if !enabled {
        return Ok(Json(DevLogsResponse {
            service: service.to_string(),
            path: filename.to_string(),
            lines: vec![],
            enabled: false,
            enrichment_sync: mobipwn_core::enrichment::read_enrichment_sync_status_live(),
        }));
    }
    let dir = std::env::var("MOBIPWN_DEV_DIR").unwrap_or_else(|_| ".dev".into());
    let dir = if std::path::Path::new(&dir).is_absolute() {
        dir
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(&dir).to_string_lossy().into_owned())
            .unwrap_or(dir)
    };
    let path = format!("{dir}/{filename}");
    let mut lines = tail_file(&path, q.lines.unwrap_or(120).min(500)).unwrap_or_default();
    let enrichment_sync = mobipwn_core::enrichment::read_enrichment_sync_status_live();
    if let Some(ref status) = enrichment_sync {
        if status.running {
            let who = if status.source.is_empty() {
                "enrichment".into()
            } else {
                status.source.clone()
            };
            let provider = status
                .provider_name
                .as_deref()
                .or(status.provider_slug.as_deref())
                .map(|p| format!(" — {p}"))
                .unwrap_or_default();
            let stats_suffix = status
                .stats
                .as_ref()
                .map(|s| {
                    if s.api_requests > 0 {
                        format!(
                            " · {} API req ({} ok)",
                            s.api_requests, s.api_ok
                        )
                    } else if s.rows_written > 0 {
                        format!(" · {} row(s)", s.rows_written)
                    } else {
                        String::new()
                    }
                })
                .unwrap_or_default();
            lines.insert(
                0,
                format!(
                    "[enrichment] RUNNING ({who}{provider}): {}{stats_suffix}",
                    status.message
                ),
            );
        }
    }
    Ok(Json(DevLogsResponse {
        service: service.to_string(),
        path,
        lines,
        enabled: true,
        enrichment_sync,
    }))
}

fn tail_file(path: &str, max_lines: usize) -> std::io::Result<Vec<String>> {
    let content = std::fs::read_to_string(path)?;
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(max_lines);
    Ok(all[start..].iter().map(|s| (*s).to_string()).collect())
}
