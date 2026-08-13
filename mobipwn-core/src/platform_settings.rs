use crate::config::{AppConfig, SearchAdmissionConfig};
use crate::plugins::{is_plugin_enabled, COLLECTOR_PLUGIN_ID};
use crate::store::SettingsRepository;
use crate::yara_compile::{compile_yara_source, compile_yara_sources, encode_yarc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

pub const KEY_LLM: &str = "llm_config";
pub const KEY_SEARCH_LIMITS: &str = "search_limits";
pub const KEY_SYSDIAGNOSE_INGEST: &str = "sysdiagnose_ingest";
pub const KEY_ENTITY_LIMITS: &str = "entity_limits";
pub const KEY_RETENTION: &str = "retention_by_source_type";
pub const KEY_MCP: &str = "mcp_config";
pub const KEY_PUBLIC_COLLECT: &str = "public_collect_config";

const MASKED_SECRET: &str = "********";

pub fn is_local_llm_url(api_url: &str) -> bool {
    let u = api_url.trim().to_lowercase();
    u.contains("localhost")
        || u.contains("127.0.0.1")
        || u.contains("[::1]")
        || u.starts_with("http://0.0.0.0")
}

fn default_llm_model() -> String {
    String::new()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpConfig {
    #[serde(default = "default_mcp_auto_start")]
    pub auto_start: bool,
    #[serde(default = "default_mcp_api_url")]
    pub api_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub binary_path: String,
}

fn default_mcp_auto_start() -> bool {
    true
}

fn default_mcp_api_url() -> String {
    "http://127.0.0.1:3000".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfigPublic {
    pub auto_start: bool,
    pub api_url: String,
    pub api_key_set: bool,
    pub binary_path: String,
}

pub fn mcp_public(cfg: &McpConfig) -> McpConfigPublic {
    McpConfigPublic {
        auto_start: cfg.auto_start,
        api_url: cfg.api_url.clone(),
        api_key_set: !cfg.api_key.is_empty(),
        binary_path: cfg.binary_path.clone(),
    }
}

pub fn redact_mcp_value(raw: &Value) -> Value {
    let mut out = raw.clone();
    if let Some(obj) = out.as_object_mut() {
        if obj.contains_key("api_key") {
            obj.insert(
                "api_key".into(),
                Value::String(if obj
                    .get("api_key")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty())
                {
                    MASKED_SECRET.into()
                } else {
                    String::new()
                }),
            );
        }
        obj.insert(
            "api_key_set".into(),
            Value::Bool(
                obj.get("api_key")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty()),
            ),
        );
    }
    out
}

pub async fn load_mcp_config(
    settings: &SettingsRepository,
    env: &AppConfig,
) -> anyhow::Result<McpConfig> {
    let raw = settings.get(KEY_MCP).await?;
    if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        return Ok(default_mcp_config(env));
    }
    let mut cfg: McpConfig = serde_json::from_value(raw)?;
    if cfg.api_url.trim().is_empty() {
        cfg.api_url = default_mcp_api_url_from_env(env);
    }
    Ok(cfg)
}

pub fn default_mcp_config(env: &AppConfig) -> McpConfig {
    McpConfig {
        auto_start: std::env::var("MOBIPWN_MCP_AUTO_START")
            .map(|v| v != "0" && v != "false")
            .unwrap_or(true),
        api_url: default_mcp_api_url_from_env(env),
        api_key: String::new(),
        binary_path: std::env::var("MOBIPWN_MCP_BIN").unwrap_or_default(),
    }
}

fn default_mcp_api_url_from_env(env: &AppConfig) -> String {
    std::env::var("MOBIPWN_API_URL").unwrap_or_else(|_| {
        if env.api_bind.starts_with("0.0.0.0:") {
            format!("http://127.0.0.1:{}", env.api_bind.trim_start_matches("0.0.0.0:"))
        } else if env.api_bind.starts_with(':') {
            format!("http://127.0.0.1{}", env.api_bind)
        } else {
            format!("http://{}", env.api_bind)
        }
    })
}

