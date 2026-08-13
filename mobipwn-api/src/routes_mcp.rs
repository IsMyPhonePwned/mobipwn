use crate::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use mobipwn_core::{McpConfig, McpStatus};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/mcp/status", get(mcp_status))
        .route("/v1/mcp/start", post(mcp_start))
        .route("/v1/mcp/stop", post(mcp_stop))
        .route("/v1/mcp/restart", post(mcp_restart))
}

async fn mcp_status(State(state): State<AppState>) -> Result<Json<McpStatus>, StatusCode> {
    state
        .mcp
        .status()
        .await
        .map(Json)
        .map_err(|e| {
            tracing::error!(error = %e, "mcp status");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

async fn mcp_start(State(state): State<AppState>) -> Result<Json<McpStatus>, (StatusCode, String)> {
    state.mcp.start().await.map(Json).map_err(|e| {
        tracing::warn!(error = %e, "mcp start");
        (StatusCode::BAD_REQUEST, e.to_string())
    })
}

async fn mcp_stop(State(state): State<AppState>) -> Result<Json<McpStatus>, StatusCode> {
    state
        .mcp
        .stop()
        .await
        .map(Json)
        .map_err(|e| {
            tracing::error!(error = %e, "mcp stop");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

async fn mcp_restart(State(state): State<AppState>) -> Result<Json<McpStatus>, (StatusCode, String)> {
    state
        .mcp
        .stop()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    state.mcp.start().await.map(Json).map_err(|e| {
        tracing::warn!(error = %e, "mcp restart");
        (StatusCode::BAD_REQUEST, e.to_string())
    })
}

pub async fn save_mcp_setting(state: &AppState, body: serde_json::Value) -> Result<(), StatusCode> {
    let incoming: McpConfig = serde_json::from_value(body).map_err(|_| StatusCode::BAD_REQUEST)?;
    state
        .mcp
        .save_config_and_apply(&incoming)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "save mcp_config");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(())
}
