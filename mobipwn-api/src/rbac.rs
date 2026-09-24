use axum::{
    body::Body,
    extract::Extension,
    http::{Method, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use mobipwn_core::auth::{AuthContext, Permission};

use crate::auth::require_permission;

/// Map mutating or sensitive routes to required permissions.
pub fn permission_for_request(method: &Method, path: &str) -> Option<Permission> {
    if path.starts_with("/v1/auth/users") || path.starts_with("/v1/auth/api-keys") {
        return Some(Permission::UsersAdmin);
    }
    if path.starts_with("/v1/settings") {
        return Some(if method == Method::GET {
            Permission::SettingsRead
        } else {
            Permission::SettingsWrite
        });
    }
    if path.starts_with("/v1/alert-siem") {
        return Some(if method == Method::GET {
            Permission::SettingsRead
        } else {
            Permission::SettingsWrite
        });
    }
    if path.starts_with("/v1/plugins") {
        return if *method == Method::GET {
            None
        } else {
            Some(Permission::SettingsWrite)
        };
    }
    if path.starts_with("/v1/mcp/") {
        return Some(if method == Method::GET {
            Permission::SettingsRead
        } else {
            Permission::SettingsWrite
        });
    }
    if path.starts_with("/v1/suppressions") || path.starts_with("/v1/notifications") {
        return Some(if method == Method::GET {
            Permission::SettingsRead
        } else {
            Permission::NotificationsWrite
        });
    }
    if path.starts_with("/v1/data/") {
        return Some(if *method == Method::GET {
            Permission::SearchRun
        } else {
            Permission::DataAdmin
        });
    }
    if path.starts_with("/v1/backup/") {
        return Some(if *method == Method::GET {
            Permission::SettingsRead
        } else {
            Permission::DataAdmin
        });
    }
    if path.starts_with("/v1/llm/") {
        return Some(Permission::LlmUse);
    }
    if path.starts_with("/v1/collect/blobs") {
        return Some(if *method == Method::GET {
            Permission::CasesRead
        } else {
            Permission::IngestWrite
        });
    }
    if path.starts_with("/v1/ingest/") {
        return Some(Permission::IngestWrite);
    }
    if path.starts_with("/v1/rules") || path.starts_with("/v1/rule-org") {
        if method == Method::GET {
            return Some(Permission::RulesRead);
        }
        if path.contains("/validate") {
            return Some(Permission::RulesRead);
        }
        return Some(Permission::RulesWrite);
    }
    if path.starts_with("/v1/alerts") {
        return Some(if method == Method::GET {
            Permission::AlertsRead
        } else {
            Permission::AlertsWrite
        });
    }
    if path.starts_with("/v1/cases") {
        return Some(if method == Method::GET {
            Permission::CasesRead
        } else {
            Permission::CasesWrite
        });
    }
    if path.starts_with("/v1/dashboards") {
        return Some(if method == Method::GET {
            Permission::DashboardsRead
        } else {
            Permission::DashboardsWrite
        });
    }
    if path.starts_with("/v1/saved-quer") || path.starts_with("/v1/search/history") {
        return Some(if method == Method::GET {
            Permission::SearchRun
        } else {
            Permission::SavedQueriesWrite
        });
    }
    if path.starts_with("/v1/marketplace") {
        return Some(if method == Method::GET {
            Permission::MarketplaceRead
        } else {
            Permission::MarketplaceWrite
        });
    }
    if path.starts_with("/v1/search/export") {
        return Some(Permission::SearchExport);
    }
    if path.starts_with("/v1/search") || path.starts_with("/v1/prevalence") || path.starts_with("/v1/mudm") {
        return Some(Permission::SearchRun);
    }
    if path.starts_with("/v1/case-comparison") || path.starts_with("/v1/bugreport-comparison") {
        return Some(Permission::CasesRead);
    }
    if path.starts_with("/v1/health") {
        return Some(Permission::HealthRead);
    }
    if path.starts_with("/v1/overview") {
        return Some(Permission::SearchRun);
    }
    None
}

pub async fn enforce_rbac(
    Extension(ctx): Extension<AuthContext>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let Some(perm) = permission_for_request(req.method(), req.uri().path()) else {
        return next.run(req).await;
    };
    if require_permission(&ctx, perm).is_ok() {
        next.run(req).await
    } else {
        (StatusCode::FORBIDDEN, "insufficient permissions").into_response()
    }
}