pub async fn save_mcp_config(
    settings: &SettingsRepository,
    incoming: &McpConfig,
) -> anyhow::Result<()> {
    let mut next = incoming.clone();
    if is_masked_secret(&next.api_key) {
        let raw = settings.get(KEY_MCP).await?;
        if let Ok(existing) = serde_json::from_value::<McpConfig>(raw) {
            next.api_key = existing.api_key;
        }
    }
    settings
        .set(KEY_MCP, &serde_json::to_value(next)?)
        .await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LlmConfig {
    #[serde(default)]
    pub api_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_llm_model")]
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfigPublic {
    pub api_url: String,
    pub model: String,
    pub api_key_set: bool,
    pub local: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchLimitsConfig {
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent: u32,
    #[serde(default = "default_max_limit")]
    pub max_limit: u32,
    #[serde(default = "default_max_export_limit")]
    pub max_export_limit: u32,
    #[serde(default = "default_max_query_len")]
    pub max_query_len: usize,
    #[serde(default = "default_true")]
    pub require_time_range: bool,
    #[serde(default = "default_default_hours")]
    pub default_hours: u32,
    #[serde(default = "default_max_joins")]
    pub max_joins: usize,
    #[serde(default = "default_max_execution_time_secs")]
    pub max_execution_time_secs: u32,
    #[serde(default = "default_events_ttl_days")]
    pub events_ttl_days: u32,
}

fn default_entity_limit() -> usize {
    50
}

fn default_process_entity_limit() -> usize {
    500
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityLimitsConfig {
    #[serde(default = "default_entity_limit")]
    pub default_limit: usize,
    #[serde(default = "default_process_entity_limit")]
    pub process_limit: usize,
}

impl Default for EntityLimitsConfig {
    fn default() -> Self {
        Self {
            default_limit: default_entity_limit(),
            process_limit: default_process_entity_limit(),
        }
    }
}

pub fn prepare_entity_limits_config(cfg: &mut EntityLimitsConfig) {
    cfg.default_limit = cfg.default_limit.clamp(1, 5_000);
    cfg.process_limit = cfg.process_limit.clamp(1, 20_000);
}

fn default_max_concurrent() -> u32 {
    4
}
fn default_max_limit() -> u32 {
    10_000
}
fn default_max_export_limit() -> u32 {
    50_000
}
fn default_max_query_len() -> usize {
    8192
}
fn default_true() -> bool {
    true
}
fn default_default_hours() -> u32 {
    24
}
fn default_max_joins() -> usize {
    2
}
fn default_max_execution_time_secs() -> u32 {
    60
}
fn default_events_ttl_days() -> u32 {
    90
}

impl Default for SearchLimitsConfig {
    fn default() -> Self {
        Self {
            max_concurrent: default_max_concurrent(),
            max_limit: default_max_limit(),
            max_export_limit: default_max_export_limit(),
            max_query_len: default_max_query_len(),
            require_time_range: default_true(),
            default_hours: default_default_hours(),
            max_joins: default_max_joins(),
            max_execution_time_secs: default_max_execution_time_secs(),
            events_ttl_days: default_events_ttl_days(),
        }
    }
}

impl SearchLimitsConfig {
    pub fn from_env_config(config: &AppConfig) -> Self {
        Self {
            max_concurrent: default_max_concurrent(),
            max_limit: config.search_admission.max_limit,
            max_export_limit: config.search_admission.max_export_limit,
            max_query_len: config.search_admission.max_query_len,
            require_time_range: config.search_admission.require_time_range,
            default_hours: config.search_admission.default_hours,
            max_joins: config.search_admission.max_joins,
            max_execution_time_secs: config.search_admission.max_execution_time_secs,
            events_ttl_days: config.events_ttl_days,
        }
    }

    pub fn to_admission(&self) -> SearchAdmissionConfig {
        SearchAdmissionConfig {
            max_limit: self.max_limit,
            max_export_limit: self.max_export_limit,
            max_query_len: self.max_query_len,
            require_time_range: self.require_time_range,
            default_hours: self.default_hours,
            max_joins: self.max_joins,
            max_execution_time_secs: self.max_execution_time_secs,
        }
    }
}

pub fn is_masked_secret(value: &str) -> bool {
    value.is_empty() || value == MASKED_SECRET
}

pub fn llm_public(cfg: &LlmConfig) -> LlmConfigPublic {
    LlmConfigPublic {
        api_url: cfg.api_url.clone(),
        model: cfg.model.clone(),
        api_key_set: !cfg.api_key.is_empty(),
        local: is_local_llm_url(&cfg.api_url),
    }
}

pub fn redact_llm_value(raw: &Value) -> Value {
    let mut out = raw.clone();
    if let Some(obj) = out.as_object_mut() {
        if obj.contains_key("api_key") {
            obj.insert(
                "api_key".into(),
                Value::String(if obj
                    .get("api_key")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty())
                {
                    MASKED_SECRET.into()
                } else {
                    String::new()
                }),
            );
        }
        obj.insert(
            "api_key_set".into(),
            Value::Bool(
                obj.get("api_key")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty()),
            ),
        );
    }
    out
}

pub async fn load_llm_config(settings: &SettingsRepository) -> anyhow::Result<LlmConfig> {
    let raw = settings.get(KEY_LLM).await?;
    if !raw.is_null() && raw.as_object().is_some_and(|o| !o.is_empty()) {
        return Ok(serde_json::from_value(raw)?);
    }
    Ok(LlmConfig::default())
}

pub async fn save_llm_config(
    settings: &SettingsRepository,
    incoming: &LlmConfig,
) -> anyhow::Result<()> {
    let mut next = incoming.clone();
    if is_masked_secret(&next.api_key) {
        let existing = load_llm_config(settings).await?;
        next.api_key = existing.api_key;
    }
    settings
        .set(KEY_LLM, &serde_json::to_value(next)?)
        .await?;
    Ok(())
}

pub async fn load_search_limits(
    settings: &SettingsRepository,
    env: &AppConfig,
) -> anyhow::Result<SearchLimitsConfig> {
    let raw = settings.get(KEY_SEARCH_LIMITS).await?;
    if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        return Ok(SearchLimitsConfig::from_env_config(env));
    }
    let mut cfg: SearchLimitsConfig = serde_json::from_value(raw)?;
    let defaults = SearchLimitsConfig::from_env_config(env);
    if cfg.max_limit == 0 {
        cfg.max_limit = defaults.max_limit;
    }
    if cfg.max_export_limit == 0 {
        cfg.max_export_limit = defaults.max_export_limit;
    }
    if cfg.max_query_len == 0 {
        cfg.max_query_len = defaults.max_query_len;
    }
    if cfg.default_hours == 0 {
        cfg.default_hours = defaults.default_hours;
    }
    if cfg.events_ttl_days == 0 {
        cfg.events_ttl_days = defaults.events_ttl_days;
    }
    Ok(cfg)
}

pub async fn load_retention_by_source_type(
    settings: &SettingsRepository,
) -> anyhow::Result<HashMap<String, u32>> {
    let raw = settings.get(KEY_RETENTION).await?;
    let mut out = HashMap::new();
    let Some(obj) = raw.as_object() else {
        return Ok(out);
    };
    for (k, v) in obj {
        if let Some(days) = v.as_u64().or_else(|| v.as_i64().map(|n| n as u64)) {
            if days > 0 {
                out.insert(k.clone(), days as u32);
            }
        }
    }
    Ok(out)
}

pub async fn load_entity_limits_config(
    settings: &SettingsRepository,
) -> anyhow::Result<EntityLimitsConfig> {
    let raw = settings.get(KEY_ENTITY_LIMITS).await?;
    if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        return Ok(EntityLimitsConfig::default());
    }
    let mut cfg: EntityLimitsConfig = serde_json::from_value(raw)?;
    prepare_entity_limits_config(&mut cfg);
    Ok(cfg)
}

