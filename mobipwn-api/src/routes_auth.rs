use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use mobipwn_core::auth::{
    authenticate, consume_mfa_challenge, create_api_key, create_mfa_challenge, create_session,
    create_user, delete_session, delete_user, delete_webauthn_credential, disable_totp, enable_totp,
    finish_webauthn_authentication, finish_webauthn_registration, get_by_id, get_mfa_challenge_user,
    list_api_key_usage_by_user, list_api_keys, list_api_keys_for_user, list_user_directory, list_users,
    list_webauthn_credentials, reveal_api_key_token, revoke_api_key, setup_totp, start_webauthn_authentication,
    start_webauthn_registration, suspend_api_key, suspend_api_keys_for_user, unsuspend_api_key, update_user,
    user_has_webauthn, user_to_record_async, verify_user_totp, webauthn_from_request, ApiRole,
    AuthContext, CreateApiKeyRequest, RevealApiKeyResponse, UserDirectoryEntry, UserRecord,
    WebauthnCredentialRecord, WebauthnSettings,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Routes that do not require credentials (login, status).
pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/v1/auth/status", get(auth_status))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/mfa", post(verify_mfa))
        .route("/v1/auth/mfa/webauthn/start", post(mfa_webauthn_start))
        .route("/v1/auth/mfa/webauthn/finish", post(mfa_webauthn_finish))
}

/// Routes that require a valid session or API key.
pub fn protected_router() -> Router<AppState> {
    Router::new()
        .route("/v1/auth/logout", post(logout))
        .route("/v1/auth/me", get(me))
        .route("/v1/auth/totp/setup", post(totp_setup))
        .route("/v1/auth/totp/enable", post(totp_enable))
        .route("/v1/auth/totp/disable", post(totp_disable))
        .route("/v1/auth/webauthn/register/start", post(webauthn_register_start))
        .route("/v1/auth/webauthn/register/finish", post(webauthn_register_finish))
        .route("/v1/auth/webauthn/credentials", get(webauthn_credentials_list))
        .route(
            "/v1/auth/webauthn/credentials/{id}",
            axum::routing::delete(webauthn_credential_delete),
        )
        .route("/v1/auth/users/directory", get(list_auth_user_directory))
        .route("/v1/auth/users", get(list_auth_users).post(create_auth_user))
        .route(
            "/v1/auth/users/{id}",
            post(patch_auth_user).delete(remove_auth_user),
        )
        .route("/v1/auth/api-keys/mine", get(list_my_api_keys))
        .route("/v1/auth/api-keys/usage-by-user", get(list_auth_api_key_usage_by_user))
        .route(
            "/v1/auth/api-keys/suspend-user/{user_id}",
            post(suspend_auth_api_keys_for_user),
        )
        .route("/v1/auth/api-keys/{id}/reveal", get(reveal_auth_api_key))
        .route("/v1/auth/api-keys/{id}/suspend", post(suspend_auth_api_key))
        .route("/v1/auth/api-keys/{id}/unsuspend", post(unsuspend_auth_api_key))
        .route("/v1/auth/api-keys", get(list_auth_api_keys).post(create_auth_api_key))
        .route("/v1/auth/api-keys/{id}", axum::routing::delete(revoke_auth_api_key))
}

#[derive(Serialize)]
struct AuthStatusResponse {
    require_auth: bool,
}

async fn auth_status(State(state): State<AppState>) -> Json<AuthStatusResponse> {
    Json(AuthStatusResponse {
        require_auth: state.config.require_auth,
    })
}

fn require_admin(ctx: &AuthContext) -> Result<(), StatusCode> {
    if ctx.role != ApiRole::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(())
}

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct AuthUserResponse {
    user: UserRecord,
    token: String,
}

