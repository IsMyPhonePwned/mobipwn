pub mod adapters;
mod ch;
mod clean;
mod options;
mod progress;
mod stats;
mod sync_metrics;
mod sync_status;
#[cfg(test)]
mod test_util;
pub mod provider;
pub mod schedule;
pub mod sync;

pub use adapters::{
    clickhouse_ip_indicator_key, normalize_indicator, test_google_play_lookup,
    test_virustotal_api_key,
};
pub use ch::{ensure_enrichment_dictionaries, reload_enrichment_dictionaries};
pub use clean::{clean_enrichment_data, CleanSummary};
pub use options::SyncOptions;
pub use stats::enrichment_field_stats;
pub use progress::{SyncProgress, SyncProgressEvent};
pub use provider::{adapter_for, builtin_catalog, config_schema_for, ProviderAdapter, SyncResult};
pub use sync_metrics::SyncStats;
pub use sync_status::{
    clear_enrichment_sync_cancel, clear_enrichment_sync_status, is_enrichment_sync_cancel_requested,
    is_enrichment_sync_stale, read_enrichment_sync_status, read_enrichment_sync_status_live,
    request_enrichment_sync_cancel, EnrichmentSyncStatus,
};
pub use schedule::{normalize_sync_cron, parse_sync_cron, DEFAULT_SYNC_CRON};
pub use sync::{
    sync_all_providers, sync_all_providers_with_progress, sync_single_provider,
    sync_single_provider_with_progress, ProviderSyncResult, SyncSummary,
};