pub async fn save_entity_limits_config(
    settings: &SettingsRepository,
    incoming: &EntityLimitsConfig,
) -> anyhow::Result<()> {
    let mut next = incoming.clone();
    prepare_entity_limits_config(&mut next);
    settings
        .set(KEY_ENTITY_LIMITS, &serde_json::to_value(next)?)
        .await?;
    Ok(())
}

pub async fn effective_app_config(
    settings: &SettingsRepository,
    base: &AppConfig,
) -> anyhow::Result<AppConfig> {
    let limits = load_search_limits(settings, base).await?;
    let mut cfg = base.clone();
    cfg.search_admission = limits.to_admission();
    cfg.events_ttl_days = limits.events_ttl_days;
    Ok(cfg)
}

fn env_llm_var(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IosCollectConfig {
    #[serde(default = "default_true")]
    pub upload_enabled: bool,
    #[serde(default = "default_ios_instructions")]
    pub instructions: String,
}

fn default_ios_instructions() -> String {
    "Upload a sysdiagnose .tar.gz archive collected on the device (Settings → Privacy & Security → Analytics & Improvements → Analytics Data).".into()
}

impl Default for IosCollectConfig {
    fn default() -> Self {
        Self {
            upload_enabled: true,
            instructions: default_ios_instructions(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AndroidYaraRule {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compiled_b64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compile_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AndroidCollectConfig {
    #[serde(default = "default_android_commands")]
    pub default_commands: Vec<String>,
    #[serde(default = "default_android_find_paths")]
    pub find_paths: Vec<String>,
    #[serde(default = "default_android_max_depth")]
    pub max_depth: u32,
    #[serde(default = "default_android_find_paths")]
    pub yara_paths: Vec<String>,
    #[serde(default = "default_android_max_depth")]
    pub yara_max_depth: u32,
    /// When true, `find` passes `--hash` (slow; metadata-only is the default).
    #[serde(default)]
    pub hash_files: bool,
    /// Max file size to hash when `hash_files` is true (`--max-hash-size`, bytes).
    #[serde(default = "default_android_max_hash_size")]
    pub max_hash_size: u64,
    /// Extra directory glob patterns passed as repeated `--exclude-dir` flags.
    #[serde(default)]
    pub exclude_dirs: Vec<String>,
    #[serde(default)]
    pub yara_rules: Vec<AndroidYaraRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub yara_bundle_b64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub yara_bundle_error: Option<String>,
    /// Device paths to pull wholesale into blob storage (no immediate analysis).
    #[serde(default)]
    pub pull_repository_paths: Vec<String>,
    #[serde(default = "default_pull_max_depth")]
    pub pull_max_depth: u32,
    #[serde(default = "default_pull_max_file_size")]
    pub pull_max_file_size: u64,
    #[serde(default = "default_pull_max_files")]
    pub pull_max_files: u32,
}

fn default_android_commands() -> Vec<String> {
    vec!["find".into()]
}

fn default_android_find_paths() -> Vec<String> {
    vec!["/sdcard".into(), "/data/local/tmp".into()]
}

fn default_android_max_depth() -> u32 {
    3
}

fn default_android_max_hash_size() -> u64 {
    512 * 1024
}

fn default_pull_max_depth() -> u32 {
    5
}

fn default_pull_max_file_size() -> u64 {
    50 * 1024 * 1024
}

fn default_pull_max_files() -> u32 {
    500
}

impl Default for AndroidCollectConfig {
    fn default() -> Self {
        Self {
            default_commands: default_android_commands(),
            find_paths: default_android_find_paths(),
            max_depth: default_android_max_depth(),
            yara_paths: default_android_find_paths(),
            yara_max_depth: default_android_max_depth(),
            hash_files: false,
            max_hash_size: default_android_max_hash_size(),
            exclude_dirs: Vec::new(),
            yara_rules: Vec::new(),
            yara_bundle_b64: None,
            yara_bundle_error: None,
            pull_repository_paths: default_android_find_paths(),
            pull_max_depth: default_pull_max_depth(),
            pull_max_file_size: default_pull_max_file_size(),
            pull_max_files: default_pull_max_files(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicAndroidCollectConfig {
    pub default_commands: Vec<String>,
    pub find_paths: Vec<String>,
    pub max_depth: u32,
    pub yara_paths: Vec<String>,
    pub yara_max_depth: u32,
    pub hash_files: bool,
    pub max_hash_size: u64,
    pub exclude_dirs: Vec<String>,
    pub yara_rule_names: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yara_bundle_b64: Option<String>,
    pub pull_repository_paths: Vec<String>,
    pub pull_max_depth: u32,
    pub pull_max_file_size: u64,
    pub pull_max_files: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicIosCollectConfig {
    pub upload_enabled: bool,
    pub instructions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicCollectorConfig {
    pub android: PublicAndroidCollectConfig,
    pub ios: PublicIosCollectConfig,
    /// Platform defaults for iOS sysdiagnose ingest (logarchive caps, etc.).
    #[serde(default)]
    pub sysdiagnose: SysdiagnoseIngestConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicCollectConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_public_collect_tags")]
    pub tags: Vec<String>,
    #[serde(default)]
    pub android_collect: AndroidCollectConfig,
    #[serde(default)]
    pub ios_collect: IosCollectConfig,
}

fn default_public_collect_tags() -> Vec<String> {
    vec!["public-collect".into(), "webusb".into()]
}

impl Default for PublicCollectConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            tags: default_public_collect_tags(),
            android_collect: AndroidCollectConfig::default(),
            ios_collect: IosCollectConfig::default(),
        }
    }
}

pub fn normalize_android_commands(commands: &[String]) -> Vec<String> {
    const ALLOWED: [&str; 3] = ["find", "ps", "yara"];
    let mut out = Vec::new();
    for cmd in commands {
        let c = cmd.trim().to_lowercase();
        if ALLOWED.contains(&c.as_str()) && !out.iter().any(|x| x == &c) {
            out.push(c);
        }
    }
    if out.is_empty() {
        out.push("find".into());
    }
    out
}

pub fn normalize_pull_repository_paths(paths: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for raw in paths {
        let p = raw.trim();
        if p.is_empty() || out.iter().any(|x| x == p) {
            continue;
        }
        out.push(p.to_string());
    }
    if out.is_empty() {
        return default_android_find_paths();
    }
    out
}

pub fn normalize_android_paths(paths: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for raw in paths {
        let p = raw.trim();
        if p.is_empty() || out.iter().any(|x| x == p) {
            continue;
        }
        out.push(p.to_string());
    }
    if out.is_empty() {
        out = default_android_find_paths();
    }
    out
}

pub fn compile_android_yara_rules(android: &mut AndroidCollectConfig) {
    for rule in &mut android.yara_rules {
        rule.compile_error = None;
        if !rule.enabled || rule.source.trim().is_empty() {
            rule.compiled_b64 = None;
            continue;
        }
        match compile_yara_source(&rule.source) {
            Ok(bytes) => rule.compiled_b64 = Some(encode_yarc(&bytes)),
            Err(err) => {
                rule.compile_error = Some(err);
                rule.compiled_b64 = None;
            }
        }
    }

    android.yara_bundle_error = None;
    android.yara_bundle_b64 = None;

    let enabled_sources: Vec<&str> = android
        .yara_rules
        .iter()
        .filter(|r| r.enabled && !r.source.trim().is_empty())
        .map(|r| r.source.as_str())
        .collect();

    if enabled_sources.is_empty() {
        return;
    }

    match compile_yara_sources(&enabled_sources) {
        Ok(bytes) => android.yara_bundle_b64 = Some(encode_yarc(&bytes)),
        Err(err) => android.yara_bundle_error = Some(err),
    }
}

pub fn prepare_android_collect_config(android: &mut AndroidCollectConfig) {
    android.default_commands = normalize_android_commands(&android.default_commands);
    android.find_paths = normalize_android_paths(&android.find_paths);
    android.yara_paths = normalize_android_paths(&android.yara_paths);
    android.pull_repository_paths = normalize_pull_repository_paths(&android.pull_repository_paths);
    android.max_depth = android.max_depth.clamp(1, 10);
    android.yara_max_depth = android.yara_max_depth.clamp(1, 10);
    android.pull_max_depth = android.pull_max_depth.clamp(1, 10);
    android.pull_max_file_size = android.pull_max_file_size.clamp(1024, 512 * 1024 * 1024);
    android.pull_max_files = android.pull_max_files.clamp(1, 10_000);
    compile_android_yara_rules(android);
}

pub fn public_ios_collect_config(ios: &IosCollectConfig) -> PublicIosCollectConfig {
    PublicIosCollectConfig {
        upload_enabled: ios.upload_enabled,
        instructions: ios.instructions.clone(),
    }
}

pub fn public_collector_config(
    cfg: &PublicCollectConfig,
    sysdiagnose: &SysdiagnoseIngestConfig,
) -> PublicCollectorConfig {
    PublicCollectorConfig {
        android: public_android_collect_config(&cfg.android_collect),
        ios: public_ios_collect_config(&cfg.ios_collect),
        sysdiagnose: sysdiagnose.clone(),
    }
}

pub fn public_android_collect_config(android: &AndroidCollectConfig) -> PublicAndroidCollectConfig {
    PublicAndroidCollectConfig {
        default_commands: android.default_commands.clone(),
        find_paths: android.find_paths.clone(),
        max_depth: android.max_depth,
        yara_paths: android.yara_paths.clone(),
        yara_max_depth: android.yara_max_depth,
        hash_files: android.hash_files,
        max_hash_size: android.max_hash_size,
        exclude_dirs: android.exclude_dirs.clone(),
        yara_rule_names: android
            .yara_rules
            .iter()
            .filter(|r| r.enabled && r.source.trim().len() > 0)
            .map(|r| r.name.clone())
            .collect(),
        yara_bundle_b64: android.yara_bundle_b64.clone(),
        pull_repository_paths: android.pull_repository_paths.clone(),
        pull_max_depth: android.pull_max_depth,
        pull_max_file_size: android.pull_max_file_size,
        pull_max_files: android.pull_max_files,
    }
}

pub async fn load_public_collect_config(
    settings: &SettingsRepository,
) -> anyhow::Result<PublicCollectConfig> {
    let raw = settings.get(KEY_PUBLIC_COLLECT).await?;
    if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        return Ok(PublicCollectConfig::default());
    }
    Ok(serde_json::from_value(raw)?)
}

pub async fn save_public_collect_config(
    settings: &SettingsRepository,
    cfg: &PublicCollectConfig,
) -> anyhow::Result<()> {
    let mut normalized = cfg.clone();
    prepare_android_collect_config(&mut normalized.android_collect);
    normalized.ios_collect.instructions = normalized.ios_collect.instructions.trim().to_string();
    normalized.enabled = is_plugin_enabled(settings, COLLECTOR_PLUGIN_ID).await?;
    settings
        .set(KEY_PUBLIC_COLLECT, &serde_json::to_value(normalized)?)
        .await?;
    Ok(())
}

pub async fn public_collect_is_enabled(settings: &SettingsRepository) -> anyhow::Result<bool> {
    is_plugin_enabled(settings, COLLECTOR_PLUGIN_ID).await
}

/// Seed DB settings from env on first boot when rows are empty.
pub async fn bootstrap_from_env(
    settings: &SettingsRepository,
    config: &AppConfig,
) -> anyhow::Result<()> {
    let llm = settings.get(KEY_LLM).await?;
    if llm.as_object().is_none_or(|o| o.is_empty()) {
        let from_env = LlmConfig {
            api_url: env_llm_var("MOBIPWN_LLM_API_URL"),
            api_key: env_llm_var("MOBIPWN_LLM_API_KEY"),
            model: env_llm_var("MOBIPWN_LLM_MODEL"),
        };
        if !from_env.api_url.is_empty() || !from_env.api_key.is_empty() {
            save_llm_config(settings, &from_env).await?;
        } else {
            settings
                .set(KEY_LLM, &serde_json::to_value(LlmConfig::default())?)
                .await?;
        }
    }

    let limits = settings.get(KEY_SEARCH_LIMITS).await?;
    if limits.as_object().is_none_or(|o| o.is_empty() || !o.contains_key("max_limit")) {
        settings
            .set(
                KEY_SEARCH_LIMITS,
                &serde_json::to_value(SearchLimitsConfig::from_env_config(config))?,
            )
            .await?;
    }

    let retention = settings.get(KEY_RETENTION).await?;
    if retention.is_null() {
        settings.set(KEY_RETENTION, &Value::Object(Map::new())).await?;
    }

    let entity_limits = settings.get(KEY_ENTITY_LIMITS).await?;
    if entity_limits.as_object().is_none_or(|o| o.is_empty()) {
        settings
            .set(
                KEY_ENTITY_LIMITS,
                &serde_json::to_value(EntityLimitsConfig::default())?,
            )
            .await?;
    }

    let mcp = settings.get(KEY_MCP).await?;
    if mcp.as_object().is_none_or(|o| o.is_empty()) {
        settings
            .set(KEY_MCP, &serde_json::to_value(default_mcp_config(config))?)
            .await?;
    }

    let public_collect = settings.get(KEY_PUBLIC_COLLECT).await?;
    if public_collect.is_null() || public_collect.as_object().is_none_or(|o| o.is_empty()) {
        settings
            .set(
                KEY_PUBLIC_COLLECT,
                &serde_json::to_value(PublicCollectConfig::default())?,
            )
            .await?;
    }

    crate::plugins::bootstrap_plugins_config(settings).await?;

    let sysdiagnose_ingest = settings.get(KEY_SYSDIAGNOSE_INGEST).await?;
    if sysdiagnose_ingest.as_object().is_none_or(|o| o.is_empty()) {
        settings
            .set(
                KEY_SYSDIAGNOSE_INGEST,
                &serde_json::to_value(SysdiagnoseIngestConfig::default())?,
            )
            .await?;
    }

    let install_enrichment = settings.get(KEY_INSTALL_ENRICHMENT).await?;
    if install_enrichment.as_object().is_none_or(|o| o.is_empty()) {
        settings
            .set(
                KEY_INSTALL_ENRICHMENT,
                &serde_json::to_value(default_install_enrichment_config())?,
            )
            .await?;
    }

    Ok(())
}

fn default_logarchive_decode_max_lines() -> u32 {
    2_500
}

fn default_max_entry_mb() -> u32 {
    64
}

/// Floor applied to [`SysdiagnoseIngestConfig::max_entry_mb`] when logarchive is uncapped
/// (large `tracev3` members are often hundreds of MiB — keep below previous 2 GiB floor).
pub const LOGARCHIVE_UNCAPPED_MIN_ENTRY_MB: u32 = 512;

/// Absolute ceiling for tar member size (MiB). Never allow "unlimited" (0).
pub const MAX_ENTRY_MB_CEILING: u32 = 1_024;

/// Forensic unified-log decode ceiling (mirrors library `LOGARCHIVE_FORENSIC_MAX_LINES`).
pub const LOGARCHIVE_FORENSIC_MAX_LINES: u32 = 250_000;

/// iOS sysdiagnose ingest tuning (Settings → General → iOS sysdiagnose ingest).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SysdiagnoseIngestConfig {
    /// Max unified-log lines decoded from `system_logs.logarchive/` per ingest (macos-unifiedlogs).
    /// `0` means use the forensic ceiling when prepared with uncapped mode.
    #[serde(default = "default_logarchive_decode_max_lines")]
    pub logarchive_decode_max_lines: u32,
    /// When true, expand full IOService tree instead of compact preview.
    #[serde(default)]
    pub ioservice_full_tree: bool,
    /// When true: use forensic line/member caps (still bounded — never unlimited).
    #[serde(default)]
    pub logarchive_uncapped: bool,
    /// Max uncompressed tar member size in MiB (default 64). `0` is treated as the ceiling.
    #[serde(default = "default_max_entry_mb")]
    pub max_entry_mb: u32,
}

impl Default for SysdiagnoseIngestConfig {
    fn default() -> Self {
        Self {
            logarchive_decode_max_lines: default_logarchive_decode_max_lines(),
            ioservice_full_tree: false,
            logarchive_uncapped: false,
            max_entry_mb: default_max_entry_mb(),
        }
    }
}

impl SysdiagnoseIngestConfig {
    /// Bytes passed to sysdiagnose-extractor-library `ArchiveOptions.max_entry_bytes`.
    pub fn archive_max_entry_bytes(&self) -> u64 {
        let mb = if self.max_entry_mb == 0 {
            MAX_ENTRY_MB_CEILING
        } else {
            self.max_entry_mb.min(MAX_ENTRY_MB_CEILING)
        };
        u64::from(mb).saturating_mul(1024 * 1024)
    }

    /// Line cap for unified-log decode. Forensic/uncapped uses [`LOGARCHIVE_FORENSIC_MAX_LINES`]
    /// (never unlimited — prevents multi‑tens‑of‑GB event buffers).
    pub fn effective_logarchive_decode_max_lines(&self) -> usize {
        if self.logarchive_uncapped || self.logarchive_decode_max_lines == 0 {
            LOGARCHIVE_FORENSIC_MAX_LINES as usize
        } else {
            (self.logarchive_decode_max_lines as usize).min(LOGARCHIVE_FORENSIC_MAX_LINES as usize)
        }
    }
}

pub fn prepare_sysdiagnose_ingest_config(cfg: &mut SysdiagnoseIngestConfig) {
    if cfg.max_entry_mb == 0 || cfg.max_entry_mb > MAX_ENTRY_MB_CEILING {
        cfg.max_entry_mb = if cfg.logarchive_uncapped {
            LOGARCHIVE_UNCAPPED_MIN_ENTRY_MB.max(512)
        } else {
            default_max_entry_mb()
        };
    }
    cfg.max_entry_mb = cfg.max_entry_mb.min(MAX_ENTRY_MB_CEILING);

    if cfg.logarchive_uncapped {
        cfg.logarchive_decode_max_lines = LOGARCHIVE_FORENSIC_MAX_LINES;
        if cfg.max_entry_mb < LOGARCHIVE_UNCAPPED_MIN_ENTRY_MB {
            cfg.max_entry_mb = LOGARCHIVE_UNCAPPED_MIN_ENTRY_MB;
        }
    } else {
        if cfg.logarchive_decode_max_lines == 0 {
            cfg.logarchive_decode_max_lines = default_logarchive_decode_max_lines();
        }
        cfg.logarchive_decode_max_lines = cfg
            .logarchive_decode_max_lines
            .clamp(100, 50_000)
            .min(LOGARCHIVE_FORENSIC_MAX_LINES);
    }
}

/// Optional per-ingest overrides (upload init / reingest body). Missing fields keep Settings defaults.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SysdiagnoseIngestOverrides {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logarchive_uncapped: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logarchive_decode_max_lines: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_entry_mb: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ioservice_full_tree: Option<bool>,
}

impl SysdiagnoseIngestOverrides {
    pub fn is_empty(&self) -> bool {
        self.logarchive_uncapped.is_none()
            && self.logarchive_decode_max_lines.is_none()
            && self.max_entry_mb.is_none()
            && self.ioservice_full_tree.is_none()
    }
}

/// Merge Settings defaults with optional per-job overrides, then clamp.
pub fn apply_sysdiagnose_ingest_overrides(
    mut cfg: SysdiagnoseIngestConfig,
    over: Option<&SysdiagnoseIngestOverrides>,
) -> SysdiagnoseIngestConfig {
    if let Some(o) = over {
        if let Some(v) = o.logarchive_uncapped {
            cfg.logarchive_uncapped = v;
        }
        if let Some(v) = o.logarchive_decode_max_lines {
            cfg.logarchive_decode_max_lines = v;
        }
        if let Some(v) = o.max_entry_mb {
            cfg.max_entry_mb = v;
        }
        if let Some(v) = o.ioservice_full_tree {
            cfg.ioservice_full_tree = v;
        }
    }
    prepare_sysdiagnose_ingest_config(&mut cfg);
    cfg
}

pub async fn load_sysdiagnose_ingest_config(
    settings: &SettingsRepository,
) -> anyhow::Result<SysdiagnoseIngestConfig> {
    let raw = settings.get(KEY_SYSDIAGNOSE_INGEST).await?;
    if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        return Ok(SysdiagnoseIngestConfig::default());
    }
    let mut cfg: SysdiagnoseIngestConfig = serde_json::from_value(raw)?;
    prepare_sysdiagnose_ingest_config(&mut cfg);
    Ok(cfg)
}

pub async fn save_sysdiagnose_ingest_config(
    settings: &SettingsRepository,
    incoming: &SysdiagnoseIngestConfig,
) -> anyhow::Result<()> {
    let mut next = incoming.clone();
    prepare_sysdiagnose_ingest_config(&mut next);
    settings
        .set(KEY_SYSDIAGNOSE_INGEST, &serde_json::to_value(next)?)
        .await?;
    Ok(())
}

/// Settings key for Installed/deleted apps IPA / sideload enrichment rules.
pub const KEY_INSTALL_ENRICHMENT: &str = "install_enrichment";

fn default_enrichment_enabled() -> bool {
    true
}

fn default_enrichment_window_minutes() -> u32 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstallEnrichmentNamePattern {
    pub pattern: String,
    pub name: String,
}

/// One enrichment rule (editable in Settings → General).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstallEnrichmentRuleConfig {
    pub id: String,
    /// `ipa` or `sideload_tool` (other values allowed for forward compat).
    pub kind: String,
    pub label: String,
    #[serde(default = "default_enrichment_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub query_terms: Vec<String>,
    pub match_pattern: String,
    #[serde(default)]
    pub name_patterns: Vec<InstallEnrichmentNamePattern>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstallEnrichmentConfig {
    #[serde(default = "default_enrichment_window_minutes")]
    pub window_minutes: u32,
    #[serde(default)]
    pub rules: Vec<InstallEnrichmentRuleConfig>,
}

impl Default for InstallEnrichmentConfig {
    fn default() -> Self {
        default_install_enrichment_config()
    }
}

/// Built-in defaults (IPA artifacts + common sideload tools).
pub fn default_install_enrichment_config() -> InstallEnrichmentConfig {
    InstallEnrichmentConfig {
        window_minutes: 30,
        rules: vec![
            InstallEnrichmentRuleConfig {
                id: "ipa".into(),
                kind: "ipa".into(),
                label: "IPA".into(),
                enabled: true,
                query_terms: vec![
                    "message=*.ipa*".into(),
                    "path=*.ipa*".into(),
                    "file_path=*.ipa*".into(),
                ],
                match_pattern: r"\.ipa\b".into(),
                name_patterns: vec![InstallEnrichmentNamePattern {
                    pattern: r"([\w.-]+\.ipa)\b".into(),
                    name: "$1".into(),
                }],
            },
            InstallEnrichmentRuleConfig {
                id: "sideload_tool".into(),
                kind: "sideload_tool".into(),
                label: "Sideload tool".into(),
                enabled: true,
                query_terms: vec![
                    "message=*TrollStore*".into(),
                    "message=*trolldecrypt*".into(),
                    "message=*TrollDecrypt*".into(),
                    "message=*AltStore*".into(),
                    "message=*Sideloadly*".into(),
                    "message=*Scarlet*".into(),
                    "message=*decrypted.ipa*".into(),
                    "path=*TrollDecrypt*".into(),
                    "file_path=*TrollDecrypt*".into(),
                    "process_name=*TrollStore*".into(),
                    "process_name=*TrollDecrypt*".into(),
                    "process_name=*AltStore*".into(),
                    "bundle_id=*trollstore*".into(),
                    "bundle_id=*trolldecrypt*".into(),
                    "bundle_id=*altstore*".into(),
                    "bundle_id=\"com.fiore.trolldecrypt\"".into(),
                ],
                match_pattern:
                    r"troll\s*store|trolldecrypt|com\.fiore\.trolldecrypt|alt\s*store|sideloadly|\bscarlet\b|\besign\b|\bfeather\b"
                        .into(),
                name_patterns: vec![
                    InstallEnrichmentNamePattern {
                        pattern: r"trolldecrypt|com\.fiore\.trolldecrypt".into(),
                        name: "TrollDecrypt".into(),
                    },
                    InstallEnrichmentNamePattern {
                        pattern: r"troll\s*store".into(),
                        name: "TrollStore".into(),
                    },
                    InstallEnrichmentNamePattern {
                        pattern: r"alt\s*store".into(),
                        name: "AltStore".into(),
                    },
                    InstallEnrichmentNamePattern {
                        pattern: r"sideloadly".into(),
                        name: "Sideloadly".into(),
                    },
                    InstallEnrichmentNamePattern {
                        pattern: r"\bscarlet\b".into(),
                        name: "Scarlet".into(),
                    },
                    InstallEnrichmentNamePattern {
                        pattern: r"\besign\b".into(),
                        name: "ESign".into(),
                    },
                    InstallEnrichmentNamePattern {
                        pattern: r"\bfeather\b".into(),
                        name: "Feather".into(),
                    },
                ],
            },
        ],
    }
}

pub fn prepare_install_enrichment_config(cfg: &mut InstallEnrichmentConfig) {
    if cfg.window_minutes == 0 {
        cfg.window_minutes = default_enrichment_window_minutes();
    }
    cfg.window_minutes = cfg.window_minutes.clamp(1, 24 * 60);
    if cfg.rules.is_empty() {
        *cfg = default_install_enrichment_config();
        return;
    }
    for rule in &mut cfg.rules {
        rule.id = rule.id.trim().to_string();
        rule.kind = rule.kind.trim().to_ascii_lowercase();
        if rule.kind.is_empty() {
            rule.kind = "sideload_tool".into();
        }
        rule.label = rule.label.trim().to_string();
        if rule.label.is_empty() {
            rule.label = rule.id.clone();
        }
        rule.match_pattern = rule.match_pattern.trim().to_string();
        rule.query_terms = rule
            .query_terms
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        rule.name_patterns.retain(|p| {
            !p.pattern.trim().is_empty() && !p.name.trim().is_empty()
        });
        for p in &mut rule.name_patterns {
            p.pattern = p.pattern.trim().to_string();
            p.name = p.name.trim().to_string();
        }
    }
    cfg.rules.retain(|r| !r.id.is_empty() && !r.match_pattern.is_empty());
    if cfg.rules.is_empty() {
        *cfg = default_install_enrichment_config();
    }
}

pub async fn load_install_enrichment_config(
    settings: &SettingsRepository,
) -> anyhow::Result<InstallEnrichmentConfig> {
    let raw = settings.get(KEY_INSTALL_ENRICHMENT).await?;
    if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        return Ok(default_install_enrichment_config());
    }
    let mut cfg: InstallEnrichmentConfig = serde_json::from_value(raw).unwrap_or_else(|_| {
        default_install_enrichment_config()
    });
    prepare_install_enrichment_config(&mut cfg);
    Ok(cfg)
}

pub async fn save_install_enrichment_config(
    settings: &SettingsRepository,
    incoming: &InstallEnrichmentConfig,
) -> anyhow::Result<()> {
    let mut next = incoming.clone();
    prepare_install_enrichment_config(&mut next);
    settings
        .set(KEY_INSTALL_ENRICHMENT, &serde_json::to_value(next)?)
        .await?;
    Ok(())
}
