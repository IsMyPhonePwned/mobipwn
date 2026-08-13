#[cfg(not(target_arch = "wasm32"))]
use mobipwn_core::mudm::TimelinePlatform;
#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

#[cfg(not(target_arch = "wasm32"))]
use crate::bugreport_report::{build_parser_report, BugreportParseReport};
#[cfg(not(target_arch = "wasm32"))]
use mobipwn_core::store::IngestJobProgress;
#[cfg(not(target_arch = "wasm32"))]
use crate::sysdiagnose_report::{
    build_sysdiagnose_report, run_sysdiagnose_parsers_with_progress, SysdiagnoseParseReport,
    SysdiagnoseProgressFn,
};
#[cfg(not(target_arch = "wasm32"))]
use crate::sysdiagnose_flatten::flatten_parse_results_to_jsonl;
#[cfg(not(target_arch = "wasm32"))]
use crate::timeline::ingest_jsonl;
#[cfg(not(target_arch = "wasm32"))]
use mobipwn_core::mudm::MudmEvent;

#[cfg(not(target_arch = "wasm32"))]
fn box_err(e: Box<dyn std::error::Error + Send + Sync>) -> anyhow::Error {
    anyhow::anyhow!("{e}")
}

/// Parse bugreport and return MUDM events plus per-parser stats.
#[cfg(not(target_arch = "wasm32"))]
pub fn parse_android_bugreport(
    path: &Path,
    source_label: &str,
) -> anyhow::Result<(Vec<MudmEvent>, BugreportParseReport)> {
    use bugreport_extractor_library::file_loader::load_bugreport_file;
    use bugreport_extractor_library::timeline::export_timeline;
    use bugreport_extractor_library::{enrich_parser_results, run_parsers_concurrently};

    let (content, from_zip) = match load_bugreport_file(path) {
        Ok(loaded) => loaded,
        Err(load_err) => {
            // AndroidQF acquisitions may lack dumpstate.txt but still have sfslog.*.gz.
            if let Ok(Some(sfs)) =
                bugreport_extractor_library::file_loader::load_samsung_sfs_from_path(path)
            {
                let results = vec![(
                    bugreport_extractor_library::parsers::ParserType::SamsungSfsLogs,
                    Ok(sfs),
                    std::time::Duration::ZERO,
                )];
                let export = export_timeline(&results);
                let events = ingest_jsonl(
                    &export.jsonl,
                    TimelinePlatform::AndroidBugreport,
                    source_label,
                );
                let report = build_parser_report(
                    path,
                    true,
                    0,
                    &["SamsungSfsLogs".to_string()],
                    &results,
                    &export,
                    events.len(),
                );
                return Ok((events, report));
            }
            return parse_magpie_only_archive(path, source_label).map_err(|magpie_err| {
                if magpie_err.to_string().contains("no Rusty Magpie") {
                    box_err(load_err)
                } else {
                    magpie_err
                }
            });
        }
    };
    let file_bytes = content.len();
    let parsers = build_bugreport_parsers()?;
    let parser_names: Vec<String> = parsers
        .iter()
        .map(|(pt, _)| format!("{pt:?}"))
        .collect();
    let mut results = run_parsers_concurrently(content, parsers);
    if let Ok(Some(sfs)) =
        bugreport_extractor_library::file_loader::load_samsung_sfs_from_path(path)
    {
        if let Some((_, slot, _)) = results.iter_mut().find(|(pt, _, _)| {
            *pt == bugreport_extractor_library::parsers::ParserType::SamsungSfsLogs
        }) {
            *slot = Ok(sfs);
        } else {
            results.push((
                bugreport_extractor_library::parsers::ParserType::SamsungSfsLogs,
                Ok(sfs),
                std::time::Duration::ZERO,
            ));
        }
    }
    enrich_parser_results(&mut results);
    let export = export_timeline(&results);
    let events = ingest_jsonl(
        &export.jsonl,
        TimelinePlatform::AndroidBugreport,
        source_label,
    );
    let mut report = build_parser_report(
        path,
        from_zip,
        file_bytes,
        &parser_names,
        &results,
        &export,
        events.len(),
    );

    let mut all_events = events;
    merge_magpie_into_report(path, source_label, &mut report, &mut all_events);

    Ok((all_events, report))
}

#[cfg(not(target_arch = "wasm32"))]
fn parse_magpie_only_archive(
    path: &Path,
    source_label: &str,
) -> anyhow::Result<(Vec<MudmEvent>, BugreportParseReport)> {
    let Some(bundle) = crate::magpie::read_magpie_bundle(path)? else {
        anyhow::bail!("no Rusty Magpie collector artifacts in archive");
    };
    let (events, summary) = crate::magpie::magpie_to_events(&bundle, source_label);
    if events.is_empty() {
        anyhow::bail!("Rusty Magpie archive contained no ingestible events");
    }
    tracing::info!(
        source = %source_label,
        process = summary.process_events,
        files = summary.file_events,
        "ingested Rusty Magpie-only collector archive"
    );
    let file_bytes = std::fs::metadata(path).map(|m| m.len() as usize).unwrap_or(0);
    let mudm_events = events.len();
    Ok((
        events,
        BugreportParseReport {
            input_display: path.display().to_string(),
            from_zip: true,
            file_bytes,
            parsers_scheduled: 0,
            timeline_events: 0,
            skipped_epoch_timeline_events: 0,
            mudm_events,
            parser_runs: Vec::new(),
            magpie_process_events: summary.process_events,
            magpie_file_events: summary.file_events,
        },
    ))
}

