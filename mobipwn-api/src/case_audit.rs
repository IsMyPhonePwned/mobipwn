use crate::AppState;
use mobipwn_core::auth::{get_by_id, AuthContext};
use mobipwn_core::{
    emit_case_audit, CaseAuditAction, CaseAuditActor, CaseAuditExtras, CaseRecord,
};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn resolve_audit_actor(pool: &PgPool, ctx: &AuthContext) -> CaseAuditActor {
    if let Some(user_id) = ctx.user_id {
        if let Ok(Some(user)) = get_by_id(pool, user_id).await {
            return CaseAuditActor {
                id: Some(user.id),
                name: user.username,
            };
        }
    }
    if let Some(name) = &ctx.key_name {
        if ctx.user_id.is_none() {
            return CaseAuditActor {
                id: ctx.key_id,
                name: format!("api:{name}"),
            };
        }
    }
    if let Some(key_id) = ctx.key_id {
        let name: Option<String> = sqlx::query_scalar(
            "SELECT name FROM api_keys WHERE id = $1 AND revoked_at IS NULL",
        )
        .bind(key_id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
        if let Some(name) = name {
            return CaseAuditActor {
                id: Some(key_id),
                name: format!("api:{name}"),
            };
        }
    }
    CaseAuditActor::system()
}

pub async fn resolve_maintainer_filter(
    pool: &PgPool,
    ctx: &AuthContext,
    maintainer: Option<&str>,
) -> Option<String> {
    match maintainer.map(str::trim).filter(|s| !s.is_empty()) {
        Some("me") | Some("@me") => Some(resolve_audit_actor(pool, ctx).await.name),
        Some(s) => Some(s.to_string()),
        None => None,
    }
}

pub async fn build_rule_list_filter(
    pool: &PgPool,
    ctx: &AuthContext,
    repository_id: Option<Uuid>,
    folder_id: Option<Uuid>,
    tag: Option<String>,
    maintainer: Option<&str>,
) -> mobipwn_core::store::RuleListFilter {
    mobipwn_core::store::RuleListFilter {
        repository_id,
        folder_id,
        tag,
        maintainer: resolve_maintainer_filter(pool, ctx, maintainer).await,
    }
}

pub async fn build_alert_list_filter(
    pool: &PgPool,
    ctx: &AuthContext,
    status: Option<&str>,
    dismissed: Option<&str>,
    case_id: Option<Uuid>,
    assignee: Option<&str>,
) -> mobipwn_core::alerts::AlertListFilter {
    let resolved_assignee = match assignee.map(str::trim).filter(|s| !s.is_empty()) {
        Some("me") | Some("@me") => Some(resolve_audit_actor(pool, ctx).await.name),
        Some(s) => Some(s.to_string()),
        None => None,
    };
    mobipwn_core::alerts::AlertListFilter {
        status: status.and_then(mobipwn_core::alerts::parse_status_filter),
        dismissed: mobipwn_core::alerts::DismissedFilter::parse(dismissed),
        case_id,
        assignee: resolved_assignee,
    }
}

/// Username for alert_events / activity log (prefers session user over legacy `"analyst"` default).
pub async fn resolve_alert_author(
    pool: &PgPool,
    ctx: &AuthContext,
    explicit: Option<&str>,
) -> String {
    if let Some(name) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
        return name.to_string();
    }
    resolve_audit_actor(pool, ctx).await.name
}

pub async fn audit_case(
    state: &AppState,
    case: &CaseRecord,
    action: CaseAuditAction,
    actor: &CaseAuditActor,
    extras: CaseAuditExtras,
) {
    if let Err(e) = emit_case_audit(&state.clickhouse, case, action, actor, extras).await {
        tracing::warn!(
            case_id = %case.id,
            action = action.as_str(),
            error = %e,
            "failed to emit case audit event"
        );
    }
}

pub async fn audit_case_created(
    state: &AppState,
    case: &CaseRecord,
    actor: &CaseAuditActor,
    grouping_type: Option<&str>,
) {
    audit_case(
        state,
        case,
        CaseAuditAction::Created,
        actor,
        CaseAuditExtras {
            grouping_type: grouping_type.map(str::to_string),
            ..Default::default()
        },
    )
    .await;
}

pub async fn audit_case_patch(
    state: &AppState,
    before: &CaseRecord,
    after: &CaseRecord,
    actor: &CaseAuditActor,
) {
    if before.status != after.status {
        let action = if after.status == "closed" {
            CaseAuditAction::Closed
        } else if before.status == "closed" {
            CaseAuditAction::Reopened
        } else {
            CaseAuditAction::StatusChanged
        };
        audit_case(
            state,
            after,
            action,
            actor,
            CaseAuditExtras {
                previous_status: Some(before.status.clone()),
                ..Default::default()
            },
        )
        .await;
    }
    if before.priority != after.priority {
        audit_case(
            state,
            after,
            CaseAuditAction::SeverityChanged,
            actor,
            CaseAuditExtras {
                previous_status: Some(before.priority.clone()),
                ..Default::default()
            },
        )
        .await;
    }
}

pub async fn audit_ingest_case_created(state: &AppState, case: &CaseRecord) {
    audit_case_created(state, case, &CaseAuditActor::system(), Some("ingest")).await;
}

pub async fn audit_alert_link(
    state: &AppState,
    case: &CaseRecord,
    alert_id: Uuid,
    actor: &CaseAuditActor,
    added: bool,
) {
    let action = if added {
        CaseAuditAction::AlertAdded
    } else {
        CaseAuditAction::AlertRemoved
    };
    audit_case(
        state,
        case,
        action,
        actor,
        CaseAuditExtras {
            alert_id: Some(alert_id),
            ..Default::default()
        },
    )
    .await;
}
