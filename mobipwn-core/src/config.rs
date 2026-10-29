use clickhouse::Client;
use std::time::Duration;

/// Release tag shown in the UI / `/health`. Docker builds set `MOBIPWN_VERSION` from `--tag`.
pub fn app_version() -> String {
    std::env::var("MOBIPWN_VERSION")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

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
    /// Max concurrent archive parse/insert workers in `mobipwn-api` (default 2).
    pub ingest_workers: usize,
    /// Max pending ingest jobs before HTTP 429 (`0` = unlimited). Env `MOBIPWN_INGEST_MAX_QUEUE`.
    pub ingest_max_queue: u32,
    /// Rows per ClickHouse insert chunk. Env `MOBIPWN_INGEST_INSERT_CHUNK`.
    pub ingest_insert_chunk_size: usize,
    /// `both` (default), `api-only` (queue only), or `worker` (process pool, health-only HTTP).
    pub ingest_mode: IngestMode,
    /// Durable upload/temp directory (shared across API + ingest worker). Env `MOBIPWN_UPLOAD_DIR`.
    pub upload_dir: String,
    /// Archive blob backend: `local` (default) or `s3`.
    pub archive_backend: ArchiveBackend,
    pub s3_bucket: Option<String>,
    pub s3_prefix: String,
    pub s3_region: String,
    pub s3_endpoint: Option<String>,
    pub s3_access_key: Option<String>,
    pub s3_secret_key: Option<String>,
}

/// How this process participates in archive ingest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestMode {
    /// Accept uploads and run the worker pool (single-node default).
    Both,
    /// Accept uploads / enqueue only — another process must run workers.
    ApiOnly,
    /// Run workers only (optional health listener on `api_bind`).
    Worker,
}

impl IngestMode {
    pub fn from_env_str(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "api-only" | "api_only" | "api" => Self::ApiOnly,
            "worker" | "workers" | "ingest-worker" => Self::Worker,
            _ => Self::Both,
        }
    }

    pub fn runs_workers(self) -> bool {
        matches!(self, Self::Both | Self::Worker)
    }

    pub fn serves_api(self) -> bool {
        matches!(self, Self::Both | Self::ApiOnly)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveBackend {
    Local,
    S3,
}

impl ArchiveBackend {
    pub fn from_env_str(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "s3" | "minio" | "object" => Self::S3,
            _ => Self::Local,
        }
    }
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
            ingest_workers: std::env::var("MOBIPWN_INGEST_WORKERS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(2)
                .max(1),
            ingest_max_queue: std::env::var("MOBIPWN_INGEST_MAX_QUEUE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(32),
            ingest_insert_chunk_size: std::env::var("MOBIPWN_INGEST_INSERT_CHUNK")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(25_000)
                .clamp(1_000, 500_000),
            ingest_mode: IngestMode::from_env_str(
                &std::env::var("MOBIPWN_INGEST_MODE").unwrap_or_else(|_| "both".into()),
            ),
            upload_dir: std::env::var("MOBIPWN_UPLOAD_DIR").unwrap_or_else(|_| {
                std::env::temp_dir()
                    .join("mobipwn_uploads")
                    .to_string_lossy()
                    .into_owned()
            }),
            archive_backend: ArchiveBackend::from_env_str(
                &std::env::var("MOBIPWN_ARCHIVE_BACKEND").unwrap_or_else(|_| "local".into()),
            ),
            s3_bucket: std::env::var("MOBIPWN_S3_BUCKET").ok().filter(|s| !s.is_empty()),
            s3_prefix: std::env::var("MOBIPWN_S3_PREFIX").unwrap_or_else(|_| "collect-blobs".into()),
            s3_region: std::env::var("MOBIPWN_S3_REGION").unwrap_or_else(|_| "us-east-1".into()),
            s3_endpoint: std::env::var("MOBIPWN_S3_ENDPOINT")
                .ok()
                .filter(|s| !s.is_empty()),
            s3_access_key: std::env::var("MOBIPWN_S3_ACCESS_KEY")
                .or_else(|_| std::env::var("AWS_ACCESS_KEY_ID"))
                .ok()
                .filter(|s| !s.is_empty()),
            s3_secret_key: std::env::var("MOBIPWN_S3_SECRET_KEY")
                .or_else(|_| std::env::var("AWS_SECRET_ACCESS_KEY"))
                .ok()
                .filter(|s| !s.is_empty()),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ingest_mode_from_env_str() {
        assert_eq!(IngestMode::from_env_str("both"), IngestMode::Both);
        assert_eq!(IngestMode::from_env_str("API-ONLY"), IngestMode::ApiOnly);
        assert_eq!(IngestMode::from_env_str("api_only"), IngestMode::ApiOnly);
        assert_eq!(IngestMode::from_env_str("worker"), IngestMode::Worker);
        assert_eq!(IngestMode::from_env_str("ingest-worker"), IngestMode::Worker);
        assert_eq!(IngestMode::from_env_str("nope"), IngestMode::Both);
    }

    #[test]
    fn ingest_mode_roles() {
        assert!(IngestMode::Both.runs_workers());
        assert!(IngestMode::Both.serves_api());
        assert!(!IngestMode::ApiOnly.runs_workers());
        assert!(IngestMode::ApiOnly.serves_api());
        assert!(IngestMode::Worker.runs_workers());
        assert!(!IngestMode::Worker.serves_api());
    }

    #[test]
    fn archive_backend_from_env_str() {
        assert_eq!(ArchiveBackend::from_env_str("local"), ArchiveBackend::Local);
        assert_eq!(ArchiveBackend::from_env_str("S3"), ArchiveBackend::S3);
        assert_eq!(ArchiveBackend::from_env_str("minio"), ArchiveBackend::S3);
        assert_eq!(ArchiveBackend::from_env_str("object"), ArchiveBackend::S3);
        assert_eq!(ArchiveBackend::from_env_str(""), ArchiveBackend::Local);
    }
}
