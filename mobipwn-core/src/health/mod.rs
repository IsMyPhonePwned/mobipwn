mod db_stats;
mod docker_stats;
mod process_stats;

use db_stats::{fetch_database_storage, DatabaseStorageStats};
use docker_stats::{fetch_docker_container_stats, DockerContainerStats};
use process_stats::{fetch_mobipwn_process_health, CrateProcessStats, ProcessStats};

use crate::auth::{fetch_auth_activity, list_api_key_usage_by_user, ApiKeyUserUsage, AuthActivity};
use crate::config::AppConfig;
use crate::db::{DualPool, PoolHealth};
use crate::mcp_supervisor::McpSupervisor;
use crate::platform_settings::{load_llm_config, llm_public};
use crate::store::SettingsRepository;
use serde::Serialize;
use sqlx::PgPool;

#[derive(Debug, Serialize)]
pub struct IronSiftHealth {
    pub status: &'static str,
    pub detail: Option<String>,
    pub enabled: bool,
    pub total_runs: i64,
    pub anomark_models: i64,
}

#[derive(Debug, Serialize)]
pub struct LlmHealth {
    pub status: &'static str,
    pub configured: bool,
    pub model: String,
    pub api_url: String,
    pub local: bool,
    pub api_key_set: bool,
}

#[derive(Debug, Serialize)]
pub struct McpHealth {
    pub status: &'static str,
    pub running: bool,
    pub pid: Option<u32>,
    pub auto_start: bool,
    pub binary_found: bool,
    pub api_url: String,
    pub api_key_set: bool,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApiKeysUsageHealth {
    pub active_keys: i64,
    pub suspended_keys: i64,
    pub total_requests: i64,
    pub total_response_bytes: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub by_user: Option<Vec<ApiKeyUserUsage>>,
}

#[derive(Debug, Serialize)]
pub struct IntegrationsHealth {
    pub llm: LlmHealth,
    pub mcp: McpHealth,
    pub api_keys: ApiKeysUsageHealth,
}

#[derive(Debug, Serialize)]
pub struct HealthDetail {
    pub postgres: ComponentHealth,
    pub clickhouse: ComponentHealth,
    pub ironsift: IronSiftHealth,
    pub alerting_rules: i64,
    pub failed_rules_24h: i64,
    pub pending_ingest_jobs: i64,
    pub process: ProcessStats,
    pub crates: Vec<CrateProcessStats>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub docker_containers: Vec<DockerContainerStats>,
    pub storage: DatabaseStorageStats,
    pub integrations: IntegrationsHealth,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthActivity>,
}

#[derive(Debug, Serialize)]
pub struct ComponentHealth {
    pub status: &'static str,
    pub detail: Option<String>,
}

pub async fn fetch_health_detail(
    pool: &DualPool,
    config: &AppConfig,
    settings: Option<&SettingsRepository>,
    mcp: Option<&McpSupervisor>,
    include_api_key_usage_by_user: bool,
) -> anyhow::Result<HealthDetail> {
    let pg = postgres_health(&pool.postgres).await?;
    let ch = match pool.health().await {
        PoolHealth::Full => clickhouse_health(config).await?,
        PoolHealth::PostgresOnly => ComponentHealth {
            status: "degraded",
            detail: Some("unreachable".into()),
        },
    };

    let alerting_rules: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM detection_rules WHERE lifecycle = 'alerting'")
            .fetch_one(&pool.postgres)
            .await
            .unwrap_or(0);

    let failed_rules_24h: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM detection_runs WHERE error IS NOT NULL AND started_at > now() - interval '24 hours'",
    )
    .fetch_one(&pool.postgres)
    .await
    .unwrap_or(0);

    let pending_ingest_jobs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ingest_jobs WHERE status IN ('pending', 'running')",
    )
    .fetch_one(&pool.postgres)
    .await
    .unwrap_or(0);

    let (process, crates) = fetch_mobipwn_process_health().await;
    let docker_containers = fetch_docker_container_stats().await;
    let storage = fetch_database_storage(pool, config).await;
    let auth = if include_api_key_usage_by_user {
        fetch_auth_activity(&pool.postgres).await.ok().flatten()
    } else {
        None
    };
    let ironsift = ironsift_health(&pool.postgres).await;
    let integrations = fetch_integrations_health(
        &pool.postgres,
        settings,
        mcp,
        include_api_key_usage_by_user,
    )
    .await;

    Ok(HealthDetail {
        postgres: pg,
        clickhouse: ch,
        ironsift,
        alerting_rules,
        failed_rules_24h,
        pending_ingest_jobs,
        process,
        crates,
        docker_containers,
        storage,
        integrations,
        auth,
    })
}

async fn fetch_integrations_health(
    pool: &PgPool,
    settings: Option<&SettingsRepository>,
    mcp: Option<&McpSupervisor>,
    include_by_user: bool,
) -> IntegrationsHealth {
    IntegrationsHealth {
        llm: fetch_llm_health(settings).await,
        mcp: fetch_mcp_health(mcp).await,
        api_keys: fetch_api_keys_usage(pool, include_by_user).await,
    }
}

