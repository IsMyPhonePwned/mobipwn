use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{DateTime, Duration, Utc};
use rand::rngs::OsRng;
use sqlx::PgPool;
use totp_lite::{totp_custom, Sha1};
use uuid::Uuid;

use super::{hash_key, ApiRole, AuthContext};

#[derive(Debug, Clone, serde::Serialize)]
pub struct UserRecord {
    pub id: Uuid,
    pub username: String,
    pub role: String,
    pub totp_enabled: bool,
    pub created_at: DateTime<Utc>,
    pub permissions: Vec<super::Permission>,
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct UserDirectoryEntry {
    pub id: Uuid,
    pub username: String,
}

#[derive(sqlx::FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub username: String,
    pub password_hash: String,
    pub role: String,
    pub totp_secret: Option<String>,
    pub totp_enabled: bool,
    pub created_at: DateTime<Utc>,
}

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("{e}"))?
        .to_string();
    debug_assert!(is_stored_password_hash(&hash));
    Ok(hash)
}

/// Stored credentials must be Argon2 PHC strings, never plaintext.
pub fn is_stored_password_hash(hash: &str) -> bool {
    hash.starts_with("$argon2")
}

pub async fn audit_password_hashes(pool: &PgPool) -> anyhow::Result<()> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT username, password_hash FROM users")
            .fetch_all(pool)
            .await?;
    for (username, hash) in rows {
        if !is_stored_password_hash(&hash) {
            tracing::error!(
                username,
                "user password is not Argon2-hashed — reset this account password immediately"
            );
        }
    }
    Ok(())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .ok()
        .and_then(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).ok())
        .is_some()
}

pub fn generate_totp_secret() -> String {
    let bytes: [u8; 20] = rand::random();
    base32::encode(base32::Alphabet::Rfc4648 { padding: false }, &bytes)
}

fn decode_totp_secret(secret: &str) -> Option<Vec<u8>> {
    let normalized = secret.trim().replace(' ', "").to_uppercase();
    base32::decode(base32::Alphabet::Rfc4648 { padding: false }, &normalized)
        .or_else(|| base32::decode(base32::Alphabet::Rfc4648 { padding: true }, &normalized))
}

pub fn verify_totp(secret: &str, code: &str) -> bool {
    let Some(key) = decode_totp_secret(secret) else {
        return false;
    };
    let trimmed = code.trim();
    if trimmed.len() != 6 || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let now = Utc::now().timestamp();
    // Allow ±1 step (30s) for clock skew — standard TOTP window.
    for step in -1_i64..=1 {
        let ts = (now + step * 30).max(0) as u64;
        let expected = totp_custom::<Sha1>(30, 6, &key, ts);
        if expected == trimmed {
            return true;
        }
    }
    false
}

pub fn totp_uri(secret: &str, username: &str, issuer: &str) -> String {
    let label = urlencoding::encode(&format!("{issuer}:{username}")).into_owned();
    let issuer_q = urlencoding::encode(issuer).into_owned();
    format!(
        "otpauth://totp/{label}?secret={secret}&issuer={issuer_q}&algorithm=SHA1&digits=6&period=30"
    )
}

pub async fn count_users(pool: &PgPool) -> anyhow::Result<i64> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    Ok(n)
}

pub async fn ensure_bootstrap_admin(
    pool: &PgPool,
    username: &str,
    password: &str,
) -> anyhow::Result<()> {
    if count_users(pool).await? > 0 {
        audit_password_hashes(pool).await?;
        return Ok(());
    }
    let hash = hash_password(password)?;
    sqlx::query(
        "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin'::api_role)",
    )
    .bind(username)
    .bind(hash)
    .execute(pool)
    .await?;
    tracing::info!(username, "bootstrap admin user created");
    Ok(())
}

pub async fn get_by_username(pool: &PgPool, username: &str) -> anyhow::Result<Option<UserRow>> {
    let row = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, password_hash, role::text, totp_secret, totp_enabled, created_at \
         FROM users WHERE username = $1",
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn get_by_id(pool: &PgPool, id: Uuid) -> anyhow::Result<Option<UserRecord>> {
    let row = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, password_hash, role::text, totp_secret, totp_enabled, created_at \
         FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| UserRecord {
        id: r.id,
        username: r.username,
        role: r.role.clone(),
        totp_enabled: r.totp_enabled,
        created_at: r.created_at,
        permissions: parse_role(&r.role).permissions(),
    }))
}

