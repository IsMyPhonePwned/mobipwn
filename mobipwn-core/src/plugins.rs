//! Platform plugin registry — optional feature modules.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::store::SettingsRepository;

pub const KEY_PLATFORM_PLUGINS: &str = "platform_plugins";
pub const CASE_COMPARISON_PLUGIN_ID: &str = "case_comparison";
/// Legacy plugin id (migrated to [`CASE_COMPARISON_PLUGIN_ID`]).
pub const BUGREPORT_COMPARISON_PLUGIN_ID: &str = "bugreport_comparison";
pub const COLLECTOR_PLUGIN_ID: &str = "collector";
pub const ALERT_TO_SIEM_PLUGIN_ID: &str = "alert_to_siem";
pub const DEVICE_ADVANCED_PLUGIN_ID: &str = "device_advanced";
/// Legacy plugin id (migrated to [`COLLECTOR_PLUGIN_ID`]).
pub const PUBLIC_COLLECT_PLUGIN_ID: &str = "collector";
const LEGACY_COLLECTOR_PLUGIN_ID: &str = "public_collect";
const LEGACY_CASE_COMPARISON_PLUGIN_ID: &str = "bugreport_comparison";
const KEY_PUBLIC_COLLECT_CONFIG: &str = "public_collect_config";

#[derive(Debug, Clone)]
pub struct PluginDescriptor {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub version: &'static str,
    pub routes: &'static [&'static str],
    pub nav_path: Option<&'static str>,
    pub default_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginState {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlatformPluginsConfig {
    #[serde(default)]
    pub plugins: HashMap<String, PluginState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub routes: Vec<String>,
    pub nav_path: Option<String>,
    pub enabled: bool,
}

/// Static catalog of integrated plugins (compile-time registry).
pub fn plugin_catalog() -> &'static [PluginDescriptor] {
    &[
        PluginDescriptor {
            id: CASE_COMPARISON_PLUGIN_ID,
            name: "Case Comparison",
            description:
                "Compare two Android or iOS cases — packages, processes, network artifacts, and device identity across uploads.",
            version: "0.2.0",
            routes: &["/case-comparison", "/bugreport-comparison"],
            nav_path: Some("/case-comparison"),
            default_enabled: true,
        },
        PluginDescriptor {
            id: COLLECTOR_PLUGIN_ID,
            name: "Collector",
            description:
                "Public /collect page — WebUSB Android bugreport + Rusty Magpie, and iOS sysdiagnose (upload + idevice-rs WebUSB) without signing in.",
            version: "0.2.0",
            routes: &["/collector", "/collect"],
            nav_path: Some("/collector"),
            default_enabled: false,
        },
        PluginDescriptor {
            id: DEVICE_ADVANCED_PLUGIN_ID,
            name: "Device Advanced",
            description:
                "Public advanced WebUSB tools — /iphone-advanced (idevice-rs) and /android-advanced (WebADB). In-app route is settings only.",
            version: "0.1.0",
            routes: &["/device-advanced", "/iphone-advanced", "/android-advanced"],
            nav_path: Some("/device-advanced"),
            default_enabled: false,
        },
        PluginDescriptor {
            id: ALERT_TO_SIEM_PLUGIN_ID,
            name: "AlertToSiem",
            description:
                "Forward detection alerts to an external SIEM (Splunk HTTP Event Collector) with delivery audit logs.",
            version: "0.1.0",
            routes: &["/alert-to-siem"],
            nav_path: Some("/alert-to-siem"),
            default_enabled: false,
        },
    ]
}

pub fn plugin_descriptor(id: &str) -> Option<&'static PluginDescriptor> {
    plugin_catalog().iter().find(|p| p.id == id)
}

pub async fn load_plugins_config(
    settings: &SettingsRepository,
) -> anyhow::Result<PlatformPluginsConfig> {
    let raw = settings.get(KEY_PLATFORM_PLUGINS).await?;
    if !raw.is_null() && raw.as_object().is_some_and(|o| !o.is_empty()) {
        let mut cfg: PlatformPluginsConfig = serde_json::from_value(raw)?;
        migrate_collector_plugin_id(&mut cfg);
        migrate_case_comparison_plugin_id(&mut cfg);
        return Ok(cfg);
    }

    let public_collect_enabled = legacy_public_collect_enabled(settings)
        .await
        .unwrap_or(false);
    let mut plugins = PlatformPluginsConfig::default();
    plugins.plugins.insert(
        COLLECTOR_PLUGIN_ID.to_string(),
        PluginState {
            enabled: public_collect_enabled,
        },
    );
    Ok(plugins)
}

