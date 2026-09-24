use crate::api_error::{api_error, ApiErrorResponse};
use crate::routes_extended::file_hash;
use crate::AppState;
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use mobipwn_core::config::AppConfig;
use mobipwn_core::mudm::stamp_ingest_tags;
use mobipwn_core::{CollectBlob, IngestJob, NewCollectBlob};
use mobipwn_core::mudm::MudmEvent;
use mobipwn_core::store::{IngestJobOptions, IngestJobProgress};
use mobipwn_ingest::{
    anonymize_archive_file, insert_events_with_progress, parse_android_bugreport,
    parse_ios_sysdiagnose, sysdiagnose_archive_options_from_config,
    sysdiagnose_parse_options_from_config, AnonymizeIngestOptions, BugreportParseReport,
    SysdiagnoseParseReport, SysdiagnoseProgressFn,
};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path as FsPath, PathBuf};
use uuid::Uuid;

pub const UPLOAD_CHUNK_SIZE: usize = 4 * 1024 * 1024;

#[derive(Deserialize)]
pub struct UploadInitRequest {
    pub source: String,
    /// `android` (bugreport) or `ios` (sysdiagnose)
    pub platform: String,
    pub user: Option<String>,
    /// Optional tags merged onto the investigation case when ingest completes.
    pub tags: Option<Vec<String>>,
    pub file_name: String,
    pub file_size: i64,
    pub file_hash: String,
    /// Per-upload iOS sysdiagnose options (overrides Settings for this job only).
    #[serde(default)]
    pub sysdiagnose: Option<mobipwn_core::SysdiagnoseIngestOverrides>,
    /// Run fakeMustache on the archive before parse (pseudonymize identifiers in indexed events).
    #[serde(default)]
    pub anonymize: Option<AnonymizeIngestOptions>,
}

#[derive(Serialize)]
pub struct IngestJobResponse {
    #[serde(flatten)]
    pub job: IngestJob,
    pub progress_percent: u8,
    pub deduplicated: bool,
}

#[derive(Serialize)]
pub struct UploadInitResponse {
    pub job_id: Uuid,
    pub deduplicated: bool,
    pub ingested: Option<usize>,
    pub status: String,
}

#[derive(Serialize)]
pub struct IngestResultResponse {
    pub ingested: usize,
    pub job_id: Option<Uuid>,
    pub status: Option<String>,
    pub deduplicated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events_cleared: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob_id: Option<Uuid>,
}

pub type IngestErr = (StatusCode, Json<ApiErrorResponse>);

fn ingest_result(
    ingested: usize,
    job_id: Option<Uuid>,
    status: Option<&str>,
    deduplicated: bool,
) -> IngestResultResponse {
    IngestResultResponse {
        ingested,
        job_id,
        status: status.map(str::to_string),
        deduplicated,
        events_cleared: None,
        blob_id: None,
    }
}

pub fn job_response(job: IngestJob, deduplicated: bool) -> IngestJobResponse {
    let progress_percent = job.progress_percent();
    IngestJobResponse {
        job,
        progress_percent,
        deduplicated,
    }
}

fn case_user<'a>(user: &'a Option<String>) -> Option<&'a str> {
    user.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

fn normalize_ingest_tags(tags: Option<Vec<String>>) -> Vec<String> {
    tags.unwrap_or_default()
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

pub(crate) fn parse_comma_tags(raw: Option<&str>) -> Vec<String> {
    raw.map(|s| {
        s.split(',')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect()
    })
    .unwrap_or_default()
}

pub(crate) async fn sync_case_after_ingest(
    state: &AppState,
    source: &str,
    platform: &str,
    user: Option<&str>,
    extra_tags: &[String],
) {
    match state
        .cases
        .ensure_for_ingest_source(source, platform, user)
        .await
    {
        Ok((case, is_new)) => {
            if !extra_tags.is_empty() {
                let _ = state.cases.patch_tags(case.id, extra_tags, &[]).await;
            }
            if is_new {
                crate::case_audit::audit_ingest_case_created(state, &case).await;
            }
        }
        Err(e) => tracing::warn!(source = %source, error = %e, "could not sync case for ingest source"),
    }
}

fn platform_slug(platform: &str) -> Result<&'static str, IngestErr> {
    match platform {
        "android" | "bugreport" => Ok("android"),
        "ios" | "sysdiagnose" => Ok("ios"),
        _ => Err(api_error(
            StatusCode::BAD_REQUEST,
            "platform must be android or ios",
        )),
    }
}

fn upload_dir() -> PathBuf {
    std::env::temp_dir().join("mobipwn_uploads")
}

fn archive_path_for(job_id: Uuid, file_name: &str) -> PathBuf {
    let safe: String = file_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
            c
        } else {
            '_'
        })
        .collect();
    upload_dir().join(job_id.to_string()).join(safe)
}

