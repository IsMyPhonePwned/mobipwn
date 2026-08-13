use crate::api_error::{api_error, ApiErrorResponse};
use crate::AppState;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use mobipwn_core::{
    attach_eligible_blob_hashes, compare_cases, enrich_eligible_case_identifiers,
    is_comparable_case, list_cases_with_ingest, CaseComparisonResponse, CaseRecord, ComparePlatform,
};
use serde::Deserialize;
use uuid::Uuid;

type CompareErr = (StatusCode, Json<ApiErrorResponse>);

fn compare_err(status: StatusCode, msg: impl Into<String>) -> CompareErr {
    api_error(status, msg)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/v1/case-comparison/eligible-cases",
            get(list_eligible_cases),
        )
        .route("/v1/case-comparison/compare", post(compare_cases_handler))
        // Legacy aliases (Android-only historically).
        .route(
            "/v1/bugreport-comparison/eligible-cases",
            get(list_eligible_cases_legacy),
        )
        .route(
            "/v1/bugreport-comparison/compare",
            post(compare_cases_legacy),
        )
}

#[derive(Debug, Deserialize)]
struct EligibleQuery {
    /// `android` (default) or `ios`
    #[serde(default = "default_platform")]
    platform: String,
}

fn default_platform() -> String {
    "android".into()
}

fn parse_platform(raw: &str) -> Result<ComparePlatform, CompareErr> {
    ComparePlatform::parse(raw).ok_or_else(|| {
        compare_err(
            StatusCode::BAD_REQUEST,
            "platform must be android or ios",
        )
    })
}

async fn list_eligible_for_platform(
    state: &AppState,
    platform: ComparePlatform,
) -> Result<Json<Vec<CaseRecord>>, CompareErr> {
    let cases = list_cases_with_ingest(
        &state.pool,
        &state.config,
        &state.cases,
        &state.ingest_jobs,
        Some(&state.clickhouse),
        None,
        None,
        None,
    )
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "list eligible comparison cases failed");
        compare_err(StatusCode::INTERNAL_SERVER_ERROR, "list cases failed")
    })?;
    let mut eligible: Vec<CaseRecord> = cases
        .into_iter()
        .filter(|c| is_comparable_case(c, platform))
        .collect();
    enrich_eligible_case_identifiers(&state.config, platform, &mut eligible).await;
    let sources: Vec<String> = eligible
        .iter()
        .filter_map(|c| c.ingest_source.clone())
        .filter(|s| !s.trim().is_empty())
        .collect();
    if let Ok(hashes) = state.collect_blobs.latest_hashes_for_sources(&sources).await {
        attach_eligible_blob_hashes(&mut eligible, &hashes);
    }
    Ok(Json(eligible))
}

async fn list_eligible_cases(
    State(state): State<AppState>,
    Query(q): Query<EligibleQuery>,
) -> Result<Json<Vec<CaseRecord>>, CompareErr> {
    let platform = parse_platform(&q.platform)?;
    list_eligible_for_platform(&state, platform).await
}

async fn list_eligible_cases_legacy(
    State(state): State<AppState>,
) -> Result<Json<Vec<CaseRecord>>, CompareErr> {
    list_eligible_for_platform(&state, ComparePlatform::Android).await
}

#[derive(Debug, Deserialize)]
struct CompareCasesBody {
    case_a_id: Uuid,
    case_b_id: Uuid,
    /// `android` (default) or `ios`
    #[serde(default = "default_platform")]
    platform: String,
}

async fn run_compare(
    state: &AppState,
    platform: ComparePlatform,
    case_a_id: Uuid,
    case_b_id: Uuid,
) -> Result<Json<CaseComparisonResponse>, CompareErr> {
    if case_a_id == case_b_id {
        return Err(compare_err(
            StatusCode::BAD_REQUEST,
            "select two different cases",
        ));
    }

    let case_a = state
        .cases
        .get(case_a_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "compare: load case A failed");
            compare_err(StatusCode::INTERNAL_SERVER_ERROR, "load case A failed")
        })?
        .ok_or_else(|| compare_err(StatusCode::NOT_FOUND, "case A not found"))?;
    let case_b = state
        .cases
        .get(case_b_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "compare: load case B failed");
            compare_err(StatusCode::INTERNAL_SERVER_ERROR, "load case B failed")
        })?
        .ok_or_else(|| compare_err(StatusCode::NOT_FOUND, "case B not found"))?;

    if !is_comparable_case(&case_a, platform) || !is_comparable_case(&case_b, platform) {
        return Err(compare_err(
            StatusCode::BAD_REQUEST,
            format!(
                "both cases must be {} ingests",
                platform.label()
            ),
        ));
    }

    let source_a = case_a.ingest_source.as_deref().unwrap_or("");
    let source_b = case_b.ingest_source.as_deref().unwrap_or("");
    let blob_a = if source_a.is_empty() {
        None
    } else {
        state
            .collect_blobs
            .list(Some(source_a), 1)
            .await
            .ok()
            .and_then(|mut v| v.pop())
    };
    let blob_b = if source_b.is_empty() {
        None
    } else {
        state
            .collect_blobs
            .list(Some(source_b), 1)
            .await
            .ok()
            .and_then(|mut v| v.pop())
    };

    compare_cases(
        &state.pool,
        &state.config,
        platform,
        &case_a,
        &case_b,
        blob_a.as_ref(),
        blob_b.as_ref(),
    )
    .await
    .map(Json)
    .map_err(|e| {
        tracing::error!(error = %e, "case comparison failed");
        compare_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })
}

async fn compare_cases_handler(
    State(state): State<AppState>,
    Json(body): Json<CompareCasesBody>,
) -> Result<Json<CaseComparisonResponse>, CompareErr> {
    let platform = parse_platform(&body.platform)?;
    run_compare(&state, platform, body.case_a_id, body.case_b_id).await
}

async fn compare_cases_legacy(
    State(state): State<AppState>,
    Json(body): Json<CompareCasesBody>,
) -> Result<Json<CaseComparisonResponse>, CompareErr> {
    run_compare(
        &state,
        ComparePlatform::Android,
        body.case_a_id,
        body.case_b_id,
    )
    .await
}
