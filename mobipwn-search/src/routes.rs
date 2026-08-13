use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use mobipwn_core::config::AppConfig;
use mobipwn_core::{effective_app_config, DualPool, SettingsRepository};
use crate::field_stats::list_sidebar_fields;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use crate::execute::{
    run_field_stats, run_fields_in_scope, run_histogram, run_search, FieldStatsRequest,
    FieldStatsResponse, FieldsInScopeRequest, FieldsInScopeResponse,
    HistogramRequest, HistogramResponse, SearchRunRequest, SearchRunResponse,
};
use crate::admission::resolve_time_bounds;
use crate::{generate_clickhouse_sql, parse_mpl};

#[derive(Clone)]
pub struct SearchState {
    pub pool: Arc<DualPool>,
    pub config: AppConfig,
    pub settings: Arc<SettingsRepository>,
}

async fn effective_config(state: &SearchState) -> AppConfig {
    effective_app_config(&state.settings, &state.config)
        .await
        .unwrap_or_else(|_| state.config.clone())
}

#[derive(Deserialize)]
pub struct SearchCompileRequest {
    pub query: String,
    pub time_from: Option<String>,
    pub time_to: Option<String>,
}

#[derive(Serialize)]
pub struct SearchCompileResponse {
    pub sql: String,
    pub fields: Vec<&'static str>,
}

async fn health() -> &'static str {
    "ok"
}

async fn compile(
    State(state): State<SearchState>,
    Json(body): Json<SearchCompileRequest>,
) -> Result<Json<SearchCompileResponse>, (axum::http::StatusCode, String)> {
    let mpl = parse_mpl(&body.query)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))?;
    let config = effective_config(&state).await;
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
    Ok(Json(SearchCompileResponse {
        sql,
        fields: list_sidebar_fields(),
    }))
}

async fn run(
    State(state): State<SearchState>,
    Json(body): Json<SearchRunRequest>,
) -> Result<Json<SearchRunResponse>, (axum::http::StatusCode, String)> {
    let config = effective_config(&state).await;
    run_search(&state.pool, &config, body)
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))
}

async fn field_stats(
    State(state): State<SearchState>,
    Json(body): Json<FieldStatsRequest>,
) -> Result<Json<FieldStatsResponse>, (axum::http::StatusCode, String)> {
    let config = effective_config(&state).await;
    run_field_stats(&config, body)
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))
}

async fn histogram(
    State(state): State<SearchState>,
    Json(body): Json<HistogramRequest>,
) -> Result<Json<HistogramResponse>, (axum::http::StatusCode, String)> {
    let config = effective_config(&state).await;
    run_histogram(&config, body)
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))
}

async fn list_fields() -> Json<Vec<&'static str>> {
    Json(list_sidebar_fields())
}

async fn fields_in_scope(
    State(state): State<SearchState>,
    Json(body): Json<FieldsInScopeRequest>,
) -> Result<Json<FieldsInScopeResponse>, (axum::http::StatusCode, String)> {
    let config = effective_config(&state).await;
    run_fields_in_scope(&config, body)
        .await
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))
}

pub fn router(state: SearchState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/search/compile", post(compile))
        .route("/v1/search/run", post(run))
        .route("/v1/search/fields", get(list_fields))
        .route("/v1/search/fields-in-scope", post(fields_in_scope))
        .route("/v1/search/field-stats", post(field_stats))
        .route("/v1/search/histogram", post(histogram))
        .with_state(state)
        .layer(CorsLayer::permissive())
}
