use mobipwn_core::store::{IngestJobProgress, IngestParserProgress};
use rayon::prelude::*;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use sysdiagnose_extractor_library::{ParserType, SysdiagnoseParser, SysdiagnoseArchive};

use crate::bugreport_report::ParserRunSummary;

/// Summary of a sysdiagnose parse before / after MUDM normalization.
#[derive(Debug, Clone)]
pub struct SysdiagnoseParseReport {
    pub input_display: String,
    pub file_bytes: usize,
    pub parsers_scheduled: usize,
    pub timeline_events: usize,
    pub mudm_events: usize,
    pub parser_runs: Vec<ParserRunSummary>,
    pub network_iocs_events: usize,
}

impl SysdiagnoseParseReport {
    pub fn parsers_ok(&self) -> usize {
        self.parser_runs.iter().filter(|p| p.ok).count()
    }

    pub fn parsers_failed(&self) -> usize {
        self.parser_runs.iter().filter(|p| !p.ok).count()
    }

    pub fn ingest_progress(&self) -> IngestJobProgress {
        build_progress(
            &self.parser_runs,
            self.parsers_scheduled,
            Some(self.timeline_events),
            Some(self.mudm_events),
            &[],
        )
    }

    pub fn log_tracing(&self) {
        tracing::info!(
            file = %self.input_display,
            mb = %(self.file_bytes as f64 / 1_048_576.0),
            parsers = self.parsers_scheduled,
            ok = self.parsers_ok(),
            failed = self.parsers_failed(),
            timeline = self.timeline_events,
            network_iocs = self.network_iocs_events,
            mudm = self.mudm_events,
            "sysdiagnose parse complete"
        );
        for p in &self.parser_runs {
            if p.ok {
                tracing::info!(
                    parser = %p.name,
                    ms = %p.duration_ms,
                    events = p.timeline_events,
                    "sysdiagnose parser"
                );
            } else {
                tracing::warn!(
                    parser = %p.name,
                    ms = %p.duration_ms,
                    error = p.error.as_deref().unwrap_or("unknown"),
                    "sysdiagnose parser failed"
                );
            }
        }
    }
}

pub type SysdiagnoseProgressFn =
    Arc<dyn Fn(&str, &str, Option<IngestJobProgress>) + Send + Sync>;

fn build_progress(
    runs: &[ParserRunSummary],
    total: usize,
    timeline_events: Option<usize>,
    mudm_events: Option<usize>,
    active: &[String],
) -> IngestJobProgress {
    IngestJobProgress {
        parsers: active
            .iter()
            .map(|name| IngestParserProgress {
                name: name.clone(),
                ok: true,
                events: 0,
                duration_ms: 0.0,
                error: None,
                status: Some("running".into()),
            })
            .chain(runs.iter().map(|p| IngestParserProgress {
                name: p.name.clone(),
                ok: p.ok,
                events: p.timeline_events,
                duration_ms: p.duration_ms,
                error: p.error.clone(),
                status: Some(if p.ok { "done".into() } else { "failed".into() }),
            }))
            .collect(),
        timeline_events,
        mudm_events,
        parsers_total: Some(total),
        parsers_completed: Some(runs.len()),
        parsers_active: if active.is_empty() {
            None
        } else {
            Some(active.to_vec())
        },
        batch: None,
        batches: None,
        rows_inserted: None,
        logarchive: None,
        options: None,
    }
}

fn emit_parser_progress(
    cb: &SysdiagnoseProgressFn,
    runs: &[ParserRunSummary],
    active: &[String],
    total: usize,
    detail: &str,
) {
    cb(
        "parsing",
        detail,
        Some(build_progress(runs, total, None, None, active)),
    );
}

