mod case;
mod extract;

pub use case::{fetch_case_entities, fetch_case_entities_with_config};
pub use extract::{
    apply_primary_anchor, entity_exists_in_response, extract_entities_from_events,
    extract_entities_from_events_with_config, EntityExtractConfig, EntityGraph, EntityType, EntityTypeSummary,
    ExtractedEntity, PrimaryEntity,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseEntitiesResponse {
    pub entities: Vec<EntityTypeSummary>,
    pub graph: EntityGraph,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_entity: Option<PrimaryEntity>,
    /// Auto-selected anchor before any case-level override is applied.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_primary_entity: Option<PrimaryEntity>,
    /// `auto` or `manual`.
    #[serde(default = "default_primary_entity_source")]
    pub primary_entity_source: String,
}

fn default_primary_entity_source() -> String {
    "auto".to_string()
}
