use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use mobipwn_core::auth::{
    authenticate, consume_mfa_challenge, create_api_key, create_mfa_challenge, create_session,
    create_user, delete_session, delete_user, disable_totp, enable_totp, get_by_id, list_api_key_usage_by_user,
    list_api_keys, list_api_keys_for_user, list_user_directory, list_users, reveal_api_key_token, revoke_api_key,
    setup_totp, suspend_api_key, suspend_api_keys_for_user, unsuspend_api_key, update_user, user_to_record,
    verify_user_totp, ApiRole, AuthContext, CreateApiKeyRequest, RevealApiKeyResponse, UserDirectoryEntry,
    UserRecord,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Routes that do not require credentials (login, status).
pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/v1/auth/status", get(auth_status))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/mfa", post(verify_mfa))
}

/// Routes that require a valid session or API key.
pub fn protected_router() -> Router<AppState> {
    Router::new()
        .route("/v1/auth/logout", post(logout))
        .route("/v1/auth/me", get(me))
        .route("/v1/auth/totp/setup", post(totp_setup))
        .route("/v1/auth/totp/enable", post(totp_enable))
        .route("/v1/auth/totp/disable", post(totp_disable))
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
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = authenticate(&state.pool.postgres, body.username.trim(), &body.password)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "invalid credentials".into()))?;

    if user.totp_enabled {
        let challenge_id = create_mfa_challenge(&state.pool.postgres, user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        return Ok(Json(serde_json::json!(MfaRequiredResponse {
            mfa_required: true,
            challenge_id: challenge_id.to_string(),
        })));
    }

    let token = create_session(&state.pool.postgres, &user, true)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!(AuthUserResponse {
        user: user_to_record(&user),
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
    let user = consume_mfa_challenge(&state.pool.postgres, challenge_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "challenge expired".into()))?;

    if !verify_user_totp(&user, &body.code) {
        return Err((StatusCode::UNAUTHORIZED, "invalid code".into()));
    }

    let token = create_session(&state.pool.postgres, &user, true)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(AuthUserResponse {
        user: user_to_record(&user),
        token,
    }))
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
