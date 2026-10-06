use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;
use webauthn_rs::prelude::*;

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct WebauthnCredentialRecord {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
struct CredentialRow {
    id: Uuid,
    passkey: serde_json::Value,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct WebauthnSettings {
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub rp_id: String,
}

fn trim_opt(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|s| !s.is_empty())
}

fn normalize_origin(origin: &str) -> String {
    origin.trim().trim_end_matches('/').to_string()
}

pub fn parse_webauthn_origin(origin: &str) -> anyhow::Result<Url> {
    let url = Url::parse(origin.trim()).map_err(|e| anyhow::anyhow!("invalid WebAuthn origin: {e}"))?;
    match url.host_str() {
        Some("127.0.0.1") | Some("[::1]") | Some("::1") => anyhow::bail!(
            "security keys require http://localhost (not 127.0.0.1). Open the console on localhost and try again"
        ),
        Some(_) => {}
        None => anyhow::bail!("invalid WebAuthn origin"),
    }
    if url.scheme() != "https" && url.host_str() != Some("localhost") {
        anyhow::bail!("security keys require https (or http://localhost in development)");
    }
    Ok(url)
}

/// Build a WebAuthn RP from the page origin/RP ID sent by the UI, using saved
/// Settings values when the request omits them.
pub fn webauthn_from_request(
    page_origin: &str,
    page_rp_id: Option<&str>,
    settings: &WebauthnSettings,
) -> anyhow::Result<Webauthn> {
    let origin_str = trim_opt(Some(page_origin))
        .map(normalize_origin)
        .or_else(|| trim_opt(Some(&settings.origin)).map(normalize_origin))
        .ok_or_else(|| {
            anyhow::anyhow!("console origin is required — set it in Settings → Account or pass origin")
        })?;
    if let Some(configured) = trim_opt(Some(&settings.origin)).map(normalize_origin) {
        if configured != origin_str {
            anyhow::bail!(
                "this console is configured for {configured}; open that URL to use a security key"
            );
        }
    }
    let origin = parse_webauthn_origin(&origin_str)?;
    let host = origin
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("invalid WebAuthn origin host"))?;
    let rp_id = trim_opt(page_rp_id)
        .or_else(|| trim_opt(Some(&settings.rp_id)))
        .unwrap_or(host)
        .to_string();
    WebauthnBuilder::new(&rp_id, &origin)?
        .rp_name("mobipwn")
        .build()
        .map_err(|e| anyhow::anyhow!("{e}"))
}

async fn load_security_keys(pool: &PgPool, user_id: Uuid) -> anyhow::Result<Vec<(Uuid, SecurityKey)>> {
    let rows = sqlx::query_as::<_, CredentialRow>(
        "SELECT id, passkey FROM auth_webauthn_credentials WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let mut keys = Vec::with_capacity(rows.len());
    for row in rows {
        let key: SecurityKey = serde_json::from_value(row.passkey)
            .map_err(|e| anyhow::anyhow!("invalid stored security key: {e}"))?;
        keys.push((row.id, key));
    }
    Ok(keys)
}

pub async fn user_has_webauthn(pool: &PgPool, user_id: Uuid) -> anyhow::Result<bool> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM auth_webauthn_credentials WHERE user_id = $1)",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(exists)
}

