use ironsift::DetectionConfig;
use mobipwn_core::endpoint_ingest::EndpointIngestConfig;
use mobipwn_core::plugins::{
    apply_ironsift_plugin_enabled, load_plugins_config, save_plugins_config, PluginState,
    IRONSIFT_PLUGIN_ID,
};
use mobipwn_core::SettingsRepository;
use mobipwn_core::mudm::ENDPOINT;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SETTINGS_KEY: &str = "ironsift_config";
const ANOMARK_SETTINGS_KEY: &str = "ironsift_anomark_config";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnoMarkPlatformConfig {
    /// Default Markov order for training (1–8).
    #[serde(default = "default_anomark_order")]
    pub default_order: u8,
    /// Default suspect percentile for scoring (55–99.999).
    #[serde(default = "default_anomark_suspect_percent")]
    pub default_suspect_percent: f64,
    /// Use parallel training when line count exceeds this threshold.
    #[serde(default = "default_parallel_train_lines")]
    pub parallel_train_lines: usize,
    /// Max AnoMark reason strings stored per host in findings.
    #[serde(default = "default_max_reasons_per_host")]
    pub max_reasons_per_host: usize,
    /// Drop Linux kernel-thread command names like `[kthreadd]` before training/scoring.
    #[serde(default = "default_anomark_exclude_kernel_threads")]
    pub exclude_kernel_threads: bool,
    /// Rust regex patterns matched against the command portion (repeatable).
    #[serde(default)]
    pub exclude_regex: Vec<String>,
}

fn default_anomark_exclude_kernel_threads() -> bool {
    true
}

fn default_anomark_order() -> u8 {
    4
}

fn default_anomark_suspect_percent() -> f64 {
    95.0
}

fn default_parallel_train_lines() -> usize {
    2_000
}

fn default_max_reasons_per_host() -> usize {
    5
}

impl Default for AnoMarkPlatformConfig {
    fn default() -> Self {
        Self {
            default_order: default_anomark_order(),
            default_suspect_percent: default_anomark_suspect_percent(),
            parallel_train_lines: default_parallel_train_lines(),
            max_reasons_per_host: default_max_reasons_per_host(),
            exclude_kernel_threads: default_anomark_exclude_kernel_threads(),
            exclude_regex: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IronSiftPlatformConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_fleet_cron")]
    pub fleet_cron: String,
    #[serde(default = "default_true")]
    pub post_ingest_temporal: bool,
    #[serde(default = "default_min_fleet_devices")]
    pub min_fleet_devices: u32,
    #[serde(default = "default_min_score")]
    pub min_score: f64,
    #[serde(default = "default_mudm_platform")]
    pub mudm_platform: String,
    #[serde(default)]
    pub detection_config: Value,
    #[serde(default)]
    pub anomark_config: AnoMarkPlatformConfig,
    #[serde(default)]
    pub endpoint_ingest: EndpointIngestConfig,
}

fn default_enabled() -> bool {
    true
}

fn default_fleet_cron() -> String {
    "0 0 3 * * *".into()
}

fn default_true() -> bool {
    true
}

fn default_min_fleet_devices() -> u32 {
    3
}

fn default_min_score() -> f64 {
    0.4
}

fn default_mudm_platform() -> String {
    ENDPOINT.to_string()
}

impl Default for IronSiftPlatformConfig {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            fleet_cron: default_fleet_cron(),
            post_ingest_temporal: default_true(),
            min_fleet_devices: default_min_fleet_devices(),
            min_score: default_min_score(),
            mudm_platform: default_mudm_platform(),
            detection_config: Value::Object(Default::default()),
            anomark_config: AnoMarkPlatformConfig::default(),
            endpoint_ingest: EndpointIngestConfig::default(),
        }
    }
}

