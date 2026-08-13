use mobipwn_core::config::AppConfig;
use mobipwn_core::{bootstrap_from_env, DualPool, SettingsRepository};
use mobipwn_search::routes::{router, SearchState};
use std::net::SocketAddr;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = AppConfig::from_env();
    let pool = Arc::new(DualPool::connect(&config).await?);
    mobipwn_core::run_migrations(&pool.postgres).await?;
    let settings = Arc::new(SettingsRepository::new(pool.postgres.clone()));
    bootstrap_from_env(&settings, &config).await?;
    if let Err(e) = mobipwn_core::enrichment::ensure_enrichment_dictionaries(&config).await {
        tracing::warn!(error = %e, "failed to ensure ClickHouse enrichment dictionaries");
    }
    let state = SearchState {
        pool,
        config: config.clone(),
        settings,
    };

    let addr: SocketAddr = config.search_bind.parse()?;
    tracing::info!(%addr, "mobipwn-search listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router(state)).await?;
    Ok(())
}
