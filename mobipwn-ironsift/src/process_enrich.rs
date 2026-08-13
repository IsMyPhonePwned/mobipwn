use std::collections::HashMap;

use ironsift::RawLogEntry;
use serde::Serialize;
use serde_json::{json, Value};

use crate::store::SaveFindingInput;

#[derive(Debug, Clone, Serialize)]
struct ProcessExample {
    pid: u32,
    ppid: u32,
    name: String,
    path: String,
    args: String,
    uid: u32,
}

fn truncate_args(args: &str, max: usize) -> String {
    if args.chars().count() <= max {
        return args.to_string();
    }
    args.chars().take(max).collect::<String>() + "…"
}

fn parse_reason_target(reason: &str) -> (Option<String>, Option<String>) {
    if let Some(rest) = reason.strip_prefix("RISK DETECTED: ") {
        let mut name = None;
        let mut path = None;
        for part in rest.split_whitespace() {
            if let Some(v) = part.strip_prefix("name=") {
                name = Some(v.to_string());
            } else if let Some(v) = part.strip_prefix("path=") {
                path = Some(v.to_string());
            }
        }
        return (name, path);
    }
    if let Some(name) = reason.strip_prefix("Rare process: ") {
        return (Some(name.trim().to_string()), None);
    }
    if let Some(open) = reason.find(" (path: ") {
        let name = reason[..open].trim().to_string();
        let path = reason[open + 8..]
            .strip_suffix(')')
            .map(|s| s.to_string());
        return (Some(name), path);
    }
    (None, None)
}

fn log_matches(log: &RawLogEntry, name: &str, path: Option<&str>) -> bool {
    if log.name != name {
        return false;
    }
    match path {
        None => true,
        Some("(none)") => log.path.is_empty(),
        Some(p) => log.path == p,
    }
}

fn find_matching_logs<'a>(
    logs: &'a [&'a RawLogEntry],
    name: &str,
    path: Option<&str>,
) -> Vec<&'a RawLogEntry> {
    logs.iter()
        .copied()
        .filter(|log| log_matches(log, name, path))
        .collect()
}

fn enrich_reason_line(reason: &str, log: Option<&RawLogEntry>) -> String {
    let Some(log) = log else {
        return reason.to_string();
    };
    let args = truncate_args(&log.args, 160);
    if reason.starts_with("RISK DETECTED:") {
        return format!(
            "{reason} | pid={} ppid={} | args={}",
            log.pid, log.ppid, args
        );
    }
    if reason.starts_with("Rare process:") {
        return format!(
            "{reason} | pid={} ppid={} uid={} | path={} | args={}",
            log.pid, log.ppid, log.uid, log.path, args
        );
    }
    if reason.contains(" (path: ") {
        return format!(
            "{reason} | pid={} ppid={} uid={} | args={}",
            log.pid, log.ppid, log.uid, args
        );
    }
    reason.to_string()
}

pub fn enrich_process_findings(
    mut findings: Vec<SaveFindingInput>,
    logs: &[RawLogEntry],
) -> Vec<SaveFindingInput> {
    let mut by_machine: HashMap<String, Vec<&RawLogEntry>> = HashMap::new();
    for log in logs {
        by_machine
            .entry(log.machine_id.clone())
            .or_default()
            .push(log);
    }

    for finding in findings.iter_mut() {
        if finding.detector != "ironsift-process" {
            continue;
        }

        let machine_logs = by_machine
            .get(&finding.machine_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);

        let mut examples = Vec::new();
        let mut seen_pids = std::collections::HashSet::new();
        let mut enriched_reasons = Vec::with_capacity(finding.reasons.len());

        for reason in &finding.reasons {
            let (name, path) = parse_reason_target(reason);
            let matched = name
                .as_deref()
                .map(|n| find_matching_logs(machine_logs, n, path.as_deref()))
                .unwrap_or_default();

            for log in matched.iter().take(3) {
                if seen_pids.insert(log.pid) {
                    examples.push(ProcessExample {
                        pid: log.pid,
                        ppid: log.ppid,
                        name: log.name.clone(),
                        path: log.path.clone(),
                        args: truncate_args(&log.args, 240),
                        uid: log.uid,
                    });
                }
            }

            enriched_reasons.push(enrich_reason_line(reason, matched.first().copied()));
        }

        finding.reasons = enriched_reasons;

        let mut raw = match finding.raw_json.clone() {
            Value::Object(map) => Value::Object(map),
            _ => json!({}),
        };
        if let Value::Object(ref mut map) = raw {
            map.insert("process_examples".to_string(), json!(examples));
            if let Some(cid) = &finding.cluster_id {
                map.insert("cluster_id".to_string(), json!(cid));
            }
        }
        finding.raw_json = raw;
    }

    findings
}