/// Rough record count from raw parser JSON (events array, rows, files, device block, …).
pub fn estimate_parser_output(value: &Value) -> usize {
    if value.get("error").is_some() {
        return 0;
    }
    if value.get("format").and_then(|x| x.as_str()) == Some("jsonl") {
        return value
            .get("events")
            .and_then(|e| e.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
    }
    if value.get("format").and_then(|x| x.as_str()) == Some("compact") {
        let props = value
            .get("device_properties")
            .and_then(|p| p.as_object())
            .map(|o| o.len())
            .unwrap_or(0);
        let nodes = value
            .get("summary")
            .and_then(|s| s.get("node_count"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0) as usize;
        return props.saturating_add(nodes).max(1);
    }
    if let Some(rows) = value.get("rows").and_then(|r| r.as_array()) {
        return rows.len();
    }
    if let Some(inv) = value.get("inventory") {
        let files = inv
            .get("file_count")
            .and_then(|n| n.as_u64())
            .unwrap_or(0) as usize;
        let events = value
            .get("events")
            .and_then(|e| e.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        return files.saturating_add(events).max(1);
    }
    if let Some(files) = value.get("files").and_then(|f| f.as_object()) {
        return files.len();
    }
    let data = value.get("data").unwrap_or(value);
    if data.get("error").is_some() {
        return 0;
    }
    if data_is_device_block(data) {
        return 1;
    }
    if let Some(obj) = data.as_object() {
        if !obj.is_empty() {
            return obj.len();
        }
    }
    0
}

fn data_is_device_block(v: &Value) -> bool {
    fn has_keys(v: &Value, keys: &[&str]) -> bool {
        match v {
            Value::Object(m) => {
                if keys.iter().all(|k| m.contains_key(*k)) {
                    return true;
                }
                m.values().any(|c| has_keys(c, keys))
            }
            Value::Array(a) => a.iter().any(|c| has_keys(c, keys)),
            _ => false,
        }
    }
    has_keys(v, &["OSVersion", "SerialNumber"])
        || has_keys(v, &["OSVersion", "UniqueDeviceID"])
        || has_keys(v, &["OSVersion", "BuildVersion"])
}

/// Run sysdiagnose parsers with bounded concurrency (default 2 threads) to limit peak RAM.
pub fn run_sysdiagnose_parsers_with_progress(
    archive: Arc<SysdiagnoseArchive>,
    parsers: Vec<(ParserType, Box<dyn SysdiagnoseParser + Send + Sync>)>,
    on_progress: Option<SysdiagnoseProgressFn>,
) -> Vec<(
    ParserType,
    Result<Value, Box<dyn std::error::Error + Send + Sync>>,
    Duration,
)> {
    let total = parsers.len();
    let completed = Arc::new(Mutex::new(Vec::<ParserRunSummary>::new()));
    let active = Arc::new(Mutex::new(Vec::<String>::new()));

    let threads = std::env::var("MOBIPWN_SYSDIAGNOSE_PARSER_THREADS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2usize)
        .clamp(1, 8);

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .expect("sysdiagnose parser thread pool");

    pool.install(|| {
        parsers
            .into_par_iter()
            .map(|(parser_type, parser)| {
                let arch = Arc::clone(&archive);
                let name = parser_type.as_str().to_string();

                if let Some(cb) = &on_progress {
                    let mut running = active.lock().expect("parser active lock");
                    running.push(name.clone());
                    let done = completed.lock().expect("parser progress lock").len();
                    let detail = format!(
                        "Running sysdiagnose parsers ({threads} threads)… {done}/{total} done · active: {}",
                        format_active_list(&running)
                    );
                    emit_parser_progress(
                        cb,
                        &completed.lock().expect("parser progress lock"),
                        &running,
                        total,
                        &detail,
                    );
                }

                let start = std::time::Instant::now();
                let result = parser.parse(arch.as_ref());
                let duration = start.elapsed();
                let output_events = result.as_ref().map(estimate_parser_output).unwrap_or(0);
                let (ok, error) = match &result {
                    Ok(_) => (true, None),
                    Err(e) => (false, Some(e.to_string())),
                };

                if let Some(cb) = &on_progress {
                    let mut running = active.lock().expect("parser active lock");
                    running.retain(|n| n != &name);
                    let mut runs = completed.lock().expect("parser progress lock");
                    runs.push(ParserRunSummary {
                        name: name.clone(),
                        slug: name.clone(),
                        ok,
                        duration_ms: duration.as_secs_f64() * 1000.0,
                        timeline_events: output_events,
                        error,
                    });
                    let done = runs.len();
                    let detail = if running.is_empty() {
                        format!(
                            "Finished {name} ({output_events} records, {:.0} ms) · {done}/{total} done",
                            duration.as_secs_f64() * 1000.0
                        )
                    } else {
                        format!(
                            "Finished {name} ({output_events} records) · {done}/{total} done · active: {}",
                            format_active_list(&running)
                        )
                    };
                    emit_parser_progress(cb, &runs, &running, total, &detail);
                }

                (parser_type, result, duration)
            })
            .collect()
    })
}

fn format_active_list(active: &[String]) -> String {
    const MAX_SHOW: usize = 4;
    if active.len() <= MAX_SHOW {
        return active.join(", ");
    }
    format!(
        "{}, … (+{} more)",
        active[..MAX_SHOW].join(", "),
        active.len() - MAX_SHOW
    )
}

pub fn count_parser_events_from_jsonl(jsonl: &str) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for line in jsonl.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let slug = v
            .get("sysdiagnose_parser")
            .or_else(|| v.get("parser"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        *counts.entry(slug.to_string()).or_default() += 1;
    }
    counts
}

pub fn build_sysdiagnose_report(
    path: &Path,
    file_bytes: usize,
    results: &[(
        ParserType,
        Result<Value, Box<dyn std::error::Error + Send + Sync>>,
        Duration,
    )],
    jsonl: &str,
    mudm_events: usize,
) -> SysdiagnoseParseReport {
    let per_parser_events = count_parser_events_from_jsonl(jsonl);
    let network_iocs_events = per_parser_events
        .get("network_iocs")
        .copied()
        .unwrap_or(0);
    let timeline_events = jsonl
        .lines()
        .filter(|l| !l.trim().is_empty())
        .count();

    let mut parser_runs: Vec<ParserRunSummary> = results
        .iter()
        .map(|(pt, res, dur)| {
            let name = pt.as_str().to_string();
            let (ok, error) = match res {
                Ok(_) => (true, None),
                Err(e) => (false, Some(e.to_string())),
            };
            let indexed = per_parser_events.get(&name).copied().unwrap_or(0);
            let parsed = res.as_ref().map(estimate_parser_output).unwrap_or(0);
            ParserRunSummary {
                name: name.clone(),
                slug: name.clone(),
                ok,
                duration_ms: dur.as_secs_f64() * 1000.0,
                timeline_events: indexed.max(parsed),
                error,
            }
        })
        .collect();

    if network_iocs_events > 0 && !parser_runs.iter().any(|p| p.name == "network_iocs") {
        parser_runs.push(ParserRunSummary {
            name: "network_iocs".into(),
            slug: "network_iocs".into(),
            ok: true,
            duration_ms: 0.0,
            timeline_events: network_iocs_events,
            error: None,
        });
    }

    parser_runs.sort_by(|a, b| b.timeline_events.cmp(&a.timeline_events));

    SysdiagnoseParseReport {
        input_display: path.display().to_string(),
        file_bytes,
        parsers_scheduled: results.len(),
        timeline_events,
        mudm_events,
        parser_runs,
        network_iocs_events,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn estimate_jsonl_events() {
        let v = json!({
            "format": "jsonl",
            "events": [{ "message": "a" }, { "message": "b" }]
        });
        assert_eq!(estimate_parser_output(&v), 2);
    }

    #[test]
    fn estimate_files_map() {
        let v = json!({ "files": { "a": {}, "b": {} } });
        assert_eq!(estimate_parser_output(&v), 2);
    }
}
