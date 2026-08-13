//! Prevalence summaries (artifact rarity) — backed by ClickHouse agg tables.

mod query;
mod scatter;

pub use query::{prevalence_score, row_rarity_score, should_suppress_prevalence};
pub use scatter::lookup_artifact_prevalence;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldPrevalence {
    pub field: String,
    pub value: String,
    pub event_count: u64,
    pub distinct_devices: u64,
    /// 0.0 = ubiquitous, 1.0 = unique in window.
    pub rarity_score: f64,
}
