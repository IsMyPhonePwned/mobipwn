use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    ThreatIntel,
    Identity,
    AssetInventory,
    Geolocation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichmentProvider {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub kind: ProviderKind,
    pub enabled: bool,
    /// MUDM fields this provider can populate (e.g. src_ip → geo).
    pub covers_fields: Vec<String>,
    pub config: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_error: Option<String>,
    /// MUDM fields with synced enrichment rows in ClickHouse (populated by API list).
    #[serde(default)]
    pub enriched_field_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enriched_fields: Vec<String>,
}