#[cfg(not(target_arch = "wasm32"))]
fn merge_magpie_into_report(
    path: &Path,
    source_label: &str,
    report: &mut BugreportParseReport,
    all_events: &mut Vec<MudmEvent>,
) {
    match crate::magpie::ingest_magpie_from_archive(path, source_label) {
        Ok((magpie_events, summary)) if !magpie_events.is_empty() => {
            tracing::info!(
                source = %source_label,
                process = summary.process_events,
                files = summary.file_events,
                "ingested Rusty Magpie collector artifacts"
            );
            report.magpie_process_events = summary.process_events;
            report.magpie_file_events = summary.file_events;
            all_events.extend(magpie_events);
            report.mudm_events = all_events.len();
        }
        Ok(_) => {}
        Err(e) => {
            tracing::warn!(source = %source_label, error = %e, "Rusty Magpie ingest skipped");
        }
    }
}

/// Run bugreport-extractor-library parsers and ingest timeline JSONL.
#[cfg(not(target_arch = "wasm32"))]
pub fn ingest_android_bugreport(path: &Path, source_label: &str) -> anyhow::Result<Vec<MudmEvent>> {
    parse_android_bugreport(path, source_label).map(|(events, _)| events)
}

#[cfg(not(target_arch = "wasm32"))]
fn build_bugreport_parsers(
) -> anyhow::Result<
    Vec<(
        bugreport_extractor_library::parsers::ParserType,
        Box<dyn bugreport_extractor_library::parsers::Parser + Send + Sync>,
    )>,
> {
    use bugreport_extractor_library::parsers::ParserType;
    use bugreport_extractor_library::parsers::{
        AccountParser, AdbParser, AuthenticationParser, BatteryParser, BluetoothParser, CrashParser,
        DevicePolicyParser, HeaderParser, LogcatParser, MemoryParser, NetworkParser,
        PackageParser, PowerParser, PrivacyParser, ProcessParser, SamsungSfsLogsParser,
        UsbParser, VpnParser,
    };
    Ok(vec![
        (
            ParserType::Header,
            Box::new(HeaderParser::new().map_err(box_err)?),
        ),
        (
            ParserType::Memory,
            Box::new(MemoryParser::new().map_err(box_err)?),
        ),
        (
            ParserType::Battery,
            Box::new(BatteryParser::new().map_err(box_err)?),
        ),
        (
            ParserType::Package,
            Box::new(PackageParser::new().map_err(box_err)?),
        ),
        (
            ParserType::Process,
            Box::new(ProcessParser::new().map_err(box_err)?),
        ),
        (
            ParserType::Power,
            Box::new(PowerParser::new().map_err(box_err)?),
        ),
        (
            ParserType::Usb,
            Box::new(UsbParser::new().map_err(box_err)?),
        ),
        // Tombstones, ANR files/traces, native backtrace frames → timeline `parser="Crash"`.
        (
            ParserType::Crash,
            Box::new(CrashParser::new().map_err(box_err)?),
        ),
        (
            ParserType::Network,
            Box::new(NetworkParser::new().map_err(box_err)?),
        ),
        (
            ParserType::Bluetooth,
            Box::new(BluetoothParser::new().map_err(box_err)?),
        ),
        (
            ParserType::DevicePolicy,
            Box::new(DevicePolicyParser::new().map_err(box_err)?),
        ),
        (ParserType::Adb, Box::new(AdbParser::new().map_err(box_err)?)),
        (
            ParserType::Authentication,
            Box::new(AuthenticationParser::new().map_err(box_err)?),
        ),
        (
            ParserType::Account,
            Box::new(AccountParser::new().map_err(box_err)?),
        ),
        (ParserType::Vpn, Box::new(VpnParser::new().map_err(box_err)?)),
        (
            ParserType::Privacy,
            Box::new(PrivacyParser::new().map_err(box_err)?),
        ),
        (
            ParserType::Logcat,
            Box::new(LogcatParser::new().map_err(box_err)?),
        ),
        (
            ParserType::SamsungSfsLogs,
            Box::new(SamsungSfsLogsParser::new().map_err(box_err)?),
        ),
    ])
}

