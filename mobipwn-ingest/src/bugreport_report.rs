use mobipwn_core::store::{IngestJobProgress, IngestParserProgress};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::Path;

/// Per-parser outcome from `bugreport-extractor-library::run_parsers_concurrently`.
#[derive(Debug, Clone)]
pub struct ParserRunSummary {
    pub name: String,
    pub slug: String,
    pub ok: bool,
    pub duration_ms: f64,
    pub timeline_events: usize,
    pub error: Option<String>,
}

/// Summary of a bugreport parse before / after MUDM normalization.
#[derive(Debug, Clone)]
pub struct BugreportParseReport {
    pub input_display: String,
    pub from_zip: bool,
    pub file_bytes: usize,
    pub parsers_scheduled: usize,
    pub timeline_events: usize,
    pub skipped_epoch_timeline_events: usize,
    pub mudm_events: usize,
    pub parser_runs: Vec<ParserRunSummary>,
    pub magpie_process_events: usize,
    pub magpie_file_events: usize,
}

impl BugreportParseReport {
    pub fn parsers_ok(&self) -> usize {
        self.parser_runs.iter().filter(|p| p.ok).count()
    }

    pub fn parsers_failed(&self) -> usize {
        self.parser_runs.iter().filter(|p| !p.ok).count()
    }

    pub fn ingest_progress(&self) -> IngestJobProgress {
        IngestJobProgress {
            parsers: self
                .parser_runs
                .iter()
                .map(|p| IngestParserProgress {
                    name: p.name.clone(),
                    ok: p.ok,
                    events: p.timeline_events,
                    duration_ms: p.duration_ms,
                    error: p.error.clone(),
                    status: None,
                })
                .collect(),
            timeline_events: Some(self.timeline_events),
            mudm_events: Some(self.mudm_events),
            parsers_total: None,
            parsers_completed: None,
            parsers_active: None,
            batch: None,
            batches: None,
            rows_inserted: None,
            logarchive: None,
            options: None,
        }
    }

    pub fn magpie_events(&self) -> usize {
        self.magpie_process_events + self.magpie_file_events
    }

    pub fn log_tracing(&self) {
        tracing::info!(
            file = %self.input_display,
            from_zip = self.from_zip,
            mb = %(self.file_bytes as f64 / 1_048_576.0),
            parsers = self.parsers_scheduled,
            ok = self.parsers_ok(),
            failed = self.parsers_failed(),
            timeline = self.timeline_events,
            skipped_epoch = self.skipped_epoch_timeline_events,
            mudm = self.mudm_events,
            magpie_process = self.magpie_process_events,
            magpie_files = self.magpie_file_events,
            "bugreport parse complete"
        );
        for p in &self.parser_runs {
            if p.ok {
                tracing::info!(
                    parser = %p.name,
                    ms = %p.duration_ms,
                    events = p.timeline_events,
                    "bugreport parser"
                );
            } else {
                tracing::warn!(
                    parser = %p.name,
                    ms = %p.duration_ms,
                    error = p.error.as_deref().unwrap_or("unknown"),
                    "bugreport parser failed"
                );
            }
        }
    }

    pub fn print_stdout(&self) {
        let mut out = String::new();
        let _ = writeln!(
            out,
            "\n=== Bugreport parsers (bugreport-extractor-library) ==="
        );
        let zip_note = if self.from_zip {
            "extracted from ZIP"
        } else {
            "plain text"
        };
        let _ = writeln!(
            out,
            "File: {} ({:.2} MB, {zip_note})",
            self.input_display,
            self.file_bytes as f64 / 1_048_576.0
        );
        let _ = writeln!(
            out,
            "Scheduled: {} parsers | {} ok | {} failed",
            self.parsers_scheduled,
            self.parsers_ok(),
            self.parsers_failed()
        );
        let _ = writeln!(
            out,
            "{:<18} {:^8} {:>10} {:>10}",
            "Parser", "Status", "Time (ms)", "Events"
        );
        let _ = writeln!(out, "{}", "-".repeat(52));

        let mut runs = self.parser_runs.clone();
        runs.sort_by(|a, b| b.timeline_events.cmp(&a.timeline_events));

        for p in &runs {
            let status = if p.ok {
                if p.timeline_events > 0 {
                    "ok"
                } else {
                    "empty"
                }
            } else {
                "FAIL"
            };
            let _ = writeln!(
                out,
                "{:<18} {:^8} {:>10.1} {:>10}",
                p.name, status, p.duration_ms, p.timeline_events
            );
            if let Some(err) = &p.error {
                let err_line = err.lines().next().unwrap_or(err.as_str());
                let _ = writeln!(out, "  └─ {err_line}");
            }
        }

        let _ = writeln!(
            out,
            "\nTimeline rows: {} ({} skipped as epoch garbage)",
            self.timeline_events, self.skipped_epoch_timeline_events
        );
        let _ = writeln!(out, "MUDM events: {} (normalized for ClickHouse)", self.mudm_events);
        if self.magpie_events() > 0 {
            let _ = writeln!(
                out,
                "Rusty Magpie: {} process + {} file snapshot events",
                self.magpie_process_events, self.magpie_file_events
            );
        }
        println!("{out}");
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn build_parser_report(
    path: &Path,
    from_zip: bool,
    file_bytes: usize,
    parser_names: &[String],
    results: &[(bugreport_extractor_library::parsers::ParserType, Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>>, std::time::Duration)],
    export: &bugreport_extractor_library::timeline::TimelineExport,
    mudm_events: usize,
) -> BugreportParseReport {
    let mut per_parser_events: HashMap<String, usize> = HashMap::new();
    for ev in &export.events {
        if let Some(slug) = ev
            .get("bugreport_parser")
            .and_then(|v| v.as_str())
        {
            *per_parser_events.entry(slug.to_string()).or_default() += 1;
        }
    }

    let mut parser_runs: Vec<ParserRunSummary> = results
        .iter()
        .map(|(pt, res, dur)| {
            let name = format!("{pt:?}");
            let slug = name.to_lowercase();
            let (ok, error) = match res {
                Ok(_) => (true, None),
                Err(e) => (false, Some(e.to_string())),
            };
            ParserRunSummary {
                timeline_events: *per_parser_events.get(&slug).unwrap_or(&0),
                name,
                slug,
                ok,
                duration_ms: dur.as_secs_f64() * 1000.0,
                error,
            }
        })
        .collect();

    // Parsers that were scheduled but missing from results (shouldn't happen)
    for name in parser_names {
        if !parser_runs.iter().any(|p| p.name == *name) {
            parser_runs.push(ParserRunSummary {
                name: name.clone(),
                slug: name.to_lowercase(),
                ok: false,
                duration_ms: 0.0,
                timeline_events: 0,
                error: Some("not executed".into()),
            });
        }
    }

    BugreportParseReport {
        input_display: path.display().to_string(),
        from_zip,
        file_bytes,
        parsers_scheduled: parser_names.len(),
        timeline_events: export.count,
        skipped_epoch_timeline_events: export.skipped_epoch_timeline_events,
        mudm_events,
        parser_runs,
        magpie_process_events: 0,
        magpie_file_events: 0,
    }
}
