use crate::case_audit::resolve_audit_actor;
use crate::AppState;
use mobipwn_core::auth::AuthContext;
use mobipwn_core::DeleteAuditInput;
use uuid::Uuid;

pub async fn audited_delete_many(
    state: &AppState,
    ctx: &AuthContext,
    ids: &[Uuid],
    author: Option<&str>,
    reason: Option<&str>,
) -> anyhow::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let deleted_by = if let Some(a) = author.filter(|s| !s.is_empty()) {
        a.to_string()
    } else {
        resolve_audit_actor(&state.pool.postgres, ctx).await.name
    };
    let input = DeleteAuditInput {
        deleted_by,
        reason: reason.map(str::to_string),
        batch_id: if ids.len() > 1 {
            Some(Uuid::now_v7())
        } else {
            None
        },
    };
    state
        .alert_deletion_audit
        .delete_alerts_with_audit(&state.alerts, &state.alert_events, ids, &input)
        .await
}
