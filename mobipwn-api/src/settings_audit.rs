use axum::{
    body::Body,
    extract::State,
    http::{Method, Request},
    middleware::Next,
    response::Response,
};
use mobipwn_core::auth::AuthContext;
use std::sync::Arc;

use crate::auth::AuthState;

/// Paths touched from the Settings UI (and related admin APIs) that should appear in audit logs.
pub fn is_settings_audit_path(path: &str) -> bool {
    path.starts_with("/v1/settings")
        || path.starts_with("/v1/suppressions")
        || path.starts_with("/v1/notifications")
        || path.starts_with("/v1/mcp/")
        || path.starts_with("/v1/auth/users")
        || path.starts_with("/v1/auth/api-keys")
        || path.starts_with("/v1/auth/totp")
        || path == "/v1/auth/me"
}

pub fn describe_settings_action(method: &Method, path: &str) -> String {
    if path.starts_with("/v1/settings/") {
        let key = path.strip_prefix("/v1/settings/").unwrap_or(path);
        return if *method == Method::GET {
            format!("read setting: {key}")
        } else {
            format!("update setting: {key}")
        };
    }
    if path == "/v1/suppressions" {
        return if *method == Method::GET {
            "list maintenance windows".into()
        } else {
            "create maintenance window".into()
        };
    }
    if path.starts_with("/v1/suppressions/") {
        return "delete maintenance window".into();
    }
    if path == "/v1/notifications/channels" {
        return if *method == Method::GET {
            "list webhook channels".into()
        } else {
            "create webhook channel".into()
        };
    }
    if path == "/v1/mcp/status" {
        return "read MCP status".into();
    }
    if path == "/v1/mcp/start" {
        return "start MCP server".into();
    }
    if path == "/v1/mcp/stop" {
        return "stop MCP server".into();
    }
    if path == "/v1/mcp/restart" {
        return "restart MCP server".into();
    }
    if path == "/v1/auth/me" {
        return "read account profile".into();
    }
    if path == "/v1/auth/users/directory" {
        return "list user directory".into();
    }
    if path == "/v1/auth/users" {
        return if *method == Method::GET {
            "list users".into()
        } else {
            "create user".into()
        };
    }
    if path.starts_with("/v1/auth/users/") {
        return if *method == Method::DELETE {
            "delete user".into()
        } else {
            "update user".into()
        };
    }
    if path == "/v1/auth/api-keys/mine" {
        return "list my API keys".into();
    }
    if path == "/v1/auth/api-keys/usage-by-user" {
        return "list API key usage by user".into();
    }
    if path == "/v1/auth/api-keys" {
        return if *method == Method::GET {
            "list API keys".into()
        } else {
            "create API key".into()
        };
    }
    if path.ends_with("/reveal") {
        return "reveal API key token".into();
    }
    if path.ends_with("/suspend") {
        return if path.contains("/suspend-user/") {
            "suspend all API keys for user".into()
        } else {
            "suspend API key".into()
        };
    }
    if path.ends_with("/unsuspend") {
        return "unsuspend API key".into();
    }
    if path.starts_with("/v1/auth/api-keys/") {
        return "revoke API key".into();
    }
    if path == "/v1/auth/totp/setup" {
        return "start MFA setup".into();
    }
    if path == "/v1/auth/totp/enable" {
        return "enable MFA".into();
    }
    if path == "/v1/auth/totp/disable" {
        return "disable MFA".into();
    }
    format!("{} {}", method.as_str(), path)
}

pub fn emit_settings_audit(ctx: &AuthContext, action: &str, method: &Method, path: &str, status: u16) {
    let actor = ctx
        .user_username
        .as_deref()
        .or(ctx.key_name.as_deref())
        .unwrap_or("anonymous");
    tracing::info!(
        event = "settings_audit",
        actor = actor,
        actor_user_id = ?ctx.user_id,
        api_key_id = ?ctx.key_id,
        action = action,
        %method,
        path,
        status,
        "settings audit"
    );
}

/// Log every Settings-related API read and write with actor identity.
pub async fn log_settings_audit(
    State(_auth): State<Arc<AuthState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let ctx = req.extensions().get::<AuthContext>().cloned();

    let response = next.run(req).await;
    let status = response.status().as_u16();

    if is_settings_audit_path(&path) {
        if let Some(ctx) = ctx {
            let action = describe_settings_action(&method, &path);
            emit_settings_audit(&ctx, &action, &method, &path, status);
        }
    }

    response
}
