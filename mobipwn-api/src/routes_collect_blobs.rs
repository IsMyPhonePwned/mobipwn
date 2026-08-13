use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum::body::Bytes;
use mobipwn_core::CollectBlob;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api_error::{api_error, ApiErrorResponse};
use crate::ingest::{reingest_collect_blob, store_collect_blob_bytes, IngestResultResponse};
use crate::AppState;

const STORE_BODY_LIMIT: usize = 512 * 1024 * 1024;

#[derive(Deserialize)]
pub struct StoreCollectBlobQuery {
    pub platform: String,
    pub source: String,
    pub file_name: String,
    pub user: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
}

#[derive(Serialize)]
pub struct StoreCollectBlobResponse {
    pub id: Uuid,
    pub source: String,
    pub file_name: String,
    pub file_size: i64,
    pub analyzed: bool,
}

#[derive(Deserialize)]
pub struct ListCollectBlobsQuery {
    pub source: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    100
}

#[derive(Serialize)]
pub struct CollectBlobListResponse {
    pub blobs: Vec<CollectBlob>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/collect/blobs", get(list_collect_blobs).post(store_collect_blob))
        .route(
            "/v1/collect/blobs/{id}",
            get(get_collect_blob).delete(delete_collect_blob),
        )
        .route("/v1/collect/blobs/{id}/download", get(download_collect_blob))
        .route("/v1/collect/blobs/{id}/reingest", post(reingest_blob))
        .layer(axum::extract::DefaultBodyLimit::max(STORE_BODY_LIMIT))
}

async fn store_collect_blob(
    State(state): State<AppState>,
    Query(q): Query<StoreCollectBlobQuery>,
    body: Bytes,
) -> Result<Json<StoreCollectBlobResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let origin = q.origin.as_deref().unwrap_or("device-pull");
    let analyzed = origin != "device-pull";
    let blob = store_collect_blob_bytes(
        &state,
        &body,
        q.source.trim(),
        q.platform.trim(),
        q.file_name.trim(),
        q.user.as_deref(),
        &[],
        origin,
        analyzed,
    )
    .await?;
    Ok(Json(StoreCollectBlobResponse {
        id: blob.id,
        source: blob.source,
        file_name: blob.file_name,
        file_size: blob.file_size,
        analyzed: blob.analyzed,
    }))
}

async fn list_collect_blobs(
    State(state): State<AppState>,
    Query(q): Query<ListCollectBlobsQuery>,
) -> Result<Json<CollectBlobListResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let limit = q.limit.clamp(1, 500);
    // Case / source-scoped lists: one archive per source (drop older duplicates).
    if let Some(src) = q.source.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let _ = state.collect_blobs.retain_latest_for_source(src).await;
    }
    let blobs = state
        .collect_blobs
        .list(q.source.as_deref(), limit)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(CollectBlobListResponse { blobs }))
}

async fn get_collect_blob(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<CollectBlob>, (StatusCode, Json<ApiErrorResponse>)> {
    let blob = state
        .collect_blobs
        .get(id)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "collect archive not found"))?;
    Ok(Json(blob))
}

async fn download_collect_blob(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Response, (StatusCode, Json<ApiErrorResponse>)> {
    let blob = state
        .collect_blobs
        .get(id)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "collect archive not found"))?;

    let bytes = tokio::fs::read(&blob.storage_path)
        .await
        .map_err(|e| api_error(StatusCode::NOT_FOUND, format!("archive file unreadable: {e}")))?;

    let disposition = format!(
        "attachment; filename=\"{}\"",
        blob.file_name.replace('"', "_")
    );
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_DISPOSITION, disposition)
        .header(header::CONTENT_LENGTH, bytes.len())
        .body(Body::from(bytes))
        .unwrap()
        .into_response())
}

#[derive(Deserialize)]
pub struct ReingestBlobQuery {
    /// When true, delete existing ClickHouse events for the blob source before re-parsing.
    #[serde(default = "default_clean_reingest")]
    pub clean: bool,
}

fn default_clean_reingest() -> bool {
    true
}

async fn reingest_blob(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(q): Query<ReingestBlobQuery>,
) -> Result<Json<IngestResultResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let result = reingest_collect_blob(&state, id, q.clean).await?;
    Ok(Json(result))
}

async fn delete_collect_blob(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<ApiErrorResponse>)> {
    let deleted = state
        .collect_blobs
        .delete(id)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(api_error(StatusCode::NOT_FOUND, "collect archive not found"))
    }
}