fn parse_role(role: &str) -> ApiRole {
    match role {
        "admin" => ApiRole::Admin,
        "viewer" => ApiRole::Viewer,
        _ => ApiRole::Analyst,
    }
}

pub async fn authenticate(
    pool: &PgPool,
    username: &str,
    password: &str,
) -> anyhow::Result<Option<UserRow>> {
    let Some(user) = get_by_username(pool, username).await? else {
        return Ok(None);
    };
    if !verify_password(password, &user.password_hash) {
        return Ok(None);
    }
    Ok(Some(user))
}

pub async fn create_mfa_challenge(pool: &PgPool, user_id: Uuid) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    let expires = Utc::now() + Duration::minutes(5);
    sqlx::query(
        "INSERT INTO auth_mfa_challenges (id, user_id, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(id)
    .bind(user_id)
    .bind(expires)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn consume_mfa_challenge(pool: &PgPool, challenge_id: Uuid) -> anyhow::Result<Option<UserRow>> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "DELETE FROM auth_mfa_challenges WHERE id = $1 AND expires_at > now() RETURNING user_id",
    )
    .bind(challenge_id)
    .fetch_optional(pool)
    .await?;
    let Some((user_id,)) = row else {
        return Ok(None);
    };
    let user = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, password_hash, role::text, totp_secret, totp_enabled, created_at \
         FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(user)
}

pub async fn create_session(pool: &PgPool, user: &UserRow, mfa_verified: bool) -> anyhow::Result<String> {
    let token = format!("{:x}", rand::random::<u128>());
    let token_hash = hash_key(&token);
    let expires = Utc::now() + Duration::days(7);
    sqlx::query(
        "INSERT INTO auth_sessions (user_id, token_hash, mfa_verified, expires_at, last_seen_at) \
         VALUES ($1, $2, $3, $4, now())",
    )
    .bind(user.id)
    .bind(token_hash)
    .bind(mfa_verified)
    .bind(expires)
    .execute(pool)
    .await?;
    sqlx::query("UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1")
        .bind(user.id)
        .execute(pool)
        .await?;
    Ok(token)
}

pub async fn verify_session(pool: &PgPool, token: &str) -> anyhow::Result<Option<AuthContext>> {
    let token_hash = hash_key(token);
    let row: Option<(Uuid, String, String, bool)> = sqlx::query_as(
        "SELECT u.id, u.role::text, u.username, s.mfa_verified FROM auth_sessions s \
         JOIN users u ON u.id = s.user_id \
         WHERE s.token_hash = $1 AND s.expires_at > now()",
    )
    .bind(&token_hash)
    .fetch_optional(pool)
    .await?;
    let Some((user_id, role, username, mfa_verified)) = row else {
        return Ok(None);
    };
    if !mfa_verified {
        return Ok(None);
    }
    sqlx::query(
        "UPDATE auth_sessions SET last_seen_at = now() \
         WHERE token_hash = $1 \
           AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')",
    )
    .bind(&token_hash)
    .execute(pool)
    .await?;
    Ok(Some(AuthContext {
        role: parse_role(&role),
        key_id: None,
        key_name: None,
        user_id: Some(user_id),
        user_username: Some(username),
    }))
}

