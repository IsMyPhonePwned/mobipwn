use axum::{
    body::Body,
    extract::State,
    http::{header, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use http_body_util::BodyExt;
use mobipwn_core::auth::{touch_api_key_usage, verify_api_key, verify_session, ApiRole, AuthContext, Permission};
use mobipwn_core::config::AppConfig;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AuthState {
    pub pool: PgPool,
    pub config: AppConfig,
}

fn client_ip(req: &Request<Body>) -> Option<String> {
    req.headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            req.headers()
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
}

fn content_length_from_headers(headers: &header::HeaderMap) -> Option<u64> {
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
}

fn is_streaming_response(headers: &header::HeaderMap) -> bool {
    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    ct.contains("application/x-ndjson") || ct.contains("text/event-stream")
}

/// Response size for usage stats. JSON handlers usually omit Content-Length; buffer those bodies.
async fn measure_response_bytes(response: Response) -> (Response, u64) {
    let (parts, body) = response.into_parts();
    if let Some(len) = content_length_from_headers(&parts.headers) {
        return (Response::from_parts(parts, body), len);
    }
    if is_streaming_response(&parts.headers) {
        return (Response::from_parts(parts, body), 0);
    }
    match body.collect().await {
        Ok(buf) => {
            let bytes = buf.to_bytes();
            let len = bytes.len() as u64;
            (Response::from_parts(parts, Body::from(bytes)), len)
        }
        Err(_) => (Response::from_parts(parts, Body::empty()), 0),
    }
}

pub async fn require_auth(
    State(auth): State<Arc<AuthState>>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    if !auth.config.require_auth {
        req.extensions_mut().insert(AuthContext {
            role: ApiRole::Admin,
            key_id: None,
            key_name: None,
            user_id: None,
            user_username: None,
        });
        return next.run(req).await;
    }

    let token = req
        .headers()
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .or_else(|| {
            req.headers()
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.strip_prefix("Bearer "))
        });

    let Some(token) = token else {
        return (StatusCode::UNAUTHORIZED, "missing credentials").into_response();
    };

    if let Ok(Some(ctx)) = verify_api_key(&auth.pool, token).await {
        req.extensions_mut().insert(ctx);
        return next.run(req).await;
    }

    if let Ok(Some(ctx)) = verify_session(&auth.pool, token).await {
        req.extensions_mut().insert(ctx);
        return next.run(req).await;
    }

    (StatusCode::UNAUTHORIZED, "invalid credentials").into_response()
}

/// Log API-key traffic with linked user identity and update per-key usage counters.
pub async fn log_api_key_usage(
    State(auth): State<Arc<AuthState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let ctx = req.extensions().get::<AuthContext>().cloned();
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let ip = client_ip(&req);

    let response = next.run(req).await;
    let status = response.status().as_u16();
    let (response, bytes) = measure_response_bytes(response).await;

    if let Some(ctx) = ctx {
        if let Some(key_id) = ctx.key_id {
            let user_label = ctx
                .user_username
                .as_deref()
                .or(ctx.user_id.as_ref().map(|_| "(linked user)"))
                .unwrap_or("-");
            tracing::info!(
                api_key_id = %key_id,
                api_key_name = ctx.key_name.as_deref().unwrap_or("?"),
                user_id = ?ctx.user_id,
                user = user_label,
                %method,
                path = %path,
                status,
                response_bytes = bytes,
                client_ip = ip.as_deref().unwrap_or("-"),
                "api key request"
            );
            let pool = auth.pool.clone();
            tokio::spawn(async move {
                let _ = touch_api_key_usage(&pool, key_id, ip.as_deref(), bytes).await;
            });
        }
    }

    response
}

pub fn require_permission(ctx: &AuthContext, perm: Permission) -> Result<(), StatusCode> {
    if ctx.role.has(perm) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}