fn sysdiagnose_options_path(job_id: Uuid) -> PathBuf {
    upload_dir()
        .join(job_id.to_string())
        .join("sysdiagnose_options.json")
}

fn anonymize_options_path(job_id: Uuid) -> PathBuf {
    upload_dir()
        .join(job_id.to_string())
        .join("anonymize_options.json")
}

fn write_anonymize_options(
    job_id: Uuid,
    opts: Option<&AnonymizeIngestOptions>,
) -> Result<(), String> {
    let path = anonymize_options_path(job_id);
    match opts {
        Some(o) if o.enabled => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let bytes = serde_json::to_vec(o).map_err(|e| e.to_string())?;
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        }
        _ => {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(())
}

fn load_anonymize_options(job_id: Option<Uuid>) -> Option<AnonymizeIngestOptions> {
    let id = job_id?;
    let bytes = std::fs::read(anonymize_options_path(id)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_sysdiagnose_options(
    job_id: Uuid,
    opts: Option<&mobipwn_core::SysdiagnoseIngestOverrides>,
) -> Result<(), String> {
    let path = sysdiagnose_options_path(job_id);
    match opts {
        Some(o) if !o.is_empty() => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let bytes = serde_json::to_vec(o).map_err(|e| e.to_string())?;
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        }
        _ => {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(())
}

fn load_sysdiagnose_options(
    job_id: Option<Uuid>,
) -> Option<mobipwn_core::SysdiagnoseIngestOverrides> {
    let id = job_id?;
    let bytes = std::fs::read(sysdiagnose_options_path(id)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Resolve iOS overrides for a job: temp upload file → prior job options → last done ingest.
async fn resolve_sysdiagnose_overrides(
    state: &AppState,
    job_id: Option<Uuid>,
    source: &str,
) -> Option<mobipwn_core::SysdiagnoseIngestOverrides> {
    if let Some(o) = load_sysdiagnose_options(job_id).filter(|o| !o.is_empty()) {
        return Some(o);
    }
    if let Some(id) = job_id {
        if let Ok(Some(job)) = state.ingest_jobs.get(id).await {
            if let Some(opts) = job.progress.as_ref().and_then(|p| p.options.as_ref()) {
                let o = opts.to_sysdiagnose_overrides();
                if !o.is_empty() {
                    return Some(o);
                }
            }
        }
    }
    match state
        .ingest_jobs
        .latest_done_options_by_sources(&[source.to_string()])
        .await
    {
        Ok(map) => map.get(source).and_then(|opts| {
            let o = opts.to_sysdiagnose_overrides();
            (!o.is_empty()).then_some(o)
        }),
        Err(_) => None,
    }
}

pub async fn init_upload(
    State(state): State<AppState>,
    Json(body): Json<UploadInitRequest>,
) -> Result<Json<UploadInitResponse>, IngestErr> {
    if body.source.trim().is_empty() {
        return Err(api_error(StatusCode::BAD_REQUEST, "source is required"));
    }
    if body.file_size <= 0 {
        return Err(api_error(StatusCode::BAD_REQUEST, "file_size must be positive"));
    }
    if body.file_hash.len() != 64 || !body.file_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "file_hash must be a 64-char SHA-256 hex digest",
        ));
    }

    let platform = platform_slug(&body.platform)?;
    let user = case_user(&body.user);
    let ingest_tags = normalize_ingest_tags(body.tags.clone());

    if let Some(existing) = state
        .ingest_jobs
        .get_by_source_hash(&body.source, &body.file_hash)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        if existing.status == "done" && existing.events_count > 0 {
            let ch_count = mobipwn_core::count_events_by_source(&state.config, &body.source)
                .await
                .unwrap_or(0);
                if ch_count > 0 {
                    sync_case_after_ingest(&state, &body.source, platform, user, &ingest_tags).await;
                    crate::detection_hook::spawn_after_ingest_detections(&state, &body.source);
                tracing::info!(
                    job_id = %existing.id,
                    source = %body.source,
                    platform,
                    file = %body.file_name,
                    file_size = body.file_size,
                    file_hash = %&body.file_hash[..12.min(body.file_hash.len())],
                    events = existing.events_count,
                    ch_count,
                    user = user.unwrap_or(""),
                    "ingest deduplicated at upload init"
                );
                return Ok(Json(UploadInitResponse {
                    job_id: existing.id,
                    deduplicated: true,
                    ingested: Some(existing.events_count as usize),
                    status: "done".into(),
                }));
            }
        }
        if existing.status == "uploading" || existing.status == "running" || existing.status == "pending"
        {
            return Err(api_error(
                StatusCode::CONFLICT,
                format!(
                    "ingest already in progress for this source and file (job {}, status {})",
                    existing.id, existing.status
                ),
            ));
        }
    }

    let job_id = state
        .ingest_jobs
        .get_by_source_hash(&body.source, &body.file_hash)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .filter(|j| j.status == "failed")
        .map(|j| j.id)
        .unwrap_or_else(Uuid::now_v7);

    let path = archive_path_for(job_id, &body.file_name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    std::fs::File::create(&path)
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let job = state
        .ingest_jobs
        .begin_upload(
            job_id,
            &body.source,
            platform,
            &body.file_hash,
            body.file_size,
            path.to_string_lossy().as_ref(),
            user,
            &ingest_tags,
        )
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if platform == "ios" {
        write_sysdiagnose_options(job.id, body.sysdiagnose.as_ref())
            .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    }
    write_anonymize_options(job.id, body.anonymize.as_ref())
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e))?;

    tracing::info!(
        job_id = %job.id,
        source = %body.source,
        platform,
        file = %body.file_name,
        file_size = body.file_size,
        file_hash = %&body.file_hash[..12.min(body.file_hash.len())],
        user = user.unwrap_or(""),
        anonymize = body.anonymize.as_ref().map(|a| a.enabled).unwrap_or(false),
        "ingest upload initiated"
    );

    Ok(Json(UploadInitResponse {
        job_id: job.id,
        deduplicated: false,
        ingested: None,
        status: job.status,
    }))
}

pub async fn upload_chunk(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<IngestJobResponse>, IngestErr> {
    let offset = headers
        .get("x-upload-offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "X-Upload-Offset header required"))?;

    let mut job = state
        .ingest_jobs
        .get(job_id)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "upload job not found"))?;

    if job.status != "uploading" {
        return Err(api_error(
            StatusCode::CONFLICT,
            format!("job status is {}, expected uploading", job.status),
        ));
    }
    if offset != job.bytes_received {
        return Err(api_error(
            StatusCode::CONFLICT,
            format!(
                "offset mismatch: expected {}, got {}",
                job.bytes_received, offset
            ),
        ));
    }
    if job.bytes_received + body.len() as i64 > job.file_size {
        return Err(api_error(StatusCode::BAD_REQUEST, "upload exceeds declared file_size"));
    }

    let path = job
        .archive_path
        .as_ref()
        .ok_or_else(|| api_error(StatusCode::INTERNAL_SERVER_ERROR, "job missing archive_path"))?;

    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    file.write_all(&body)
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let new_received = job.bytes_received + body.len() as i64;
    state
        .ingest_jobs
        .update_upload_progress(job_id, new_received)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    job.bytes_received = new_received;

    if new_received == job.file_size {
        tracing::info!(
            job_id = %job_id,
            source = %job.source,
            bytes = new_received,
            file_size = job.file_size,
            "ingest upload bytes complete"
        );
    } else {
        tracing::debug!(
            job_id = %job_id,
            bytes = new_received,
            file_size = job.file_size,
            progress = job.progress_percent(),
            "ingest upload chunk"
        );
    }

    Ok(Json(job_response(job, false)))
}

pub async fn complete_upload(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<IngestResultResponse>, IngestErr> {
    let job = state
        .ingest_jobs
        .get(job_id)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "upload job not found"))?;

    if job.status != "uploading" {
        return Err(api_error(
            StatusCode::CONFLICT,
            format!("job status is {}, expected uploading", job.status),
        ));
    }
    if job.bytes_received != job.file_size {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            format!(
                "incomplete upload: received {} of {} bytes",
                job.bytes_received, job.file_size
            ),
        ));
    }

    let path = job
        .archive_path
        .clone()
        .ok_or_else(|| api_error(StatusCode::INTERNAL_SERVER_ERROR, "job missing archive_path"))?;

    let actual_hash = hash_file(FsPath::new(&path))
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if actual_hash != job.file_hash {
        let _ = state
            .ingest_jobs
            .finish(job_id, 0, Some("file hash mismatch after upload"), None)
            .await;
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "uploaded file hash does not match declared file_hash",
        ));
    }

    state
        .ingest_jobs
        .mark_pending(job_id)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!(
        job_id = %job_id,
        source = %job.source,
        platform = %job.platform,
        file_size = job.file_size,
        file_hash = %&job.file_hash[..12.min(job.file_hash.len())],
        "ingest upload complete, parsing queued"
    );

    spawn_process_job(state.clone(), job_id);

    Ok(Json(ingest_result(0, Some(job_id), Some("pending"), false)))
}

