use uuid::Uuid;

pub mod api_key_cipher;
pub mod api_keys;
pub mod permissions;
pub mod users;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiRole {
    Admin,
    Analyst,
    Viewer,
}

impl ApiRole {
    pub fn can_write_rules(self) -> bool {
        self.has(permissions::Permission::RulesWrite)
    }

    pub fn can_write_alerts(self) -> bool {
        self.has(permissions::Permission::AlertsWrite)
    }
}

#[derive(Debug, Clone)]
pub struct AuthContext {
    pub role: ApiRole,
    pub key_id: Option<Uuid>,
    /// Human label from api_keys.name when authenticated via X-API-Key.
    pub key_name: Option<String>,
    pub user_id: Option<Uuid>,
    /// Linked account username when authenticated via API key.
    pub user_username: Option<String>,
}

pub fn hash_key(key: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    format!("{:x}", h.finalize())
}

pub use api_keys::{
    create_api_key, generate_plaintext_key, list_api_key_usage_by_user, list_api_keys,
    list_api_keys_for_user, reveal_api_key_token, revoke_api_key, suspend_api_key,
    suspend_api_keys_for_user, touch_api_key_usage, unsuspend_api_key, verify_api_key, ApiKeyRecord,
    ApiKeyUserUsage, CreateApiKeyRequest, CreateApiKeyResponse, RevealApiKeyResponse,
};
pub use permissions::Permission;
pub use users::{
    authenticate, consume_mfa_challenge, count_users, create_mfa_challenge, create_session,
    create_user, delete_session, delete_user, disable_totp, enable_totp, ensure_bootstrap_admin,
    fetch_auth_activity, get_by_id, get_by_username, hash_password, is_stored_password_hash,
    list_user_directory, list_users, setup_totp, totp_uri, update_user, user_to_record,
    verify_password, verify_session, verify_totp, verify_user_totp, ActiveSession, AuthActivity,
    RecentLogin, UserDirectoryEntry, UserRecord,
};
