//! mobipwn-core — Mobile Unified Data Model (MUDM), dual storage pools, alerts, detection.

pub mod alert_siem;
pub mod alerts;
pub mod case_compare;
pub mod backup;
pub mod auth;
pub mod case_audit;
pub mod cases_list;
pub mod ch;
pub mod collect_blob;
pub mod config;
pub mod data;
pub mod db;
pub mod detection;
pub mod entities;
pub mod endpoint_ingest;
pub mod enrichment;
pub mod health;
pub mod marketplace;
pub mod mudm;
pub mod net;
pub mod overview;
pub mod llm;
pub mod llm_assistant;
pub mod mcp_supervisor;
pub mod platform_settings;
pub mod plugins;
pub mod prevalence;
pub mod rules_dashboard;
pub mod short_id;
pub mod sigma_convert;
pub mod sigma_fields;
pub mod store;
pub mod yara_compile;

pub use case_compare::{
    attach_eligible_blob_hashes, compare_bugreport_cases, compare_cases, compare_entity_responses,
    compare_value_maps, enrich_eligible_case_identifiers, entity_type_label,
    is_android_bugreport_case, is_android_case, is_comparable_case, is_ios_case,
    BugreportComparisonResponse, CaseComparisonResponse, CompareCaseMeta, CompareEntityItem,
    ComparePlatform, CompareSummary, EntityCompareSection,
};
pub use backup::{
    export_backup, import_backup, list_section_info, parse_section_ids, BackupBundle, BackupSection,
    BackupSectionInfo, ImportBackupResult, ImportMode, BACKUP_FORMAT_VERSION,
};
pub use config::AppConfig;
pub use case_audit::{
    emit_case_audit, emit_case_comment, fetch_case_wall, normalize_note_type, CaseAuditAction,
    CaseAuditActor, CaseAuditExtras,
    CaseWallEntry,
};
pub use cases_list::list_cases_with_ingest;
pub use data::{
    clear_ingest_events_for_source, count_events_by_source, delete_ingest_source, fetch_data_summary,
    rename_ingest_source, ClearIngestEventsResponse, DataSummary, DeleteIngestResponse,
    RenameIngestSourceResponse, SourceSummary,
};
pub use db::{run_migrations, DualPool};
pub use entities::{
    apply_primary_anchor, entity_exists_in_response, fetch_case_entities, fetch_case_entities_with_config,
    CaseEntitiesResponse, EntityExtractConfig, PrimaryEntity,
};
pub use overview::{fetch_overview, OverviewStats};
pub use short_id::{normalize_id_token, resolve_uuid_token};
pub use rules_dashboard::{
    fetch_alert_velocity, fetch_fleet_health, list_repositories, list_repository_rules,
    FleetHealthSummary, RuleRepositoriesResponse, RepositoryRuleFile, VelocityBucket,
};
pub use alert_siem::{
    config_public, load_alert_to_siem_config, maybe_forward_detection_alert,
    maybe_forward_status_change_alert, save_alert_to_siem_config, test_siem_connection,
    AlertToSiemConfig, AlertToSiemConfigPublic, SiemDestination, SiemForwardOutcome,
    SplunkHecEndpoint, SplunkHostMode, KEY_ALERT_TO_SIEM_CONFIG,
};
pub use plugins::{
    apply_ironsift_plugin_enabled, is_plugin_enabled, list_plugins, load_plugins_config,
    plugin_catalog, plugin_descriptor, set_plugin_enabled, PlatformPluginsConfig, PluginInfo,
    PluginState, ALERT_TO_SIEM_PLUGIN_ID, BUGREPORT_COMPARISON_PLUGIN_ID, CASE_COMPARISON_PLUGIN_ID,
    COLLECTOR_PLUGIN_ID, DEVICE_ADVANCED_PLUGIN_ID, IRONSIFT_PLUGIN_ID, PUBLIC_COLLECT_PLUGIN_ID,
    KEY_PLATFORM_PLUGINS,
};
pub use platform_settings::{
    bootstrap_from_env, default_mcp_config, effective_app_config, is_local_llm_url, is_masked_secret,
    load_entity_limits_config, load_llm_config,
    load_mcp_config, load_public_collect_config, load_retention_by_source_type, load_search_limits,
    load_sysdiagnose_ingest_config, load_install_enrichment_config,
    llm_public, mcp_public, redact_llm_value, redact_mcp_value, save_llm_config, save_mcp_config,
    save_entity_limits_config, save_sysdiagnose_ingest_config, save_install_enrichment_config,
    public_collect_is_enabled, save_public_collect_config, AndroidCollectConfig, AndroidYaraRule,
    EntityLimitsConfig, IosCollectConfig, InstallEnrichmentConfig, InstallEnrichmentNamePattern,
    InstallEnrichmentRuleConfig, LlmConfig, LlmConfigPublic,
    McpConfig, McpConfigPublic, prepare_android_collect_config, prepare_sysdiagnose_ingest_config,
    prepare_install_enrichment_config, prepare_entity_limits_config, public_android_collect_config,
    public_collector_config, public_ios_collect_config, PublicAndroidCollectConfig,
    PublicCollectorConfig, PublicCollectConfig, PublicIosCollectConfig, SearchLimitsConfig,
    SysdiagnoseIngestConfig, SysdiagnoseIngestOverrides, apply_sysdiagnose_ingest_overrides,
    default_install_enrichment_config,
    LOGARCHIVE_FORENSIC_MAX_LINES, LOGARCHIVE_UNCAPPED_MIN_ENTRY_MB, MAX_ENTRY_MB_CEILING,
    KEY_ENTITY_LIMITS, KEY_INSTALL_ENRICHMENT, KEY_LLM, KEY_MCP, KEY_PUBLIC_COLLECT, KEY_RETENTION,
    KEY_SEARCH_LIMITS, KEY_SYSDIAGNOSE_INGEST,
};
pub use yara_compile::{compile_yara_source, compile_yara_sources, decode_yarc, encode_yarc};
pub use mcp_supervisor::{McpStatus, McpSupervisor, resolve_mcp_binary};
pub use llm::{
    finalize_assistant_content_public, is_weak_llm_reply, mock_reply, prepare_upstream_messages,
    test_connection, LlmChatRequest, LlmChatResponse, LlmMessage, LlmTestResult,
};
pub use llm_assistant::{
    fetch_alerts_for_assistant, format_alert_list_reply, format_alerts_live_context,
    is_direct_alert_list_request, parse_alert_status_filter, status_filter_label, wants_alert_data,
};
pub use store::{
    AlertActivityEntry, AlertActivityFilter, AlertActivityRepository,
    AlertDeletionAuditDetail, AlertDeletionAuditRepository, AlertDeletionAuditSummary,
    AlertEvent, AlertEventRepository, AlertRepository, AlertSiemForwardLog,
    AlertSiemForwardLogRepository, CaseRecord, CaseRepository, CreateCase,
    DeleteAuditInput,
    AllRuleRunSummaries, CreateSearchHistory, Dashboard, DashboardRepository, DetectionRun,
    DetectionRunRepository, FailedDetectionRun,
    CollectBlob, CollectBlobRepository, NewCollectBlob,
    case_ingest_label,
    IngestJob, IngestJobOptions, IngestJobRepository, JobsControlSummary, ProviderRepository, RuleFolderRecord,
    RuleListFilter, cancel_running_jobs, clear_stuck_enrichment_status,
    RuleOrganizationBundle, RuleOrganizationRepository, RuleRepository, RuleRepositoryRecord,
    RuleVersion,
    RuleVersionRepository, SavedQuery,
    SavedQueryFolder, SavedQueryFolderRepository, SavedQueriesBundle,
    SavedQueryRepository, SearchHistoryEntry, SearchHistoryRepository, SettingsRepository,
    SuppressionRepository, SuppressionWindow, UpdateCase,
};