pub async fn get_ingest_job(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<IngestJobResponse>, IngestErr> {
    let job = state
        .ingest_jobs
        .get(job_id)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "ingest job not found"))?;
    Ok(Json(job_response(job, false)))
}

/// Inline ingest for legacy raw-body endpoints (CLI / small uploads).
pub async fn ingest_archive_bytes(
    state: &AppState,
    source: &str,
    platform: &str,
    user: Option<&str>,
    extra_tags: &[String],
    body: &Bytes,
    temp_suffix: &str,
) -> Result<IngestResultResponse, IngestErr> {
    ingest_archive_bytes_with_sysdiagnose(
        state,
        source,
        platform,
        user,
        extra_tags,
        body,
        temp_suffix,
        None,
    )
    .await
}

pub async fn ingest_archive_bytes_with_sysdiagnose(
    state: &AppState,
    source: &str,
    platform: &str,
    user: Option<&str>,
    extra_tags: &[String],
    body: &Bytes,
    temp_suffix: &str,
    sysdiagnose: Option<&mobipwn_core::SysdiagnoseIngestOverrides>,
) -> Result<IngestResultResponse, IngestErr> {
    let hash = file_hash(body);
    if let Some(resp) = check_dedup(state, source, platform, &hash, user, extra_tags).await? {
        return Ok(resp);
    }

    if let Some(existing) = state
        .ingest_jobs
        .get_by_source_hash(source, &hash)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        if matches!(existing.status.as_str(), "uploading" | "pending" | "running") {
            return Err(api_error(
                StatusCode::CONFLICT,
                "ingest already in progress for this source and file",
            ));
        }
    }

    let path = write_temp_file(temp_suffix, body)?;
    let job = state
        .ingest_jobs
        .try_start(source, platform, &hash)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let job_id = job.as_ref().map(|j| j.id);
    if platform == "ios" {
        if let Some(id) = job_id {
            write_sysdiagnose_options(id, sysdiagnose)
                .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e))?;
        }
    }
    tracing::info!(
        job_id = ?job_id,
        %source,
        platform,
        bytes = body.len(),
        file_hash = %&hash[..12.min(hash.len())],
        user = user.unwrap_or(""),
        "ingest inline upload started"
    );
    persist_collect_archive(state, &path, job_id, source, platform, user, extra_tags).await;
    let (n, final_progress) =
        process_archive_at_path(state, job_id, &path, source, platform, user, extra_tags).await?;
    let _ = std::fs::remove_file(&path);

    if let Some(j) = job {
        let _ = state
            .ingest_jobs
            .finish(j.id, n as i32, None, final_progress.as_ref())
            .await;
    } else if let Ok(Some(j)) = state.ingest_jobs.get_by_source_hash(source, &hash).await {
        let _ = state
            .ingest_jobs
            .finish(j.id, n as i32, None, final_progress.as_ref())
            .await;
    }

    tracing::info!(
        job_id = ?job_id,
        %source,
        platform,
        events = n,
        "ingest inline complete"
    );

    Ok(ingest_result(n, job_id, Some("done"), false))
}

