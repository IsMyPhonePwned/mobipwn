use clickhouse::Client;
use std::time::Duration;

fn clickhouse_user_from_env() -> Option<String> {
    match std::env::var("MOBIPWN_CLICKHOUSE_USER") {
        Ok(v) if v.is_empty() => None,
        Ok(v) => Some(v),
        Err(_) => Some("default".into()),
    }
}

fn clickhouse_password_from_env() -> Option<String> {
    match std::env::var("MOBIPWN_CLICKHOUSE_PASSWORD") {
        Ok(v) if v.is_empty() => None,
        Ok(v) => Some(v),
        // Matches docker-compose CLICKHOUSE_PASSWORD and .env.example
        Err(_) => Some("mobipwn".into()),
    }
}

/// Search query admission limits (nano-style guardrails).
#[derive(Debug, Clone)]
pub struct SearchAdmissionConfig {
    pub max_limit: u32,
    pub max_export_limit: u32,
    pub max_query_len: usize,
    pub require_time_range: bool,
    pub default_hours: u32,
    pub max_joins: usize,
    /// ClickHouse `max_execution_time` (seconds); 0 disables the server-side cap.
    pub max_execution_time_secs: u32,
}

impl Default for SearchAdmissionConfig {
    fn default() -> Self {
        Self {
            max_limit: 10_000,
            max_export_limit: 50_000,
            max_query_len: 8192,
            require_time_range: true,
            default_hours: 24,
            max_joins: 2,
            max_execution_time_secs: 60,
        }
    }
}

/// Runtime configuration (env-backed defaults for local dev).
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub postgres_url: String,
    pub clickhouse_url: String,
    pub clickhouse_user: Option<String>,
    pub clickhouse_password: Option<String>,
    pub clickhouse_database: String,
    pub events_ttl_days: u32,
    pub api_bind: String,
    pub search_bind: String,
    pub jobs_enabled: bool,
    pub search_admission: SearchAdmissionConfig,
    pub require_auth: bool,
    pub expose_dev_logs: bool,
}

impl AppConfig {
    pub fn search_service_url(&self) -> String {
        std::env::var("MOBIPWN_SEARCH_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:3002".into())
    }

    pub fn from_env() -> Self {
        Self {
            postgres_url: std::env::var("MOBIPWN_POSTGRES_URL")
                .unwrap_or_else(|_| "postgres://mobipwn:mobipwn@127.0.0.1:5432/mobipwn".into()),
            clickhouse_url: std::env::var("MOBIPWN_CLICKHOUSE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8123".into()),
            clickhouse_user: clickhouse_user_from_env(),
            clickhouse_password: clickhouse_password_from_env(),
            clickhouse_database: std::env::var("MOBIPWN_CLICKHOUSE_DB")
                .unwrap_or_else(|_| "mobipwn".into()),
            events_ttl_days: std::env::var("MOBIPWN_EVENTS_TTL_DAYS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(90),
            api_bind: std::env::var("MOBIPWN_API_BIND")
                .unwrap_or_else(|_| "0.0.0.0:3000".into()),
            search_bind: std::env::var("MOBIPWN_SEARCH_BIND")
                .unwrap_or_else(|_| "0.0.0.0:3002".into()),
            jobs_enabled: std::env::var("MOBIPWN_JOBS_ENABLED")
                .map(|v| v != "0" && v != "false")
                .unwrap_or(true),
            require_auth: std::env::var("MOBIPWN_REQUIRE_AUTH")
                .map(|v| v != "0" && v != "false")
                .unwrap_or(true),
            expose_dev_logs: std::env::var("MOBIPWN_EXPOSE_DEV_LOGS")
                .map(|v| v != "0" && v != "false")
                .unwrap_or(true),
            search_admission: SearchAdmissionConfig {
                max_limit: std::env::var("MOBIPWN_SEARCH_MAX_LIMIT")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(10_000),
                max_export_limit: std::env::var("MOBIPWN_SEARCH_MAX_EXPORT_LIMIT")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(50_000),
                max_query_len: std::env::var("MOBIPWN_SEARCH_MAX_QUERY_LEN")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(8192),
                require_time_range: std::env::var("MOBIPWN_SEARCH_REQUIRE_TIME_RANGE")
                    .map(|v| v != "0" && v != "false")
                    .unwrap_or(true),
                default_hours: std::env::var("MOBIPWN_SEARCH_DEFAULT_HOURS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(24),
                max_joins: std::env::var("MOBIPWN_SEARCH_MAX_JOINS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(2),
                max_execution_time_secs: std::env::var("MOBIPWN_SEARCH_MAX_EXECUTION_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(60),
            },
        }
    }

    pub fn clickhouse_query_timeout() -> Duration {
        Duration::from_secs(120)
    }

    /// ClickHouse HTTP client (URL, database, user/password from env).
    pub fn clickhouse_client(&self) -> Client {
        let mut client = Client::default()
            .with_url(&self.clickhouse_url)
            .with_database(&self.clickhouse_database);
        if let Some(user) = &self.clickhouse_user {
            client = client.with_user(user.clone());
        }
        if let Some(password) = &self.clickhouse_password {
            client = client.with_password(password.clone());
        }
        client
    }
}
