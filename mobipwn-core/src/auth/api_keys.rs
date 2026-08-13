use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use super::api_key_cipher::{decrypt_api_key_token, encrypt_api_key_token};
use super::{get_by_id, hash_key, ApiRole, AuthContext, Permission};

#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyRecord {
    pub id: Uuid,
    pub name: String,
    pub role: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub last_used_ip: Option<String>,
    pub request_count: i64,
    pub response_bytes: i64,
    pub suspended_at: Option<DateTime<Utc>>,
    pub token_recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by_username: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyUserUsage {
    pub user_id: Option<Uuid>,
    pub username: String,
    pub active_keys: i64,
    pub suspended_keys: i64,
    pub request_count: i64,
    pub response_bytes: i64,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct RevealApiKeyResponse {
    pub token: String,
}

#[derive(Debug, Serialize)]
pub struct CreateApiKeyResponse {
    pub key: ApiKeyRecord,
    /// Plaintext token — shown once at creation; store it in MCP / scripts.
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    #[serde(default = "default_role")]
    pub role: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub user_id: Option<Uuid>,
}

fn default_role() -> String {
    "analyst".into()
}

pub fn parse_role(role: &str) -> ApiRole {
    match role.trim().to_lowercase().as_str() {
        "admin" => ApiRole::Admin,
        "viewer" => ApiRole::Viewer,
        _ => ApiRole::Analyst,
    }
}

fn role_rank(role: ApiRole) -> u8 {
    match role {
        ApiRole::Viewer => 0,
        ApiRole::Analyst => 1,
        ApiRole::Admin => 2,
    }
}

/// When a key is linked to a user, cap permissions at the lower of key role and user role.
fn effective_role(key_role: ApiRole, user_role: ApiRole) -> ApiRole {
    if role_rank(key_role) <= role_rank(user_role) {
        key_role
    } else {
        user_role
    }
}

pub fn generate_plaintext_key() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("mpwn_{hex}")
}

pub async fn verify_api_key(pool: &PgPool, token: &str) -> anyhow::Result<Option<AuthContext>> {
    let hash = hash_key(token);
    let row: Option<(String, Uuid, String, Option<Uuid>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT k.role::text, k.id, k.name, k.user_id, u.role::text, u.username \
         FROM api_keys k \
         LEFT JOIN users u ON u.id = k.user_id \
         WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND k.suspended_at IS NULL",
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(key_role, id, name, user_id, linked_user_role, user_username)| {
        let key_role = parse_role(&key_role);
        let role = linked_user_role
            .as_deref()
            .map(parse_role)
            .map(|user_role| effective_role(key_role, user_role))
            .unwrap_or(key_role);
        AuthContext {
            role,
            key_id: Some(id),
            key_name: Some(name),
            user_id,
            user_username,
        }
    }))
}

pub async fn touch_api_key_usage(
    pool: &PgPool,
    key_id: Uuid,
    client_ip: Option<&str>,
    response_bytes: u64,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE api_keys SET last_used_at = now(), last_used_ip = $2, \
         request_count = request_count + 1, response_bytes = response_bytes + $3 \
         WHERE id = $1",
    )
    .bind(key_id)
    .bind(client_ip)
    .bind(i64::try_from(response_bytes).unwrap_or(i64::MAX))
    .execute(pool)
    .await?;
    Ok(())
}

const API_KEY_SELECT: &str = "SELECT k.id, k.name, k.role::text, k.description, k.created_at, k.last_used_at, \
         k.last_used_ip, k.request_count, k.response_bytes, k.suspended_at, \
         (k.key_ciphertext IS NOT NULL) AS token_recoverable, k.user_id, \
         linked.username AS user_username, creator.username AS created_by_username \
         FROM api_keys k \
         LEFT JOIN users linked ON linked.id = k.user_id \
         LEFT JOIN users creator ON creator.id = k.created_by";

const API_KEY_LIST_SQL: &str = "SELECT k.id, k.name, k.role::text, k.description, k.created_at, k.last_used_at, \
         k.last_used_ip, k.request_count, k.response_bytes, k.suspended_at, \
         (k.key_ciphertext IS NOT NULL) AS token_recoverable, k.user_id, \
         linked.username AS user_username, creator.username AS created_by_username \
         FROM api_keys k \
         LEFT JOIN users linked ON linked.id = k.user_id \
         LEFT JOIN users creator ON creator.id = k.created_by \
         WHERE k.revoked_at IS NULL \
         ORDER BY k.created_at DESC";

