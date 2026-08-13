//! Optional unified-log decode for iOS sysdiagnose (feature `logarchive-decode`).

use std::time::Duration;

use serde_json::Value;
use sysdiagnose_extractor_library::{ParserType, SysdiagnoseArchive};

use crate::sysdiagnose_report::SysdiagnoseProgressFn;

/// After the stock `logarchive` parser runs, decode unified logs when the feature is enabled.
pub fn augment_logarchive_parser_output(
    archive: &SysdiagnoseArchive,
    results: &mut [(
        ParserType,
        Result<Value, Box<dyn std::error::Error + Send + Sync>>,
        Duration,
    )],
    max_lines: usize,
    on_progress: Option<&SysdiagnoseProgressFn>,
) {
    #[cfg(not(feature = "logarchive-decode"))]
    {
        let _ = (archive, results, max_lines, on_progress);
        return;
    }

    #[cfg(feature = "logarchive-decode")]
    augment_logarchive_parser_output_impl(archive, results, max_lines, on_progress);
}

#[cfg(feature = "logarchive-decode")]
fn augment_logarchive_parser_output_impl(
    archive: &SysdiagnoseArchive,
    results: &mut [(
        ParserType,
        Result<Value, Box<dyn std::error::Error + Send + Sync>>,
        Duration,
    )],
    max_lines: usize,
    on_progress: Option<&SysdiagnoseProgressFn>,
) {
    use std::time::Instant;

    use mobipwn_core::store::{IngestJobProgress, IngestParserProgress, LogarchiveDecodeProgress};
    use serde_json::json;
    use sysdiagnose_extractor_library::parsers::logarchive_decode::decode_logarchive_events_with_limit_and_progress;

    let parsers_snapshot: Vec<IngestParserProgress> = results
        .iter()
        .map(|(pt, res, dur)| {
            let name = pt.as_str().to_string();
            let (ok, error) = match res {
                Ok(_) => (true, None),
                Err(e) => (false, Some(e.to_string())),
            };
            IngestParserProgress {
                name,
                ok,
                events: 0,
                duration_ms: dur.as_secs_f64() * 1000.0,
                error,
                status: Some(if ok { "done".into() } else { "failed".into() }),
            }
        })
        .collect();
    let parsers_total = parsers_snapshot.len();

    let inventory = results
        .iter()
        .find(|(pt, _, _)| *pt == ParserType::logarchive)
        .and_then(|(_, result, _)| result.as_ref().ok())
        .and_then(|v| v.get("inventory").cloned())
        .unwrap_or_else(|| json!({ "file_count": 0 }));

    let file_count = inventory
        .get("file_count")
        .and_then(|n| n.as_u64())
        .unwrap_or(0) as usize;

    let logarchive_idx = results
        .iter()
        .position(|(pt, _, _)| *pt == ParserType::logarchive);
    let Some(idx) = logarchive_idx else {
        return;
    };
    if results[idx].1.is_err() {
        return;
    }

    let uncapped = max_lines >= mobipwn_core::LOGARCHIVE_FORENSIC_MAX_LINES as usize;
    let started = Instant::now();

    let emit = |la: LogarchiveDecodeProgress| {
        let Some(cb) = on_progress else {
            return;
        };
        let detail = la
            .detail
            .clone()
            .unwrap_or_else(|| format!("Logarchive decode · {}", la.phase));
        cb(
            "logarchive",
            &detail,
            Some(IngestJobProgress {
                parsers: parsers_snapshot.clone(),
                parsers_total: Some(parsers_total),
                parsers_completed: Some(parsers_total),
                logarchive: Some(LogarchiveDecodeProgress {
                    elapsed_ms: Some(started.elapsed().as_millis() as u64),
                    uncapped: Some(uncapped),
                    ..la
                }),
                ..Default::default()
            }),
        );
    };

    emit(LogarchiveDecodeProgress {
        phase: "starting".into(),
        detail: Some(if uncapped {
            format!(
                "Starting unified-log decode (uncapped) · inventory {file_count} files — this can take several minutes…"
            )
        } else {
            format!(
                "Starting unified-log decode (cap {max_lines} lines) · inventory {file_count} files…"
            )
        }),
        max_lines: Some(max_lines),
        events_decoded: Some(0),
        uncapped: Some(uncapped),
        ..Default::default()
    });

    let (decode_meta, events) = {
        let mut last_emit = Instant::now();
        let mut progress_cb = |p: sysdiagnose_extractor_library::parsers::logarchive_decode::LogarchiveDecodeProgress| {
            if p.phase == "decoding" && last_emit.elapsed() < Duration::from_millis(350) {
                return;
            }
            last_emit = Instant::now();
            emit(LogarchiveDecodeProgress {
                phase: p.phase.to_string(),
                detail: p.detail,
            max_lines: p.max_lines,
            events_decoded: p.events_decoded,
                files_materialized: p.files_materialized,
                tracev3_files: p.tracev3_files,
                current_file: p.current_file,
                elapsed_ms: Some(started.elapsed().as_millis() as u64),
                uncapped: Some(uncapped),
            });
        };
        decode_logarchive_events_with_limit_and_progress(archive, max_lines, Some(&mut progress_cb))
    };
    let status = decode_meta
        .get("status")
        .and_then(|s| s.as_str())
        .unwrap_or("unknown");
    let event_count = events.len();

    let mut out = json!({
        "parser": "logarchive",
        "inventory": inventory,
        "decode": status,
        "decode_meta": decode_meta,
        "note": "Unified log decode via mobipwn-ingest logarchive-decode (macos-unifiedlogs).",
    });
    if status == "success" {
        out["format"] = json!("jsonl");
        out["events"] = json!(events);
    }
    results[idx].1 = Ok(out);

    emit(LogarchiveDecodeProgress {
        phase: status.to_string(),
        detail: Some(format!(
            "Logarchive decode {status} · {event_count} events · {:.1}s",
            started.elapsed().as_secs_f64()
        )),
        max_lines: Some(max_lines),
        events_decoded: Some(event_count),
        elapsed_ms: Some(started.elapsed().as_millis() as u64),
        uncapped: Some(uncapped),
        ..Default::default()
    });
}
