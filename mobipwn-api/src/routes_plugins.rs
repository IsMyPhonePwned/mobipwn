use crate::api_error::{api_error, ApiErrorResponse};
use crate::auth::require_permission;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Extension, Json, Router,
};
use mobipwn_core::auth::{AuthContext, Permission};
use mobipwn_core::plugins::{list_plugins, set_plugin_enabled, PluginInfo};
use serde::Deserialize;

type PluginErr = (StatusCode, Json<ApiErrorResponse>);

fn plugin_err(e: impl std::fmt::Display, ctx: &str) -> PluginErr {
    tracing::error!(error = %e, context = ctx, "plugin API error");
    api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("{ctx}: {e}"))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/plugins", get(get_plugins))
        .route("/v1/plugins/{id}", get(get_plugin).put(put_plugin))
}

async fn get_plugins(
    State(state): State<AppState>,
) -> Result<Json<Vec<PluginInfo>>, PluginErr> {
    list_plugins(&state.settings)
        .await
        .map(Json)
        .map_err(|e| plugin_err(e, "list plugins"))
}

async fn get_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PluginInfo>, PluginErr> {
    let plugins = list_plugins(&state.settings)
        .await
        .map_err(|e| plugin_err(e, "list plugins"))?;
    plugins
        .into_iter()
        .find(|p| p.id == id)
        .map(Json)
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, format!("plugin not found: {id}")))
}

#[derive(Debug, Deserialize)]
struct PutPluginBody {
    enabled: bool,
}

async fn put_plugin(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(body): Json<PutPluginBody>,
) -> Result<Json<PluginInfo>, PluginErr> {
    require_permission(&ctx, Permission::SettingsWrite)
        .map_err(|status| api_error(status, "Insufficient permissions"))?;
    set_plugin_enabled(&state.settings, &id, body.enabled)
        .await
        .map_err(|e| {
            if e.to_string().contains("unknown plugin") {
                api_error(StatusCode::NOT_FOUND, e.to_string())
            } else {
                plugin_err(e, "set plugin enabled")
            }
        })?;
    get_plugin(State(state), Path(id)).await
}