/// Parse sysdiagnose and return MUDM events plus per-parser stats.
#[cfg(not(target_arch = "wasm32"))]
pub fn parse_ios_sysdiagnose(
    archive: &Path,
    source_label: &str,
    on_progress: Option<SysdiagnoseProgressFn>,
    parse_options: sysdiagnose_extractor_library::ParseOptions,
    archive_options: sysdiagnose_extractor_library::ArchiveOptions,
) -> anyhow::Result<(Vec<MudmEvent>, SysdiagnoseParseReport)> {
    use std::sync::Arc;
    use strum::IntoEnumIterator;
    use sysdiagnose_extractor_library::{
        parser_for_with_options, ParserType, SysdiagnoseArchive,
    };

    let parse_options = parse_options;

    let file_bytes = std::fs::metadata(archive).map(|m| m.len() as usize).unwrap_or(0);

    if let Some(cb) = &on_progress {
        cb(
            "opening",
            "Opening sysdiagnose archive…",
            Some(IngestJobProgress {
                parsers_total: Some(ParserType::iter().count()),
                ..Default::default()
            }),
        );
    }

    let mut arch = Arc::new(SysdiagnoseArchive::open_path_with_options(
        archive,
        archive_options,
    )?);
    let parsers: Vec<_> = ParserType::iter()
        .filter(|t| *t != ParserType::apollo_all)
        .map(|t| (t, parser_for_with_options(t, parse_options.clone())))
        .collect();
    let parser_total = parsers.len();

    if let Some(cb) = &on_progress {
        cb(
            "parsing",
            &format!("Running {parser_total} sysdiagnose parsers (bounded concurrency)…"),
            Some(IngestJobProgress {
                parsers_total: Some(parser_total),
                parsers_completed: Some(0),
                ..Default::default()
            }),
        );
    }

    let mut results = run_sysdiagnose_parsers_with_progress(
        Arc::clone(&arch),
        parsers,
        on_progress.clone(),
    );

    crate::ios_logarchive_decode::augment_logarchive_parser_output(
        arch.as_ref(),
        &mut results,
        parse_options.logarchive_decode_max_lines,
        on_progress.as_ref(),
    );

    // Drop logarchive bytes from RAM now that decode finished (temp dir already held them).
    if let Some(arch_mut) = Arc::get_mut(&mut arch) {
        let purged = arch_mut.purge_prefix("system_logs.logarchive/");
        if purged > 0 {
            tracing::info!(purged, "Purged logarchive members from in-memory archive");
        }
    }

    if let Some(cb) = &on_progress {
        cb(
            "parsing",
            "Flattening parser output and scanning network IOCs…",
            None,
        );
    }

    let capture_dt = crate::sysdiagnose_flatten::capture_datetime_from_sysdiagnose_path(archive);
    let jsonl = flatten_parse_results_to_jsonl(&mut results, capture_dt.as_deref(), Some(arch.as_ref()));
    // Drop remaining large parser JSON trees before building MUDM events (report still needs ok/err/timing).
    for (_, result, _) in results.iter_mut() {
        if let Ok(v) = result {
            if let Some(obj) = v.as_object_mut() {
                for key in ["events", "data", "rows", "records"] {
                    if obj.contains_key(key) {
                        obj.insert(key.into(), serde_json::Value::Null);
                    }
                }
            }
        }
    }

    if let Some(cb) = &on_progress {
        let timeline_lines = jsonl.lines().filter(|l| !l.trim().is_empty()).count();
        cb(
            "parsing",
            &format!("Normalizing {timeline_lines} timeline rows into MUDM events…"),
            None,
        );
    }

    let events = ingest_jsonl(
        &jsonl,
        TimelinePlatform::IosSysdiagnose,
        source_label,
    );
    let report = build_sysdiagnose_report(archive, file_bytes, &results, &jsonl, events.len());

    if let Some(cb) = &on_progress {
        cb(
            "parsed",
            &format!(
                "Indexed {} timeline rows · {} MUDM events",
                report.timeline_events, report.mudm_events
            ),
            Some(report.ingest_progress()),
        );
    }

    Ok((events, report))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn sysdiagnose_parse_options_from_config(
    cfg: &mobipwn_core::SysdiagnoseIngestConfig,
) -> sysdiagnose_extractor_library::ParseOptions {
    sysdiagnose_extractor_library::ParseOptions {
        ioservice_full_tree: cfg.ioservice_full_tree,
        logarchive_decode_max_lines: cfg.effective_logarchive_decode_max_lines(),
        // Decode once in augment_logarchive_parser_output (avoids double materialize/decode).
        logarchive_inventory_only: true,
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn sysdiagnose_archive_options_from_config(
    cfg: &mobipwn_core::SysdiagnoseIngestConfig,
) -> sysdiagnose_extractor_library::ArchiveOptions {
    sysdiagnose_extractor_library::ArchiveOptions {
        max_entry_bytes: cfg.archive_max_entry_bytes(),
        ..sysdiagnose_extractor_library::ArchiveOptions::default()
    }
}

/// Run sysdiagnose-extractor-library parsers and ingest SAF-style events as timeline rows.
#[cfg(not(target_arch = "wasm32"))]
pub fn ingest_ios_sysdiagnose(
    archive: &Path,
    source_label: &str,
    parse_options: sysdiagnose_extractor_library::ParseOptions,
    archive_options: sysdiagnose_extractor_library::ArchiveOptions,
) -> anyhow::Result<Vec<MudmEvent>> {
    parse_ios_sysdiagnose(archive, source_label, None, parse_options, archive_options)
        .map(|(events, _)| events)
}
