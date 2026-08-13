//! mobipwn-search — mPL (mobile PL) parser and ClickHouse SQL generation.

pub mod admission;
pub mod detection_run;
pub mod execute;
pub mod export;
pub mod pagination;
pub mod post_ingest_detection;
pub mod rule_validate;
pub mod field_stats;
pub mod prevalence_scatter;
pub mod mpl;
pub mod routes;
pub mod sql_gen;
pub mod timechart;
pub mod tokenize;

pub use detection_run::{
    execute_detection_rule, ExecuteDetectionOptions, ExecuteDetectionResult,
};
pub use execute::{
    run_field_stats, run_fields_in_scope, run_histogram, run_search, run_search_export,
    FieldStatsRequest, FieldStatsResponse, FieldsInScopeRequest, FieldsInScopeResponse,
    HistogramRequest, HistogramResponse, SearchExportRequest, SearchExportResponse,
    SearchRunRequest, SearchRunResponse,
};
pub use prevalence_scatter::{
    run_prevalence_scatter, PrevalenceScatterRequest, PrevalenceScatterResponse, ScatterPoint,
};
pub use mpl::{parse_mpl, MplQuery};
pub use post_ingest_detection::{
    run_post_ingest_detections, scope_rule_query_to_source, PostIngestDetectionSummary,
};
pub use rule_validate::{estimate_rule_cost, validate_detection_rule, RuleValidationResult};
pub use sql_gen::{
    apply_row_limit, generate_clickhouse_sql, generate_events_filter_sql,
    generate_events_where_clause,
};
pub use timechart::{effective_timechart_series_limit, should_skip_row_limit};