#[derive(Serialize)]
struct MfaRequiredResponse {
    mfa_required: bool,
    challenge_id: String,
    totp_available: bool,
    webauthn_available: bool,
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = authenticate(&state.pool.postgres, body.username.trim(), &body.password)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "invalid credentials".into()))?;

    let webauthn_available = user_has_webauthn(&state.pool.postgres, user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if user.totp_enabled || webauthn_available {
        let challenge_id = create_mfa_challenge(&state.pool.postgres, user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        return Ok(Json(serde_json::json!(MfaRequiredResponse {
            mfa_required: true,
            challenge_id: challenge_id.to_string(),
            totp_available: user.totp_enabled,
            webauthn_available,
        })));
    }

    let token = create_session(&state.pool.postgres, &user, true)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let record = user_to_record_async(&state.pool.postgres, &user)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!(AuthUserResponse {
        user: record,
        token,
    })))
}

#[derive(Deserialize)]
struct MfaBody {
    challenge_id: String,
    code: String,
}

async fn verify_mfa(
    State(state): State<AppState>,
    Json(body): Json<MfaBody>,
) -> Result<Json<AuthUserResponse>, (StatusCode, String)> {
    let challenge_id = Uuid::parse_str(body.challenge_id.trim())
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid challenge".into()))?;
    let user = get_mfa_challenge_user(&state.pool.postgres, challenge_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "challenge expired".into()))?;

    if !user.totp_enabled || !verify_user_totp(&user, &body.code) {
        return Err((StatusCode::UNAUTHORIZED, "invalid code".into()));
    }

    consume_mfa_challenge(&state.pool.postgres, challenge_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "challenge expired".into()))?;

    let token = create_session(&state.pool.postgres, &user, true)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let record = user_to_record_async(&state.pool.postgres, &user)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(AuthUserResponse {
        user: record,
        token,
    }))
}

fn webauthn_err(e: anyhow::Error) -> (StatusCode, String) {
    let msg = e.to_string();
    let lower = msg.to_lowercase();
    if lower.contains("expired") || lower.contains("invalid") || lower.contains("unknown") {
        (StatusCode::UNAUTHORIZED, msg)
    } else if lower.contains("localhost")
        || lower.contains("already registered")
        || lower.contains("no security")
        || lower.contains("origin")
        || lower.contains("configured for")
    {
        (StatusCode::BAD_REQUEST, msg)
    } else {
        (StatusCode::INTERNAL_SERVER_ERROR, msg)
    }
}

async fn load_webauthn_settings(state: &AppState) -> Result<WebauthnSettings, (StatusCode, String)> {
    let raw = state
        .settings
        .get("webauthn_config")
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(serde_json::from_value(raw).unwrap_or_default())
}

#[derive(Deserialize, Default)]
struct WebauthnSiteArgs {
    #[serde(default)]
    origin: String,
    #[serde(default)]
    rp_id: Option<String>,
}

#[derive(Deserialize)]
struct MfaWebauthnStartBody {
    challenge_id: String,
    #[serde(flatten)]
    site: WebauthnSiteArgs,
}

async fn mfa_webauthn_start(
    State(state): State<AppState>,
    Json(body): Json<MfaWebauthnStartBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let challenge_id = Uuid::parse_str(body.challenge_id.trim())
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid challenge".into()))?;
    let user = get_mfa_challenge_user(&state.pool.postgres, challenge_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "challenge expired".into()))?;
    let settings = load_webauthn_settings(&state).await?;
    let webauthn = webauthn_from_request(&body.site.origin, body.site.rp_id.as_deref(), &settings)
        .map_err(webauthn_err)?;
    let options = start_webauthn_authentication(&state.pool.postgres, &webauthn, user.id, challenge_id)
        .await
        .map_err(webauthn_err)?;
    Ok(Json(serde_json::to_value(options).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?))
}

#[derive(Deserialize)]
struct MfaWebauthnFinishBody {
    challenge_id: String,
    credential: serde_json::Value,
    #[serde(flatten)]
    site: WebauthnSiteArgs,
}