fn migrate_collector_plugin_id(cfg: &mut PlatformPluginsConfig) {
    if let Some(state) = cfg.plugins.remove(LEGACY_COLLECTOR_PLUGIN_ID) {
        cfg.plugins
            .entry(COLLECTOR_PLUGIN_ID.to_string())
            .or_insert(state);
    }
}

fn migrate_case_comparison_plugin_id(cfg: &mut PlatformPluginsConfig) {
    if let Some(state) = cfg.plugins.remove(LEGACY_CASE_COMPARISON_PLUGIN_ID) {
        cfg.plugins
            .entry(CASE_COMPARISON_PLUGIN_ID.to_string())
            .or_insert(state);
    }
}

async fn legacy_public_collect_enabled(settings: &SettingsRepository) -> anyhow::Result<bool> {
    let raw = settings.get(KEY_PUBLIC_COLLECT_CONFIG).await?;
    if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        return Ok(false);
    }
    Ok(raw
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

pub async fn save_plugins_config(
    settings: &SettingsRepository,
    cfg: &PlatformPluginsConfig,
) -> anyhow::Result<()> {
    settings
        .set(KEY_PLATFORM_PLUGINS, &serde_json::to_value(cfg)?)
        .await
}

/// Seed `platform_plugins` on first boot (matches plugin catalog defaults + legacy flags).
pub async fn bootstrap_plugins_config(settings: &SettingsRepository) -> anyhow::Result<()> {
    let raw = settings.get(KEY_PLATFORM_PLUGINS).await?;
    if !raw.is_null() && raw.as_object().is_some_and(|o| !o.is_empty()) {
        return Ok(());
    }
    let cfg = load_plugins_config(settings).await?;
    save_plugins_config(settings, &cfg).await
}

pub async fn is_plugin_enabled(settings: &SettingsRepository, id: &str) -> anyhow::Result<bool> {
    let id = normalize_plugin_id(id);
    let cfg = load_plugins_config(settings).await?;
    Ok(cfg
        .plugins
        .get(id)
        .map(|s| s.enabled)
        .unwrap_or_else(|| plugin_descriptor(id).map(|d| d.default_enabled).unwrap_or(false)))
}

fn normalize_plugin_id(id: &str) -> &str {
    if id == LEGACY_COLLECTOR_PLUGIN_ID {
        COLLECTOR_PLUGIN_ID
    } else if id == LEGACY_CASE_COMPARISON_PLUGIN_ID {
        CASE_COMPARISON_PLUGIN_ID
    } else {
        id
    }
}

pub async fn set_plugin_enabled(
    settings: &SettingsRepository,
    id: &str,
    enabled: bool,
) -> anyhow::Result<()> {
    let id = normalize_plugin_id(id);
    if plugin_descriptor(id).is_none() {
        anyhow::bail!("unknown plugin: {id}");
    }
    let mut cfg = load_plugins_config(settings).await?;
    cfg.plugins
        .insert(id.to_string(), PluginState { enabled });
    save_plugins_config(settings, &cfg).await?;
    if id == COLLECTOR_PLUGIN_ID || id == LEGACY_COLLECTOR_PLUGIN_ID {
        sync_public_collect_config(settings, enabled).await?;
    }
    Ok(())
}

async fn sync_public_collect_config(
    settings: &SettingsRepository,
    _enabled: bool,
) -> anyhow::Result<()> {
    let cfg = crate::platform_settings::load_public_collect_config(settings).await?;
    crate::platform_settings::save_public_collect_config(settings, &cfg).await
}

pub async fn list_plugins(settings: &SettingsRepository) -> anyhow::Result<Vec<PluginInfo>> {
    let cfg = load_plugins_config(settings).await?;
    Ok(plugin_catalog()
        .iter()
        .map(|desc| {
            let enabled = cfg
                .plugins
                .get(desc.id)
                .map(|s| s.enabled)
                .unwrap_or(desc.default_enabled);
            PluginInfo {
                id: desc.id.to_string(),
                name: desc.name.to_string(),
                description: desc.description.to_string(),
                version: desc.version.to_string(),
                routes: desc.routes.iter().map(|r| (*r).to_string()).collect(),
                nav_path: desc.nav_path.map(str::to_string),
                enabled,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_includes_builtin_plugins() {
        assert!(plugin_descriptor(CASE_COMPARISON_PLUGIN_ID).is_some());
        assert!(plugin_descriptor(BUGREPORT_COMPARISON_PLUGIN_ID).is_none());
        assert!(plugin_descriptor(COLLECTOR_PLUGIN_ID).is_some());
        assert!(plugin_descriptor(ALERT_TO_SIEM_PLUGIN_ID).is_some());
    }
}
