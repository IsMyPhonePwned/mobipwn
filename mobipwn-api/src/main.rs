mod alert_delete;
mod api_error;
mod auth;
mod case_audit;
mod effective_config;
mod ingest;
mod detection_hook;
mod ironsift_hook;
mod routes;
mod routes_extended;
mod routes_alert_siem;
mod routes_auth;
mod routes_backup;
mod routes_ironsift;
mod routes_case_compare;
mod routes_plugins;
mod routes_mcp;
mod routes_platform;
mod routes_public_collect;
mod routes_public_device_advanced;
mod routes_collect_blobs;
mod rbac;
mod routes_rules_ext;
mod settings_audit;
mod llm_chat;
mod llm_tools;

use auth::{log_api_key_usage, require_auth, AuthState};
use axum::middleware;
use axum::Router;
use rbac::enforce_rbac;
use clickhouse::Client;
use mobipwn_core::config::AppConfig;
use mobipwn_core::run_migrations;
use mobipwn_core::{
    bootstrap_from_env, AlertActivityRepository, AlertDeletionAuditRepository, AlertEventRepository, AlertRepository,
    CaseRepository,
    DashboardRepository,
    DetectionRunRepository, DualPool, IngestJobRepository, ProviderRepository,
    RuleOrganizationRepository, RuleRepository, CollectBlobRepository,
    SavedQueryFolderRepository, SavedQueryRepository, SearchHistoryRepository, SettingsRepository,
    SuppressionRepository, McpSupervisor,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[derive(OpenApi)]
#[openapi(tags((name = "mobipwn-api", description = "Mobile SIEM API")))]
struct ApiDoc;

#[derive(Clone)]
pub struct AppState {
    pub pool: Arc<DualPool>,
    pub clickhouse: Client,
    pub config: AppConfig,
    pub rules: Arc<RuleRepository>,
    pub rule_org: Arc<RuleOrganizationRepository>,
    pub alerts: Arc<AlertRepository>,
    pub providers: Arc<ProviderRepository>,
    pub saved_queries: Arc<SavedQueryRepository>,
    pub saved_query_folders: Arc<SavedQueryFolderRepository>,
    pub ingest_jobs: Arc<IngestJobRepository>,
    pub collect_blobs: Arc<CollectBlobRepository>,
    pub detection_runs: Arc<DetectionRunRepository>,
    pub alert_events: Arc<AlertEventRepository>,
    pub alert_deletion_audit: Arc<AlertDeletionAuditRepository>,
    pub alert_activity: Arc<AlertActivityRepository>,
    pub settings: Arc<SettingsRepository>,
    pub search_history: Arc<SearchHistoryRepository>,
    pub cases: Arc<CaseRepository>,
    pub dashboards: Arc<DashboardRepository>,
    pub suppressions: Arc<SuppressionRepository>,
    pub mcp: Arc<McpSupervisor>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = AppConfig::from_env();
    let pool = Arc::new(DualPool::connect(&config).await?);
    run_migrations(&pool.postgres).await?;
    mobipwn_ironsift::ensure_system_rules(&pool.postgres).await?;

    let admin_username =
        std::env::var("MOBIPWN_ADMIN_USER").unwrap_or_else(|_| "admin".into());
    let admin_password =
        std::env::var("MOBIPWN_ADMIN_PASSWORD").unwrap_or_else(|_| "admin".into());
    mobipwn_core::auth::ensure_bootstrap_admin(&pool.postgres, &admin_username, &admin_password)
        .await?;
    if let Ok(result) = sqlx::query(
        "UPDATE api_keys SET revoked_at = now() \
         WHERE name = 'env-bootstrap' AND revoked_at IS NULL",
    )
    .execute(&pool.postgres)
    .await
    {
        if result.rows_affected() > 0 {
            tracing::info!(
                count = result.rows_affected(),
                "revoked legacy env-bootstrap API keys — create per-user keys in Settings"
            );
        }
    }

    if let Ok(usage) = mobipwn_core::auth::list_api_key_usage_by_user(&pool.postgres).await {
        for row in usage {
            tracing::info!(
                user = %row.username,
                user_id = ?row.user_id,
                active_keys = row.active_keys,
                suspended_keys = row.suspended_keys,
                requests = row.request_count,
                response_bytes = row.response_bytes,
                last_used_at = ?row.last_used_at,
                "api key usage by user"
            );
        }
    }

    let settings = Arc::new(SettingsRepository::new(pool.postgres.clone()));
    bootstrap_from_env(&settings, &config).await?;

    let mcp = Arc::new(McpSupervisor::new(config.clone(), settings.clone()));

    let pg = pool.postgres.clone();
    let state = AppState {
        pool: pool.clone(),
        clickhouse: config.clickhouse_client(),
        config: config.clone(),
        rules: Arc::new(RuleRepository::new(pg.clone())),
        rule_org: Arc::new(RuleOrganizationRepository::new(pg.clone())),
        alerts: Arc::new(AlertRepository::new(pg.clone())),
        providers: Arc::new(ProviderRepository::new(pg.clone())),
        saved_queries: Arc::new(SavedQueryRepository::new(pg.clone())),
        saved_query_folders: Arc::new(SavedQueryFolderRepository::new(pg.clone())),
        ingest_jobs: Arc::new(IngestJobRepository::new(pg.clone())),
        collect_blobs: Arc::new(CollectBlobRepository::new(pg.clone())),
        detection_runs: Arc::new(DetectionRunRepository::new(pg.clone())),
        alert_events: Arc::new(AlertEventRepository::new(pg.clone())),
        alert_deletion_audit: Arc::new(AlertDeletionAuditRepository::new(pg.clone())),
        alert_activity: Arc::new(AlertActivityRepository::new(pg.clone())),
        search_history: Arc::new(SearchHistoryRepository::new(pg.clone())),
        cases: Arc::new(CaseRepository::new(pg.clone())),
        dashboards: Arc::new(DashboardRepository::new(pg.clone())),
        suppressions: Arc::new(SuppressionRepository::new(pg.clone())),
        settings: settings.clone(),
        mcp: mcp.clone(),
    };

    if let Err(e) = mcp.auto_start_if_configured().await {
        tracing::warn!(error = %e, "mobipwn-mcp auto_start skipped");
    }

    let auth_state = Arc::new(AuthState {
        pool: state.pool.postgres.clone(),
        config: config.clone(),
    });

    let public = routes_auth::public_router()
        .route("/health", axum::routing::get(routes::health))
        .merge(routes_public_collect::router())
        .merge(routes_public_device_advanced::router())
        .with_state(state.clone());

    let api = Router::new()
        .merge(routes::router())
        .merge(routes_extended::router())
        .merge(routes_platform::router())
        .merge(routes_ironsift::router())
        .merge(routes_case_compare::router())
        .merge(routes_plugins::router())
        .merge(routes_alert_siem::router())
        .merge(routes_mcp::router())
        .merge(routes_rules_ext::router())
        .merge(routes_backup::router())
        .merge(routes_collect_blobs::router())
        .merge(routes_auth::protected_router())
        .layer(middleware::from_fn(enforce_rbac))
        .layer(middleware::from_fn_with_state(
            auth_state.clone(),
            settings_audit::log_settings_audit,
        ))
        .layer(middleware::from_fn_with_state(auth_state.clone(), log_api_key_usage))
        .layer(middleware::from_fn_with_state(auth_state, require_auth))
        .with_state(state);

    let app = Router::new()
        .merge(public)
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .merge(api)
        .layer(CorsLayer::permissive());

    let addr: SocketAddr = config.api_bind.parse()?;
    tracing::info!(%addr, "mobipwn-api listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