async fn mfa_webauthn_finish(
    State(state): State<AppState>,
    Json(body): Json<MfaWebauthnFinishBody>,
) -> Result<Json<AuthUserResponse>, (StatusCode, String)> {
    let challenge_id = Uuid::parse_str(body.challenge_id.trim())
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid challenge".into()))?;
    let user = get_mfa_challenge_user(&state.pool.postgres, challenge_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "challenge expired".into()))?;
    let credential = serde_json::from_value(body.credential)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid credential: {e}")))?;
    let settings = load_webauthn_settings(&state).await?;
    let webauthn = webauthn_from_request(&body.site.origin, body.site.rp_id.as_deref(), &settings)
        .map_err(webauthn_err)?;
    finish_webauthn_authentication(
        &state.pool.postgres,
        &webauthn,
        user.id,
        challenge_id,
        credential,
    )
    .await
    .map_err(webauthn_err)?;
    consume_mfa_challenge(&state.pool.postgres, challenge_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "challenge expired".into()))?;
    let token = create_session(&state.pool.postgres, &user, true)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let record = user_to_record_async(&state.pool.postgres, &user)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(AuthUserResponse {
        user: record,
        token,
    }))
}

async fn webauthn_register_start(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<WebauthnSiteArgs>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = ctx.user_id.ok_or((StatusCode::UNAUTHORIZED, "sign in required".into()))?;
    let username = ctx
        .user_username
        .as_deref()
        .ok_or((StatusCode::UNAUTHORIZED, "sign in required".into()))?;
    let settings = load_webauthn_settings(&state).await?;
    let webauthn = webauthn_from_request(&body.origin, body.rp_id.as_deref(), &settings).map_err(webauthn_err)?;
    let (challenge_id, ccr) =
        start_webauthn_registration(&state.pool.postgres, &webauthn, user_id, username)
            .await
            .map_err(webauthn_err)?;
    let mut value = serde_json::to_value(&ccr).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert("challenge_id".into(), serde_json::json!(challenge_id.to_string()));
    }
    Ok(Json(value))
}

#[derive(Deserialize)]
struct WebauthnRegisterFinishBody {
    challenge_id: String,
    credential: serde_json::Value,
    #[serde(default)]
    name: Option<String>,
    #[serde(flatten)]
    site: WebauthnSiteArgs,
}

async fn webauthn_register_finish(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<WebauthnRegisterFinishBody>,
) -> Result<Json<WebauthnCredentialRecord>, (StatusCode, String)> {
    let user_id = ctx.user_id.ok_or((StatusCode::UNAUTHORIZED, "sign in required".into()))?;
    let challenge_id = Uuid::parse_str(body.challenge_id.trim())
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid challenge".into()))?;
    let credential = serde_json::from_value(body.credential)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid credential: {e}")))?;
    let settings = load_webauthn_settings(&state).await?;
    let webauthn = webauthn_from_request(&body.site.origin, body.site.rp_id.as_deref(), &settings)
        .map_err(webauthn_err)?;
    finish_webauthn_registration(
        &state.pool.postgres,
        &webauthn,
        user_id,
        challenge_id,
        credential,
        body.name.as_deref(),
    )
    .await
    .map(Json)
    .map_err(webauthn_err)
}

