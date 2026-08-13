//! Ingest Rusty Magpie (`mobipwn-collector/*`) JSON bundled with Android bugreport uploads.

use chrono::{DateTime, Utc};
use mobipwn_core::mudm::MudmEvent;
use serde_json::Value;
use std::io::{Cursor, Read};
use std::path::Path;
use zip::ZipArchive;

const MANIFEST_PATH: &str = "mobipwn-collector/manifest.json";
const PS_PATH: &str = "mobipwn-collector/ps.json";
const FIND_PATH: &str = "mobipwn-collector/find.json";
const YARA_PATH: &str = "mobipwn-collector/yara.json";

#[derive(Debug, Clone)]
pub struct MagpieBundle {
    pub manifest: Option<Value>,
    pub processes: Vec<Value>,
    pub files: Vec<Value>,
    pub yara_matches: Vec<Value>,
}

#[derive(Debug, Clone, Default)]
pub struct MagpieIngestSummary {
    pub process_events: usize,
    pub file_events: usize,
    pub yara_events: usize,
}

pub fn read_magpie_bundle(path: &Path) -> anyhow::Result<Option<MagpieBundle>> {
    let bytes = std::fs::read(path)?;
    read_magpie_bundle_from_bytes(&bytes)
}

pub fn read_magpie_bundle_from_bytes(bytes: &[u8]) -> anyhow::Result<Option<MagpieBundle>> {
    if bytes.len() < 4 || bytes[0] != 0x50 || bytes[1] != 0x4b {
        return Ok(None);
    }

    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| anyhow::anyhow!("invalid zip: {e}"))?;

    let mut manifest = None;
    let mut processes_raw = None;
    let mut files_raw = None;
    let mut yara_raw = None;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| anyhow::anyhow!("zip entry: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = normalize_zip_name(entry.name());
        match name.as_str() {
            MANIFEST_PATH => {
                manifest = Some(read_json_entry(&mut entry, &name)?);
            }
            PS_PATH => {
                processes_raw = Some(read_string_entry(&mut entry, &name)?);
            }
            FIND_PATH => {
                files_raw = Some(read_string_entry(&mut entry, &name)?);
            }
            YARA_PATH => {
                yara_raw = Some(read_string_entry(&mut entry, &name)?);
            }
            _ => {}
        }
    }

    if processes_raw.is_none() && files_raw.is_none() && yara_raw.is_none() {
        return Ok(None);
    }

    let processes = parse_json_array(processes_raw.as_deref(), "ps.json")?;
    let files = parse_json_array(files_raw.as_deref(), "find.json")?;
    let yara_matches = parse_json_array(yara_raw.as_deref(), "yara.json")?;

    Ok(Some(MagpieBundle {
        manifest,
        processes,
        files,
        yara_matches,
    }))
}

pub fn magpie_to_events(
    bundle: &MagpieBundle,
    source_label: &str,
) -> (Vec<MudmEvent>, MagpieIngestSummary) {
    let ts = collection_timestamp(bundle.manifest.as_ref());
    let mut events = Vec::with_capacity(
        bundle.processes.len() + bundle.files.len() + bundle.yara_matches.len(),
    );
    let mut summary = MagpieIngestSummary::default();

    for proc in &bundle.processes {
        if let Some(ev) = process_to_event(proc, ts, source_label) {
            events.push(ev);
            summary.process_events += 1;
        }
    }

    for file in &bundle.files {
        if let Some(ev) = file_to_event(file, ts, source_label) {
            events.push(ev);
            summary.file_events += 1;
        }
    }

    for hit in &bundle.yara_matches {
        if let Some(ev) = yara_to_event(hit, ts, source_label) {
            events.push(ev);
            summary.yara_events += 1;
        }
    }

    (events, summary)
}

pub fn ingest_magpie_from_archive(
    path: &Path,
    source_label: &str,
) -> anyhow::Result<(Vec<MudmEvent>, MagpieIngestSummary)> {
    let Some(bundle) = read_magpie_bundle(path)? else {
        return Ok((Vec::new(), MagpieIngestSummary::default()));
    };
    Ok(magpie_to_events(&bundle, source_label))
}

fn normalize_zip_name(name: &str) -> String {
    name.replace('\\', "/").trim_start_matches('/').to_string()
}

fn read_string_entry(entry: &mut zip::read::ZipFile<'_>, name: &str) -> anyhow::Result<String> {
    let mut body = String::new();
    entry
        .read_to_string(&mut body)
        .map_err(|e| anyhow::anyhow!("read {name}: {e}"))?;
    Ok(body)
}

fn read_json_entry(entry: &mut zip::read::ZipFile<'_>, name: &str) -> anyhow::Result<Value> {
    let body = read_string_entry(entry, name)?;
    serde_json::from_str(&body).map_err(|e| anyhow::anyhow!("parse {name}: {e}"))
}

fn parse_json_array(raw: Option<&str>, label: &str) -> anyhow::Result<Vec<Value>> {
    let Some(body) = raw else {
        return Ok(Vec::new());
    };
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let value: Value = serde_json::from_str(trimmed)
        .map_err(|e| anyhow::anyhow!("parse mobipwn-collector/{label}: {e}"))?;
    match value {
        Value::Array(items) => Ok(items),
        other => anyhow::bail!("mobipwn-collector/{label} must be a JSON array, got {other}"),
    }
}

