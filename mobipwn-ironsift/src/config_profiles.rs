use crate::config::{
    load_anomark_config, load_ironsift_config_only, save_anomark_config, save_platform_config,
    AnoMarkPlatformConfig, IronSiftPlatformConfig,
};
use chrono::Utc;
use mobipwn_core::SettingsRepository;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const IRONSIFT_PROFILES_KEY: &str = "ironsift_config_profiles";
const ANOMARK_PROFILES_KEY: &str = "ironsift_anomark_config_profiles";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigProfileMeta {
    pub id: String,
    pub name: String,
    pub saved_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigProfile<T> {
    pub id: String,
    pub name: String,
    pub saved_at: String,
    pub config: T,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ConfigProfileStore<T> {
    #[serde(default)]
    profiles: Vec<ConfigProfile<T>>,
    #[serde(default)]
    selected_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigProfilesListResponse {
    pub profiles: Vec<ConfigProfileMeta>,
    pub selected_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateConfigProfileRequest<T> {
    pub name: String,
    pub config: Option<T>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateConfigProfileRequest<T> {
    pub name: Option<String>,
    pub config: Option<T>,
}

fn profile_meta<T>(p: &ConfigProfile<T>) -> ConfigProfileMeta {
    ConfigProfileMeta {
        id: p.id.clone(),
        name: p.name.clone(),
        saved_at: p.saved_at.clone(),
    }
}

async fn load_store<T>(settings: &SettingsRepository, key: &str) -> anyhow::Result<ConfigProfileStore<T>>
where
    T: for<'de> Deserialize<'de> + Default,
{
    let raw = settings.get(key).await?;
    if raw.is_null() || raw.as_object().is_none_or(|o| o.is_empty()) {
        return Ok(ConfigProfileStore::default());
    }
    Ok(serde_json::from_value(raw)?)
}

async fn save_store<T>(settings: &SettingsRepository, key: &str, store: &ConfigProfileStore<T>) -> anyhow::Result<()>
where
    T: Serialize,
{
    settings
        .set(key, &serde_json::to_value(store)?)
        .await
}

fn find_profile<'a, T>(store: &'a ConfigProfileStore<T>, id: &str) -> Option<&'a ConfigProfile<T>> {
    store.profiles.iter().find(|p| p.id == id)
}

fn find_profile_mut<'a, T>(store: &'a mut ConfigProfileStore<T>, id: &str) -> Option<&'a mut ConfigProfile<T>> {
    store.profiles.iter_mut().find(|p| p.id == id)
}

async fn list_profiles<T>(
    settings: &SettingsRepository,
    key: &str,
) -> anyhow::Result<ConfigProfilesListResponse>
where
    T: for<'de> Deserialize<'de> + Default,
{
    let store = load_store::<T>(settings, key).await?;
    Ok(ConfigProfilesListResponse {
        profiles: store.profiles.iter().map(profile_meta).collect(),
        selected_id: store.selected_id,
    })
}

async fn get_profile<T>(
    settings: &SettingsRepository,
    key: &str,
    id: &str,
) -> anyhow::Result<ConfigProfile<T>>
where
    T: for<'de> Deserialize<'de> + Default + Clone,
{
    let store = load_store::<T>(settings, key).await?;
    find_profile(&store, id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("config profile not found"))
}

async fn create_profile<T>(
    settings: &SettingsRepository,
    key: &str,
    name: &str,
    config: T,
) -> anyhow::Result<ConfigProfile<T>>
where
    T: for<'de> Deserialize<'de> + Default + Serialize + Clone,
{
    let trimmed = name.trim();
    if trimmed.is_empty() {
        anyhow::bail!("profile name is required");
    }
    let mut store = load_store::<T>(settings, key).await?;
    let profile = ConfigProfile {
        id: Uuid::now_v7().to_string(),
        name: trimmed.to_string(),
        saved_at: Utc::now().to_rfc3339(),
        config,
    };
    let created = profile.clone();
    store.profiles.push(profile);
    save_store(settings, key, &store).await?;
    Ok(created)
}

async fn update_profile<T>(
    settings: &SettingsRepository,
    key: &str,
    id: &str,
    name: Option<String>,
    config: Option<T>,
) -> anyhow::Result<ConfigProfile<T>>
where
    T: for<'de> Deserialize<'de> + Default + Serialize + Clone,
{
    if name.as_ref().is_some_and(|n| n.trim().is_empty()) {
        anyhow::bail!("profile name cannot be empty");
    }
    if name.is_none() && config.is_none() {
        anyhow::bail!("nothing to update (provide name and/or config)");
    }
    let mut store = load_store::<T>(settings, key).await?;
    let profile = find_profile_mut(&mut store, id).ok_or_else(|| anyhow::anyhow!("config profile not found"))?;
    if let Some(n) = name {
        profile.name = n.trim().to_string();
    }
    if let Some(cfg) = config {
        profile.config = cfg;
    }
    profile.saved_at = Utc::now().to_rfc3339();
    let updated = profile.clone();
    save_store(settings, key, &store).await?;
    Ok(updated)
}

async fn delete_profile<T>(
    settings: &SettingsRepository,
    key: &str,
    id: &str,
) -> anyhow::Result<()>
where
    T: for<'de> Deserialize<'de> + Default + Serialize,
{
    let mut store = load_store::<T>(settings, key).await?;
    let before = store.profiles.len();
    store.profiles.retain(|p| p.id != id);
    if store.profiles.len() == before {
        anyhow::bail!("config profile not found");
    }
    if store.selected_id.as_deref() == Some(id) {
        store.selected_id = None;
    }
    save_store(settings, key, &store).await
}

fn strip_anomark(mut cfg: IronSiftPlatformConfig) -> IronSiftPlatformConfig {
    cfg.anomark_config = AnoMarkPlatformConfig::default();
    cfg
}

pub async fn list_ironsift_profiles(
    settings: &SettingsRepository,
) -> anyhow::Result<ConfigProfilesListResponse> {
    list_profiles::<IronSiftPlatformConfig>(settings, IRONSIFT_PROFILES_KEY).await
}

pub async fn get_ironsift_profile(
    settings: &SettingsRepository,
    id: &str,
) -> anyhow::Result<ConfigProfile<IronSiftPlatformConfig>> {
    get_profile(settings, IRONSIFT_PROFILES_KEY, id).await
}

pub async fn create_ironsift_profile(
    settings: &SettingsRepository,
    req: CreateConfigProfileRequest<IronSiftPlatformConfig>,
) -> anyhow::Result<ConfigProfile<IronSiftPlatformConfig>> {
    let config = match req.config {
        Some(cfg) => strip_anomark(cfg),
        None => load_ironsift_config_only(settings).await?,
    };
    create_profile(settings, IRONSIFT_PROFILES_KEY, &req.name, config).await
}

pub async fn update_ironsift_profile(
    settings: &SettingsRepository,
    id: &str,
    req: UpdateConfigProfileRequest<IronSiftPlatformConfig>,
) -> anyhow::Result<ConfigProfile<IronSiftPlatformConfig>> {
    let config = req.config.map(strip_anomark);
    update_profile(settings, IRONSIFT_PROFILES_KEY, id, req.name, config).await
}

pub async fn delete_ironsift_profile(settings: &SettingsRepository, id: &str) -> anyhow::Result<()> {
    delete_profile::<IronSiftPlatformConfig>(settings, IRONSIFT_PROFILES_KEY, id).await
}

pub async fn select_ironsift_profile(
    settings: &SettingsRepository,
    id: &str,
) -> anyhow::Result<IronSiftPlatformConfig> {
    let mut store = load_store::<IronSiftPlatformConfig>(settings, IRONSIFT_PROFILES_KEY).await?;
    let profile = find_profile(&store, id)
        .ok_or_else(|| anyhow::anyhow!("config profile not found"))?
        .clone();
    let mut platform = load_ironsift_config_only(settings).await?;
    platform.enabled = profile.config.enabled;
    platform.fleet_cron = profile.config.fleet_cron.clone();
    platform.post_ingest_temporal = profile.config.post_ingest_temporal;
    platform.min_fleet_devices = profile.config.min_fleet_devices;
    platform.min_score = profile.config.min_score;
    platform.mudm_platform = profile.config.mudm_platform.clone();
    platform.detection_config = profile.config.detection_config.clone();
    platform.endpoint_ingest = profile.config.endpoint_ingest.clone();
    save_platform_config(settings, &platform).await?;
    store.selected_id = Some(id.to_string());
    save_store(settings, IRONSIFT_PROFILES_KEY, &store).await?;
    Ok(platform)
}

pub async fn list_anomark_profiles(
    settings: &SettingsRepository,
) -> anyhow::Result<ConfigProfilesListResponse> {
    list_profiles::<AnoMarkPlatformConfig>(settings, ANOMARK_PROFILES_KEY).await
}

pub async fn get_anomark_profile(
    settings: &SettingsRepository,
    id: &str,
) -> anyhow::Result<ConfigProfile<AnoMarkPlatformConfig>> {
    get_profile(settings, ANOMARK_PROFILES_KEY, id).await
}

pub async fn create_anomark_profile(
    settings: &SettingsRepository,
    req: CreateConfigProfileRequest<AnoMarkPlatformConfig>,
) -> anyhow::Result<ConfigProfile<AnoMarkPlatformConfig>> {
    let config = match req.config {
        Some(cfg) => cfg,
        None => load_anomark_config(settings).await?,
    };
    create_profile(settings, ANOMARK_PROFILES_KEY, &req.name, config).await
}

pub async fn update_anomark_profile(
    settings: &SettingsRepository,
    id: &str,
    req: UpdateConfigProfileRequest<AnoMarkPlatformConfig>,
) -> anyhow::Result<ConfigProfile<AnoMarkPlatformConfig>> {
    update_profile(settings, ANOMARK_PROFILES_KEY, id, req.name, req.config).await
}

pub async fn delete_anomark_profile(settings: &SettingsRepository, id: &str) -> anyhow::Result<()> {
    delete_profile::<AnoMarkPlatformConfig>(settings, ANOMARK_PROFILES_KEY, id).await
}

pub async fn select_anomark_profile(
    settings: &SettingsRepository,
    id: &str,
) -> anyhow::Result<AnoMarkPlatformConfig> {
    let mut store = load_store::<AnoMarkPlatformConfig>(settings, ANOMARK_PROFILES_KEY).await?;
    let profile = find_profile(&store, id)
        .ok_or_else(|| anyhow::anyhow!("config profile not found"))?
        .clone();
    save_anomark_config(settings, &profile.config).await?;
    store.selected_id = Some(id.to_string());
    save_store(settings, ANOMARK_PROFILES_KEY, &store).await?;
    Ok(profile.config)
}

pub const CUSTOM_CONFIG_LABEL: &str = "Custom";

pub fn active_config_label_from_list(list: &ConfigProfilesListResponse) -> String {
    list.selected_id
        .as_ref()
        .and_then(|id| list.profiles.iter().find(|p| p.id == *id))
        .map(|p| p.name.clone())
        .unwrap_or_else(|| CUSTOM_CONFIG_LABEL.to_string())
}

pub async fn active_ironsift_config_label(
    settings: &SettingsRepository,
) -> anyhow::Result<String> {
    Ok(active_config_label_from_list(&list_ironsift_profiles(settings).await?))
}

pub async fn active_anomark_config_label(
    settings: &SettingsRepository,
) -> anyhow::Result<String> {
    Ok(active_config_label_from_list(&list_anomark_profiles(settings).await?))
}