async fn check_dedup(
    state: &AppState,
    source: &str,
    platform: &str,
    hash: &str,
    user: Option<&str>,
    extra_tags: &[String],
) -> Result<Option<IngestResultResponse>, IngestErr> {
    let existing = state
        .ingest_jobs
        .get_by_source_hash(source, hash)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let Some(job) = existing else {
        return Ok(None);
    };

    if job.status == "done" && job.events_count > 0 {
        let ch_count = mobipwn_core::count_events_by_source(&state.config, source)
            .await
            .unwrap_or(0);
        if ch_count > 0 {
            sync_case_after_ingest(state, source, platform, user, extra_tags).await;
            crate::detection_hook::spawn_after_ingest_detections(state, source);
            tracing::info!(
                job_id = %job.id,
                %source,
                platform,
                events = job.events_count,
                ch_count,
                user = user.unwrap_or(""),
                "ingest deduplicated"
            );
            return Ok(Some(ingest_result(
                job.events_count as usize,
                Some(job.id),
                Some("done"),
                true,
            )));
        }
        state
            .ingest_jobs
            .mark_running(job.id)
            .await
            .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(None)
}

fn spawn_process_job(state: AppState, job_id: Uuid) {
    tokio::spawn(async move {
        let job = match state.ingest_jobs.get(job_id).await {
            Ok(Some(j)) => j,
            _ => return,
        };

        let path = match job.archive_path.clone() {
            Some(p) => p,
            None => {
                let _ = state
                    .ingest_jobs
                    .finish(job_id, 0, Some("missing archive_path"), None)
                    .await;
                return;
            }
        };

        let _ = state.ingest_jobs.mark_running(job_id).await;
        let user = job.case_user.as_deref();
        let mut ingest_tags = job.ingest_tags.clone();

        if let Some(anon) = load_anonymize_options(Some(job_id)).filter(|o| o.enabled) {
            set_job_stage(
                &state,
                Some(job_id),
                "anonymizing",
                &format!("fakeMustache ({})…", anon.profile),
                None,
            )
            .await;
            match anonymize_archive_file(FsPath::new(&path), &anon) {
                Ok(profile) => {
                    let tag = format!("anonymized:{profile}");
                    if !ingest_tags.iter().any(|t| t == &tag || t == "anonymized") {
                        ingest_tags.push("anonymized".into());
                        ingest_tags.push(tag);
                    }
                    tracing::info!(job_id = %job_id, %profile, "archive anonymized before parse");
                }
                Err(e) => {
                    let msg = format!("fakeMustache anonymize failed: {e}");
                    let _ = state
                        .ingest_jobs
                        .finish(job_id, 0, Some(&msg), None)
                        .await;
                    tracing::error!(job_id = %job_id, error = %e, "anonymize failed");
                    return;
                }
            }
        }

        persist_collect_archive(
            &state,
            FsPath::new(&path),
            Some(job_id),
            &job.source,
            &job.platform,
            user,
            &ingest_tags,
        )
        .await;
        tracing::info!(
            job_id = %job_id,
            source = %job.source,
            platform = %job.platform,
            file_size = job.file_size,
            archive = %path,
            user = user.unwrap_or(""),
            tags = ?ingest_tags,
            "ingest parsing started"
        );
        let result = process_archive_at_path(
            &state,
            Some(job_id),
            FsPath::new(&path),
            &job.source,
            &job.platform,
            user,
            &ingest_tags,
        )
        .await;

        match result {
            Ok((n, final_progress)) => {
                let _ = state
                    .ingest_jobs
                    .finish(job_id, n as i32, None, final_progress.as_ref())
                    .await;
                let _ = std::fs::remove_file(&path);
                if let Some(parent) = FsPath::new(&path).parent() {
                    let _ = std::fs::remove_dir(parent);
                }
                tracing::info!(
                    job_id = %job_id,
                    source = %job.source,
                    platform = %job.platform,
                    events = n,
                    file_size = job.file_size,
                    "ingest complete"
                );
            }
            Err((status, Json(err))) => {
                let _ = state
                    .ingest_jobs
                    .finish(job_id, 0, Some(&err.error), None)
                    .await;
                tracing::error!(
                    job_id = %job_id,
                    source = %job.source,
                    platform = %job.platform,
                    http_status = %status.as_u16(),
                    error = %err.error,
                    "ingest failed"
                );
            }
        }
    });
}

async fn set_job_stage(
    state: &AppState,
    job_id: Option<Uuid>,
    stage: &str,
    detail: &str,
    progress: Option<&IngestJobProgress>,
) {
    let Some(job_id) = job_id else {
        return;
    };
    if let Err(e) = state
        .ingest_jobs
        .update_stage(job_id, stage, detail, progress)
        .await
    {
        tracing::warn!(job_id = %job_id, error = %e, "failed to update ingest job stage");
    }
}

fn parser_summary_detail(report: &BugreportParseReport) -> String {
    let mut detail = format!(
        "Parsed {} MUDM events from {} timeline rows · {} parsers ok, {} failed",
        report.mudm_events,
        report.timeline_events,
        report.parsers_ok(),
        report.parsers_failed()
    );
    if report.magpie_events() > 0 {
        detail.push_str(&format!(
            " · Rusty Magpie: {} process + {} file events",
            report.magpie_process_events, report.magpie_file_events
        ));
    }
    detail
}

fn sysdiagnose_summary_detail(report: &SysdiagnoseParseReport) -> String {
    format!(
        "Parsed {} MUDM events from {} timeline rows · {} parsers ok, {} failed · network IOCs: {}",
        report.mudm_events,
        report.timeline_events,
        report.parsers_ok(),
        report.parsers_failed(),
        report.network_iocs_events
    )
}

fn ingest_build_features_vec() -> Vec<String> {
    mobipwn_ingest::ingest_build_features()
        .iter()
        .map(|s| (*s).to_string())
        .collect()
}

fn logarchive_decode_status(events: &[MudmEvent]) -> Option<String> {
    let decoded = events
        .iter()
        .any(|e| e.parser == "logarchive" && e.action == "logarchive_event");
    let deferred = events
        .iter()
        .any(|e| e.parser == "logarchive" && e.action == "logarchive_inventory");
    if decoded {
        Some("enabled".into())
    } else if deferred {
        Some("deferred".into())
    } else {
        None
    }
}

fn android_ingest_options(
    report: &BugreportParseReport,
    job_id: Option<Uuid>,
) -> IngestJobOptions {
    IngestJobOptions {
        build_features: ingest_build_features_vec(),
        magpie: Some(report.magpie_events() > 0),
        anonymize_profile: load_anonymize_options(job_id)
            .filter(|o| o.enabled)
            .map(|o| o.profile),
        ..Default::default()
    }
}

fn ios_ingest_options(
    cfg: &mobipwn_core::SysdiagnoseIngestConfig,
    events: &[MudmEvent],
    job_id: Option<Uuid>,
) -> IngestJobOptions {
    IngestJobOptions {
        build_features: ingest_build_features_vec(),
        logarchive_decode: logarchive_decode_status(events),
        logarchive_decode_max_lines: Some(cfg.logarchive_decode_max_lines),
        ioservice_full_tree: Some(cfg.ioservice_full_tree),
        logarchive_uncapped: Some(cfg.logarchive_uncapped),
        max_entry_mb: Some(cfg.max_entry_mb),
        anonymize_profile: load_anonymize_options(job_id)
            .filter(|o| o.enabled)
            .map(|o| o.profile),
        ..Default::default()
    }
}

fn progress_with_options(
    mut progress: IngestJobProgress,
    options: IngestJobOptions,
) -> IngestJobProgress {
    progress.options = Some(options);
    progress
}

async fn process_archive_at_path(
    state: &AppState,
    job_id: Option<Uuid>,
    path: &FsPath,
    source: &str,
    platform: &str,
    user: Option<&str>,
    extra_tags: &[String],
) -> Result<(usize, Option<IngestJobProgress>), IngestErr> {
    let mut final_progress: Option<IngestJobProgress> = None;
    let n = match platform {
        "android" => {
            set_job_stage(
                state,
                job_id,
                "parsing",
                "Running bugreport parsers…",
                None,
            )
            .await;
            let (mut events, report) = parse_android_bugreport(path, source)
                .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))?;
            report.log_tracing();
            let progress = progress_with_options(
                report.ingest_progress(),
                android_ingest_options(&report, job_id),
            );
            final_progress = Some(progress.clone());
            set_job_stage(
                state,
                job_id,
                "parsed",
                &parser_summary_detail(&report),
                Some(&progress),
            )
            .await;
            stamp_ingest_tags(&mut events, extra_tags);
            let event_total = events.len();
            set_job_stage(
                state,
                job_id,
                "inserting",
                &format!("Indexing {event_total} events into ClickHouse…"),
                Some(&IngestJobProgress {
                    mudm_events: Some(event_total),
                    ..progress
                }),
            )
            .await;
            let jobs = state.ingest_jobs.clone();
            let insert_job_id = job_id;
            insert_events_with_progress(&state.clickhouse, &events, Some(move |batch, batches, rows| {
                let detail = if batches > 1 {
                    format!("Inserting batch {batch}/{batches} · {rows} events so far")
                } else {
                    format!("Inserting {rows} events into ClickHouse…")
                };
                let progress = IngestJobProgress {
                    batch: Some(batch),
                    batches: Some(batches),
                    rows_inserted: Some(rows),
                    mudm_events: Some(event_total),
                    ..Default::default()
                };
                let Some(job_id) = insert_job_id else {
                    return;
                };
                let jobs = jobs.clone();
                tokio::spawn(async move {
                    let _ = jobs
                        .update_stage(job_id, "inserting", &detail, Some(&progress))
                        .await;
                });
            }))
            .await
            .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        }
        "ios" => {
            let base_cfg = mobipwn_core::load_sysdiagnose_ingest_config(&state.settings)
                .await
                .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let overrides = resolve_sysdiagnose_overrides(state, job_id, source).await;
            if overrides.is_some() {
                tracing::info!(
                    ?job_id,
                    %source,
                    "ios ingest using prior/upload sysdiagnose options"
                );
            }
            let ingest_cfg = mobipwn_core::apply_sysdiagnose_ingest_overrides(
                base_cfg,
                overrides.as_ref(),
            );
            let parse_options = sysdiagnose_parse_options_from_config(&ingest_cfg);
            let archive_options = sysdiagnose_archive_options_from_config(&ingest_cfg);
            let path_buf = path.to_path_buf();
            let source_owned = source.to_string();
            let jobs = state.ingest_jobs.clone();
            let handle = tokio::runtime::Handle::current();
            let progress_job_id = job_id;
            let progress_fn: Option<SysdiagnoseProgressFn> = progress_job_id.map(|id| {
                let jobs = jobs.clone();
                let handle = handle.clone();
                Arc::new(
                    move |stage: &str, detail: &str, progress: Option<IngestJobProgress>| {
                        let jobs = jobs.clone();
                        let stage = stage.to_string();
                        let detail = detail.to_string();
                        let progress = progress.clone();
                        handle.spawn(async move {
                            let _ = jobs
                                .update_stage(id, &stage, &detail, progress.as_ref())
                                .await;
                        });
                    },
                ) as SysdiagnoseProgressFn
            });
            let parse_result = tokio::task::spawn_blocking(move || {
                parse_ios_sysdiagnose(
                    &path_buf,
                    &source_owned,
                    progress_fn,
                    parse_options,
                    archive_options,
                )
            })
            .await
            .map_err(|e| {
                api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("sysdiagnose parse task: {e}"),
                )
            })?
            .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))?;
            let (mut events, report) = parse_result;
            report.log_tracing();
            let progress = progress_with_options(
                report.ingest_progress(),
                ios_ingest_options(&ingest_cfg, &events, job_id),
            );
            final_progress = Some(progress.clone());
            set_job_stage(
                state,
                job_id,
                "parsed",
                &sysdiagnose_summary_detail(&report),
                Some(&progress),
            )
            .await;
            let event_total = events.len();
            stamp_ingest_tags(&mut events, extra_tags);
            set_job_stage(
                state,
                job_id,
                "inserting",
                &format!("Indexing {event_total} events into ClickHouse…"),
                Some(&IngestJobProgress {
                    mudm_events: Some(event_total),
                    ..progress
                }),
            )
            .await;
            let jobs = state.ingest_jobs.clone();
            let insert_job_id = job_id;
            insert_events_with_progress(&state.clickhouse, &events, Some(move |batch, batches, rows| {
                let detail = if batches > 1 {
                    format!("Inserting batch {batch}/{batches} · {rows} events so far")
                } else {
                    format!("Inserting {rows} events into ClickHouse…")
                };
                let progress = IngestJobProgress {
                    batch: Some(batch),
                    batches: Some(batches),
                    rows_inserted: Some(rows),
                    mudm_events: Some(event_total),
                    ..Default::default()
                };
                let Some(job_id) = insert_job_id else {
                    return;
                };
                let jobs = jobs.clone();
                tokio::spawn(async move {
                    let _ = jobs
                        .update_stage(job_id, "inserting", &detail, Some(&progress))
                        .await;
                });
            }))
            .await
            .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        }
        _ => {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                format!("unsupported platform {platform}"),
            ))
        }
    };

    set_job_stage(
        state,
        job_id,
        "verifying",
        "Verifying indexed events in ClickHouse…",
        None,
    )
    .await;
    verify_source_in_clickhouse(&state.config, source, n).await?;
    set_job_stage(
        state,
        job_id,
        "syncing",
        "Linking investigation case and tags…",
        None,
    )
    .await;
    sync_case_after_ingest(state, source, platform, user, extra_tags).await;
    tracing::info!(
        source = %source,
        platform,
        inserted = n,
        user = user.unwrap_or(""),
        "ingest events inserted into ClickHouse"
    );
    crate::detection_hook::spawn_after_ingest_detections(state, source);
    Ok((n, final_progress))
}