pub async fn delete_session(pool: &PgPool, token: &str) -> anyhow::Result<()> {
    let token_hash = hash_key(token);
    sqlx::query("DELETE FROM auth_sessions WHERE token_hash = $1")
        .bind(token_hash)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn setup_totp(pool: &PgPool, user_id: Uuid) -> anyhow::Result<(String, String)> {
    let user = get_by_id(pool, user_id).await?.ok_or_else(|| anyhow::anyhow!("user not found"))?;
    let secret = generate_totp_secret();
    sqlx::query(
        "UPDATE users SET totp_secret = $2, totp_enabled = false, updated_at = now() WHERE id = $1",
    )
    .bind(user_id)
    .bind(&secret)
    .execute(pool)
    .await?;
    let uri = totp_uri(&secret, &user.username, "mobipwn");
    Ok((secret, uri))
}

pub async fn enable_totp(pool: &PgPool, user_id: Uuid, code: &str) -> anyhow::Result<bool> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT totp_secret FROM users WHERE id = $1 AND totp_secret IS NOT NULL")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    let Some((secret,)) = row else {
        return Ok(false);
    };
    if !verify_totp(&secret, code) {
        return Ok(false);
    }
    sqlx::query(
        "UPDATE users SET totp_enabled = true, updated_at = now() WHERE id = $1",
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(true)
}

pub async fn disable_totp(pool: &PgPool, user_id: Uuid) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE users SET totp_enabled = false, totp_secret = NULL, updated_at = now() WHERE id = $1",
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub fn verify_user_totp(user: &UserRow, code: &str) -> bool {
    user.totp_secret
        .as_deref()
        .map(|s| verify_totp(s, code))
        .unwrap_or(false)
}

pub fn user_to_record(user: &UserRow) -> UserRecord {
    let role = parse_role(&user.role);
    UserRecord {
        id: user.id,
        username: user.username.clone(),
        role: user.role.clone(),
        totp_enabled: user.totp_enabled,
        created_at: user.created_at,
        permissions: role.permissions(),
    }
}

fn normalize_role(role: &str) -> anyhow::Result<&'static str> {
    match role.trim().to_lowercase().as_str() {
        "admin" => Ok("admin"),
        "analyst" => Ok("analyst"),
        "viewer" => Ok("viewer"),
        _ => anyhow::bail!("role must be admin, analyst, or viewer"),
    }
}

pub async fn list_users(pool: &PgPool) -> anyhow::Result<Vec<UserRecord>> {
    let rows = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, password_hash, role::text, totp_secret, totp_enabled, created_at \
         FROM users ORDER BY username",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(user_to_record).collect())
}

pub async fn list_user_directory(pool: &PgPool) -> anyhow::Result<Vec<UserDirectoryEntry>> {
    sqlx::query_as::<_, UserDirectoryEntry>(
        "SELECT id, username FROM users ORDER BY username",
    )
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn create_user(
    pool: &PgPool,
    username: &str,
    password: &str,
    role: &str,
) -> anyhow::Result<UserRecord> {
    let username = username.trim();
    if username.is_empty() {
        anyhow::bail!("username required");
    }
    if password.len() < 4 {
        anyhow::bail!("password must be at least 4 characters");
    }
    let role = normalize_role(role)?;
    let hash = hash_password(password)?;
    let row = sqlx::query_as::<_, UserRow>(
        "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3::api_role) \
         RETURNING id, username, password_hash, role::text, totp_secret, totp_enabled, created_at",
    )
    .bind(username)
    .bind(hash)
    .bind(role)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        if e.to_string().contains("duplicate") || e.to_string().contains("unique") {
            anyhow::anyhow!("username already taken")
        } else {
            e.into()
        }
    })?;
    Ok(user_to_record(&row))
}

pub async fn update_user(
    pool: &PgPool,
    id: Uuid,
    role: Option<&str>,
    password: Option<&str>,
) -> anyhow::Result<Option<UserRecord>> {
    let existing = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, password_hash, role::text, totp_secret, totp_enabled, created_at \
         FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some(user) = existing else {
        return Ok(None);
    };

    let next_role = if let Some(r) = role {
        normalize_role(r)?.to_string()
    } else {
        user.role.clone()
    };

    if next_role != "admin" && user.role == "admin" {
        let admins: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'admin'::api_role")
            .fetch_one(pool)
            .await?;
        if admins <= 1 {
            anyhow::bail!("cannot demote the last admin");
        }
    }

    if let Some(pw) = password {
        if pw.len() < 4 {
            anyhow::bail!("password must be at least 4 characters");
        }
        let hash = hash_password(pw)?;
        sqlx::query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1")
            .bind(id)
            .bind(hash)
            .execute(pool)
            .await?;
    }

    let row = sqlx::query_as::<_, UserRow>(
        "UPDATE users SET role = $2::api_role, updated_at = now() WHERE id = $1 \
         RETURNING id, username, password_hash, role::text, totp_secret, totp_enabled, created_at",
    )
    .bind(id)
    .bind(&next_role)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| user_to_record(&r)))
}

