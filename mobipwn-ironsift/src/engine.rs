use ironsift::{
    analyze_files_fleet, analyze_fleet, build_file_profiles, build_machine_snapshot, build_profiles,
    compare_temporal, AnomalyLevel, AnalysisReport, DetectionConfig,
};
use mobipwn_core::config::AppConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::config::{merge_detection_config_with_override, IronSiftPlatformConfig};
use crate::extract::{
    distinct_machine_ids, extract_connection_logs, extract_file_logs, extract_process_logs,
    extract_process_logs_window, ScopeFilter,
};
use crate::process_enrich::enrich_process_findings;
use crate::store::{
    IronSiftRepository, IronSiftRunMode, IronSiftRunRecord, IronSiftRunScope, IronSiftRunStatus,
    SaveFindingInput,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRunRequest {
    pub mode: IronSiftRunMode,
    pub scope: IronSiftRunScope,
    #[serde(default)]
    pub filter: ScopeFilter,
    #[serde(default)]
    pub triggered_by: String,
    #[serde(default)]
    pub enable_anomark: bool,
    #[serde(default)]
    pub anomark_train_id: Option<Uuid>,
    #[serde(default = "default_anomark_suspect_percent")]
    pub anomark_suspect_percent: f64,
    /// Per-run detection settings override (merged on top of platform defaults).
    #[serde(default)]
    pub detection_config_override: Option<Value>,
    /// When true, findings above min_score are upserted into mobipwn alerts.
    #[serde(default)]
    pub sync_alerts: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ironsift_config_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anomark_config_name: Option<String>,
}

fn default_anomark_suspect_percent() -> f64 {
    crate::anomark::default_suspect_percent()
}

#[derive(Debug, Clone)]
pub struct RunOutcome {
    pub run: IronSiftRunRecord,
    pub findings: Vec<SaveFindingInput>,
}

pub async fn run_fleet(
    config: &AppConfig,
    repo: &IronSiftRepository,
    platform: &IronSiftPlatformConfig,
    req: &CreateRunRequest,
    detection: &DetectionConfig,
) -> anyhow::Result<RunOutcome> {
    let logs = extract_process_logs(config, &req.filter).await?;
    let machines = distinct_machine_ids(&logs);
    let run = repo
        .create_run(
            IronSiftRunMode::Fleet,
            req.scope,
            &req.filter,
            &serde_json::to_value(detection)?,
            &req.triggered_by,
            req.ironsift_config_name.as_deref(),
            req.anomark_config_name.as_deref(),
        )
        .await?;

    if machines.len() < platform.min_fleet_devices as usize {
        let summary = format!(
            "Skipped process fleet: {} process events from {} host(s); need at least {} devices",
            logs.len(),
            machines.len(),
            platform.min_fleet_devices
        );
        let report_json = skipped_fleet_report_json(
            "process_fleet",
            logs.len(),
            machines.len(),
            platform.min_fleet_devices,
        );
        repo.finish_run(
            run.id,
            IronSiftRunStatus::Skipped,
            machines.len() as i32,
            0,
            &summary,
            None,
            Some(&report_json),
        )
        .await?;
        return Ok(RunOutcome {
            run: repo.get_run(run.id).await?.unwrap(),
            findings: vec![],
        });
    }

    repo.record_devices(run.id, &machines, req.filter.source.as_deref())
        .await?;

    let profiles = build_profiles(logs.clone(), detection);
    let report = analyze_fleet(&profiles, detection).map_err(|e| anyhow::anyhow!("{e}"))?;
    let mut findings = enrich_process_findings(
        fleet_findings(&report.anomalies, platform.min_score, "ironsift-process"),
        &logs,
    );

    if req.enable_anomark {
        findings.extend(
            anomark_findings(repo, platform, req, &logs)
                .await?,
        );
    }

    let summary = process_fleet_summary(
        logs.len(),
        machines.len(),
        &report,
        &findings,
        platform.min_score,
    );
    let report_json = process_fleet_report_json(
        &report,
        &findings,
        logs.len(),
        machines.len(),
        platform.min_score,
    );
    repo.finish_run(
        run.id,
        IronSiftRunStatus::Done,
        report.total_analyzed as i32,
        findings.len() as i32,
        &summary,
        None,
        Some(&report_json),
    )
    .await?;

    Ok(RunOutcome {
        run: repo.get_run(run.id).await?.unwrap(),
        findings,
    })
}

pub async fn run_file_fleet(
    config: &AppConfig,
    repo: &IronSiftRepository,
    platform: &IronSiftPlatformConfig,
    req: &CreateRunRequest,
    detection: &DetectionConfig,
) -> anyhow::Result<RunOutcome> {
    let logs = extract_file_logs(config, &req.filter).await?;
    let machines: Vec<String> = logs
        .iter()
        .map(|l| l.machine_id.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    let run = repo
        .create_run(
            IronSiftRunMode::File,
            req.scope,
            &req.filter,
            &serde_json::to_value(detection)?,
            &req.triggered_by,
            req.ironsift_config_name.as_deref(),
            req.anomark_config_name.as_deref(),
        )
        .await?;

    if machines.len() < platform.min_fleet_devices as usize {
        let summary = format!(
            "Skipped file fleet: need at least {} devices, found {}",
            platform.min_fleet_devices,
            machines.len()
        );
        repo.finish_run(
            run.id,
            IronSiftRunStatus::Skipped,
            machines.len() as i32,
            0,
            &summary,
            None,
            None,
        )
        .await?;
        return Ok(RunOutcome {
            run: repo.get_run(run.id).await?.unwrap(),
            findings: vec![],
        });
    }

    repo.record_devices(run.id, &machines, req.filter.source.as_deref())
        .await?;
    let profiles = build_file_profiles(logs, detection);
    let report = analyze_files_fleet(&profiles, detection).map_err(|e| anyhow::anyhow!("{e}"))?;
    let findings = fleet_findings(&report.anomalies, platform.min_score, "ironsift-file");
    let summary = format!(
        "File fleet: {} machines, {} anomalies",
        report.total_analyzed,
        findings.len()
    );
    repo.finish_run(
        run.id,
        IronSiftRunStatus::Done,
        report.total_analyzed as i32,
        findings.len() as i32,
        &summary,
        None,
        None,
    )
    .await?;

    Ok(RunOutcome {
        run: repo.get_run(run.id).await?.unwrap(),
        findings,
    })
}

pub async fn run_temporal(
    config: &AppConfig,
    repo: &IronSiftRepository,
    platform: &IronSiftPlatformConfig,
    req: &CreateRunRequest,
    detection: &DetectionConfig,
) -> anyhow::Result<RunOutcome> {
    let machine_id = req
        .filter
        .device_id
        .clone()
        .or_else(|| req.filter.source.clone())
        .ok_or_else(|| anyhow::anyhow!("temporal run requires device_id or source"))?;

    let baseline_from = req
        .filter
        .baseline_from
        .ok_or_else(|| anyhow::anyhow!("temporal run requires baseline_from"))?;
    let baseline_to = req
        .filter
        .baseline_to
        .ok_or_else(|| anyhow::anyhow!("temporal run requires baseline_to"))?;
    let current_from = req
        .filter
        .current_from
        .ok_or_else(|| anyhow::anyhow!("temporal run requires current_from"))?;
    let current_to = req.filter.current_to.unwrap_or_else(chrono::Utc::now);

    let mut base_filter = req.filter.clone();
    base_filter.device_id = Some(machine_id.clone());
    let baseline_proc =
        extract_process_logs_window(config, &base_filter, baseline_from, baseline_to).await?;
    let baseline_files = extract_file_logs(config, &base_filter).await?;
    let baseline_conn = extract_connection_logs(config, &base_filter).await?;

    let mut cur_filter = req.filter.clone();
    cur_filter.device_id = Some(machine_id.clone());
    let current_proc =
        extract_process_logs_window(config, &cur_filter, current_from, current_to).await?;
    let current_files = extract_file_logs(config, &cur_filter).await?;
    let current_conn = extract_connection_logs(config, &cur_filter).await?;

    let run = repo
        .create_run(
            IronSiftRunMode::Temporal,
            req.scope,
            &req.filter,
            &serde_json::to_value(detection)?,
            &req.triggered_by,
            req.ironsift_config_name.as_deref(),
            req.anomark_config_name.as_deref(),
        )
        .await?;

    let baseline = build_machine_snapshot(
        &machine_id,
        &baseline_to.to_rfc3339(),
        baseline_proc,
        baseline_files,
        baseline_conn,
        detection,
    );
    let current = build_machine_snapshot(
        &machine_id,
        &current_to.to_rfc3339(),
        current_proc,
        current_files,
        current_conn,
        detection,
    );
    let diff = compare_temporal(&baseline, &current);
    let findings = temporal_findings(&diff, platform.min_score);
    let summary = if diff.has_changes() {
        format!(
            "Temporal diff for {machine_id}: {} new processes, {} new connections",
            diff.new_processes.len(),
            diff.new_connections.len()
        )
    } else {
        format!("Temporal diff for {machine_id}: no changes")
    };

    let report_json = serde_json::to_value(&diff)?;
    repo.record_devices(run.id, &[machine_id.clone()], req.filter.source.as_deref())
        .await?;
    repo.finish_run(
        run.id,
        IronSiftRunStatus::Done,
        1,
        findings.len() as i32,
        &summary,
        None,
        Some(&report_json),
    )
    .await?;

    Ok(RunOutcome {
        run: repo.get_run(run.id).await?.unwrap(),
        findings,
    })
}

pub async fn run_both(
    config: &AppConfig,
    repo: &IronSiftRepository,
    platform: &IronSiftPlatformConfig,
    req: &CreateRunRequest,
    detection: &DetectionConfig,
) -> anyhow::Result<RunOutcome> {
    let proc_logs = extract_process_logs(config, &req.filter).await?;
    let file_logs = extract_file_logs(config, &req.filter).await?;
    let mut machines: std::collections::HashSet<String> = proc_logs
        .iter()
        .map(|l| l.machine_id.clone())
        .chain(file_logs.iter().map(|l| l.machine_id.clone()))
        .collect();
    let machines: Vec<String> = machines.drain().collect();
    let run = repo
        .create_run(
            IronSiftRunMode::Both,
            req.scope,
            &req.filter,
            &serde_json::to_value(detection)?,
            &req.triggered_by,
            req.ironsift_config_name.as_deref(),
            req.anomark_config_name.as_deref(),
        )
        .await?;

    if machines.len() < platform.min_fleet_devices as usize {
        let summary = format!(
            "Skipped combined fleet: need at least {} devices, found {}",
            platform.min_fleet_devices,
            machines.len()
        );
        repo.finish_run(
            run.id,
            IronSiftRunStatus::Skipped,
            machines.len() as i32,
            0,
            &summary,
            None,
            None,
        )
        .await?;
        return Ok(RunOutcome {
            run: repo.get_run(run.id).await?.unwrap(),
            findings: vec![],
        });
    }

    repo.record_devices(run.id, &machines, req.filter.source.as_deref())
        .await?;

    let mut findings = Vec::new();
    let mut total_analyzed = 0i32;
    if !proc_logs.is_empty() {
        let profiles = build_profiles(proc_logs.clone(), detection);
        let report = analyze_fleet(&profiles, detection).map_err(|e| anyhow::anyhow!("{e}"))?;
        total_analyzed = total_analyzed.max(report.total_analyzed as i32);
        findings.extend(enrich_process_findings(
            fleet_findings(&report.anomalies, platform.min_score, "ironsift-process"),
            &proc_logs,
        ));
    }
    if !file_logs.is_empty() {
        let profiles = build_file_profiles(file_logs, detection);
        let report = analyze_files_fleet(&profiles, detection).map_err(|e| anyhow::anyhow!("{e}"))?;
        total_analyzed = total_analyzed.max(report.total_analyzed as i32);
        findings.extend(fleet_findings(
            &report.anomalies,
            platform.min_score,
            "ironsift-file",
        ));
    }
    if req.enable_anomark {
        findings.extend(anomark_findings(repo, platform, req, &proc_logs).await?);
    }

    let summary = format!(
        "Combined fleet: {} machines, {} anomalies (process + file + AnoMark)",
        machines.len(),
        findings.len()
    );
    repo.finish_run(
        run.id,
        IronSiftRunStatus::Done,
        total_analyzed.max(machines.len() as i32),
        findings.len() as i32,
        &summary,
        None,
        Some(&json!({
            "machines": machines.len(),
            "anomaly_count": findings.len(),
            "arms": ["process", "file", "anomark"],
        })),
    )
    .await?;

    Ok(RunOutcome {
        run: repo.get_run(run.id).await?.unwrap(),
        findings,
    })
}

pub async fn run_anomark(
    config: &AppConfig,
    repo: &IronSiftRepository,
    platform: &IronSiftPlatformConfig,
    req: &CreateRunRequest,
    detection: &DetectionConfig,
) -> anyhow::Result<RunOutcome> {
    let logs = extract_process_logs(config, &req.filter).await?;
    let machines = distinct_machine_ids(&logs);
    let run = repo
        .create_run(
            IronSiftRunMode::Anomark,
            req.scope,
            &req.filter,
            &serde_json::to_value(detection)?,
            &req.triggered_by,
            req.ironsift_config_name.as_deref(),
            req.anomark_config_name.as_deref(),
        )
        .await?;

    if machines.is_empty() {
        let summary = "Skipped AnoMark: no process logs in scope".to_string();
        repo.finish_run(
            run.id,
            IronSiftRunStatus::Skipped,
            0,
            0,
            &summary,
            None,
            None,
        )
        .await?;
        return Ok(RunOutcome {
            run: repo.get_run(run.id).await?.unwrap(),
            findings: vec![],
        });
    }

    repo.record_devices(run.id, &machines, req.filter.source.as_deref())
        .await?;
    let findings = anomark_findings(repo, platform, req, &logs).await?;
    let summary = format!(
        "AnoMark: {} machines, {} anomalies",
        machines.len(),
        findings.len()
    );
    repo.finish_run(
        run.id,
        IronSiftRunStatus::Done,
        machines.len() as i32,
        findings.len() as i32,
        &summary,
        None,
        Some(&json!({ "machines": machines.len(), "anomaly_count": findings.len() })),
    )
    .await?;

    Ok(RunOutcome {
        run: repo.get_run(run.id).await?.unwrap(),
        findings,
    })
}

pub async fn execute_run(
    config: &AppConfig,
    repo: &IronSiftRepository,
    platform: &IronSiftPlatformConfig,
    req: CreateRunRequest,
) -> anyhow::Result<RunOutcome> {
    let detection = merge_detection_config_with_override(platform, req.detection_config_override.clone());
    match req.mode {
        IronSiftRunMode::Fleet => run_fleet(config, repo, platform, &req, &detection).await,
        IronSiftRunMode::File => run_file_fleet(config, repo, platform, &req, &detection).await,
        IronSiftRunMode::Temporal => run_temporal(config, repo, platform, &req, &detection).await,
        IronSiftRunMode::Both => run_both(config, repo, platform, &req, &detection).await,
        IronSiftRunMode::Anomark => run_anomark(config, repo, platform, &req, &detection).await,
    }
}

async fn anomark_findings(
    repo: &IronSiftRepository,
    platform: &IronSiftPlatformConfig,
    req: &CreateRunRequest,
    logs: &[ironsift::RawLogEntry],
) -> anyhow::Result<Vec<SaveFindingInput>> {
    let amo = &platform.anomark_config;
    let pct = crate::anomark::clamp_suspect_percent(
        if req.anomark_suspect_percent > 0.0 {
            req.anomark_suspect_percent
        } else {
            amo.default_suspect_percent
        },
    );
    let model = if let Some(train_id) = req.anomark_train_id {
        repo.get_anomark_train(train_id)
            .await?
            .and_then(|record| crate::anomark::load_model(&record.rel_model_path).ok())
    } else {
        crate::anomark::train_model_from_logs(logs, amo.default_order, amo.parallel_train_lines, amo).ok()
    };
    let Some(model) = model else {
        return Ok(vec![]);
    };
    let mut out = Vec::new();
    let scores = crate::anomark::score_machines(&model, logs, pct, amo)?;
    for (machine_id, (ratio, reasons)) in scores {
        if reasons.is_empty() {
            continue;
        }
        let score = (0.5 + ratio * 0.5).min(1.0);
        if score < platform.min_score {
            continue;
        }
        let severity = if score >= 0.9 {
            "CRITICAL"
        } else if score >= 0.7 {
            "HIGH"
        } else if score >= 0.4 {
            "MEDIUM"
        } else {
            "LOW"
        };
        out.push(SaveFindingInput {
            machine_id,
            detector: "anomark-rs".into(),
            severity: severity.into(),
            score,
            distance_score: Some(ratio),
            reasons,
            cluster_id: None,
            raw_json: json!({ "anomark_suspect_ratio": ratio }),
        });
    }
    Ok(out)
}

fn severity_counts(findings: &[SaveFindingInput]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for finding in findings {
        *counts.entry(finding.severity.clone()).or_insert(0) += 1;
    }
    counts
}

fn format_severity_counts(counts: &HashMap<String, usize>) -> String {
    const ORDER: &[&str] = &["CRITICAL", "HIGH", "MEDIUM", "LOW"];
    ORDER
        .iter()
        .filter_map(|level| {
            counts
                .get(*level)
                .filter(|count| **count > 0)
                .map(|count| format!("{count} {level}"))
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn cluster_stats_json(report: &AnalysisReport) -> HashMap<String, usize> {
    report
        .cluster_stats
        .iter()
        .map(|(cluster_id, count)| {
            let key = match cluster_id {
                None => "noise".to_string(),
                Some(id) => id.to_string(),
            };
            (key, *count)
        })
        .collect()
}

fn skipped_fleet_report_json(
    kind: &str,
    event_count: usize,
    distinct_machines: usize,
    min_fleet_devices: u32,
) -> Value {
    json!({
        "kind": kind,
        "event_count": event_count,
        "distinct_machines": distinct_machines,
        "min_fleet_devices": min_fleet_devices,
        "status_reason": "insufficient_devices",
    })
}

fn process_fleet_summary(
    process_log_count: usize,
    distinct_machines: usize,
    report: &AnalysisReport,
    findings: &[SaveFindingInput],
    min_score: f64,
) -> String {
    let severity = format_severity_counts(&severity_counts(findings));
    if findings.is_empty() {
        return format!(
            "Process fleet: {process_log_count} process events from {distinct_machines} hosts, {} profiled — no anomalies above score {min_score:.2}",
            report.total_analyzed
        );
    }
    let affected_hosts = findings
        .iter()
        .map(|f| f.machine_id.as_str())
        .collect::<std::collections::HashSet<_>>()
        .len();
    let mut summary = format!(
        "Process fleet: {process_log_count} process events from {distinct_machines} hosts, {} profiled — {} finding(s) on {affected_hosts} host(s)",
        report.total_analyzed,
        findings.len()
    );
    if !severity.is_empty() {
        summary.push_str(&format!(" ({severity})"));
    }
    summary
}

fn process_fleet_report_json(
    report: &AnalysisReport,
    findings: &[SaveFindingInput],
    process_log_count: usize,
    distinct_machines: usize,
    min_score: f64,
) -> Value {
    let cluster_stats = cluster_stats_json(report);
    let clusters_found = report.cluster_stats.keys().filter(|id| id.is_some()).count();
    let noise_machines = report.cluster_stats.get(&None).copied().unwrap_or(0);
    let affected_hosts = findings
        .iter()
        .map(|f| f.machine_id.as_str())
        .collect::<std::collections::HashSet<_>>()
        .len();
    json!({
        "kind": "process_fleet",
        "process_log_count": process_log_count,
        "distinct_machines": distinct_machines,
        "total_analyzed": report.total_analyzed,
        "anomalies_detected": report.anomalies.len(),
        "anomaly_count": findings.len(),
        "affected_hosts": affected_hosts,
        "min_score": min_score,
        "severity_counts": severity_counts(findings),
        "cluster_stats": cluster_stats,
        "clusters_found": clusters_found,
        "noise_machines": noise_machines,
    })
}

fn fleet_findings(
    anomalies: &[ironsift::AnomalyDetails],
    min_score: f64,
    detector: &str,
) -> Vec<SaveFindingInput> {
    anomalies
        .iter()
        .filter_map(|a| {
            let score = anomaly_score(&a.severity);
            if score < min_score {
                return None;
            }
            Some(SaveFindingInput {
                machine_id: a.machine_id.clone(),
                detector: detector.into(),
                severity: a.severity.as_str().to_string(),
                score,
                distance_score: Some(a.distance_score),
                reasons: a.anomalous_features.clone(),
                cluster_id: a.cluster_assignment.map(|c| c.to_string()),
                raw_json: json!({
                    "process_count": a.process_count,
                    "suspicious_process_count": a.suspicious_process_count,
                    "distance_score": a.distance_score,
                    "cluster_id": a.cluster_assignment,
                }),
            })
        })
        .collect()
}

fn temporal_findings(diff: &ironsift::TemporalDiff, min_score: f64) -> Vec<SaveFindingInput> {
    if !diff.has_changes() {
        return vec![];
    }
    let mut reasons = Vec::new();
    for p in &diff.new_processes {
        reasons.push(format!("New process: {} ({})", p.name, p.path));
    }
    for ip in &diff.new_connections {
        reasons.push(format!("New connection: {ip}"));
    }
    for f in &diff.new_files {
        reasons.push(format!("New file: {}", f.path));
    }
    for (path, _, _) in &diff.modified_files {
        reasons.push(format!("Modified file: {path}"));
    }
    let score = if diff.new_processes.len() >= 3 || diff.new_connections.len() >= 5 {
        0.85
    } else if diff.new_processes.is_empty() && diff.new_connections.len() <= 2 {
        0.45
    } else {
        0.65
    };
    if score < min_score {
        return vec![];
    }
    let severity = if score >= 0.8 {
        "HIGH"
    } else if score >= 0.5 {
        "MEDIUM"
    } else {
        "LOW"
    };
    vec![SaveFindingInput {
        machine_id: diff.machine_id.clone(),
        detector: "ironsift-temporal".into(),
        severity: severity.into(),
        score,
        distance_score: None,
        reasons,
        cluster_id: None,
        raw_json: serde_json::to_value(diff).unwrap_or(json!({})),
    }]
}

fn anomaly_score(level: &AnomalyLevel) -> f64 {
    match level {
        AnomalyLevel::Critical => 0.95,
        AnomalyLevel::High => 0.75,
        AnomalyLevel::Medium => 0.55,
        AnomalyLevel::Low => 0.35,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anomaly_score_ordering() {
        assert!(anomaly_score(&AnomalyLevel::Critical) > anomaly_score(&AnomalyLevel::High));
    }
}