pub async fn load_anomark_config(
    settings: &SettingsRepository,
) -> anyhow::Result<AnoMarkPlatformConfig> {
    let raw = settings.get(ANOMARK_SETTINGS_KEY).await?;
    if !raw.is_null() && raw.as_object().is_some_and(|o| !o.is_empty()) {
        return Ok(serde_json::from_value(raw)?);
    }

    let legacy = settings.get(SETTINGS_KEY).await?;
    if let Some(nested) = legacy.get("anomark_config") {
        if !nested.is_null() && !nested.as_object().is_some_and(|o| o.is_empty()) {
            let cfg: AnoMarkPlatformConfig = serde_json::from_value(nested.clone())?;
            save_anomark_config(settings, &cfg).await?;
            return Ok(cfg);
        }
    }

    Ok(AnoMarkPlatformConfig::default())
}

pub async fn save_anomark_config(
    settings: &SettingsRepository,
    cfg: &AnoMarkPlatformConfig,
) -> anyhow::Result<()> {
    settings
        .set(ANOMARK_SETTINGS_KEY, &serde_json::to_value(cfg)?)
        .await
}

pub async fn load_platform_config(settings: &SettingsRepository) -> anyhow::Result<IronSiftPlatformConfig> {
    let raw = settings.get(SETTINGS_KEY).await?;
    let mut cfg = if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        IronSiftPlatformConfig::default()
    } else {
        serde_json::from_value(raw)?
    };
    cfg.anomark_config = load_anomark_config(settings).await?;
    if let Ok(plugins) = load_plugins_config(settings).await {
        apply_ironsift_plugin_enabled(&plugins, &mut cfg.enabled);
    }
    Ok(cfg)
}

pub async fn load_ironsift_config_only(
    settings: &SettingsRepository,
) -> anyhow::Result<IronSiftPlatformConfig> {
    let raw = settings.get(SETTINGS_KEY).await?;
    let mut cfg = if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        IronSiftPlatformConfig::default()
    } else {
        serde_json::from_value(raw)?
    };
    cfg.anomark_config = AnoMarkPlatformConfig::default();
    if let Ok(plugins) = load_plugins_config(settings).await {
        apply_ironsift_plugin_enabled(&plugins, &mut cfg.enabled);
    }
    Ok(cfg)
}

pub async fn save_platform_config(
    settings: &SettingsRepository,
    cfg: &IronSiftPlatformConfig,
) -> anyhow::Result<()> {
    let mut value = serde_json::to_value(cfg)?;
    if let Some(obj) = value.as_object_mut() {
        obj.remove("anomark_config");
    }
    settings.set(SETTINGS_KEY, &value).await?;
    let mut plugins = load_plugins_config(settings).await?;
    plugins.plugins.insert(
        IRONSIFT_PLUGIN_ID.to_string(),
        PluginState {
            enabled: cfg.enabled,
        },
    );
    save_plugins_config(settings, &plugins).await
}

fn load_detection_config_from_env() -> DetectionConfig {
    let path = std::env::var("MOBIPWN_IRONSIFT_CONFIG").ok();
    if let Some(path) = path.filter(|p| !p.is_empty()) {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<DetectionConfig>(&text) {
                return cfg;
            }
        }
    }
    DetectionConfig::default()
}

pub fn merge_detection_config(platform: &IronSiftPlatformConfig) -> DetectionConfig {
    merge_detection_config_with_override(platform, None)
}

pub fn merge_detection_config_with_override(
    platform: &IronSiftPlatformConfig,
    run_override: Option<Value>,
) -> DetectionConfig {
    let mut cfg = load_detection_config_from_env();
    if let Ok(override_cfg) = serde_json::from_value::<DetectionConfig>(platform.detection_config.clone())
    {
        cfg = override_cfg;
    }
    if let Some(run_override) = run_override {
        if let Ok(override_cfg) = serde_json::from_value::<DetectionConfig>(run_override) {
            cfg = override_cfg;
        }
    }
    cfg
}
