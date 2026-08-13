//! IronSift integration for mobipwn — MUDM extract, fleet/temporal/file runs, alert bridge.

mod alerts;
mod anomark;
mod config;
mod config_profiles;
mod constants;
mod engine;
mod extract;
mod pipeline;
mod process_enrich;
mod scope;
mod store;
mod system_rules;

pub use alerts::{promote_finding_to_alert, sync_findings_to_alerts};
pub use config::{
    load_anomark_config, load_ironsift_config_only, load_platform_config, merge_detection_config,
    merge_detection_config_with_override, save_anomark_config, save_platform_config,
    AnoMarkPlatformConfig, IronSiftPlatformConfig,
};
pub use config_profiles::{
    active_anomark_config_label, active_config_label_from_list, active_ironsift_config_label,
    create_anomark_profile, create_ironsift_profile, delete_anomark_profile,
    delete_ironsift_profile, get_anomark_profile, get_ironsift_profile, list_anomark_profiles,
    list_ironsift_profiles, select_anomark_profile, select_ironsift_profile, update_anomark_profile,
    update_ironsift_profile, ConfigProfile, ConfigProfileMeta, ConfigProfilesListResponse,
    CreateConfigProfileRequest, UpdateConfigProfileRequest, CUSTOM_CONFIG_LABEL,
};
pub use constants::{IRONSIFT_FILE_RULE_ID, IRONSIFT_FLEET_RULE_ID, IRONSIFT_TEMPORAL_RULE_ID};
pub use system_rules::{ensure_system_rules, filter_public_rules, is_system_rule_id};
pub use engine::{run_file_fleet, run_fleet, run_temporal, CreateRunRequest, RunOutcome};
pub use extract::{list_device_ids_for_filter, ScopeFilter};
pub use anomark::{
    default_suspect_percent, train_model_from_logs, AnoMarkCommandScore, AnoMarkModelInspection,
    AnoMarkTrainInspectResult, AnoMarkTrainRecord, AnoMarkTrainRequest, AnoMarkTrainResult,
    ScoreAnomarkCommandRequest, AnoMarkTrainsListResponse, delete_all_anomark_trains,
    delete_anomark_train, inspect_anomark_train, list_anomark_trains_with_selection,
    score_anomark_command, select_anomark_train_for_runs, train_anomark_model,
};
pub use scope::{fetch_scope_options, resolve_scope, IronSiftScopeOptions, ScopeCaseOption, ScopeSourceOption};
pub use pipeline::{maybe_run_post_ingest_temporal, run_pipeline, run_scheduled_fleet};
pub use store::{
    HoneycombCell, IronSiftDashboardStats, IronSiftFindingRecord, IronSiftRepository,
    IronSiftRunMode, IronSiftRunRecord, IronSiftRunScope, IronSiftRunStatus, IronSiftTriageRecord,
    IronSiftTriageVerdict, SaveFindingInput, SaveTriageInput, TriageMemoryEntry,
};
