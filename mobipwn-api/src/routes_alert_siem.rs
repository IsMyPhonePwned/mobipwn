use crate::api_error::{api_error, ApiErrorResponse};
use crate::auth::require_permission;
use crate::AppState;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use mobipwn_core::auth::{AuthContext, Permission};
use mobipwn_core::{
    config_public, is_plugin_enabled, load_alert_to_siem_config, save_alert_to_siem_config,
    test_siem_connection, AlertSiemForwardLogRepository, AlertToSiemConfig, AlertToSiemConfigPublic,
    ALERT_TO_SIEM_PLUGIN_ID,
};
use serde::Deserialize;

type SiemErr = (StatusCode, Json<ApiErrorResponse>);

fn siem_err(e: impl std::fmt::Display, ctx: &str) -> SiemErr {
    tracing::error!(error = %e, context = ctx, "AlertToSiem API error");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("{ctx}: {e}. Restart mobipwn-api if migrations were just added."),
    )
}

fn require_siem_read(ctx: &AuthContext) -> Result<(), SiemErr> {
    require_permission(ctx, Permission::SettingsRead)
        .map_err(|status| api_error(status, "Insufficient permissions"))
}

fn require_siem_write(ctx: &AuthContext) -> Result<(), SiemErr> {
    require_permission(ctx, Permission::SettingsWrite)
        .map_err(|status| api_error(status, "Insufficient permissions"))
}

async fn ensure_plugin_enabled(state: &AppState) -> Result<(), SiemErr> {
    let enabled = is_plugin_enabled(&state.settings, ALERT_TO_SIEM_PLUGIN_ID)
        .await
        .map_err(|e| siem_err(e, "check plugin"))?;
    if !enabled {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AlertToSiem plugin is disabled — enable it under Settings → Plugins",
        ));
    }
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/alert-siem/config", get(get_config).put(put_config))
        .route("/v1/alert-siem/test", post(post_test))
        .route("/v1/alert-siem/logs", get(get_logs))
}

async fn get_config(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<AlertToSiemConfigPublic>, SiemErr> {
    require_siem_read(&auth)?;
    ensure_plugin_enabled(&state).await?;
    let cfg = load_alert_to_siem_config(&state.settings)
        .await
        .map_err(|e| siem_err(e, "load config"))?;
    Ok(Json(config_public(&cfg)))
}

async fn put_config(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<AlertToSiemConfig>,
) -> Result<Json<AlertToSiemConfigPublic>, SiemErr> {
    require_siem_write(&auth)?;
    ensure_plugin_enabled(&state).await?;
    save_alert_to_siem_config(&state.settings, &body)
        .await
        .map_err(|e| siem_err(e, "save config"))?;
    let cfg = load_alert_to_siem_config(&state.settings)
        .await
        .map_err(|e| siem_err(e, "reload config"))?;
    Ok(Json(config_public(&cfg)))
}

async fn post_test(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<serde_json::Value>, SiemErr> {
    require_siem_write(&auth)?;
    ensure_plugin_enabled(&state).await?;
    let cfg = load_alert_to_siem_config(&state.settings)
        .await
        .map_err(|e| siem_err(e, "load config"))?;
    let outcome = test_siem_connection(&state.pool.postgres, &cfg)
        .await
        .map_err(|e| siem_err(e, "test connection"))?;
    if outcome.ok {
        Ok(Json(serde_json::json!({
            "ok": true,
            "message": "Test event accepted by SIEM",
            "http_status": outcome.http_status,
        })))
    } else {
        Err(api_error(
            StatusCode::BAD_GATEWAY,
            outcome
                .error
                .unwrap_or_else(|| "SIEM test failed".into()),
        ))
    }
}

#[derive(Debug, Deserialize)]
struct LogsQuery {
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    100
}

async fn get_logs(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Query(q): Query<LogsQuery>,
) -> Result<Json<Vec<mobipwn_core::AlertSiemForwardLog>>, SiemErr> {
    require_siem_read(&auth)?;
    ensure_plugin_enabled(&state).await?;
    let repo = AlertSiemForwardLogRepository::new(state.pool.postgres.clone());
    let rows = repo
        .list_recent(q.limit)
        .await
        .map_err(|e| siem_err(e, "list forward logs"))?;
    Ok(Json(rows))
}