pub async fn webauthn_user_ids(pool: &PgPool) -> anyhow::Result<Vec<Uuid>> {
    sqlx::query_scalar("SELECT DISTINCT user_id FROM auth_webauthn_credentials")
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

pub async fn list_webauthn_credentials(
    pool: &PgPool,
    user_id: Uuid,
) -> anyhow::Result<Vec<WebauthnCredentialRecord>> {
    sqlx::query_as::<_, WebauthnCredentialRecord>(
        "SELECT id, name, created_at, last_used_at FROM auth_webauthn_credentials \
         WHERE user_id = $1 ORDER BY created_at",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

async fn store_challenge(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    kind: &str,
    state: serde_json::Value,
) -> anyhow::Result<()> {
    let expires = Utc::now() + Duration::minutes(5);
    sqlx::query(
        "INSERT INTO auth_webauthn_challenges (id, user_id, kind, state, expires_at) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, kind = EXCLUDED.kind, \
             expires_at = EXCLUDED.expires_at, created_at = now()",
    )
    .bind(id)
    .bind(user_id)
    .bind(kind)
    .bind(state)
    .bind(expires)
    .execute(pool)
    .await?;
    Ok(())
}

async fn take_challenge(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    kind: &str,
) -> anyhow::Result<serde_json::Value> {
    let row: Option<(serde_json::Value,)> = sqlx::query_as(
        "DELETE FROM auth_webauthn_challenges \
         WHERE id = $1 AND user_id = $2 AND kind = $3 AND expires_at > now() \
         RETURNING state",
    )
    .bind(id)
    .bind(user_id)
    .bind(kind)
    .fetch_optional(pool)
    .await?;
    row.map(|r| r.0)
        .ok_or_else(|| anyhow::anyhow!("security key challenge expired"))
}

pub async fn start_webauthn_registration(
    pool: &PgPool,
    webauthn: &Webauthn,
    user_id: Uuid,
    username: &str,
) -> anyhow::Result<(Uuid, CreationChallengeResponse)> {
    let existing = load_security_keys(pool, user_id).await?;
    let exclude: Vec<CredentialID> = existing.iter().map(|(_, k)| k.cred_id().clone()).collect();
    let exclude = if exclude.is_empty() {
        None
    } else {
        Some(exclude)
    };
    let (ccr, state) = webauthn.start_securitykey_registration(
        user_id,
        username,
        username,
        exclude,
        None,
        None,
    )?;
    let challenge_id = Uuid::now_v7();
    store_challenge(
        pool,
        challenge_id,
        user_id,
        "register",
        serde_json::to_value(&state)?,
    )
    .await?;
    Ok((challenge_id, ccr))
}

pub async fn finish_webauthn_registration(
    pool: &PgPool,
    webauthn: &Webauthn,
    user_id: Uuid,
    challenge_id: Uuid,
    credential: RegisterPublicKeyCredential,
    name: Option<&str>,
) -> anyhow::Result<WebauthnCredentialRecord> {
    let state_json = take_challenge(pool, challenge_id, user_id, "register").await?;
    let state: SecurityKeyRegistration = serde_json::from_value(state_json)?;
    let key = webauthn.finish_securitykey_registration(&credential, &state)?;
    let cred_bytes: &[u8] = key.cred_id().as_ref();
    let label = name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("YubiKey");
    let row = sqlx::query_as::<_, WebauthnCredentialRecord>(
        "INSERT INTO auth_webauthn_credentials (id, user_id, credential_id, passkey, name) \
         VALUES ($1, $2, $3, $4, $5) \
         RETURNING id, name, created_at, last_used_at",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(cred_bytes)
    .bind(serde_json::to_value(&key)?)
    .bind(label)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("unique") || msg.contains("duplicate") {
            anyhow::anyhow!("this security key is already registered")
        } else {
            e.into()
        }
    })?;
    Ok(row)
}

pub async fn start_webauthn_authentication(
    pool: &PgPool,
    webauthn: &Webauthn,
    user_id: Uuid,
    mfa_challenge_id: Uuid,
) -> anyhow::Result<RequestChallengeResponse> {
    let keys = load_security_keys(pool, user_id).await?;
    if keys.is_empty() {
        anyhow::bail!("no security keys registered");
    }
    let creds: Vec<SecurityKey> = keys.into_iter().map(|(_, k)| k).collect();
    let (rcr, state) = webauthn.start_securitykey_authentication(&creds)?;
    store_challenge(
        pool,
        mfa_challenge_id,
        user_id,
        "authenticate",
        serde_json::to_value(&state)?,
    )
    .await?;
    Ok(rcr)
}

pub async fn finish_webauthn_authentication(
    pool: &PgPool,
    webauthn: &Webauthn,
    user_id: Uuid,
    mfa_challenge_id: Uuid,
    credential: PublicKeyCredential,
) -> anyhow::Result<()> {
    let state_json = take_challenge(pool, mfa_challenge_id, user_id, "authenticate").await?;
    let state: SecurityKeyAuthentication = serde_json::from_value(state_json)?;
    let result = webauthn.finish_securitykey_authentication(&credential, &state)?;
    let mut keys = load_security_keys(pool, user_id).await?;
    let Some((row_id, key)) = keys.iter_mut().find(|(_, k)| k.cred_id() == result.cred_id()) else {
        anyhow::bail!("unknown security key");
    };
    let _ = key.update_credential(&result);
    sqlx::query(
        "UPDATE auth_webauthn_credentials SET passkey = $2, last_used_at = now() WHERE id = $1",
    )
    .bind(*row_id)
    .bind(serde_json::to_value(&*key)?)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_webauthn_credential(
    pool: &PgPool,
    user_id: Uuid,
    credential_id: Uuid,
) -> anyhow::Result<bool> {
    let r = sqlx::query(
        "DELETE FROM auth_webauthn_credentials WHERE id = $1 AND user_id = $2",
    )
    .bind(credential_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::parse_webauthn_origin;

    #[test]
    fn localhost_http_origin_is_allowed() {
        let url = parse_webauthn_origin("http://localhost:5173").expect("origin");
        assert_eq!(url.host_str(), Some("localhost"));
    }

    #[test]
    fn loopback_ip_is_rejected() {
        let err = parse_webauthn_origin("http://127.0.0.1:5173").unwrap_err();
        assert!(err.to_string().contains("localhost"));
    }

    #[test]
    fn request_origin_is_required_without_settings() {
        let err = super::webauthn_from_request("", None, &super::WebauthnSettings::default()).unwrap_err();
        assert!(err.to_string().contains("origin is required"));
    }

    #[test]
    fn settings_origin_fills_in_when_request_omits_it() {
        let settings = super::WebauthnSettings {
            origin: "http://localhost:5173".into(),
            rp_id: String::new(),
        };
        super::webauthn_from_request("", None, &settings).expect("settings origin");
    }
}
