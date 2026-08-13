use serde_json::Value;
use sqlx::PgPool;

pub struct SettingsRepository {
    pool: PgPool,
}

impl SettingsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn get(&self, key: &str) -> anyhow::Result<Value> {
        let v: Option<Value> = sqlx::query_scalar("SELECT value FROM siem_settings WHERE key = $1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?
            .flatten();
        Ok(v.unwrap_or(Value::Object(Default::default())))
    }

    pub async fn set(&self, key: &str, value: &Value) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO siem_settings (key, value, updated_at) VALUES ($1, $2, now()) \
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()",
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_keys(&self) -> anyhow::Result<Vec<String>> {
        let keys: Vec<String> = sqlx::query_scalar("SELECT key FROM siem_settings ORDER BY key")
            .fetch_all(&self.pool)
            .await?;
        Ok(keys)
    }
}