pub(crate) async fn verify_source_in_clickhouse(
    config: &AppConfig,
    source: &str,
    inserted: usize,
) -> Result<(), IngestErr> {
    if inserted == 0 {
        return Ok(());
    }
    let ch = mobipwn_core::count_events_by_source(config, source)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if ch == 0 {
        return Err(api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!(
                "insert reported {inserted} events for source={source:?} but ClickHouse has 0 — \
                 run ./scripts/ch-migrate.sh and re-ingest"
            ),
        ));
    }
    Ok(())
}

fn write_temp_file(suffix: &str, body: &Bytes) -> Result<PathBuf, IngestErr> {
    let path = std::env::temp_dir().join(format!("mobipwn_{}_{suffix}", Uuid::now_v7()));
    std::fs::write(&path, body)
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(path)
}

fn hash_file(path: &FsPath) -> anyhow::Result<String> {
    use sha2::Digest;
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = sha2::Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn persist_collect_archive(
    state: &AppState,
    path: &FsPath,
    job_id: Option<Uuid>,
    source: &str,
    platform: &str,
    user: Option<&str>,
    ingest_tags: &[String],
) {
    if platform != "android" && platform != "ios" {
        return;
    }
    if let Some(id) = job_id {
        let _ = state
            .ingest_jobs
            .update_stage(id, "opening", "Storing archive copy…", None)
            .await;
    }
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("archive.bin")
        .to_string();
    let file_size = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
    let file_hash = hash_file(path).unwrap_or_default();
    let origin = if ingest_tags.iter().any(|t| t == "public-collect") {
        "public-collect"
    } else {
        "ingest"
    };
    let meta = NewCollectBlob {
        ingest_job_id: job_id,
        source: source.to_string(),
        platform: platform.to_string(),
        file_name,
        file_hash,
        file_size,
        case_user: user.map(str::to_string),
        ingest_tags: ingest_tags.to_vec(),
        origin: origin.into(),
        analyzed: true,
    };
    match state
        .collect_blobs
        .insert_from_file(path, meta)
        .await
    {
        Ok(blob) => tracing::info!(
            blob_id = %blob.id,
            source = %source,
            platform,
            file_size = blob.file_size,
            "collect archive persisted"
        ),
        Err(e) => tracing::warn!(
            error = %e,
            source = %source,
            platform,
            "failed to persist collect archive"
        ),
    }
}

/// Store raw bytes in blob storage without parsing into ClickHouse.
pub async fn store_collect_blob_bytes(
    state: &AppState,
    body: &Bytes,
    source: &str,
    platform: &str,
    file_name: &str,
    user: Option<&str>,
    ingest_tags: &[String],
    origin: &str,
    analyzed: bool,
) -> Result<CollectBlob, IngestErr> {
    if platform != "android" && platform != "ios" {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "platform must be android or ios",
        ));
    }
    if body.is_empty() {
        return Err(api_error(StatusCode::BAD_REQUEST, "empty body"));
    }
    let safe_name = file_name.trim();
    if safe_name.is_empty() {
        return Err(api_error(StatusCode::BAD_REQUEST, "file_name required"));
    }

    let suffix = safe_name
        .rsplit('.')
        .next()
        .filter(|ext| !ext.is_empty() && safe_name.contains('.'))
        .unwrap_or("bin");
    let path = write_temp_file(suffix, body)?;
    let file_size = body.len() as i64;
    let file_hash = hash_file(&path).unwrap_or_default();
    let meta = NewCollectBlob {
        ingest_job_id: None,
        source: source.to_string(),
        platform: platform.to_string(),
        file_name: safe_name.to_string(),
        file_hash,
        file_size,
        case_user: user.map(str::to_string),
        ingest_tags: ingest_tags.to_vec(),
        origin: origin.to_string(),
        analyzed,
    };
    let blob = state
        .collect_blobs
        .insert_from_file(&path, meta)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let _ = std::fs::remove_file(&path);
    Ok(blob)
}

