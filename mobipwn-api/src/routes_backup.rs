use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Extension, Json, Router,
};
use mobipwn_core::auth::{AuthContext, Permission};
use crate::auth::require_permission;
use mobipwn_core::{
    export_backup, import_backup, list_section_info, parse_section_ids, BackupBundle, ImportMode,
};
use serde::{Deserialize, Serialize};

use crate::api_error::{api_error, ApiErrorResponse};
use crate::routes_rules_ext::sync_rule_realtime_mv;
use crate::AppState;

type BackupErr = (StatusCode, Json<ApiErrorResponse>);

const IMPORT_BODY_LIMIT: usize = 512 * 1024 * 1024;

fn backup_err(e: impl std::fmt::Display, ctx: &str) -> BackupErr {
    api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("{ctx}: {e}"))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/backup/sections", get(list_sections))
        .route("/v1/backup/export", post(export_dump))
        .route(
            "/v1/backup/import",
            post(import_dump).layer(DefaultBodyLimit::max(IMPORT_BODY_LIMIT)),
        )
}

async fn list_sections(
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<Vec<mobipwn_core::BackupSectionInfo>>, BackupErr> {
    require_permission(&ctx, Permission::SettingsRead)
        .map_err(|s| api_error(s, "settings read required to list backup sections"))?;
    Ok(Json(list_section_info()))
}

#[derive(Debug, Deserialize)]
struct ExportBackupRequest {
    sections: Vec<String>,
}

async fn export_dump(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<ExportBackupRequest>,
) -> Result<impl IntoResponse, BackupErr> {
    require_permission(&ctx, Permission::DataAdmin)
        .map_err(|s| api_error(s, "data admin required"))?;
    let sections = parse_section_ids(&body.sections)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))?;
    if sections.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "select at least one section to export",
        ));
    }
    let bundle = export_backup(&state.pool, &state.config, &sections)
        .await
        .map_err(|e| backup_err(e, "export backup"))?;
    let filename = format!(
        "mobipwn-backup-{}.json",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    );
    let body = serde_json::to_string_pretty(&bundle)
        .map_err(|e| backup_err(e, "serialize backup"))?;
    let disposition = format!("attachment; filename=\"{filename}\"");
    Ok((
        [
            (header::CONTENT_TYPE, "application/json".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        body,
    ))
}

#[derive(Debug, Deserialize)]
struct ImportBackupRequest {
    bundle: BackupBundle,
    sections: Vec<String>,
    #[serde(default)]
    mode: ImportMode,
}

async fn import_dump(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<ImportBackupRequest>,
) -> Result<Json<mobipwn_core::ImportBackupResult>, BackupErr> {
    require_permission(&ctx, Permission::DataAdmin)
        .map_err(|s| api_error(s, "data admin required"))?;
    let sections = parse_section_ids(&body.sections)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))?;
    if sections.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "select at least one section to import",
        ));
    }

    let result = import_backup(
        &state.pool,
        &state.config,
        &body.bundle,
        &sections,
        body.mode,
    )
    .await
    .map_err(|e| backup_err(e, "import backup"))?;

    if sections.iter().any(|s| *s == mobipwn_core::BackupSection::Rules) {
        if let Ok(rules) = state.rules.list().await {
            for rule in rules {
                if rule.enabled && rule.realtime_mv.is_some() {
                    let _ = sync_rule_realtime_mv(&state, &rule).await;
                }
            }
        }
    }

    Ok(Json(result))
}
