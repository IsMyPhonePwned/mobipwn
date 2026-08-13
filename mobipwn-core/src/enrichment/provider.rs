use crate::config::AppConfig;
use crate::marketplace::ProviderKind;
use async_trait::async_trait;
use serde_json::Value;

use super::adapters::{
    AssetInventoryAdapter, GeoIpAdapter, GooglePlayAdapter, IdentityAdapter, ThreatIntelAdapter,
    VirusTotalAdapter,
};
use super::options::SyncOptions;
use super::progress::SyncProgress;
use super::sync_metrics::SyncStats;

#[derive(Debug, Clone, Default)]
pub struct SyncResult {
    pub rows_written: usize,
    pub stats: SyncStats,
}

impl SyncResult {
    pub fn with_rows(written: usize, options: &SyncOptions) -> Self {
        let mode = if options.full_resync {
            "full"
        } else {
            "incremental"
        };
        Self {
            rows_written: written,
            stats: SyncStats {
                rows_written: written as u32,
                mode: Some(mode.into()),
                ..Default::default()
            },
        }
    }
}

/// Built-in enrichment provider adapter (config-driven sync into ClickHouse).
#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn slug(&self) -> &'static str;
    fn config_schema(&self) -> Value;
    fn covers_fields(&self) -> &'static [&'static str];
    async fn sync(
        &self,
        config: &AppConfig,
        provider_cfg: &Value,
        progress: &SyncProgress,
        options: &SyncOptions,
    ) -> anyhow::Result<SyncResult>;
}

pub fn adapter_for(kind: ProviderKind, slug: &str) -> Option<Box<dyn ProviderAdapter>> {
    match kind {
        ProviderKind::Geolocation if slug == "geo_lite" => Some(Box::new(GeoIpAdapter)),
        ProviderKind::ThreatIntel if slug == "threatfox" => Some(Box::new(ThreatIntelAdapter)),
        ProviderKind::ThreatIntel if slug == "virustotal" => Some(Box::new(VirusTotalAdapter)),
        ProviderKind::AssetInventory if slug == "device_inventory" => Some(Box::new(AssetInventoryAdapter)),
        ProviderKind::AssetInventory if slug == "google_play" => Some(Box::new(GooglePlayAdapter)),
        ProviderKind::Identity if slug == "mobile_identity" => Some(Box::new(IdentityAdapter)),
        _ => None,
    }
}

pub fn config_schema_for(kind: ProviderKind, slug: &str) -> Option<Value> {
    adapter_for(kind, slug).map(|a| a.config_schema())
}

pub fn builtin_catalog() -> Vec<(&'static str, ProviderKind, Value, &'static [&'static str])> {
    let geo = GeoIpAdapter;
    let threat = ThreatIntelAdapter;
    let vt = VirusTotalAdapter;
    let asset = AssetInventoryAdapter;
    let google_play = GooglePlayAdapter;
    let identity = IdentityAdapter;
    vec![
        ("geo_lite", ProviderKind::Geolocation, geo.config_schema(), geo.covers_fields()),
        ("threatfox", ProviderKind::ThreatIntel, threat.config_schema(), threat.covers_fields()),
        (
            "virustotal",
            ProviderKind::ThreatIntel,
            vt.config_schema(),
            vt.covers_fields(),
        ),
        (
            "device_inventory",
            ProviderKind::AssetInventory,
            asset.config_schema(),
            asset.covers_fields(),
        ),
        (
            "google_play",
            ProviderKind::AssetInventory,
            google_play.config_schema(),
            google_play.covers_fields(),
        ),
        (
            "mobile_identity",
            ProviderKind::Identity,
            identity.config_schema(),
            identity.covers_fields(),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::marketplace::ProviderKind;

    #[test]
    fn sync_result_with_rows_sets_mode() {
        let inc = SyncResult::with_rows(3, &SyncOptions::incremental());
        assert_eq!(inc.rows_written, 3);
        assert_eq!(inc.stats.rows_written, 3);
        assert_eq!(inc.stats.mode.as_deref(), Some("incremental"));

        let full = SyncResult::with_rows(0, &SyncOptions::full_resync());
        assert_eq!(full.stats.mode.as_deref(), Some("full"));
    }

    #[test]
    fn adapter_for_known_providers() {
        assert!(adapter_for(ProviderKind::Geolocation, "geo_lite").is_some());
        assert!(adapter_for(ProviderKind::ThreatIntel, "virustotal").is_some());
        assert!(adapter_for(ProviderKind::ThreatIntel, "threatfox").is_some());
        assert!(adapter_for(ProviderKind::Identity, "mobile_identity").is_some());
        assert!(adapter_for(ProviderKind::AssetInventory, "device_inventory").is_some());
        assert!(adapter_for(ProviderKind::AssetInventory, "google_play").is_some());
    }

    #[test]
    fn adapter_for_rejects_unknown_slug() {
        assert!(adapter_for(ProviderKind::ThreatIntel, "unknown").is_none());
        assert!(adapter_for(ProviderKind::Geolocation, "virustotal").is_none());
    }

    #[test]
    fn config_schema_for_matches_adapter() {
        let schema = config_schema_for(ProviderKind::ThreatIntel, "virustotal").unwrap();
        assert!(schema.get("properties").and_then(|p| p.get("api_key")).is_some());
    }

    #[test]
    fn builtin_catalog_lists_all_providers() {
        let catalog = builtin_catalog();
        assert_eq!(catalog.len(), 6);
        let slugs: Vec<_> = catalog.iter().map(|(s, _, _, _)| *s).collect();
        assert!(slugs.contains(&"geo_lite"));
        assert!(slugs.contains(&"virustotal"));
        assert!(slugs.contains(&"google_play"));
        assert!(slugs.contains(&"threatfox"));
        assert!(slugs.contains(&"mobile_identity"));
        assert!(slugs.contains(&"device_inventory"));
    }
}
