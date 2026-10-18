use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct PlatformAuditEvent {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub actor: String,
    pub actor_user_id: Option<Uuid>,
    pub api_key_id: Option<Uuid>,
    pub action: String,
    pub method: String,
    pub path: String,
    pub status: i16,
    pub detail: Option<String>,
    pub client_ip: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PlatformAuditInput<'a> {
    pub actor: &'a str,
    pub actor_user_id: Option<Uuid>,
    pub api_key_id: Option<Uuid>,
    pub action: &'a str,
    pub method: &'a str,
    pub path: &'a str,
    pub status: u16,
    pub detail: Option<&'a str>,
    pub client_ip: Option<&'a str>,
    pub user_agent: Option<&'a str>,
}

/// Persist a platform audit row. Failures are logged by the caller; this returns the DB error.
pub async fn insert_platform_audit(pool: &PgPool, input: PlatformAuditInput<'_>) -> anyhow::Result<()> {
    let actor = input.actor.trim();
    let actor = if actor.is_empty() { "anonymous" } else { actor };
    let status = i16::try_from(input.status).unwrap_or(i16::MAX);
    sqlx::query(
        "INSERT INTO platform_audit_events \
         (actor, actor_user_id, api_key_id, action, method, path, status, detail, client_ip, user_agent) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(actor)
    .bind(input.actor_user_id)
    .bind(input.api_key_id)
    .bind(input.action)
    .bind(input.method)
    .bind(input.path)
    .bind(status)
    .bind(input.detail)
    .bind(input.client_ip)
    .bind(input.user_agent)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_platform_audit(
    pool: &PgPool,
    limit: i64,
) -> anyhow::Result<Vec<PlatformAuditEvent>> {
    let limit = limit.clamp(1, 500);
    sqlx::query_as::<_, PlatformAuditEvent>(
        "SELECT id, created_at, actor, actor_user_id, api_key_id, action, method, path, status, \
                detail, client_ip, user_agent \
         FROM platform_audit_events \
         ORDER BY created_at DESC \
         LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}
