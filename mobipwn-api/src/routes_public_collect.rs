use axum::{
    body::Bytes,
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use mobipwn_core::{
    load_public_collect_config, public_android_collect_config, public_collect_is_enabled,
    public_collector_config, PublicAndroidCollectConfig, PublicCollectorConfig,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api_error::api_error;
use crate::ingest::IngestErr;
use crate::AppState;

const INGEST_BODY_LIMIT: usize = 512 * 1024 * 1024;

#[derive(Serialize)]
pub struct PublicCollectStatus {
    pub enabled: bool,
}

#[derive(Deserialize)]
pub struct PublicCollectIngestQuery {
    /// `android` (bugreport) or `ios` (sysdiagnose archive).
    pub platform: String,
    /// Ingest source label; auto-generated when omitted.
    pub source: Option<String>,
    /// Optional device owner for the investigation case.
    pub user: Option<String>,
    /// Per-upload iOS sysdiagnose options (same knobs as /ingest).
    #[serde(default)]
    pub logarchive_uncapped: Option<bool>,
    #[serde(default)]
    pub logarchive_decode_max_lines: Option<u32>,
    #[serde(default)]
    pub max_entry_mb: Option<u32>,
    #[serde(default)]
    pub ioservice_full_tree: Option<bool>,
}

#[derive(Serialize)]
pub struct PublicCollectIngestResponse {
    pub ingested: usize,
    pub deduplicated: bool,
    pub source: String,
    pub case_id: Uuid,
    pub case_title: String,
}

#[derive(Deserialize)]
pub struct PublicCollectStoreQuery {
    pub platform: String,
    pub source: Option<String>,
    pub user: Option<String>,
    pub file_name: String,
}

#[derive(Serialize)]
pub struct PublicCollectStoreResponse {
    pub id: Uuid,
    pub source: String,
    pub file_name: String,
    pub file_size: i64,
}

fn random_case_source() -> String {
    let hex = Uuid::now_v7().to_string().replace('-', "");
    format!("case-{}", &hex[..8])
}

fn normalize_source(raw: Option<String>) -> String {
    raw.map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(random_case_source)
}

fn merge_public_tags(cfg_tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = cfg_tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if !out.iter().any(|t| t == "public-collect") {
        out.push("public-collect".into());
    }
    out
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/public/collect/status", get(public_collect_status))
        .route("/v1/public/collect/android-config", get(public_android_collect_config_route))
        .route("/v1/public/collect/collector-config", get(public_collector_config_route))
        .route("/v1/public/collect/ingest", post(public_collect_ingest))
        .route("/v1/public/collect/store", post(public_collect_store))
        .layer(axum::extract::DefaultBodyLimit::max(INGEST_BODY_LIMIT))
}

async fn public_android_collect_config_route(
    State(state): State<AppState>,
) -> Result<Json<PublicAndroidCollectConfig>, StatusCode> {
    let enabled = public_collect_is_enabled(&state.settings)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !enabled {
        return Err(StatusCode::NOT_FOUND);
    }
    let cfg = load_public_collect_config(&state.settings)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(public_android_collect_config(&cfg.android_collect)))
}

async fn public_collector_config_route(
    State(state): State<AppState>,
) -> Result<Json<PublicCollectorConfig>, StatusCode> {
    let enabled = public_collect_is_enabled(&state.settings)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !enabled {
        return Err(StatusCode::NOT_FOUND);
    }
    let cfg = load_public_collect_config(&state.settings)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let sysdiagnose = mobipwn_core::load_sysdiagnose_ingest_config(&state.settings)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(public_collector_config(&cfg, &sysdiagnose)))
}

async fn public_collect_status(State(state): State<AppState>) -> Result<Json<PublicCollectStatus>, StatusCode> {
    let enabled = public_collect_is_enabled(&state.settings)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(PublicCollectStatus { enabled }))
}

async fn public_collect_ingest(
    State(state): State<AppState>,
    Query(q): Query<PublicCollectIngestQuery>,
    body: Bytes,
) -> Result<Json<PublicCollectIngestResponse>, IngestErr> {
    let enabled = public_collect_is_enabled(&state.settings)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if !enabled {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "public device collection is disabled",
        ));
    }
    let cfg = load_public_collect_config(&state.settings)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if body.is_empty() {
        return Err(api_error(StatusCode::BAD_REQUEST, "empty upload body"));
    }

    let platform = q.platform.trim().to_lowercase();
    if platform != "android" && platform != "ios" {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "platform must be android or ios",
        ));
    }
    if platform == "ios" && !cfg.ios_collect.upload_enabled {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "iOS sysdiagnose upload is disabled by an administrator",
        ));
    }

    let source = normalize_source(q.source);
    let user = q
        .user
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let tags = merge_public_tags(&cfg.tags);
    let temp_suffix = if platform == "ios" {
        "sysdiagnose.tar.gz"
    } else {
        "bugreport.zip"
    };

    let sysdiagnose = if platform == "ios" {
        let o = mobipwn_core::SysdiagnoseIngestOverrides {
            logarchive_uncapped: q.logarchive_uncapped,
            logarchive_decode_max_lines: q.logarchive_decode_max_lines,
            max_entry_mb: q.max_entry_mb,
            ioservice_full_tree: q.ioservice_full_tree,
        };
        (!o.is_empty()).then_some(o)
    } else {
        None
    };

    let result = crate::ingest::ingest_archive_bytes_with_sysdiagnose(
        &state,
        &source,
        &platform,
        user,
        &tags,
        &body,
        temp_suffix,
        sysdiagnose.as_ref(),
    )
    .await?;

    let (case, _) = state
        .cases
        .ensure_for_ingest_source(&source, &platform, user)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(PublicCollectIngestResponse {
        ingested: result.ingested,
        deduplicated: result.deduplicated,
        source,
        case_id: case.id,
        case_title: case.title,
    }))
}

async fn public_collect_store(
    State(state): State<AppState>,
    Query(q): Query<PublicCollectStoreQuery>,
    body: Bytes,
) -> Result<Json<PublicCollectStoreResponse>, IngestErr> {
    let enabled = public_collect_is_enabled(&state.settings)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if !enabled {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "public device collection is disabled",
        ));
    }
    let cfg = load_public_collect_config(&state.settings)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let platform = q.platform.trim().to_lowercase();
    if platform != "android" && platform != "ios" {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "platform must be android or ios",
        ));
    }
    if platform == "ios" && !cfg.ios_collect.upload_enabled {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "iOS sysdiagnose upload is disabled by an administrator",
        ));
    }

    let source = normalize_source(q.source);
    let user = q
        .user
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let tags = merge_public_tags(&cfg.tags);

    let blob = crate::ingest::store_collect_blob_bytes(
        &state,
        &body,
        &source,
        &platform,
        q.file_name.trim(),
        user,
        &tags,
        "device-pull",
        false,
    )
    .await?;

    Ok(Json(PublicCollectStoreResponse {
        id: blob.id,
        source: blob.source,
        file_name: blob.file_name,
        file_size: blob.file_size,
    }))
}