pub async fn delete_user(pool: &PgPool, id: Uuid) -> anyhow::Result<bool> {
    let role: Option<String> = sqlx::query_scalar("SELECT role::text FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    let Some(role) = role else {
        return Ok(false);
    };
    if role == "admin" {
        let admins: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'admin'::api_role")
            .fetch_one(pool)
            .await?;
        if admins <= 1 {
            anyhow::bail!("cannot delete the last admin");
        }
    }
    let r = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

#[derive(Debug, serde::Serialize)]
pub struct ActiveSession {
    pub username: String,
    pub role: String,
    pub session_started: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, serde::Serialize)]
pub struct RecentLogin {
    pub username: String,
    pub role: String,
    pub last_login_at: DateTime<Utc>,
}

#[derive(Debug, serde::Serialize)]
pub struct AuthActivity {
    pub password_storage: &'static str,
    pub total_users: i64,
    pub active_sessions: i64,
    pub connected: Vec<ActiveSession>,
    pub recent_logins: Vec<RecentLogin>,
}

pub async fn fetch_auth_activity(pool: &PgPool) -> anyhow::Result<Option<AuthActivity>> {
    let users_table: bool = sqlx::query_scalar(
        "SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'users'
        )",
    )
    .fetch_one(pool)
    .await?;
    if !users_table {
        return Ok(None);
    }

    let total_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;

    let active_sessions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM auth_sessions WHERE mfa_verified = true AND expires_at > now()",
    )
    .fetch_one(pool)
    .await?;

    let connected = sqlx::query_as::<_, (String, String, DateTime<Utc>, Option<DateTime<Utc>>, DateTime<Utc>)>(
        "SELECT u.username, u.role::text, s.created_at, s.last_seen_at, s.expires_at \
         FROM auth_sessions s \
         JOIN users u ON u.id = s.user_id \
         WHERE s.mfa_verified = true AND s.expires_at > now() \
         ORDER BY COALESCE(s.last_seen_at, s.created_at) DESC",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(username, role, session_started, last_seen_at, expires_at)| ActiveSession {
        username,
        role,
        session_started,
        last_seen_at,
        expires_at,
    })
    .collect();

    let recent_logins = sqlx::query_as::<_, (String, String, DateTime<Utc>)>(
        "SELECT username, role::text, last_login_at \
         FROM users \
         WHERE last_login_at IS NOT NULL \
         ORDER BY last_login_at DESC \
         LIMIT 20",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(username, role, last_login_at)| RecentLogin {
        username,
        role,
        last_login_at,
    })
    .collect();

    Ok(Some(AuthActivity {
        password_storage: "argon2",
        total_users,
        active_sessions,
        connected,
        recent_logins,
    }))
}

#[cfg(test)]
mod tests {
    use super::{decode_totp_secret, hash_password, is_stored_password_hash, verify_password};
    use totp_lite::{totp_custom, Sha1};

    #[test]
    fn password_is_hashed_not_plaintext() {
        let plain = "super-secret-password";
        let hash = hash_password(plain).expect("hash");
        assert!(is_stored_password_hash(&hash));
        assert_ne!(hash, plain);
        assert!(verify_password(plain, &hash));
        assert!(!verify_password("wrong", &hash));
    }

    #[test]
    fn totp_verifies_base32_secret_like_authenticator_apps() {
        // RFC 6238 test vector (SHA1, 6 digits, t=1234567890).
        let raw = b"12345678901234567890";
        let secret_b32 =
            base32::encode(base32::Alphabet::Rfc4648 { padding: false }, raw);
        let key = decode_totp_secret(&secret_b32).expect("decode");
        assert_eq!(key, raw);
        let code = totp_custom::<Sha1>(30, 6, &key, 1_234_567_890);
        assert_eq!(code, "005924");
    }
}
