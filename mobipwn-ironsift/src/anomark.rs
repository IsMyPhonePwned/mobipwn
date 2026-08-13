use anomark::{train_parallel, MarkovModel, ModelHandler, TrainLineFilter};
use crate::config::AnoMarkPlatformConfig;
use chrono::{DateTime, Utc};
use ironsift::RawLogEntry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use uuid::Uuid;

use crate::config::load_platform_config;
use crate::extract::{extract_process_logs, ScopeFilter};
use crate::scope::resolve_scope;
use crate::store::IronSiftRepository;
use mobipwn_core::config::AppConfig;
use mobipwn_core::store::CaseRepository;
use mobipwn_core::SettingsRepository;

const SELECTED_ANOMARK_TRAIN_KEY: &str = "ironsift_selected_anomark_train";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnoMarkTrainRequest {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub filter: ScopeFilter,
    #[serde(default = "default_order")]
    pub order: u8,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_order() -> u8 {
    4
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnoMarkTrainRecord {
    pub id: Uuid,
    pub label: String,
    pub scope_filter: Value,
    pub request_json: Value,
    pub training_line_count: i64,
    pub rel_model_path: String,
    pub rel_training_path: String,
    pub created_at: DateTime<Utc>,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnoMarkTrainStats {
    pub process_log_count: i64,
    pub training_line_count: i64,
    pub distinct_machines: i64,
    pub order: u8,
    pub scope_relaxed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnoMarkModelInspection {
    pub model_path: String,
    pub file_size_bytes: u64,
    pub order: usize,
    pub is_trained: bool,
    pub prior: f64,
    pub num_contexts: usize,
    pub num_transitions: usize,
    pub alphabet_len: usize,
    pub raw_markov_entries: usize,
    pub suspect_threshold_ln: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnoMarkTrainInspectResult {
    pub record: AnoMarkTrainRecord,
    pub inspection: AnoMarkModelInspection,
    #[serde(default)]
    pub sample_training_lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnoMarkTrainsListResponse {
    pub trains: Vec<AnoMarkTrainRecord>,
    pub selected_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnoMarkTrainResult {
    pub status: String,
    pub train_id: Uuid,
    pub record: AnoMarkTrainRecord,
    pub stats: AnoMarkTrainStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreAnomarkCommandRequest {
    pub command: String,
    /// Hostname / machine_id prefix — same rule as fleet runs (`"{machine} {command}"` scored).
    #[serde(default)]
    pub machine_name: Option<String>,
    /// Percent of ln(prior) for threshold (55–99.999); lower flags more commands.
    #[serde(default)]
    pub suspect_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnoMarkCommandScore {
    pub train_id: Uuid,
    pub model_path: String,
    pub order: usize,
    pub log_likelihood: f64,
    pub suspect_threshold_ln: f64,
    pub is_suspect: bool,
    /// `log_likelihood - suspect_threshold_ln` — negative means flagged at [`Self::suspect_percent_used`].
    pub margin_ln: f64,
    pub suspect_percent_used: f64,
    /// Exact UTF-8 string scored by the Markov model (`machine cmd…` when host is known).
    pub line_scored: String,
}

pub fn anomark_data_root() -> PathBuf {
    std::env::var("MOBIPWN_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(".dev")
        })
        .join("anomark-trains")
}

fn anomark_score_line(machine_label: &str, cmd: &str) -> String {
    let m = machine_label.trim();
    let c = cmd.trim();
    if c.is_empty() {
        return String::new();
    }
    if m.is_empty() {
        return c.to_string();
    }
    format!("{m} {c}")
}

fn command_from_log(entry: &RawLogEntry) -> String {
    if !entry.path.is_empty() {
        if entry.args.is_empty() {
            entry.path.clone()
        } else {
            format!("{} {}", entry.path, entry.args)
        }
    } else if !entry.name.is_empty() {
        entry.name.clone()
    } else {
        String::new()
    }
}

pub fn train_line_filter(config: &AnoMarkPlatformConfig) -> anyhow::Result<TrainLineFilter> {
    TrainLineFilter::new(config.exclude_kernel_threads, &config.exclude_regex)
        .map_err(Into::into)
}

fn command_from_scored_line(line: &str) -> &str {
    line
        .find(' ')
        .map(|idx| line[idx + 1..].trim_start())
        .filter(|cmd| !cmd.is_empty())
        .unwrap_or(line.trim())
}

pub fn should_exclude_anomark_command(filter: &TrainLineFilter, cmd: &str) -> bool {
    filter.should_exclude(cmd)
}

pub fn training_lines_from_logs(
    logs: &[RawLogEntry],
    config: &AnoMarkPlatformConfig,
) -> anyhow::Result<Vec<String>> {
    let filter = train_line_filter(config)?;
    let mut lines = Vec::new();
    for entry in logs {
        let cmd = command_from_log(entry);
        if cmd.is_empty() || should_exclude_anomark_command(&filter, &cmd) {
            continue;
        }
        lines.push(anomark_score_line(&entry.machine_id, &cmd));
    }
    Ok(lines)
}

fn merge_request_tags(filter: &mut ScopeFilter, tags: &[String]) {
    if tags.is_empty() {
        return;
    }
    let mut merged = filter.baseline_tags.clone().unwrap_or_default();
    for t in tags {
        let t = t.trim();
        if !t.is_empty() && !merged.iter().any(|x| x == t) {
            merged.push(t.to_string());
        }
    }
    if !merged.is_empty() {
        filter.baseline_tags = Some(merged);
    }
}

async fn apply_scope_defaults(
    settings: &SettingsRepository,
    filter: &mut ScopeFilter,
) -> anyhow::Result<()> {
    let platform = load_platform_config(settings).await?;
    if filter
        .platform
        .as_deref()
        .filter(|s| !s.is_empty())
        .is_none()
    {
        filter.platform = Some(platform.mudm_platform);
    }
    Ok(())
}

/// Resolve scope and extract process logs, progressively relaxing tag/machine filters.
pub async fn extract_training_logs(
    config: &AppConfig,
    cases: &CaseRepository,
    settings: &SettingsRepository,
    filter: &mut ScopeFilter,
    extra_tags: &[String],
) -> anyhow::Result<Vec<RawLogEntry>> {
    merge_request_tags(filter, extra_tags);
    resolve_scope(cases, filter).await?;
    apply_scope_defaults(settings, filter).await?;

    let mut attempts: Vec<ScopeFilter> = vec![filter.clone()];
    let mut relaxed = filter.clone();
    relaxed.baseline_tags = None;
    relaxed.candidate_tags = None;
    relaxed.machine_ids = None;
    relaxed.device_id = None;
    if relaxed != *filter {
        attempts.push(relaxed);
    }

    if filter.source.is_some() || filter.sources.is_some() || filter.case_id.is_some() {
        let mut source_only = ScopeFilter::endpoint_defaults();
        if let Some(s) = filter.source.clone() {
            source_only.source = Some(s);
        } else if let Some(ref sources) = filter.sources {
            source_only.sources = Some(sources.clone());
        }
        attempts.push(source_only);
    }

    attempts.push(ScopeFilter::endpoint_defaults());

    for attempt in attempts {
        let logs = extract_process_logs(config, &attempt).await?;
        let platform = load_platform_config(settings).await?;
        if !training_lines_from_logs(&logs, &platform.anomark_config)?.is_empty() {
            *filter = attempt;
            return Ok(logs);
        }
    }

    Ok(vec![])
}

pub fn train_model_from_lines(
    lines: &[String],
    order: u8,
    parallel_train_lines: usize,
    config: &AnoMarkPlatformConfig,
) -> anyhow::Result<MarkovModel> {
    let filter = train_line_filter(config)?;
    let mut kept = Vec::new();
    for line in lines {
        let cmd = command_from_scored_line(line);
        if !should_exclude_anomark_command(&filter, cmd) {
            kept.push(line.clone());
        }
    }
    if kept.is_empty() {
        anyhow::bail!("no training lines after AnoMark filters");
    }
    let lines = kept;
    let order = order.max(1).min(8) as usize;
    let parallel_threshold = parallel_train_lines.max(100);
    let mut model = if lines.len() > parallel_threshold {
        train_parallel(&lines, order, None, None)?
    } else {
        ModelHandler::train_from_csv(&lines, order, None, None)?
    };
    model.normalize_model_and_compute_prior();
    Ok(model)
}

async fn persist_training(
    repo: &IronSiftRepository,
    train_id: Uuid,
    label: &str,
    scope_filter: &Value,
    request_json: &Value,
    lines: &[String],
    order: u8,
    parallel_train_lines: usize,
    anomark_config: &AnoMarkPlatformConfig,
) -> anyhow::Result<AnoMarkTrainRecord> {
    let rel_dir = format!("{train_id}");
    let root = anomark_data_root().join(&rel_dir);
    std::fs::create_dir_all(&root)?;
    let model = train_model_from_lines(lines, order, parallel_train_lines, anomark_config)?;
    let model_path = root.join("model.bin");
    ModelHandler::save_model(&model, Some(model_path.to_string_lossy().as_ref()))?;

    let training_path = root.join("training_input.jsonl");
    std::fs::write(&training_path, lines.join("\n") + "\n")?;

    let rel_model_path = format!("{rel_dir}/model.bin");
    let rel_training_path = format!("{rel_dir}/training_input.jsonl");

    repo.insert_anomark_train(
        train_id,
        label,
        scope_filter,
        request_json,
        lines.len() as i64,
        &rel_model_path,
        &rel_training_path,
    )
    .await?;

    repo.get_anomark_train(train_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("training record missing after insert"))
}

pub async fn train_anomark_model(
    config: &AppConfig,
    cases: &CaseRepository,
    settings: &SettingsRepository,
    repo: &IronSiftRepository,
    mut req: AnoMarkTrainRequest,
) -> anyhow::Result<AnoMarkTrainResult> {
    let extra_tags = req.tags.clone();
    let original_filter = req.filter.clone();
    let logs = extract_training_logs(config, cases, settings, &mut req.filter, &extra_tags).await?;
    let platform = load_platform_config(settings).await?;
    let lines = training_lines_from_logs(&logs, &platform.anomark_config)?;
    if lines.is_empty() {
        anyhow::bail!(
            "no process command lines in scope for AnoMark training after filters — ingest endpoint JSONL or zip first, then select a case/source in Fleet scope"
        );
    }

    let distinct_machines = logs
        .iter()
        .map(|e| e.machine_id.as_str())
        .collect::<std::collections::HashSet<_>>()
        .len() as i64;
    let scope_relaxed = req.filter != original_filter;

    let order = if req.order == 0 {
        platform.anomark_config.default_order
    } else {
        req.order
    }
    .max(1)
    .min(8);
    let parallel_train_lines = platform.anomark_config.parallel_train_lines;
    let anomark_config = platform.anomark_config.clone();
    let train_id = Uuid::now_v7();
    let request_json = serde_json::to_value(&req)?;
    let scope_filter = serde_json::to_value(&req.filter)?;
    let label = if req.label.trim().is_empty() {
        "baseline model".to_string()
    } else {
        req.label.trim().to_string()
    };

    let record = persist_training(
        repo,
        train_id,
        &label,
        &scope_filter,
        &request_json,
        &lines,
        order,
        parallel_train_lines,
        &anomark_config,
    )
    .await?;

    Ok(AnoMarkTrainResult {
        status: "ok".into(),
        train_id,
        record,
        stats: AnoMarkTrainStats {
            process_log_count: logs.len() as i64,
            training_line_count: lines.len() as i64,
            distinct_machines,
            order,
            scope_relaxed,
        },
    })
}

/// Train inline from fleet run logs (embedded IronSift AnoMark, no saved model required).
pub fn train_model_from_logs(
    logs: &[RawLogEntry],
    order: u8,
    parallel_train_lines: usize,
    config: &AnoMarkPlatformConfig,
) -> anyhow::Result<MarkovModel> {
    let lines = training_lines_from_logs(logs, config)?;
    train_model_from_lines(&lines, order, parallel_train_lines, config)
}

pub fn model_path_for(rel_model_path: &str) -> PathBuf {
    anomark_data_root().join(rel_model_path)
}

pub fn load_model(rel_model_path: &str) -> anyhow::Result<MarkovModel> {
    let path = model_path_for(rel_model_path);
    if !path.is_file() {
        anyhow::bail!("AnoMark model file missing: {}", path.display());
    }
    ModelHandler::load_model(path.to_string_lossy().as_ref()).map_err(Into::into)
}

fn score_command(model: &MarkovModel, text: &str) -> f64 {
    let padded = format!("{}{}", "~".repeat(model.order), text);
    model.log_likelihood(&padded)
}

/// Score endpoint process logs; returns per-machine suspicious ratios (0..1).
pub fn score_machines(
    model: &MarkovModel,
    logs: &[RawLogEntry],
    suspect_percent: f64,
    config: &AnoMarkPlatformConfig,
) -> anyhow::Result<std::collections::HashMap<String, (f64, Vec<String>)>> {
    use std::collections::HashMap;
    let threshold = model.prior.ln() * (suspect_percent / 100.0);
    let max_reasons = config.max_reasons_per_host.clamp(1, 20);
    let filter = train_line_filter(config)?;
    let mut per_machine: HashMap<String, (usize, usize, Vec<String>)> = HashMap::new();

    for entry in logs {
        let cmd = command_from_log(entry);
        if cmd.is_empty() || should_exclude_anomark_command(&filter, &cmd) {
            continue;
        }
        let scored = anomark_score_line(&entry.machine_id, &cmd);
        if scored.is_empty() {
            continue;
        }
        let slot = per_machine
            .entry(entry.machine_id.clone())
            .or_insert((0, 0, Vec::new()));
        slot.0 += 1;
        let ln_score = score_command(model, &scored);
        if ln_score < threshold {
            slot.1 += 1;
            if slot.2.len() < max_reasons {
                slot.2
                    .push(format!("AnoMark suspect: {cmd} (score {ln_score:.4})"));
            }
        }
    }

    Ok(per_machine
        .into_iter()
        .map(|(mid, (total, suspects, reasons))| {
            let ratio = if total == 0 {
                0.0
            } else {
                suspects as f64 / total as f64
            };
            (mid, (ratio, reasons))
        })
        .collect())
}

pub fn default_suspect_percent() -> f64 {
    95.0
}

pub fn clamp_suspect_percent(pct: f64) -> f64 {
    pct.clamp(55.0, 99.999)
}

fn read_sample_training_lines(path: &std::path::Path, max: usize) -> Vec<String> {
    std::fs::read_to_string(path)
        .map(|text| {
            text.lines()
                .filter(|line| !line.trim().is_empty())
                .take(max)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn inspect_model_file(path: &std::path::Path) -> anyhow::Result<AnoMarkModelInspection> {
    if !path.is_file() {
        anyhow::bail!("model file not found: {}", path.display());
    }
    let path_str = path.to_string_lossy();
    let mut model = ModelHandler::load_model(path_str.as_ref())?;
    if !model.is_trained() {
        model.normalize_model_and_compute_prior();
    }
    let threshold = ModelHandler::compute_threshold(&model, default_suspect_percent());
    let meta = std::fs::metadata(path)?;
    let model_path = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();
    Ok(AnoMarkModelInspection {
        model_path,
        file_size_bytes: meta.len(),
        order: model.order,
        is_trained: model.is_trained(),
        prior: model.prior,
        num_contexts: model.num_contexts(),
        num_transitions: model.num_transitions(),
        alphabet_len: model.alphabet_len(),
        raw_markov_entries: model.raw_markov_entries(),
        suspect_threshold_ln: threshold,
    })
}

pub fn remove_anomark_train_files(train_id: Uuid) {
    let dir = anomark_data_root().join(train_id.to_string());
    if dir.is_dir() {
        let _ = std::fs::remove_dir_all(dir);
    }
}

pub fn remove_all_anomark_train_files() {
    let root = anomark_data_root();
    if !root.is_dir() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

pub async fn score_anomark_command(
    repo: &IronSiftRepository,
    train_id: Uuid,
    request: ScoreAnomarkCommandRequest,
    default_suspect_percent: f64,
) -> anyhow::Result<AnoMarkCommandScore> {
    const MAX_CMD: usize = 32 * 1024;
    let command = request.command.trim();
    if command.is_empty() {
        anyhow::bail!("command is empty");
    }
    if command.len() > MAX_CMD {
        anyhow::bail!("command exceeds {MAX_CMD} characters");
    }
    let machine = request
        .machine_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let scored_line = anomark_score_line(machine.unwrap_or(""), command);
    if scored_line.is_empty() {
        anyhow::bail!("command is empty");
    }
    if scored_line.len() > MAX_CMD {
        anyhow::bail!("scored line exceeds {MAX_CMD} characters");
    }

    let record = repo
        .get_anomark_train(train_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("training not found"))?;
    let model_path = model_path_for(&record.rel_model_path);
    if !model_path.is_file() {
        anyhow::bail!("model file not found: {}", model_path.display());
    }

    let mut model = ModelHandler::load_model(model_path.to_string_lossy().as_ref())?;
    if !model.is_trained() {
        model.normalize_model_and_compute_prior();
    }
    let pct = clamp_suspect_percent(
        request
            .suspect_percent
            .unwrap_or(default_suspect_percent),
    );
    let threshold_ln = ModelHandler::compute_threshold(&model, pct);
    let padded = format!("{}{}", "~".repeat(model.order), scored_line);
    let log_likelihood = model.log_likelihood(&padded);
    let is_suspect = ModelHandler::is_suspect_command(log_likelihood, threshold_ln);
    let margin_ln = log_likelihood - threshold_ln;
    let canonical = model_path
        .canonicalize()
        .unwrap_or(model_path)
        .to_string_lossy()
        .into_owned();

    Ok(AnoMarkCommandScore {
        train_id,
        model_path: canonical,
        order: model.order,
        log_likelihood,
        suspect_threshold_ln: threshold_ln,
        is_suspect,
        margin_ln,
        suspect_percent_used: pct,
        line_scored: scored_line,
    })
}

pub async fn inspect_anomark_train(
    repo: &IronSiftRepository,
    id: Uuid,
) -> anyhow::Result<AnoMarkTrainInspectResult> {
    let record = repo
        .get_anomark_train(id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("training not found"))?;
    let model_path = model_path_for(&record.rel_model_path);
    let inspection = inspect_model_file(&model_path)?;
    let training_path = model_path_for(&record.rel_training_path);
    let sample_training_lines = read_sample_training_lines(&training_path, 12);
    Ok(AnoMarkTrainInspectResult {
        record,
        inspection,
        sample_training_lines,
    })
}

pub async fn get_selected_anomark_train_id(
    settings: &SettingsRepository,
) -> anyhow::Result<Option<Uuid>> {
    let raw = settings.get(SELECTED_ANOMARK_TRAIN_KEY).await?;
    if raw.is_null() {
        return Ok(None);
    }
    if let Some(s) = raw.as_str() {
        return Ok(Uuid::parse_str(s).ok());
    }
    Ok(None)
}

pub async fn list_anomark_trains_with_selection(
    repo: &IronSiftRepository,
    settings: &SettingsRepository,
) -> anyhow::Result<AnoMarkTrainsListResponse> {
    let trains = repo.list_anomark_trains().await?;
    let selected_id = get_selected_anomark_train_id(settings).await?;
    Ok(AnoMarkTrainsListResponse {
        trains,
        selected_id,
    })
}

pub async fn select_anomark_train_for_runs(
    repo: &IronSiftRepository,
    settings: &SettingsRepository,
    id: Uuid,
) -> anyhow::Result<()> {
    repo.get_anomark_train(id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("training not found"))?;
    settings
        .set(SELECTED_ANOMARK_TRAIN_KEY, &serde_json::json!(id.to_string()))
        .await?;
    Ok(())
}

async fn clear_selected_anomark_train_if(settings: &SettingsRepository, id: Uuid) -> anyhow::Result<()> {
    if get_selected_anomark_train_id(settings).await? == Some(id) {
        settings.set(SELECTED_ANOMARK_TRAIN_KEY, &serde_json::Value::Null).await?;
    }
    Ok(())
}

pub async fn delete_anomark_train(
    repo: &IronSiftRepository,
    settings: &SettingsRepository,
    id: Uuid,
) -> anyhow::Result<()> {
    let deleted = repo.delete_anomark_train(id).await?;
    if !deleted {
        anyhow::bail!("training not found");
    }
    remove_anomark_train_files(id);
    clear_selected_anomark_train_if(settings, id).await?;
    Ok(())
}

pub async fn delete_all_anomark_trains(
    repo: &IronSiftRepository,
    settings: &SettingsRepository,
) -> anyhow::Result<i64> {
    let removed = repo.delete_all_anomark_trains().await?;
    remove_all_anomark_train_files();
    settings
        .set(SELECTED_ANOMARK_TRAIN_KEY, &serde_json::Value::Null)
        .await?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn score_line_includes_machine() {
        assert_eq!(
            anomark_score_line("ws-01", "/bin/bash -c ls"),
            "ws-01 /bin/bash -c ls"
        );
    }

    fn sample_log(machine_id: &str, name: &str, path: &str) -> RawLogEntry {
        RawLogEntry {
            machine_id: machine_id.into(),
            pid: 1,
            ppid: 0,
            name: name.into(),
            uid: 0,
            path: path.into(),
            args: String::new(),
            timestamp: None,
        }
    }

    #[test]
    fn training_lines_exclude_kernel_threads() {
        let logs = vec![
            sample_log("ws-01", "[kthreadd]", ""),
            sample_log("ws-01", "", "/bin/ls"),
        ];
        let cfg = AnoMarkPlatformConfig {
            exclude_kernel_threads: true,
            exclude_regex: Vec::new(),
            ..Default::default()
        };
        let lines = training_lines_from_logs(&logs, &cfg).unwrap();
        assert_eq!(lines, vec!["ws-01 /bin/ls".to_string()]);
    }

    #[test]
    fn training_lines_exclude_regex() {
        let logs = vec![
            sample_log("ws-01", "", "/usr/lib/systemd/systemd"),
            sample_log("ws-01", "systemd", ""),
        ];
        let cfg = AnoMarkPlatformConfig {
            exclude_kernel_threads: false,
            exclude_regex: vec![r"^systemd$".to_string()],
            ..Default::default()
        };
        let lines = training_lines_from_logs(&logs, &cfg).unwrap();
        assert_eq!(lines, vec!["ws-01 /usr/lib/systemd/systemd".to_string()]);
    }
}