const API_KEY_USER_USAGE_SQL: &str = "SELECT k.user_id, COALESCE(linked.username, '(no linked user)') AS username, \
         COUNT(*)::bigint AS active_keys, \
         COUNT(*) FILTER (WHERE k.suspended_at IS NOT NULL)::bigint AS suspended_keys, \
         COALESCE(SUM(k.request_count), 0)::bigint AS request_count, \
         COALESCE(SUM(k.response_bytes), 0)::bigint AS response_bytes, \
         MAX(k.last_used_at) AS last_used_at \
         FROM api_keys k \
         LEFT JOIN users linked ON linked.id = k.user_id \
         WHERE k.revoked_at IS NULL \
         GROUP BY k.user_id, linked.username \
         ORDER BY COALESCE(SUM(k.response_bytes), 0) DESC, COALESCE(SUM(k.request_count), 0) DESC";

pub async fn list_api_keys(pool: &PgPool) -> anyhow::Result<Vec<ApiKeyRecord>> {
    let rows = sqlx::query_as::<_, ApiKeyRow>(API_KEY_LIST_SQL)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn list_api_keys_for_user(pool: &PgPool, user_id: Uuid) -> anyhow::Result<Vec<ApiKeyRecord>> {
    let sql = format!(
        "{API_KEY_SELECT} WHERE k.revoked_at IS NULL AND k.user_id = $1 ORDER BY k.created_at DESC"
    );
    let rows = sqlx::query_as::<_, ApiKeyRow>(&sql)
        .bind(user_id)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn reveal_api_key_token(pool: &PgPool, key_id: Uuid, viewer: &AuthContext) -> anyhow::Result<String> {
    let Some(viewer_user_id) = viewer.user_id else {
        anyhow::bail!("sign in with your account to reveal API keys");
    };
    let row: Option<(Option<Uuid>, Option<String>)> = sqlx::query_as(
        "SELECT user_id, key_ciphertext FROM api_keys WHERE id = $1 AND revoked_at IS NULL",
    )
    .bind(key_id)
    .fetch_optional(pool)
    .await?;
    let Some((owner_id, ciphertext)) = row else {
        anyhow::bail!("api key not found");
    };
    let is_admin = viewer.role.has(Permission::UsersAdmin);
    let is_owner = owner_id == Some(viewer_user_id);
    if !is_admin && !is_owner {
        anyhow::bail!("forbidden");
    }
    let Some(encoded) = ciphertext.filter(|s| !s.is_empty()) else {
        anyhow::bail!("token not stored for this key — create a new key to enable reveal");
    };
    decrypt_api_key_token(&encoded)
}

pub async fn list_api_key_usage_by_user(pool: &PgPool) -> anyhow::Result<Vec<ApiKeyUserUsage>> {
    let rows = sqlx::query_as::<_, ApiKeyUserUsageRow>(API_KEY_USER_USAGE_SQL)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn create_api_key(
    pool: &PgPool,
    req: &CreateApiKeyRequest,
    created_by: Option<Uuid>,
) -> anyhow::Result<CreateApiKeyResponse> {
    let name = req.name.trim();
    if name.is_empty() {
        anyhow::bail!("name is required");
    }
    if name.len() > 120 {
        anyhow::bail!("name too long (max 120)");
    }
    if let Some(user_id) = req.user_id {
        if get_by_id(pool, user_id).await?.is_none() {
            anyhow::bail!("linked user not found");
        }
    }
    let role = parse_role(&req.role);
    let token = generate_plaintext_key();
    let hash = hash_key(&token);
    let ciphertext = encrypt_api_key_token(&token)?;
    let description = req.description.trim();
    sqlx::query(
        "INSERT INTO api_keys (name, key_hash, role, description, created_by, user_id, key_ciphertext) \
         VALUES ($1, $2, $3::api_role, $4, $5, $6, $7)",
    )
    .bind(name)
    .bind(&hash)
    .bind(role.as_str())
    .bind(description)
    .bind(created_by)
    .bind(req.user_id)
    .bind(&ciphertext)
    .execute(pool)
    .await?;

    let rows = sqlx::query_as::<_, ApiKeyRow>(
        "SELECT k.id, k.name, k.role::text, k.description, k.created_at, k.last_used_at, k.last_used_ip, \
         k.request_count, k.response_bytes, k.suspended_at, \
         (k.key_ciphertext IS NOT NULL) AS token_recoverable, k.user_id, linked.username AS user_username, \
         creator.username AS created_by_username \
         FROM api_keys k \
         LEFT JOIN users linked ON linked.id = k.user_id \
         LEFT JOIN users creator ON creator.id = k.created_by \
         WHERE k.key_hash = $1 AND k.revoked_at IS NULL",
    )
    .bind(&hash)
    .fetch_one(pool)
    .await?;

    Ok(CreateApiKeyResponse {
        key: rows.into(),
        token,
    })
}

pub async fn revoke_api_key(pool: &PgPool, id: Uuid) -> anyhow::Result<bool> {
    let r = sqlx::query(
        "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn suspend_api_key(pool: &PgPool, id: Uuid) -> anyhow::Result<bool> {
    let r = sqlx::query(
        "UPDATE api_keys SET suspended_at = now() WHERE id = $1 AND revoked_at IS NULL AND suspended_at IS NULL",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn unsuspend_api_key(pool: &PgPool, id: Uuid) -> anyhow::Result<bool> {
    let r = sqlx::query(
        "UPDATE api_keys SET suspended_at = NULL WHERE id = $1 AND revoked_at IS NULL AND suspended_at IS NOT NULL",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn suspend_api_keys_for_user(pool: &PgPool, user_id: Uuid) -> anyhow::Result<u64> {
    if get_by_id(pool, user_id).await?.is_none() {
        anyhow::bail!("user not found");
    }
    let r = sqlx::query(
        "UPDATE api_keys SET suspended_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND suspended_at IS NULL",
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

#[derive(sqlx::FromRow)]
struct ApiKeyRow {
    id: Uuid,
    name: String,
    role: String,
    description: String,
    created_at: DateTime<Utc>,
    last_used_at: Option<DateTime<Utc>>,
    last_used_ip: Option<String>,
    request_count: i64,
    response_bytes: i64,
    suspended_at: Option<DateTime<Utc>>,
    token_recoverable: bool,
    user_id: Option<Uuid>,
    user_username: Option<String>,
    created_by_username: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ApiKeyUserUsageRow {
    user_id: Option<Uuid>,
    username: String,
    active_keys: i64,
    suspended_keys: i64,
    request_count: i64,
    response_bytes: i64,
    last_used_at: Option<DateTime<Utc>>,
}

impl From<ApiKeyUserUsageRow> for ApiKeyUserUsage {
    fn from(r: ApiKeyUserUsageRow) -> Self {
        Self {
            user_id: r.user_id,
            username: r.username,
            active_keys: r.active_keys,
            suspended_keys: r.suspended_keys,
            request_count: r.request_count,
            response_bytes: r.response_bytes,
            last_used_at: r.last_used_at,
        }
    }
}

impl From<ApiKeyRow> for ApiKeyRecord {
    fn from(r: ApiKeyRow) -> Self {
        Self {
            id: r.id,
            name: r.name,
            role: r.role,
            description: r.description,
            created_at: r.created_at,
            last_used_at: r.last_used_at,
            last_used_ip: r.last_used_ip,
            request_count: r.request_count,
            response_bytes: r.response_bytes,
            suspended_at: r.suspended_at,
            token_recoverable: r.token_recoverable,
            user_id: r.user_id,
            user_username: r.user_username,
            created_by_username: r.created_by_username,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_keys_have_prefix() {
        let k = generate_plaintext_key();
        assert!(k.starts_with("mpwn_"));
        assert!(k.len() > 20);
    }

    #[test]
    fn effective_role_uses_lower_privilege() {
        assert_eq!(
            effective_role(ApiRole::Admin, ApiRole::Analyst),
            ApiRole::Analyst
        );
        assert_eq!(
            effective_role(ApiRole::Analyst, ApiRole::Viewer),
            ApiRole::Viewer
        );
    }
}