async fn fetch_llm_health(settings: Option<&SettingsRepository>) -> LlmHealth {
    let Some(settings) = settings else {
        return LlmHealth {
            status: "unknown",
            configured: false,
            model: String::new(),
            api_url: String::new(),
            local: false,
            api_key_set: false,
        };
    };
    let cfg = load_llm_config(settings).await.unwrap_or_default();
    let public = llm_public(&cfg);
    let configured = !public.api_url.is_empty() && !public.model.is_empty();
    LlmHealth {
        status: if configured {
            "configured"
        } else {
            "not_configured"
        },
        configured,
        model: public.model,
        api_url: public.api_url,
        local: public.local,
        api_key_set: public.api_key_set,
    }
}

async fn fetch_mcp_health(mcp: Option<&McpSupervisor>) -> McpHealth {
    let Some(mcp) = mcp else {
        return McpHealth {
            status: "unknown",
            running: false,
            pid: None,
            auto_start: false,
            binary_found: false,
            api_url: String::new(),
            api_key_set: false,
            started_at: None,
            last_error: None,
        };
    };
    match mcp.status().await {
        Ok(s) => {
            let status = if s.running {
                "running"
            } else if s.last_error.is_some() {
                "error"
            } else {
                "stopped"
            };
            McpHealth {
                status,
                running: s.running,
                pid: s.pid,
                auto_start: s.auto_start,
                binary_found: s.binary_found,
                api_url: s.api_url,
                api_key_set: s.api_key_set,
                started_at: s.started_at,
                last_error: s.last_error,
            }
        }
        Err(e) => McpHealth {
            status: "error",
            running: false,
            pid: None,
            auto_start: false,
            binary_found: false,
            api_url: String::new(),
            api_key_set: false,
            started_at: None,
            last_error: Some(e.to_string()),
        },
    }
}

async fn fetch_api_keys_usage(pool: &PgPool, include_by_user: bool) -> ApiKeysUsageHealth {
    let row: Option<(i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT COUNT(*)::bigint AS active_keys, \
         COUNT(*) FILTER (WHERE suspended_at IS NOT NULL)::bigint AS suspended_keys, \
         COALESCE(SUM(request_count), 0)::bigint AS total_requests, \
         COALESCE(SUM(response_bytes), 0)::bigint AS total_response_bytes \
         FROM api_keys WHERE revoked_at IS NULL",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let (active_keys, suspended_keys, total_requests, total_response_bytes) =
        row.unwrap_or((0, 0, 0, 0));

    let by_user = if include_by_user {
        list_api_key_usage_by_user(pool).await.ok()
    } else {
        None
    };

    ApiKeysUsageHealth {
        active_keys,
        suspended_keys,
        total_requests,
        total_response_bytes,
        by_user,
    }
}

async fn postgres_health(pool: &PgPool) -> anyhow::Result<ComponentHealth> {
    sqlx::query("SELECT 1").execute(pool).await?;
    Ok(ComponentHealth {
        status: "up",
        detail: None,
    })
}

async fn ironsift_health(pool: &PgPool) -> IronSiftHealth {
    let tables_ok = sqlx::query_scalar::<_, i32>(
        "SELECT COUNT(*)::int FROM information_schema.tables \
         WHERE table_schema = 'public' AND table_name IN ('ironsift_runs', 'ironsift_findings')",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0)
        >= 2;

    if !tables_ok {
        return IronSiftHealth {
            status: "down",
            detail: Some("migrations missing (ironsift_runs)".into()),
            enabled: false,
            total_runs: 0,
            anomark_models: 0,
        };
    }

    let config: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT value FROM siem_settings WHERE key = 'ironsift_config'")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    let enabled = config
        .as_ref()
        .and_then(|v| v.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let total_runs: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM ironsift_runs")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let anomark_models: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM ironsift_anomark_trains")
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    let status = if enabled { "up" } else { "disabled" };
    let detail = if enabled {
        Some(format!("{total_runs} runs · {anomark_models} AnoMark models"))
    } else {
        Some("disabled in settings".into())
    };

    IronSiftHealth {
        status,
        detail,
        enabled,
        total_runs,
        anomark_models,
    }
}

async fn clickhouse_health(config: &AppConfig) -> anyhow::Result<ComponentHealth> {
    let url = format!(
        "{}/?query=SELECT%201",
        config.clickhouse_url.trim_end_matches('/')
    );
    let mut req = reqwest::Client::new().get(&url);
    if let Some(user) = &config.clickhouse_user {
        req = req.header("X-ClickHouse-User", user);
    }
    if let Some(password) = &config.clickhouse_password {
        req = req.header("X-ClickHouse-Key", password);
    }
    let resp = req.send().await?;
    if resp.status().is_success() {
        Ok(ComponentHealth {
            status: "up",
            detail: None,
        })
    } else {
        Ok(ComponentHealth {
            status: "down",
            detail: Some(resp.status().to_string()),
        })
    }
}
