use mobipwn_core::endpoint_ingest::{parent_dir_segment, EndpointZipDeviceRule};
use mobipwn_core::mudm::{normalize_timeline_line, stamp_ingest_tags, MudmEvent, TimelinePlatform};
use serde_json::Value;
use std::io::{Cursor, Read};
use std::path::Path;
use zip::ZipArchive;

#[derive(Debug, Clone)]
pub struct EndpointZipFile {
    pub device_id: String,
    pub relative_path: String,
    pub jsonl: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct EndpointZipParseResult {
    pub files: Vec<EndpointZipFile>,
    pub tags: Vec<String>,
}

/// Parse a zip archive containing nested `.jsonl` logs (IronSift-style fleet ingest).
pub fn parse_endpoint_zip(
    bytes: &[u8],
    extra_tags: &[String],
    parent_tag_field: Option<usize>,
    device_rule: &EndpointZipDeviceRule,
) -> anyhow::Result<EndpointZipParseResult> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| anyhow::anyhow!("invalid zip: {e}"))?;
    let mut paths: Vec<(String, String)> = Vec::new();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| anyhow::anyhow!("zip entry: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().replace('\\', "/");
        if !name.to_ascii_lowercase().ends_with(".jsonl") {
            continue;
        }
        let mut body = String::new();
        entry
            .read_to_string(&mut body)
            .map_err(|e| anyhow::anyhow!("read {}: {e}", name))?;
        paths.push((name, body));
    }

    if paths.is_empty() {
        anyhow::bail!("zip contains no .jsonl files");
    }

    paths.sort_by(|a, b| a.0.cmp(&b.0));
    let merged_tags = extra_tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>();

    let mut files = Vec::with_capacity(paths.len());
    for (rel, body) in paths {
        let rel_norm = rel.trim_start_matches('/');
        let device_id = device_id_from_path(rel_norm, device_rule);
        let mut file_tags = merged_tags.clone();
        if let Some(field) = parent_tag_field {
            if let Some(tag) = parent_dir_tag(rel_norm, field, device_rule.delimiter) {
                if !file_tags.iter().any(|t| t == &tag) {
                    file_tags.push(tag);
                }
            }
        }
        let jsonl = inject_device_ids(&body, &device_id);
        files.push(EndpointZipFile {
            device_id,
            relative_path: rel_norm.to_string(),
            jsonl,
            tags: file_tags,
        });
    }

    Ok(EndpointZipParseResult {
        files,
        tags: merged_tags,
    })
}

pub fn ingest_endpoint_zip_jsonl(
    files: &[EndpointZipFile],
    platform: TimelinePlatform,
    source_label: &str,
) -> Vec<MudmEvent> {
    let mut events = Vec::new();
    for file in files {
        let mut file_events = Vec::new();
        for line in file.jsonl.lines().filter(|l| !l.trim().is_empty()) {
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                if let Some(ev) = normalize_timeline_line(&v, platform, source_label) {
                    file_events.push(ev);
                }
            }
        }
        stamp_ingest_tags(&mut file_events, &file.tags);
        events.extend(file_events);
    }
    events
}

pub fn device_id_from_path(rel: &str, rule: &EndpointZipDeviceRule) -> String {
    if let Some(field) = rule.parent_dir_field {
        if let Some(parent) = Path::new(rel).parent() {
            if let Some(name) = parent.file_name().and_then(|s| s.to_str()) {
                if let Some(seg) = parent_dir_segment(name, field, rule.delimiter) {
                    return seg;
                }
            }
        }
    }
    device_id_from_file_stem(rel)
}

fn device_id_from_file_stem(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            rel.replace('/', "-")
                .trim_end_matches(".jsonl")
                .to_string()
        })
}

fn parent_dir_tag(rel: &str, field: usize, delimiter: char) -> Option<String> {
    let parent = Path::new(rel).parent()?;
    let parent_name = parent.file_name()?.to_str()?;
    parent_dir_segment(parent_name, field, delimiter)
}

fn inject_device_ids(jsonl: &str, device_id: &str) -> String {
    jsonl
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| inject_device_id_line(line, device_id))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn inject_device_id_line(line: &str, device_id: &str) -> Option<String> {
    let mut v: Value = serde_json::from_str(line).ok()?;
    let obj = v.as_object_mut()?;
    for key in ["device_id", "machine_id"] {
        let existing = obj
            .get(key)
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if existing.is_none() {
            obj.insert(key.into(), Value::String(device_id.to_string()));
        }
    }
    Some(v.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mobipwn_core::endpoint_ingest::EndpointZipDeviceRule;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    #[test]
    fn injects_device_id_when_missing() {
        let out = inject_device_ids("{\"parser\":\"process\"}\n", "host-a");
        assert!(out.contains("\"device_id\":\"host-a\""));
        assert!(out.contains("\"machine_id\":\"host-a\""));
    }

    #[test]
    fn parses_zip_with_jsonl_files() {
        let mut buf = Vec::new();
        {
            let mut zip = ZipWriter::new(Cursor::new(&mut buf));
            let opts = SimpleFileOptions::default();
            zip.start_file("fleet/ws-001.jsonl", opts).unwrap();
            zip.write_all(b"{\"parser\":\"process\",\"process_name\":\"bash\"}\n")
                .unwrap();
            zip.start_file("fleet/ws-002.jsonl", opts).unwrap();
            zip.write_all(b"{\"parser\":\"process\",\"process_name\":\"sshd\"}\n")
                .unwrap();
            zip.finish().unwrap();
        }
        let parsed = parse_endpoint_zip(&buf, &["baseline".into()], None, &EndpointZipDeviceRule::default()).unwrap();
        assert_eq!(parsed.files.len(), 2);
        assert_eq!(parsed.files[0].device_id, "ws-001");
    }

    #[test]
    fn parses_zip_with_parent_dir_device_field() {
        let mut buf = Vec::new();
        {
            let mut zip = ZipWriter::new(Cursor::new(&mut buf));
            let opts = SimpleFileOptions::default();
            let path = "2026-05-03/PulseSecure-Periodicsnapshot-standalone-VPNGW01-20260504-0011/snapshot.jsonl";
            zip.start_file(path, opts).unwrap();
            zip.write_all(b"{\"event_type\":\"file_information\",\"file_path\":\"/tmp\"}\n")
                .unwrap();
            zip.finish().unwrap();
        }
        let rule = EndpointZipDeviceRule::parent_dir_segment(4, '-');
        let parsed = parse_endpoint_zip(&buf, &[], None, &rule).unwrap();
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].device_id, "VPNGW01");
    }
}
