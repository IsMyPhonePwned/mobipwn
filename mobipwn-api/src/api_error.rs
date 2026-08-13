use axum::{http::StatusCode, Json};
use serde::Serialize;

#[derive(Serialize)]
pub struct ApiErrorResponse {
    pub error: String,
}

pub fn api_error(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<ApiErrorResponse>) {
    (
        status,
        Json(ApiErrorResponse {
            error: msg.into(),
        }),
    )
}