fn collection_timestamp(manifest: Option<&Value>) -> DateTime<Utc> {
    manifest
        .and_then(|m| m.get("collected_at"))
        .and_then(|v| v.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

fn process_to_event(proc: &Value, ts: DateTime<Utc>, source_label: &str) -> Option<MudmEvent> {
    let pid = proc.get("pid").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let filename = proc
        .get("filename")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let exe_path = proc
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let cmdline = proc
        .get("command_line")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let message = if !cmdline.is_empty() {
        cmdline.join(" ")
    } else if !exe_path.is_empty() {
        format!("process {exe_path}")
    } else if !filename.is_empty() {
        format!("process {filename} (pid {pid})")
    } else if pid > 0 {
        format!("process pid {pid}")
    } else {
        return None;
    };

    let mut ev = MudmEvent::new(ts, message);
    ev.source_type = "android_magpie".into();
    ev.source = source_label.into();
    ev.platform = "android".into();
    ev.parser = "rusty_magpie".into();
    ev.data_type = "process_snapshot".into();
    ev.event_time_binding = "collection_time".into();
    ev.process_id = pid;
    ev.process_name = if !filename.is_empty() {
        filename.to_string()
    } else {
        exe_path
            .rsplit('/')
            .next()
            .unwrap_or(exe_path)
            .to_string()
    };
    ev.user = proc
        .get("uid")
        .map(|v| v.to_string())
        .unwrap_or_default();
    ev.ext = proc.clone();
    Some(ev)
}

fn file_to_event(file: &Value, ts: DateTime<Utc>, source_label: &str) -> Option<MudmEvent> {
    let path = file.get("path").and_then(|v| v.as_str()).unwrap_or("").trim();
    if path.is_empty() {
        return None;
    }
    let size = file.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
    let sha256 = file
        .get("sha256")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    let message = if sha256.is_empty() {
        format!("file {path} ({size} bytes)")
    } else {
        format!("file {path} ({size} bytes, sha256={sha256})")
    };

    let mut ev = MudmEvent::new(ts, message);
    ev.source_type = "android_magpie".into();
    ev.source = source_label.into();
    ev.platform = "android".into();
    ev.parser = "rusty_magpie".into();
    ev.data_type = "file_inventory".into();
    ev.event_time_binding = "collection_time".into();
    ev.file_hash = sha256.to_string();
    ev.ext = file.clone();
    Some(ev)
}

fn yara_rule_names(hit: &Value) -> Vec<String> {
    hit.get("rules")
        .and_then(|v| v.as_array())
        .map(|rules| {
            rules
                .iter()
                .filter_map(|rule| rule.get("identifier").and_then(|v| v.as_str()))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn yara_to_event(hit: &Value, ts: DateTime<Utc>, source_label: &str) -> Option<MudmEvent> {
    let path = hit.get("path").and_then(|v| v.as_str()).unwrap_or("").trim();
    if path.is_empty() {
        return None;
    }
    let count = hit.get("count").and_then(|v| v.as_u64()).unwrap_or(0);
    let rule_names = yara_rule_names(hit);
    let rules_label = if rule_names.is_empty() {
        format!("{count} rule(s)")
    } else {
        rule_names.join(", ")
    };
    let message = format!("yara match on {path}: {rules_label}");

    let mut ev = MudmEvent::new(ts, message);
    ev.source_type = "android_magpie".into();
    ev.source = source_label.into();
    ev.platform = "android".into();
    ev.parser = "rusty_magpie".into();
    ev.data_type = "yara_match".into();
    ev.event_time_binding = "collection_time".into();
    ev.ext = hit.clone();
    Some(ev)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::{FileOptions, ZipWriter};

    fn sample_zip() -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut buf);
            let opts = FileOptions::<()>::default().compression_method(zip::CompressionMethod::Stored);

            zip.start_file(MANIFEST_PATH, opts).unwrap();
            zip.write_all(
                br#"{"collector":"rusty-magpie","collected_at":"2026-06-04T12:00:00Z"}"#,
            )
            .unwrap();

            zip.start_file(PS_PATH, opts).unwrap();
            zip.write_all(
                br#"[{"pid":1,"uid":0,"filename":"init","path":"/system/bin/init","command_line":["init"],"state":"S"}]"#,
            )
            .unwrap();

            zip.start_file(FIND_PATH, opts).unwrap();
            zip.write_all(
                br#"[{"path":"/sdcard/test.txt","size":12,"sha256":"abc","modified_time":0,"access_time":0}]"#,
            )
            .unwrap();

            zip.finish().unwrap();
        }
        buf.into_inner()
    }

    #[test]
    fn reads_magpie_bundle_from_zip() {
        let bundle = read_magpie_bundle_from_bytes(&sample_zip())
            .unwrap()
            .expect("bundle");
        assert_eq!(bundle.processes.len(), 1);
        assert_eq!(bundle.files.len(), 1);
    }

    #[test]
    fn converts_magpie_json_to_mudm_events() {
        let bundle = read_magpie_bundle_from_bytes(&sample_zip())
            .unwrap()
            .expect("bundle");
        let (events, summary) = magpie_to_events(&bundle, "case-001");
        assert_eq!(summary.process_events, 1);
        assert_eq!(summary.file_events, 1);
        assert_eq!(events.len(), 2);
        assert!(events.iter().any(|e| e.data_type == "process_snapshot"));
        assert!(events.iter().any(|e| e.data_type == "file_inventory"));
        assert!(events.iter().all(|e| e.parser == "rusty_magpie"));
        assert!(events.iter().all(|e| e.source == "case-001"));
    }
}
