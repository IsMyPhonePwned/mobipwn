use axum::{
    body::Body,
    extract::State,
    http::{header, Method, Request},
    middleware::Next,
    response::Response,
};
use mobipwn_core::auth::{insert_platform_audit, AuthContext, PlatformAuditInput};
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
        || path.starts_with("/v1/auth/webauthn")
        || path == "/v1/auth/me"
        || path == "/v1/auth/logout"
}

/// High-value mutating APIs beyond Settings (rules, cases, ingest, backup, …).
pub fn is_action_audit_mutation_path(path: &str) -> bool {
    path.starts_with("/v1/rules")
        || path.starts_with("/v1/alerts")
        || path.starts_with("/v1/cases")
        || path.starts_with("/v1/ingest")
        || path.starts_with("/v1/data/")
        || path.starts_with("/v1/backup")
        || path.starts_with("/v1/marketplace")
        || path.starts_with("/v1/saved-queries")
        || path.starts_with("/v1/dashboards")
        || path.starts_with("/v1/plugins")
}

fn is_sensitive_read(path: &str) -> bool {
    path.ends_with("/reveal")
        || path == "/v1/auth/users"
        || path == "/v1/auth/users/directory"
        || path.starts_with("/v1/auth/api-keys")
        || path == "/v1/auth/webauthn/credentials"
        || path == "/v1/settings/webauthn_config"
        || path == "/v1/settings/llm_config"
        || path == "/v1/settings/mcp_config"
}

/// Whether this request should be persisted to `platform_audit_events`.
pub fn should_persist_action_audit(method: &Method, path: &str) -> bool {
    if is_settings_audit_path(path) {
        return *method != Method::GET || is_sensitive_read(path);
    }
    matches!(*method, Method::POST | Method::PUT | Method::PATCH | Method::DELETE)
        && is_action_audit_mutation_path(path)
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
    if path == "/v1/auth/logout" {
        return "sign out".into();
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
    if path == "/v1/auth/webauthn/register/start" {
        return "start security key registration".into();
    }
    if path == "/v1/auth/webauthn/register/finish" {
        return "register security key".into();
    }
    if path == "/v1/auth/webauthn/credentials" {
        return "list security keys".into();
    }
    if path.starts_with("/v1/auth/webauthn/credentials/") {
        return "remove security key".into();
    }
    if path.contains("/run") && path.starts_with("/v1/rules/") {
        return "run detection rule".into();
    }
    if path.starts_with("/v1/rules") {
        return match *method {
            Method::DELETE => "delete detection rule".into(),
            Method::GET => "read detection rules".into(),
            _ => "save detection rule".into(),
        };
    }
    if path.starts_with("/v1/alerts") {
        return match *method {
            Method::DELETE => "delete alert(s)".into(),
            Method::PATCH | Method::PUT => "update alert".into(),
            Method::POST => "create / act on alert".into(),
            _ => format!("{} {}", method.as_str(), path),
        };
    }
    if path.starts_with("/v1/cases") {
        return match *method {
            Method::DELETE => "delete case".into(),
            Method::PATCH | Method::PUT => "update case".into(),
            Method::POST => "create / act on case".into(),
            _ => format!("{} {}", method.as_str(), path),
        };
    }
    if path.starts_with("/v1/ingest") {
        return "ingest action".into();
    }
    if path.starts_with("/v1/data/") {
        return "data management action".into();
    }
    if path.starts_with("/v1/backup") {
        return "backup action".into();
    }
    if path.starts_with("/v1/marketplace") {
        return "marketplace action".into();
    }
    if path.starts_with("/v1/saved-queries") {
        return "saved query action".into();
    }
    if path.starts_with("/v1/dashboards") {
        return "dashboard action".into();
    }
    if path.starts_with("/v1/plugins") {
        return "plugin action".into();
    }
    format!("{} {}", method.as_str(), path)
}

fn header_str<'a>(req: &'a Request<Body>, name: &'static str) -> Option<&'a str> {
    req.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

pub fn client_ip_from_request(req: &Request<Body>) -> Option<String> {
    header_str(req, "x-forwarded-for")
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| header_str(req, "x-real-ip").map(str::to_string))
}

pub fn user_agent_from_request(req: &Request<Body>) -> Option<String> {
    header_str(req, header::USER_AGENT.as_str()).map(|s| s.chars().take(512).collect())
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

/// Auth / MFA events on public routes (no session yet) for admin inspection in API logs.
pub fn emit_auth_audit(actor: &str, action: &str, path: &str, status: u16, detail: Option<&str>) {
    tracing::info!(
        event = "auth_audit",
        actor = actor,
        action = action,
        path = path,
        status = status,
        detail = detail.unwrap_or(""),
        "auth audit"
    );
}

/// Persist + log an authentication / MFA event (login, YubiKey, TOTP).
pub async fn record_auth_audit(
    pool: &sqlx::PgPool,
    actor: &str,
    action: &str,
    path: &str,
    status: u16,
    detail: Option<&str>,
    client_ip: Option<&str>,
    user_agent: Option<&str>,
) {
    emit_auth_audit(actor, action, path, status, detail);
    if let Err(e) = insert_platform_audit(
        pool,
        PlatformAuditInput {
            actor,
            actor_user_id: None,
            api_key_id: None,
            action,
            method: "POST",
            path,
            status,
            detail,
            client_ip,
            user_agent,
        },
    )
    .await
    {
        tracing::warn!(error = %e, action, path, "failed to persist auth audit");
    }
}

/// Log every Settings-related / high-value API action with actor identity (tracing + Postgres).
pub async fn log_settings_audit(
    State(auth): State<Arc<AuthState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let ctx = req.extensions().get::<AuthContext>().cloned();
    let client_ip = client_ip_from_request(&req);
    let user_agent = user_agent_from_request(&req);

    let response = next.run(req).await;
    let status = response.status().as_u16();

    if should_persist_action_audit(&method, &path) {
        if let Some(ctx) = ctx {
            let action = describe_settings_action(&method, &path);
            emit_settings_audit(&ctx, &action, &method, &path, status);
            let actor = ctx
                .user_username
                .as_deref()
                .or(ctx.key_name.as_deref())
                .unwrap_or("anonymous");
            if let Err(e) = insert_platform_audit(
                &auth.pool,
                PlatformAuditInput {
                    actor,
                    actor_user_id: ctx.user_id,
                    api_key_id: ctx.key_id,
                    action: &action,
                    method: method.as_str(),
                    path: &path,
                    status,
                    detail: None,
                    client_ip: client_ip.as_deref(),
                    user_agent: user_agent.as_deref(),
                },
            )
            .await
            {
                tracing::warn!(error = %e, action, path, "failed to persist action audit");
            }
        }
    }

    response
}
