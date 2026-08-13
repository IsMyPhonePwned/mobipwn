//! Public status for the Device Advanced plugin (iphone/android advanced pages).

use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use mobipwn_core::{is_plugin_enabled, DEVICE_ADVANCED_PLUGIN_ID};
use serde::Serialize;

use crate::AppState;

#[derive(Serialize)]
pub struct DeviceAdvancedStatus {
    pub enabled: bool,
}

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/v1/public/device-advanced/status",
        get(device_advanced_status),
    )
}

async fn device_advanced_status(
    State(state): State<AppState>,
) -> Result<Json<DeviceAdvancedStatus>, StatusCode> {
    let enabled = is_plugin_enabled(&state.settings, DEVICE_ADVANCED_PLUGIN_ID)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(DeviceAdvancedStatus { enabled }))
}