/// Re-parse a stored collect archive into ClickHouse (bypasses upload dedup).
pub async fn reingest_collect_blob(
    state: &AppState,
    blob_id: Uuid,
    clean: bool,
) -> Result<IngestResultResponse, IngestErr> {
    let blob = state
        .collect_blobs
        .get(blob_id)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "collect archive not found"))?;

    if !std::path::Path::new(&blob.storage_path).exists() {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "archive file missing on disk",
        ));
    }

    let events_cleared = if clean {
        let cleared = mobipwn_core::clear_ingest_events_for_source(&state.config, &blob.source)
            .await
            .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        Some(cleared.events_deleted)
    } else {
        None
    };

    // Capture prior options before mark_running (which clears live progress).
    let prior_job = state
        .ingest_jobs
        .get_by_source_hash(&blob.source, &blob.file_hash)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let prior_ios_overrides = prior_job
        .as_ref()
        .and_then(|j| j.progress.as_ref())
        .and_then(|p| p.options.as_ref())
        .map(|o| o.to_sysdiagnose_overrides())
        .filter(|o| !o.is_empty());

    if let Some(job) = prior_job {
        state
            .ingest_jobs
            .mark_running(job.id)
            .await
            .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    } else {
        // New job row: fall back to last successful ingest options for this source.
        let _ = state
            .ingest_jobs
            .try_start(&blob.source, &blob.platform, &blob.file_hash)
            .await
            .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let job = state
        .ingest_jobs
        .get_by_source_hash(&blob.source, &blob.file_hash)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let job_id = job.as_ref().map(|j| j.id);
    let user = blob.case_user.as_deref();
    let platform = blob.platform.clone();
    let source = blob.source.clone();
    let ingest_tags = blob.ingest_tags.clone();

    if platform == "ios" {
        let overrides = if let Some(o) = prior_ios_overrides {
            Some(o)
        } else {
            resolve_sysdiagnose_overrides(state, job_id, &source).await
        };
        if let (Some(id), Some(ref o)) = (job_id, overrides.filter(|o| !o.is_empty())) {
            write_sysdiagnose_options(id, Some(o))
                .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e))?;
        }
    }

    let (n, final_progress) = process_archive_at_path(
        state,
        job_id,
        FsPath::new(&blob.storage_path),
        &source,
        &platform,
        user,
        &ingest_tags,
    )
    .await?;
    if let Some(j) = job {
        let _ = state
            .ingest_jobs
            .finish(j.id, n as i32, None, final_progress.as_ref())
            .await;
    }
    let _ = state.collect_blobs.mark_analyzed(blob_id).await;
    Ok(IngestResultResponse {
        ingested: n,
        job_id,
        status: Some("done".into()),
        deduplicated: false,
        events_cleared,
        blob_id: Some(blob_id),
    })
}

/// Re-ingest the latest (or selected) stored archive for an investigation case.
pub async fn reingest_case(
    state: &AppState,
    case_id: Uuid,
    clean: bool,
    blob_id: Option<Uuid>,
) -> Result<IngestResultResponse, IngestErr> {
    let case = state
        .cases
        .get(case_id)
        .await
        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "case not found"))?;
    let source = case.ingest_source.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| {
        api_error(
            StatusCode::BAD_REQUEST,
            "case has no ingest source — upload data first",
        )
    })?;

    let target_blob_id = if let Some(id) = blob_id {
        let blob = state
            .collect_blobs
            .get(id)
            .await
            .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "collect archive not found"))?;
        if blob.source != source {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "stored archive source does not match this case",
            ));
        }
        id
    } else {
        let blobs = state
            .collect_blobs
            .list(Some(source), 1)
            .await
            .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let blob = blobs.into_iter().next().ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "no stored archive for this case — upload via Ingest or store a blob first",
            )
        })?;
        blob.id
    };

    reingest_collect_blob(state, target_blob_id, clean).await
}