async fn webauthn_credentials_list(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<Vec<WebauthnCredentialRecord>>, StatusCode> {
    let user_id = ctx.user_id.ok_or(StatusCode::UNAUTHORIZED)?;
    list_webauthn_credentials(&state.pool.postgres, user_id)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn webauthn_credential_delete(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = ctx.user_id.ok_or((StatusCode::UNAUTHORIZED, "sign in required".into()))?;
    let ok = delete_webauthn_credential(&state.pool.postgres, user_id, id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if ok {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "security key not found".into()))
    }
}

async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<StatusCode, StatusCode> {
    if let Some(token) = bearer_token(&headers) {
        delete_session(&state.pool.postgres, token)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn me(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<UserRecord>, StatusCode> {
    let user_id = ctx.user_id.ok_or(StatusCode::UNAUTHORIZED)?;
    get_by_id(&state.pool.postgres, user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)
        .map(Json)
}

#[derive(Serialize)]
struct TotpSetupResponse {
    secret: String,
    uri: String,
}

async fn totp_setup(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<TotpSetupResponse>, StatusCode> {
    let user_id = ctx.user_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let (secret, uri) = setup_totp(&state.pool.postgres, user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(TotpSetupResponse { secret, uri }))
}

#[derive(Deserialize)]
struct TotpCodeBody {
    code: String,
}

async fn totp_enable(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<TotpCodeBody>,
) -> Result<StatusCode, StatusCode> {
    let user_id = ctx.user_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let ok = enable_totp(&state.pool.postgres, user_id, &body.code)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if ok {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

async fn totp_disable(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<StatusCode, StatusCode> {
    let user_id = ctx.user_id.ok_or(StatusCode::UNAUTHORIZED)?;
    disable_totp(&state.pool.postgres, user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_auth_user_directory(
    State(state): State<AppState>,
) -> Result<Json<Vec<UserDirectoryEntry>>, StatusCode> {
    list_user_directory(&state.pool.postgres)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn list_auth_users(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<Vec<UserRecord>>, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    list_users(&state.pool.postgres)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Deserialize)]
struct CreateUserBody {
    username: String,
    password: String,
    #[serde(default = "default_role")]
    role: String,
}

fn default_role() -> String {
    "analyst".into()
}

async fn create_auth_user(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<CreateUserBody>,
) -> Result<Json<UserRecord>, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    create_user(
        &state.pool.postgres,
        &body.username,
        &body.password,
        &body.role,
    )
    .await
    .map(Json)
    .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

#[derive(Deserialize)]
struct PatchUserBody {
    role: Option<String>,
    password: Option<String>,
}

async fn patch_auth_user(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchUserBody>,
) -> Result<Json<UserRecord>, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    update_user(
        &state.pool.postgres,
        id,
        body.role.as_deref(),
        body.password.as_deref(),
    )
    .await
    .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "user not found".into()))
    .map(Json)
}

async fn remove_auth_user(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    if ctx.user_id == Some(id) {
        return Err((StatusCode::BAD_REQUEST, "cannot delete your own account".into()));
    }
    let ok = delete_user(&state.pool.postgres, id)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    if ok {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "user not found".into()))
    }
}

fn bearer_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
}

async fn list_auth_api_keys(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<Vec<mobipwn_core::auth::ApiKeyRecord>>, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    list_api_keys(&state.pool.postgres)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn list_my_api_keys(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<Vec<mobipwn_core::auth::ApiKeyRecord>>, (StatusCode, String)> {
    let user_id = ctx
        .user_id
        .ok_or((StatusCode::UNAUTHORIZED, "sign in to view your API keys".into()))?;
    list_api_keys_for_user(&state.pool.postgres, user_id)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn reveal_auth_api_key(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<Json<RevealApiKeyResponse>, (StatusCode, String)> {
    let token = reveal_api_key_token(&state.pool.postgres, id, &ctx)
        .await
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("forbidden") {
                (StatusCode::FORBIDDEN, msg)
            } else if msg.contains("not found") {
                (StatusCode::NOT_FOUND, msg)
            } else {
                (StatusCode::BAD_REQUEST, msg)
            }
        })?;
    Ok(Json(RevealApiKeyResponse { token }))
}

async fn create_auth_api_key(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Json(body): Json<CreateApiKeyRequest>,
) -> Result<Json<mobipwn_core::auth::CreateApiKeyResponse>, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    create_api_key(&state.pool.postgres, &body, ctx.user_id)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn revoke_auth_api_key(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    let ok = revoke_api_key(&state.pool.postgres, id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if ok {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "api key not found".into()))
    }
}

async fn list_auth_api_key_usage_by_user(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
) -> Result<Json<Vec<mobipwn_core::auth::ApiKeyUserUsage>>, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    list_api_key_usage_by_user(&state.pool.postgres)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Serialize)]
struct SuspendUserKeysResponse {
    suspended: u64,
}

async fn suspend_auth_api_keys_for_user(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<SuspendUserKeysResponse>, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    let suspended = suspend_api_keys_for_user(&state.pool.postgres, user_id)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(SuspendUserKeysResponse { suspended }))
}

async fn suspend_auth_api_key(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    let ok = suspend_api_key(&state.pool.postgres, id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if ok {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "api key not found or already suspended".into()))
    }
}

async fn unsuspend_auth_api_key(
    State(state): State<AppState>,
    Extension(ctx): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&ctx).map_err(|s| (s, "admin only".into()))?;
    let ok = unsuspend_api_key(&state.pool.postgres, id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if ok {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "api key not found or not suspended".into()))
    }
}
