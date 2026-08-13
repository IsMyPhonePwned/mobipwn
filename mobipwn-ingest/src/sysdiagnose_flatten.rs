//! Flatten sysdiagnose parser JSON into timeline-compatible JSONL for MUDM normalization.

use std::collections::HashMap;
use std::path::Path;

use serde_json::{json, Map, Value};
use sysdiagnose_extractor_library::{
    canonicalize_app_bundle_id, enrich_mobile_installation_event, extract_app_bundle_id_from_text,
    Analyser, AnalyserType, BuiltinAnalyser, ParserType, ParsedByParser, SysdiagnoseArchive,
};

/// Convert concurrent parser results into newline-delimited JSON (Timesketch-style rows).
pub fn flatten_parse_results_to_jsonl(
    results: &mut [(ParserType, Result<Value, Box<dyn std::error::Error + Send + Sync>>, std::time::Duration)],
    capture_datetime: Option<&str>,
    archive: Option<&SysdiagnoseArchive>,
) -> String {
    let mut lines = Vec::new();
    for (pt, result, _) in results.iter() {
        let Ok(v) = result else { continue };
        let parser_id = parser_type_slug(*pt);
        collect_events_from_parser(&parser_id, v, capture_datetime, &mut lines);
    }
    // Free giant logarchive event arrays before analyser clones (saves multi‑GB).
    for (pt, result, _) in results.iter_mut() {
        if *pt == ParserType::logarchive {
            if let Ok(v) = result {
                if let Some(obj) = v.as_object_mut() {
                    obj.insert("events".into(), json!([]));
                }
            }
        }
    }
    if let Some(arch) = archive {
        // Build analyser input once (previously rebuilt/cloned per analyser).
        let parsed = parsed_map_for_analysers(results);
        append_ps_everywhere_from_parsed(&parsed, arch, capture_datetime, &mut lines);
        append_apps_from_parsed(&parsed, arch, capture_datetime, &mut lines);
        append_permissions_from_parsed(&parsed, arch, capture_datetime, &mut lines);
        append_accounts_from_parsed(&parsed, arch, capture_datetime, &mut lines);
        append_uuid2path_lines(results, capture_datetime, &mut lines);
        append_network_iocs_from_parsed(&parsed, arch, capture_datetime, &mut lines);
        append_file_stats_device_metadata(results, arch, capture_datetime, &mut lines);
    }
    append_lockdownd_device_metadata(results, capture_datetime, &mut lines);
    lines.join("\n")
}

fn lines_contain_device_metadata(lines: &[String]) -> bool {
    lines.iter().any(|line| {
        line.contains(r#""event_type":"device_metadata""#)
            || line.contains(r#""event_type": "device_metadata""#)
    })
}

/// When `remotectl_dumpstate.txt` is absent, synthesize one device row from lockdownd log lines.
fn append_lockdownd_device_metadata(
    results: &[(ParserType, Result<Value, Box<dyn std::error::Error + Send + Sync>>, std::time::Duration)],
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    if lines_contain_device_metadata(out) {
        return;
    }
    let parsed = parsed_map_from_results(results);
    let Some(lockdownd) = parsed.get("lockdownd") else {
        return;
    };
    let Some(events) = lockdownd.get("events").and_then(|e| e.as_array()) else {
        return;
    };

    let mut product_type = String::new();
    let mut build_version = String::new();
    let mut serial = String::new();

    for ev in events {
        let message = ev
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .trim();
        if message.is_empty() {
            continue;
        }
        if let Some(value) = lockdownd_kv_value(message, "product_type") {
            product_type = value;
        }
        if let Some(value) = lockdownd_kv_value(message, "Build version") {
            build_version = value;
        }
        if let Some(value) = lockdownd_serial_from_pair(message) {
            serial = value;
        }
    }

    if product_type.is_empty() && serial.is_empty() && build_version.is_empty() {
        return;
    }

    let device = json!({
        "product_type": product_type,
        "build": build_version,
        "serial_number": serial,
    });
    let mut extra = Map::new();
    extra.insert("device_metadata_source".into(), json!("lockdownd"));
    emit_normalized_device_metadata("lockdownd", &device, Some(&extra), capture_datetime, out);
}

fn lockdownd_kv_value(message: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    let rest = message.strip_prefix(&prefix)?.trim();
    if rest.is_empty() {
        return None;
    }
    Some(rest.to_string())
}

fn lockdownd_serial_from_pair(message: &str) -> Option<String> {
    if !message.contains("SerialNumber") {
        return None;
    }
    let marker = "SerialNumber = ";
    let after = message.split(marker).nth(1)?;
    let serial = after
        .split(|c: char| c.is_whitespace() || c == ';' || c == '}')
        .next()?
        .trim();
    if serial.is_empty() {
        return None;
    }
    Some(serial.to_string())
}

/// Fallback device row via `file_stats` analyser (same `device_props_from_remotectl` as the library).
fn append_file_stats_device_metadata(
    results: &[(ParserType, Result<Value, Box<dyn std::error::Error + Send + Sync>>, std::time::Duration)],
    archive: &SysdiagnoseArchive,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    if lines_contain_device_metadata(out) {
        return;
    }
    let parsed = parsed_map_from_results(results);
    let analyser = BuiltinAnalyser(AnalyserType::file_stats);
    let Ok(stats) = analyser.analyse(archive, &parsed) else {
        return;
    };
    let Some(device) = stats.get("device") else {
        return;
    };
    if device.is_null() {
        return;
    }
    emit_normalized_device_metadata("remotectl_dumpstate", device, None, capture_datetime, out);
}

fn parsed_map_from_results(
    results: &[(ParserType, Result<Value, Box<dyn std::error::Error + Send + Sync>>, std::time::Duration)],
) -> ParsedByParser {
    let mut parsed = HashMap::new();
    for (pt, result, _) in results {
        if let Ok(v) = result {
            parsed.insert(parser_type_slug(*pt), v.clone());
        }
    }
    parsed
}

/// Analyser input without logarchive `events` (inventory/meta only — avoids multi‑GB clones).
fn parsed_map_for_analysers(
    results: &[(ParserType, Result<Value, Box<dyn std::error::Error + Send + Sync>>, std::time::Duration)],
) -> ParsedByParser {
    let mut parsed = HashMap::new();
    for (pt, result, _) in results {
        if let Ok(v) = result {
            let slug = parser_type_slug(*pt);
            if *pt == ParserType::logarchive {
                let mut slim = v.clone();
                if let Some(obj) = slim.as_object_mut() {
                    obj.insert("events".into(), json!([]));
                }
                parsed.insert(slug, slim);
            } else {
                parsed.insert(slug, v.clone());
            }
        }
    }
    parsed
}

fn append_network_iocs_from_parsed(
    parsed: &ParsedByParser,
    archive: &SysdiagnoseArchive,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    let analyser = BuiltinAnalyser(AnalyserType::network_iocs);
    let Ok(iocs) = analyser.analyse(archive, parsed) else {
        return;
    };
    collect_network_iocs_lines(&iocs, capture_datetime, out);
}

fn append_ps_everywhere_from_parsed(
    parsed: &ParsedByParser,
    archive: &SysdiagnoseArchive,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    let analyser = BuiltinAnalyser(AnalyserType::ps_everywhere);
    let Ok(processes) = analyser.analyse(archive, parsed) else {
        return;
    };
    let Some(entries) = processes.get("entries").and_then(|e| e.as_array()) else {
        return;
    };
    for entry in entries {
        let Some(obj) = entry.as_object() else {
            continue;
        };
        let mut row = Map::new();
        if let Some(dt) = obj.get("datetime") {
            row.insert("datetime".into(), dt.clone());
        }
        if let Some(pid) = obj.get("pid") {
            row.insert("process_id".into(), pid.clone());
            row.insert("pid".into(), pid.clone());
        }
        if let Some(user) = obj.get("user") {
            row.insert("user".into(), user.clone());
        }
        if let Some(name) = obj
            .get("process_name")
            .or_else(|| obj.get("name"))
            .or_else(|| obj.get("process"))
        {
            row.insert("process_name".into(), name.clone());
        } else if let Some(cmd) = obj.get("command").and_then(|v| v.as_str()) {
            row.insert(
                "process_name".into(),
                json!(sysdiagnose_extractor_library::util::process_short_name(cmd)),
            );
        }
        if let Some(cmd) = obj.get("command") {
            row.insert("command".into(), cmd.clone());
        }
        if let Some(cmdline) = obj.get("command_line") {
            row.insert("command_line".into(), cmdline.clone());
        }
        if let Some(args) = obj.get("args") {
            row.insert("args".into(), args.clone());
        }
        if let Some(message) = obj.get("message").or_else(|| obj.get("command")) {
            row.insert("message".into(), message.clone());
        }
        // Hoist forensic fields flat (no nested `ext` — normalize would nest as ext.ext).
        for key in [
            "uid",
            "ppid",
            "parent_pid",
            "path",
            "file_path",
            "parent",
            "footprint",
            "time_since_fork",
            "started",
            "threads",
            "sources",
            "taskinfo_process_line",
            "taskinfo_process",
            "taskinfo_thread_blocks",
        ] {
            if let Some(v) = obj.get(key) {
                row.insert(key.to_string(), v.clone());
            }
        }
        if let Some(rt) = obj.get("run time").or_else(|| obj.get("run_time")) {
            row.insert("run_time".into(), rt.clone());
        }
        row.insert("event_type".into(), json!("process_inventory"));
        out.push(row_object_to_line("ps_everywhere", &row, capture_datetime));
    }
}

fn append_apps_from_parsed(
    parsed: &ParsedByParser,
    archive: &SysdiagnoseArchive,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    let analyser = BuiltinAnalyser(AnalyserType::apps);
    let Ok(apps_out) = analyser.analyse(archive, parsed) else {
        return;
    };
    let Some(apps) = apps_out.get("apps").and_then(|a| a.as_object()) else {
        return;
    };
    let datetime = snapshot_datetime(capture_datetime);
    for (bundle_id, info) in apps {
        if bundle_id.trim().is_empty() {
            continue;
        }
        let found: Vec<String> = info
            .get("found")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let hits_n = info
            .get("hits")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        let mut fields = Map::new();
        fields.insert("bundle_id".into(), json!(bundle_id));
        fields.insert("event_type".into(), json!("installed_app"));
        if !found.is_empty() {
            fields.insert("sources".into(), json!(found));
        }
        fields.insert("hit_count".into(), json!(hits_n));
        let msg = if found.is_empty() {
            format!("Installed app {bundle_id}")
        } else {
            format!("Installed app {bundle_id} (sources: {})", found.join(", "))
        };
        emit_snapshot_row("apps", &datetime, &msg, fields, out);
    }
}

fn append_permissions_from_parsed(
    parsed: &ParsedByParser,
    archive: &SysdiagnoseArchive,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    let analyser = BuiltinAnalyser(AnalyserType::permissions);
    let Ok(perms_out) = analyser.analyse(archive, parsed) else {
        return;
    };
    let Some(apps) = perms_out.get("apps").and_then(|a| a.as_object()) else {
        return;
    };
    let fallback_dt = snapshot_datetime(capture_datetime);
    for (bundle_id, info) in apps {
        let Some(perms) = info.get("permissions").and_then(|p| p.as_array()) else {
            continue;
        };
        for perm in perms {
            let service = perm
                .get("service")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if service.is_empty() {
                continue;
            }
            let allowed = perm
                .get("allowed")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let datetime = perm
                .get("last_modified")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(fallback_dt)
                .to_string();
            let mut fields = Map::new();
            fields.insert("bundle_id".into(), json!(bundle_id));
            fields.insert("permission".into(), json!(service));
            fields.insert("service".into(), json!(service));
            if !allowed.is_empty() {
                fields.insert("allowed".into(), json!(allowed));
                fields.insert("status".into(), json!(allowed));
            }
            if let Some(v) = perm.get("auth_reason") {
                fields.insert("auth_reason".into(), v.clone());
            }
            if let Some(v) = perm.get("client_type") {
                fields.insert("client_type".into(), v.clone());
            }
            fields.insert("event_type".into(), json!("tcc_permission"));
            let msg = if allowed.is_empty() {
                format!("TCC {bundle_id} {service}")
            } else {
                format!("TCC {bundle_id} {service}={allowed}")
            };
            emit_snapshot_row("permissions", &datetime, &msg, fields, out);
        }
    }
}

fn append_accounts_from_parsed(
    parsed: &ParsedByParser,
    archive: &SysdiagnoseArchive,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    let analyser = BuiltinAnalyser(AnalyserType::accounts);
    let Ok(accounts_out) = analyser.analyse(archive, parsed) else {
        return;
    };
    let datetime = snapshot_datetime(capture_datetime);

    if let Some(mode) = accounts_out.get("lockdown_mode").and_then(|v| v.as_bool()) {
        let mut fields = Map::new();
        fields.insert("event_type".into(), json!("lockdown_mode"));
        fields.insert("lockdown_mode".into(), json!(mode));
        fields.insert("data_type".into(), json!("ios:sysdiagnose:lockdown_mode"));
        emit_snapshot_row(
            "accounts",
            datetime,
            &format!("Lockdown mode: {mode}"),
            fields,
            out,
        );
    }

    if let Some(emails) = accounts_out.get("owner_emails").and_then(|a| a.as_array()) {
        for item in emails {
            let email = item
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if email.is_empty() {
                continue;
            }
            let path = item
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let mut fields = Map::new();
            fields.insert("event_type".into(), json!("owner_email"));
            fields.insert("email".into(), json!(email));
            fields.insert("account_name".into(), json!(email));
            fields.insert("account_type".into(), json!("owner_email"));
            fields.insert("data_type".into(), json!("ios:sysdiagnose:owner_email"));
            if !path.is_empty() {
                fields.insert("plist_path".into(), json!(path));
            }
            emit_snapshot_row(
                "accounts",
                datetime,
                &format!("Calendar owner email: {email}"),
                fields,
                out,
            );
        }
    }

    if let Some(emails) = accounts_out
        .get("organization_emails")
        .and_then(|a| a.as_array())
    {
        for item in emails {
            let email = item
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if email.is_empty() {
                continue;
            }
            let path = item
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let org = item
                .get("organization_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let dept = item
                .get("organization_department")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let mut fields = Map::new();
            // CloudConfigurationDetails OrganizationEmail is an MDM/DEP enrollment
            // contact, not a signed-in Apple/calendar account on the device.
            fields.insert("event_type".into(), json!("organization_email"));
            fields.insert("email".into(), json!(email));
            fields.insert("account_name".into(), json!(email));
            fields.insert("account_type".into(), json!("mdm_organization"));
            fields.insert(
                "data_type".into(),
                json!("ios:sysdiagnose:organization_email"),
            );
            fields.insert("management_role".into(), json!("mdm_organization_contact"));
            if !org.is_empty() {
                fields.insert("organization_name".into(), json!(org));
            }
            if !dept.is_empty() {
                fields.insert("organization_department".into(), json!(dept));
            }
            if !path.is_empty() {
                fields.insert("plist_path".into(), json!(path));
            }
            let msg = if org.is_empty() {
                format!("MDM organization contact: {email}")
            } else {
                format!("MDM organization contact: {email} ({org})")
            };
            emit_snapshot_row("accounts", datetime, &msg, fields, out);
        }
    }

    if let Some(usernames) = accounts_out
        .get("activation_lock_usernames")
        .and_then(|a| a.as_array())
    {
        for item in usernames {
            let email = item
                .get("email")
                .or_else(|| item.get("username"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if email.is_empty() {
                continue;
            }
            let path = item
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let mut fields = Map::new();
            fields.insert("event_type".into(), json!("activation_lock_username"));
            fields.insert("email".into(), json!(email));
            fields.insert("account_name".into(), json!(email));
            fields.insert("account_type".into(), json!("activation_lock"));
            fields.insert(
                "data_type".into(),
                json!("ios:sysdiagnose:activation_lock_username"),
            );
            if !path.is_empty() {
                fields.insert("plist_path".into(), json!(path));
            }
            emit_snapshot_row(
                "accounts",
                datetime,
                &format!("Activation Lock Apple ID: {email}"),
                fields,
                out,
            );
        }
    }

    if let Some(contacts) = accounts_out.get("contacts").and_then(|a| a.as_array()) {
        for item in contacts {
            let uri = item.get("uri").and_then(|v| v.as_str()).unwrap_or("").trim();
            if uri.is_empty() {
                continue;
            }
            let kind = item
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let mut fields = Map::new();
            fields.insert("event_type".into(), json!("transparency_contact"));
            fields.insert("contact_uri".into(), json!(uri));
            fields.insert("uri_kind".into(), json!(kind));
            fields.insert("data_type".into(), json!("ios:sysdiagnose:transparency_contact"));
            if let Some(email) = item.get("email").and_then(|v| v.as_str()) {
                fields.insert("email".into(), json!(email));
                fields.insert("account_name".into(), json!(email));
            }
            if let Some(phone) = item.get("phone").and_then(|v| v.as_str()) {
                fields.insert("phone".into(), json!(phone));
                fields.insert("account_name".into(), json!(phone));
            }
            fields.insert("account_type".into(), json!("transparency_contact"));
            emit_snapshot_row(
                "accounts",
                datetime,
                &format!("Transparency contact URI {uri}"),
                fields,
                out,
            );
        }
    }

    if let Some(accts) = accounts_out.get("apple_accounts").and_then(|a| a.as_array()) {
        for item in accts {
            let id = item
                .get("account_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if id.is_empty() {
                continue;
            }
            let mut fields = Map::new();
            fields.insert("event_type".into(), json!("apple_account"));
            fields.insert("account_id".into(), json!(id));
            fields.insert("account_name".into(), json!(id));
            fields.insert("account_type".into(), json!("apple_transparency"));
            fields.insert("data_type".into(), json!("ios:sysdiagnose:apple_account"));
            emit_snapshot_row(
                "accounts",
                datetime,
                &format!("Apple account id: {id}"),
                fields,
                out,
            );
        }
    }

    if let Some(devs) = accounts_out.get("linked_devices").and_then(|a| a.as_array()) {
        for item in devs {
            let Some(obj) = item.as_object() else { continue };
            let serial = obj
                .get("serial")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
            let model = obj
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let os_version = obj
                .get("os_version")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if serial.is_empty() && name.is_empty() && model.is_empty() {
                continue;
            }
            let mut fields = Map::new();
            fields.insert("event_type".into(), json!("linked_device"));
            fields.insert("data_type".into(), json!("ios:sysdiagnose:linked_device"));
            if !serial.is_empty() {
                fields.insert("serial".into(), json!(serial));
                fields.insert("device_id".into(), json!(serial));
            }
            if !name.is_empty() {
                fields.insert("device_name".into(), json!(name));
                fields.insert("app_name".into(), json!(name));
            }
            if !model.is_empty() {
                fields.insert("device_model".into(), json!(model));
            }
            if !os_version.is_empty() {
                fields.insert("os_version".into(), json!(os_version));
            }
            let label = if !name.is_empty() {
                name
            } else if !serial.is_empty() {
                serial
            } else {
                model
            };
            emit_snapshot_row(
                "accounts",
                datetime,
                &format!("Linked Apple device: {label}"),
                fields,
                out,
            );
        }
    }
}

fn append_uuid2path_lines(
    results: &[(ParserType, Result<Value, Box<dyn std::error::Error + Send + Sync>>, std::time::Duration)],
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    let parsed = parsed_map_from_results(results);
    let Some(uuid2path) = parsed.get("uuid2path") else {
        return;
    };
    let datetime = snapshot_datetime(capture_datetime);
    let mut emitted = 0usize;
    const MAX_UUID2PATH_ROWS: usize = 5_000;

    let walk_map = |map: &Map<String, Value>, out: &mut Vec<String>, emitted: &mut usize| {
        for (key, val) in map {
            if *emitted >= MAX_UUID2PATH_ROWS {
                return;
            }
            // Inner UUID → path maps (skip archive path keys that hold objects).
            if let Some(inner) = val.as_object() {
                for (uuid, path_v) in inner {
                    if *emitted >= MAX_UUID2PATH_ROWS {
                        return;
                    }
                    let path = match path_v.as_str() {
                        Some(s) if !s.trim().is_empty() => s.trim(),
                        _ => continue,
                    };
                    let uuid = uuid.trim();
                    if uuid.is_empty() {
                        continue;
                    }
                    let mut fields = Map::new();
                    fields.insert("uuid".into(), json!(uuid));
                    fields.insert("path".into(), json!(path));
                    fields.insert("file_path".into(), json!(path));
                    fields.insert("event_type".into(), json!("uuid2path"));
                    let msg = format!("UUID {uuid} → {path}");
                    emit_snapshot_row("uuid2path", &datetime, &msg, fields, out);
                    *emitted += 1;
                }
            } else if let Some(path) = val.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                // Flat uuid → path at top level
                let uuid = key.trim();
                if uuid.len() < 8 {
                    continue;
                }
                let mut fields = Map::new();
                fields.insert("uuid".into(), json!(uuid));
                fields.insert("path".into(), json!(path));
                fields.insert("file_path".into(), json!(path));
                fields.insert("event_type".into(), json!("uuid2path"));
                let msg = format!("UUID {uuid} → {path}");
                emit_snapshot_row("uuid2path", &datetime, &msg, fields, out);
                *emitted += 1;
            }
        }
    };

    if let Some(obj) = uuid2path.as_object() {
        walk_map(obj, out, &mut emitted);
    }
}

fn collect_network_iocs_lines(iocs: &Value, capture_datetime: Option<&str>, out: &mut Vec<String>) {
    let Some(hits) = iocs.get("hits").and_then(|h| h.as_array()) else {
        return;
    };
    let datetime = snapshot_datetime(capture_datetime);
    for hit in hits {
        let kind = hit.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let value = hit.get("value").and_then(|v| v.as_str()).unwrap_or("");
        if value.is_empty() {
            continue;
        }
        let source = hit
            .get("source_parser")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let path = hit.get("json_path").and_then(|v| v.as_str()).unwrap_or("");
        let mut fields = Map::new();
        fields.insert("ioc_kind".into(), json!(kind));
        fields.insert("ioc_value".into(), json!(value));
        fields.insert("source_parser".into(), json!(source));
        fields.insert("json_path".into(), json!(path));
        match kind {
            "ipv4" => {
                fields.insert("dest_ip".into(), json!(value));
            }
            "domain" => {
                fields.insert("destination_domain".into(), json!(value));
            }
            "url" => {
                fields.insert("url".into(), json!(value));
            }
            _ => {}
        }
        emit_snapshot_row(
            "network_iocs",
            datetime,
            &format!("network IOC {kind}: {value} ({source})"),
            fields,
            out,
        );
    }
}

/// Parse `sysdiagnose_YYYY.MM.DD_HH-MM-SS+TZ...` from an archive path into RFC3339-ish datetime.
///
/// Blob storage sanitizes `+` in filenames to `_`, so timezone may appear as `_0200` instead of `+0200`.
/// The capture time is always the 8-char `HH-MM-SS` segment immediately after the date underscore.
pub fn capture_datetime_from_sysdiagnose_path(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let stem = name
        .strip_suffix(".tar.gz")
        .or_else(|| name.strip_suffix(".tgz"))
        .or_else(|| name.strip_suffix(".tar.xz"))
        .or_else(|| name.strip_suffix(".xz"))?;
    let rest = stem.strip_prefix("sysdiagnose_")?;
    let (date_part, after_date) = rest.split_once('_')?;
    if after_date.len() < 8 {
        return None;
    }
    let time_segment = &after_date[..8];
    let bytes = time_segment.as_bytes();
    if bytes[2] != b'-' || bytes[5] != b'-' {
        return None;
    }
    for i in [0, 1, 3, 4, 6, 7] {
        if !bytes[i].is_ascii_digit() {
            return None;
        }
    }
    let date = date_part.replace('.', "-");
    let time = time_segment.replace('-', ":");
    Some(format!("{date}T{time}Z"))
}

fn collect_events_from_parser(
    parser_id: &str,
    v: &Value,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    if parser_id == "logarchive" {
        collect_logarchive_lines(parser_id, v, capture_datetime, out);
        return;
    }
    if parser_id == "ioservice" {
        collect_ioservice_lines(parser_id, v, capture_datetime, out);
        return;
    }
    if parser_id == "iousb" {
        collect_iousb_lines(parser_id, v, capture_datetime, out);
        return;
    }
    if v.get("format").and_then(|x| x.as_str()) == Some("jsonl") {
        if let Some(events) = v.get("events").and_then(|e| e.as_array()) {
            for ev in events {
                if let Some(line) = saf_event_to_timeline_row(parser_id, ev) {
                    out.push(line);
                }
            }
        }
        return;
    }
    if let Some(entries) = v.get("entries").and_then(|r| r.as_array()) {
        for row in entries {
            if let Some(obj) = row.as_object() {
                out.push(row_object_to_line(parser_id, obj, capture_datetime));
            }
        }
        return;
    }
    if v.get("format").is_none() {
        if let Some(events) = v.get("events").and_then(|e| e.as_array()) {
            for ev in events {
                if let Some(line) = generic_event_to_timeline_row(parser_id, ev, capture_datetime) {
                    out.push(line);
                }
            }
            return;
        }
    }
    if let Some(rows) = v.get("rows").and_then(|r| r.as_array()) {
        for row in rows {
            if let Some(obj) = row.as_object() {
                out.push(row_object_to_line(parser_id, obj, capture_datetime));
            }
        }
        return;
    }
    if parser_id == "remotectl_dumpstate" {
        if let Some(line) = remotectl_device_to_timeline_row(parser_id, v, capture_datetime) {
            out.push(line);
        }
        return;
    }
    if parser_id == "transparency_json" {
        collect_transparency_json_lines(parser_id, v, capture_datetime, out);
        return;
    }
    if parser_id == "plists" {
        if let Some(files) = v.get("files").and_then(|f| f.as_object()) {
            collect_plist_url_lines(parser_id, files, capture_datetime, out);
        }
        return;
    }
    if parser_id == "networkextension" || parser_id == "networkextensioncache" {
        collect_network_extension_lines(parser_id, v, capture_datetime, out);
    }
}

fn alias_ioservice_device_fields(fields: &mut Map<String, Value>) {
    let model = field_string(fields, "product_type")
        .or_else(|| field_string_suffix(fields, "ProductType"));
    if !fields.contains_key("device_model") {
        if let Some(model) = model {
            fields.insert("device_model".into(), json!(model));
            fields.insert("product_type".into(), json!(model));
        }
    }
    if !fields.contains_key("os_version") {
        if let Some(os) = field_string(fields, "OSVersion")
            .or_else(|| field_string_suffix(fields, "ProductVersion"))
            .or_else(|| field_string_suffix(fields, "HumanReadableProductVersionString"))
        {
            fields.insert("os_version".into(), json!(os));
        }
    }
    if !fields.contains_key("serial") {
        if let Some(serial) = field_string(fields, "SerialNumber")
            .or_else(|| field_string_suffix(fields, "IOPlatformSerialNumber"))
            .or_else(|| field_string_suffix(fields, "SerialNumber"))
        {
            fields.insert("serial".into(), json!(serial));
            fields.insert("device_id".into(), json!(serial));
        }
    }
    if !fields.contains_key("unique_device_id") {
        if let Some(udid) = field_string(fields, "UniqueDeviceID")
            .or_else(|| field_string_suffix(fields, "UniqueDeviceID"))
        {
            fields.insert("unique_device_id".into(), json!(udid));
            if !fields.contains_key("device_id") {
                fields.insert("device_id".into(), json!(udid));
            }
        }
    }
    if !fields.contains_key("build_version") {
        if let Some(build) = field_string(fields, "BuildVersion")
            .or_else(|| field_string_suffix(fields, "BuildVersion"))
        {
            fields.insert("build_version".into(), json!(build));
        }
    }
}

fn field_string(fields: &Map<String, Value>, key: &str) -> Option<String> {
    fields.get(key).and_then(value_as_string_opt)
}

fn field_string_suffix(fields: &Map<String, Value>, suffix: &str) -> Option<String> {
    fields
        .iter()
        .find(|(k, _)| k.ends_with(suffix))
        .and_then(|(_, v)| value_as_string_opt(v))
}

fn collect_logarchive_lines(
    parser_id: &str,
    v: &Value,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    let datetime = snapshot_datetime(capture_datetime);
    let decode = v
        .get("decode")
        .and_then(|d| d.as_str())
        .unwrap_or("unknown");
    let decode_meta = v.get("decode_meta").and_then(|m| m.as_object());
    let tool = decode_meta
        .and_then(|m| m.get("tool"))
        .and_then(|t| t.as_str())
        .unwrap_or("");
    let event_count = decode_meta
        .and_then(|m| m.get("event_count"))
        .and_then(|n| n.as_u64())
        .unwrap_or(0);
    let max_lines = decode_meta
        .and_then(|m| m.get("max_lines"))
        .and_then(|n| n.as_u64());
    let reason = decode_meta
        .and_then(|m| m.get("reason"))
        .and_then(|r| r.as_str())
        .unwrap_or("");

    if let Some(inv) = v.get("inventory").and_then(|i| i.as_object()) {
        let file_count = inv
            .get("file_count")
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let mut fields = Map::new();
        fields.insert("event_type".into(), json!("logarchive_inventory"));
        fields.insert("logarchive_decode".into(), json!(decode));
        fields.insert("file_count".into(), json!(file_count));
        if !tool.is_empty() {
            fields.insert("logarchive_tool".into(), json!(tool));
            fields.insert("tool".into(), json!(tool));
        }
        if event_count > 0 {
            fields.insert("event_count".into(), json!(event_count));
        }
        if let Some(cap) = max_lines {
            fields.insert("max_lines".into(), json!(cap));
        }
        if !reason.is_empty() {
            fields.insert("reason".into(), json!(reason));
        }
        if let Some(bytes) = inv.get("total_bytes") {
            fields.insert("total_bytes".into(), bytes.clone());
        }
        if let Some(meta) = decode_meta {
            for (k, val) in meta {
                fields.insert(k.clone(), val.clone());
            }
        }
        emit_snapshot_row(
            parser_id,
            datetime,
            &logarchive_inventory_message(decode, file_count, tool, event_count, reason),
            fields,
            out,
        );
    }
    if v.get("format").and_then(|x| x.as_str()) == Some("jsonl") {
        if let Some(events) = v.get("events").and_then(|e| e.as_array()) {
            for ev in events {
                if let Some(line) = logarchive_event_to_timeline_row(parser_id, ev, tool) {
                    out.push(line);
                }
            }
        }
    }
}

fn logarchive_inventory_message(
    decode: &str,
    file_count: u64,
    tool: &str,
    event_count: u64,
    reason: &str,
) -> String {
    match decode {
        "success" => {
            let via = if tool.is_empty() {
                String::new()
            } else {
                format!(", via {tool}")
            };
            format!(
                "Unified log archive: {file_count} files, decode=success{via} ({event_count} events)"
            )
        }
        "failed" => {
            let via = if tool.is_empty() {
                String::new()
            } else {
                format!(" ({tool})")
            };
            let detail = if reason.is_empty() {
                String::new()
            } else {
                format!(": {reason}")
            };
            format!("Unified log archive: {file_count} files, decode failed{via}{detail}")
        }
        "skipped" => {
            let detail = if reason.is_empty() {
                "no system_logs.logarchive/ tree".to_string()
            } else {
                reason.to_string()
            };
            format!("Unified log archive: decode skipped ({detail})")
        }
        "deferred" => format!(
            "Unified log archive: {file_count} files, decode deferred (enable ./dev.sh --logarchive-decode or --features logarchive-decode)"
        ),
        _ => format!("Unified log archive: {file_count} files, decode={decode}"),
    }
}

fn logarchive_event_to_timeline_row(parser_id: &str, ev: &Value, tool: &str) -> Option<String> {
    let message = ev.get("message")?.as_str()?;
    let datetime = ev
        .get("datetime")
        .and_then(|d| d.as_str())
        .unwrap_or("");
    let mut map = Map::new();
    map.insert("message".into(), json!(message));
    map.insert("datetime".into(), json!(datetime));
    map.insert("event_type".into(), json!("logarchive_event"));
    map.insert("logarchive_decode".into(), json!("success"));
    map.insert("data_type".into(), json!(parser_id));
    map.insert("sysdiagnose_parser".into(), json!(parser_id));
    map.insert("parser".into(), json!(parser_id));
    if !tool.is_empty() {
        map.insert("logarchive_tool".into(), json!(tool));
    }
    map.insert(
        "timestamp_desc".into(),
        ev.get("timestamp_desc")
            .cloned()
            .unwrap_or(Value::String(String::new())),
    );
    if let Some(data) = ev.get("data").and_then(|d| d.as_object()) {
        for (k, v) in data {
            map.insert(k.clone(), v.clone());
        }
        if let Some(proc) = data.get("process").and_then(value_as_string_opt) {
            if !proc.is_empty() {
                map.insert("process_name".into(), json!(proc));
            }
        }
        if let Some(subsystem) = data.get("subsystem").and_then(value_as_string_opt) {
            if !subsystem.is_empty() {
                map.insert("bundle_id".into(), json!(subsystem));
            }
        }
    }
    apply_ios_auth_classification(&mut map, message);
    stamp_ios_bundle_id(parser_id, &mut map);
    serde_json::to_string(&Value::Object(map)).ok()
}

fn apply_ios_auth_classification(map: &mut Map<String, Value>, message: &str) {
    use sysdiagnose_extractor_library::parsers::{
        classify_ios_auth_message, stamp_auth_classification,
    };

    // Prefer fields already stamped by the library decoder / lockdownd parser.
    if map.get("auth_success").and_then(|v| v.as_bool()).is_some() {
        if map
            .get("event_type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            != "authentication_event"
        {
            map.insert("event_type".into(), json!("authentication_event"));
        }
        if map.get("success").is_none() {
            if let Some(v) = map.get("auth_success").cloned() {
                map.insert("success".into(), v);
            }
        }
        return;
    }

    if let Some(auth) = classify_ios_auth_message(message) {
        stamp_auth_classification(map, auth);
        map.insert("timestamp_desc".into(), json!(auth.timestamp_desc));
    }
}

fn collect_ioservice_lines(
    parser_id: &str,
    v: &Value,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    if v.get("error").is_some() {
        return;
    }
    let datetime = snapshot_datetime(capture_datetime);

    if let Some(summary) = v.get("summary").and_then(|s| s.as_object()) {
        let node_count = summary
            .get("node_count")
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let mut fields = Map::new();
        fields.insert("event_type".into(), json!("ioservice_summary"));
        for (k, val) in summary {
            fields.insert(k.clone(), val.clone());
        }
        if let Some(meta) = v.get("meta").and_then(|m| m.as_object()) {
            if let Some(trunc) = meta.get("tree_truncated") {
                fields.insert("tree_truncated".into(), trunc.clone());
            }
            if let Some(hint) = meta.get("full_tree_hint").and_then(|h| h.as_str()) {
                fields.insert("full_tree_hint".into(), json!(hint));
            }
        }
        emit_snapshot_row(
            parser_id,
            datetime,
            &format!("IOService compact summary: {node_count} nodes"),
            fields,
            out,
        );
    }

    if let Some(props) = v.get("device_properties").and_then(|p| p.as_object()) {
        if !props.is_empty() {
            let mut fields = Map::new();
            fields.insert("event_type".into(), json!("device_properties"));
            for (k, val) in props {
                if let Some(s) = value_as_string_opt(val) {
                    fields.insert(k.clone(), json!(s));
                } else {
                    fields.insert(k.clone(), val.clone());
                }
            }
            alias_ioservice_device_fields(&mut fields);
            emit_snapshot_row(
                parser_id,
                datetime,
                "IOService device properties",
                fields,
                out,
            );
        }
    }

    if v.get("format").is_none() && v.get("tree").is_some() {
        let mut fields = Map::new();
        fields.insert("event_type".into(), json!("ioservice_full_tree"));
        emit_snapshot_row(
            parser_id,
            datetime,
            "IOService full tree (metadata only — tree not expanded to timeline)",
            fields,
            out,
        );
    }
}

const IOUSB_MAX_DEVICES: usize = 200;

fn collect_iousb_lines(
    parser_id: &str,
    v: &Value,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    if v.get("error").is_some() {
        return;
    }
    let Some(tree) = v.get("tree") else {
        return;
    };
    if tree.as_object().is_some_and(|m| m.is_empty()) {
        return;
    }

    let datetime = snapshot_datetime(capture_datetime);
    let mut devices: Vec<Map<String, Value>> = Vec::new();
    walk_iousb_tree(tree, "", &mut devices);

    let mut summary = Map::new();
    summary.insert("usb_kind".into(), json!("summary"));
    summary.insert("event_type".into(), json!("iousb_summary"));
    summary.insert("device_count".into(), json!(devices.len()));
    if let Some(src) = v.get("parser").and_then(|p| p.as_str()) {
        summary.insert("source_parser".into(), json!(src));
    }
    summary.insert("source_path".into(), json!("ioreg/IOUSB.txt"));
    emit_snapshot_row(
        parser_id,
        datetime,
        &format!("IOUSB plane: {} device node(s)", devices.len()),
        summary,
        out,
    );

    for (i, mut fields) in devices.into_iter().take(IOUSB_MAX_DEVICES).enumerate() {
        let product = field_string(&fields, "usb_product")
            .or_else(|| field_string(&fields, "node_name"))
            .unwrap_or_else(|| format!("USB device {}", i + 1));
        let vendor = field_string(&fields, "usb_vendor").unwrap_or_default();
        let vid = field_string(&fields, "id_vendor").unwrap_or_default();
        let pid = field_string(&fields, "id_product").unwrap_or_default();
        let class = field_string(&fields, "usb_class").unwrap_or_default();

        let mut msg_parts = vec![product.clone()];
        if !vendor.is_empty() {
            msg_parts.push(format!("by {vendor}"));
        }
        if !vid.is_empty() || !pid.is_empty() {
            msg_parts.push(format!("vid={vid} pid={pid}"));
        }
        if !class.is_empty() {
            msg_parts.push(class);
        }

        fields.insert("usb_kind".into(), json!("device"));
        fields.insert("event_type".into(), json!("usb_device"));
        fields.insert("action".into(), json!(product));
        if !vendor.is_empty() {
            fields.insert("app_name".into(), json!(vendor));
        }
        emit_snapshot_row(parser_id, datetime, &msg_parts.join(" · "), fields, out);
    }
}

fn walk_iousb_tree(v: &Value, path: &str, out: &mut Vec<Map<String, Value>>) {
    if out.len() >= IOUSB_MAX_DEVICES {
        return;
    }
    match v {
        Value::Object(m) => {
            if iousb_node_is_device(m) {
                if let Some(fields) = iousb_device_fields(m, path) {
                    out.push(fields);
                }
            }
            for (key, child) in m {
                if child.is_object() || child.is_array() {
                    let child_path = if path.is_empty() {
                        key.clone()
                    } else {
                        format!("{path}/{key}")
                    };
                    walk_iousb_tree(child, &child_path, out);
                }
            }
        }
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                walk_iousb_tree(item, &format!("{path}[{i}]"), out);
            }
        }
        _ => {}
    }
}

fn iousb_node_is_device(m: &Map<String, Value>) -> bool {
    let class = m
        .get("class")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if class.contains("usb") {
        return iousb_has_identity_props(m) || class.contains("device") || class.contains("hub");
    }
    iousb_has_identity_props(m)
}

fn iousb_has_identity_props(m: &Map<String, Value>) -> bool {
    m.keys().any(|k| {
        let kl = k.to_ascii_lowercase();
        kl.contains("idvendor")
            || kl.contains("idproduct")
            || kl.contains("usb product")
            || kl.contains("usb vendor")
            || kl.contains("kusbproduct")
            || kl.contains("kusbvendor")
            || kl.contains("usb serial")
            || kl == "product name"
            || kl == "vendor name"
    })
}

fn iousb_device_fields(m: &Map<String, Value>, path: &str) -> Option<Map<String, Value>> {
    let node_name = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .trim()
        .to_string();
    let class = m.get("class").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let product = first_prop_string(
        m,
        &[
            "USB Product Name",
            "kUSBProductString",
            "USB Product Name ",
            "Product Name",
            "product-name",
        ],
    );
    let vendor = first_prop_string(
        m,
        &[
            "USB Vendor Name",
            "kUSBVendorString",
            "Vendor Name",
            "manufacturer",
        ],
    );
    let id_vendor = first_prop_string(m, &["idVendor", "idvendor", "vendor-id"]);
    let id_product = first_prop_string(m, &["idProduct", "idproduct", "product-id"]);
    let serial = first_prop_string(
        m,
        &["USB Serial Number", "kUSBSerialNumberString", "serial-number", "Serial Number"],
    );
    let port = first_prop_string(m, &["PortNum", "port", "UsbPortNumber", "port-number"]);

    // Skip pure container / root nodes with no identity.
    if product.is_none()
        && vendor.is_none()
        && id_vendor.is_none()
        && id_product.is_none()
        && serial.is_none()
        && !class.to_ascii_lowercase().contains("device")
    {
        return None;
    }

    let mut fields = Map::new();
    if !node_name.is_empty() && !node_name.starts_with('[') {
        fields.insert("node_name".into(), json!(node_name));
    }
    if !path.is_empty() {
        fields.insert("ioreg_path".into(), json!(path));
    }
    if !class.is_empty() {
        fields.insert("usb_class".into(), json!(class));
    }
    if let Some(v) = product {
        fields.insert("usb_product".into(), json!(v));
    }
    if let Some(v) = vendor {
        fields.insert("usb_vendor".into(), json!(v));
    }
    if let Some(v) = id_vendor {
        fields.insert("id_vendor".into(), json!(normalize_usb_id(&v)));
    }
    if let Some(v) = id_product {
        fields.insert("id_product".into(), json!(normalize_usb_id(&v)));
    }
    if let Some(v) = serial {
        fields.insert("usb_serial".into(), json!(v));
    }
    if let Some(v) = port {
        fields.insert("port_num".into(), json!(v));
    }
    Some(fields)
}

fn first_prop_string(m: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = m.get(*key).and_then(value_as_string_opt) {
            let t = v.trim();
            if !t.is_empty() && t != "null" {
                return Some(t.to_string());
            }
        }
        // Case-insensitive fallback for quirky IOReg key casing.
        let want = key.to_ascii_lowercase();
        for (k, val) in m {
            if k.to_ascii_lowercase() == want {
                if let Some(v) = value_as_string_opt(val) {
                    let t = v.trim();
                    if !t.is_empty() && t != "null" {
                        return Some(t.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Normalize IOReg USB ids (`0x5ac`, `<ac050000>`, `1452`) to a stable hex string when possible.
fn normalize_usb_id(raw: &str) -> String {
    let t = raw.trim().trim_matches(|c| c == '<' || c == '>');
    if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        return format!("0x{}", hex.to_ascii_lowercase());
    }
    // Little-endian Apple byte dumps like <ac050000> → 0x05ac
    if t.len() >= 4 && t.chars().all(|c| c.is_ascii_hexdigit()) {
        let b0 = u8::from_str_radix(&t[0..2], 16).ok();
        let b1 = u8::from_str_radix(&t[2..4], 16).ok();
        if let (Some(lo), Some(hi)) = (b0, b1) {
            let n = u16::from(hi) << 8 | u16::from(lo);
            return format!("0x{n:04x}");
        }
    }
    if let Ok(n) = t.parse::<u32>() {
        return format!("0x{n:x}");
    }
    raw.trim().to_string()
}

fn remotectl_device_to_timeline_row(
    parser_id: &str,
    v: &Value,
    capture_datetime: Option<&str>,
) -> Option<String> {
    if remotectl_value_is_hard_error(v) {
        return None;
    }
    let props = remotectl_properties_map(v)?;
    let device = device_json_from_remotectl_props(&props);
    let mut lines = Vec::new();
    emit_normalized_device_metadata(parser_id, &device, Some(&props), capture_datetime, &mut lines);
    lines.into_iter().next()
}

fn remotectl_value_is_hard_error(v: &Value) -> bool {
    let Some(data) = v.get("data").filter(|d| d.is_object()) else {
        return v
            .get("error")
            .and_then(|e| e.as_str())
            .is_some_and(|s| !s.is_empty());
    };
    let Some(obj) = data.as_object() else {
        return false;
    };
    if obj.len() == 1 && obj.contains_key("error") {
        return true;
    }
    false
}

fn device_json_from_remotectl_props(props: &Map<String, Value>) -> Value {
    let os_version = props
        .get("OSVersion")
        .or_else(|| props.get("ProductVersion"))
        .or_else(|| props.get("HumanReadableProductVersionString"));
    json!({
        "os_version": os_version,
        "build": props.get("BuildVersion"),
        "product_name": props.get("ProductName"),
        "product_type": props.get("ProductType"),
        "serial_number": props
            .get("SerialNumber")
            .or_else(|| props.get("UniqueDeviceID")),
        "unique_device_id": props.get("UniqueDeviceID"),
    })
}

fn emit_normalized_device_metadata(
    parser_id: &str,
    device: &Value,
    extra_props: Option<&Map<String, Value>>,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    let os_version = value_as_string(
        device
            .get("os_version")
            .unwrap_or(&Value::Null),
    );
    let product_type = value_as_string(
        device
            .get("product_type")
            .unwrap_or(&Value::Null),
    );
    let serial = value_as_string(
        device
            .get("serial_number")
            .or_else(|| device.get("unique_device_id"))
            .unwrap_or(&Value::Null),
    );
    if os_version.is_empty() && product_type.is_empty() && serial.is_empty() {
        return;
    }

    let datetime = capture_datetime.unwrap_or("1970-01-01T00:00:00Z");
    let mut map = Map::new();
    map.insert(
        "message".into(),
        json!(format!(
            "iOS device {product_type} iOS {os_version} serial {serial}"
        )),
    );
    map.insert("datetime".into(), json!(datetime));
    map.insert("event_type".into(), json!("device_metadata"));
    map.insert("data_type".into(), json!(parser_id));
    map.insert("sysdiagnose_parser".into(), json!(parser_id));
    map.insert("parser".into(), json!(parser_id));
    if !os_version.is_empty() {
        map.insert("os_version".into(), json!(os_version));
    }
    if !product_type.is_empty() {
        map.insert("device_model".into(), json!(product_type));
        map.insert("product_type".into(), json!(product_type));
    }
    if let Some(build) = device.get("build").and_then(value_as_string_opt) {
        map.insert("build_version".into(), json!(build));
    }
    if let Some(name) = device.get("product_name").and_then(value_as_string_opt) {
        map.insert("product_name".into(), json!(name));
    }
    if let Some(serial) = device.get("serial_number").and_then(value_as_string_opt) {
        map.insert("serial".into(), json!(serial));
        map.insert("device_id".into(), json!(serial));
    }
    if let Some(udid) = device.get("unique_device_id").and_then(value_as_string_opt) {
        map.insert("unique_device_id".into(), json!(udid));
        if !map.contains_key("device_id") {
            map.insert("device_id".into(), json!(udid));
        }
    }
    if let Some(props) = extra_props {
        for (k, v) in props {
            if map.contains_key(k) {
                continue;
            }
            if let Some(s) = value_as_string_opt(v) {
                map.insert(k.clone(), json!(s));
            }
        }
    }
    if let Ok(line) = serde_json::to_string(&Value::Object(map)) {
        out.push(line);
    }
}

fn remotectl_properties_map(v: &Value) -> Option<Map<String, Value>> {
    if let Some(block) = find_remotectl_local_device_block(v) {
        let props = block
            .get("Properties")
            .and_then(|p| p.as_object())
            .unwrap_or(block);
        let mut merged = props.clone();
        merge_remotectl_envelope_fields(&mut merged, block);
        if device_props_usable(&merged) {
            return Some(merged);
        }
    }
    find_device_props_map(v).cloned()
}

/// Tab-hierarchy dumps use `Local device` → `Properties` (newer) or flat `Device` (golden fixture).
fn find_remotectl_local_device_block(v: &Value) -> Option<&Map<String, Value>> {
    const KEYS: &[&str] = &["Local device", "Device"];
    if let Some(data) = v.get("data") {
        for key in KEYS {
            if let Some(m) = data.get(*key).and_then(|x| x.as_object()) {
                return Some(m);
            }
            if let Some(inner) = data.get("data") {
                if let Some(m) = inner.get(*key).and_then(|x| x.as_object()) {
                    return Some(m);
                }
            }
        }
    }
    for key in KEYS {
        if let Some(m) = find_object_by_key(v, key) {
            return Some(m);
        }
    }
    None
}

fn find_object_by_key<'a>(v: &'a Value, key: &str) -> Option<&'a Map<String, Value>> {
    match v {
        Value::Object(m) => {
            if let Some(obj) = m.get(key).and_then(|x| x.as_object()) {
                return Some(obj);
            }
            for child in m.values() {
                if let Some(inner) = find_object_by_key(child, key) {
                    return Some(inner);
                }
            }
        }
        Value::Array(a) => {
            for child in a {
                if let Some(inner) = find_object_by_key(child, key) {
                    return Some(inner);
                }
            }
        }
        _ => {}
    }
    None
}

fn merge_remotectl_envelope_fields(props: &mut Map<String, Value>, envelope: &Map<String, Value>) {
    if !props.contains_key("ProductType") {
        if let Some(s) = envelope.get("Product Type").and_then(value_as_string_opt) {
            props.insert("ProductType".into(), json!(s));
        }
    }
    if !props.contains_key("OSVersion") || !props.contains_key("BuildVersion") {
        if let Some(os_build) = envelope.get("OS Build").and_then(value_as_string_opt) {
            if let Some((os, build)) = parse_os_build_string(&os_build) {
                props
                    .entry("OSVersion".to_string())
                    .or_insert(json!(os));
                if !build.is_empty() {
                    props
                        .entry("BuildVersion".to_string())
                        .or_insert(json!(build));
                }
            }
        }
    }
    if let Some(uuid) = envelope.get("UUID").and_then(value_as_string_opt) {
        props
            .entry("RemotectlDeviceUUID".to_string())
            .or_insert(json!(uuid));
    }
    if let Some(services) = envelope.get("Services").and_then(|s| s.as_array()) {
        props.insert("RemotectlServicesCount".into(), json!(services.len()));
    }
}

fn parse_os_build_string(s: &str) -> Option<(String, String)> {
    let s = s.trim();
    if let Some(open) = s.find('(') {
        let os = s[..open].trim().to_string();
        let rest = s[open + 1..].trim_end_matches(')').trim();
        if !os.is_empty() {
            return Some((os, rest.to_string()));
        }
    }
    if !s.is_empty() {
        return Some((s.to_string(), String::new()));
    }
    None
}

fn device_props_usable(props: &Map<String, Value>) -> bool {
    props.contains_key("OSVersion")
        || props.contains_key("ProductVersion")
        || props.contains_key("HumanReadableProductVersionString")
        || props.contains_key("ProductType")
        || props.contains_key("SerialNumber")
        || props.contains_key("UniqueDeviceID")
        || props.contains_key("BuildVersion")
}

fn find_device_props_map(v: &Value) -> Option<&Map<String, Value>> {
    find_map_with_all_keys(v, &["OSVersion", "SerialNumber"])
        .or_else(|| find_map_with_all_keys(v, &["OSVersion", "UniqueDeviceID"]))
        .or_else(|| find_map_with_all_keys(v, &["OSVersion", "BuildVersion"]))
        .or_else(|| find_map_with_all_keys(v, &["ProductVersion", "SerialNumber"]))
        .or_else(|| find_map_with_all_keys(v, &["ProductVersion", "UniqueDeviceID"]))
        .or_else(|| {
            find_map_with_all_keys(
                v,
                &["HumanReadableProductVersionString", "SerialNumber"],
            )
        })
}

fn find_map_with_all_keys<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a Map<String, Value>> {
    match v {
        Value::Object(m) => {
            if keys.iter().all(|k| m.contains_key(*k)) {
                return Some(m);
            }
            for child in m.values() {
                if let Some(inner) = find_map_with_all_keys(child, keys) {
                    return Some(inner);
                }
            }
        }
        Value::Array(a) => {
            for child in a {
                if let Some(inner) = find_map_with_all_keys(child, keys) {
                    return Some(inner);
                }
            }
        }
        _ => {}
    }
    None
}

fn value_as_string_opt(v: &Value) -> Option<String> {
    let s = value_as_string(v);
    if s.is_empty() { None } else { Some(s) }
}

fn value_as_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

fn saf_event_to_timeline_row(parser_id: &str, ev: &Value) -> Option<String> {
    let message = ev.get("message")?.as_str()?;
    let datetime = ev
        .get("datetime")
        .and_then(|d| d.as_str())
        .unwrap_or("");
    let mut map = Map::new();
    map.insert("message".into(), json!(message));
    map.insert("datetime".into(), json!(datetime));
    map.insert("data_type".into(), json!(parser_id));
    map.insert("sysdiagnose_parser".into(), json!(parser_id));
    map.insert("parser".into(), json!(parser_id));
    map.insert(
        "timestamp_desc".into(),
        ev.get("timestamp_desc")
            .cloned()
            .unwrap_or(Value::String(String::new())),
    );
    if let Some(source) = ev.get("source") {
        map.insert("crash_source".into(), source.clone());
    }
    if let Some(data) = ev.get("data") {
        if let Some(obj) = data.as_object() {
            for (k, v) in obj {
                map.insert(k.clone(), v.clone());
            }
        }
    }
    apply_ios_auth_classification(&mut map, message);
    finalize_sysdiagnose_row(parser_id, &mut map);
    serde_json::to_string(&Value::Object(map)).ok()
}

/// Promote structured `.ips` fields from sysdiagnose-extractor-library crashlogs
/// (`threads` / `frames` / nested `report`) onto searchable timeline columns.
fn enrich_crashlog_timeline_fields(map: &mut Map<String, Value>) {
    map.insert("event_type".into(), json!("ios_crash"));

    let report = map.get("report").cloned();
    let report_obj = report.as_ref().and_then(|v| v.as_object());

    if map_str(map, "process_name").is_none() {
        let proc = map_str(map, "procName")
            .or_else(|| report_obj.and_then(|r| obj_str(r, "procName")))
            .or_else(|| map_str(map, "app_name"))
            .or_else(|| map_str(map, "name"));
        if let Some(proc) = proc {
            map.insert("process_name".into(), json!(proc));
        }
    }

    if map_str(map, "bundleIdentifier")
        .or_else(|| map_str(map, "bundleID"))
        .or_else(|| map_str(map, "bundleId"))
        .is_none()
    {
        if let Some(bundle) = report_obj
            .and_then(|r| obj_str(r, "bundleID"))
            .or_else(|| report_obj.and_then(|r| obj_str(r, "bundleIdentifier")))
            .or_else(|| report_obj.and_then(|r| obj_str(r, "coalitionName")))
        {
            map.insert("bundleIdentifier".into(), json!(bundle));
        }
    }

    let signal = map
        .get("exception")
        .and_then(|ex| ex.get("signal"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            report_obj
                .and_then(|r| r.get("exception"))
                .and_then(|ex| ex.get("signal"))
                .and_then(|v| v.as_str())
        })
        .map(str::to_string);
    let exc_type = map
        .get("exception")
        .and_then(|ex| ex.get("type"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            report_obj
                .and_then(|r| r.get("exception"))
                .and_then(|ex| ex.get("type"))
                .and_then(|v| v.as_str())
        })
        .map(str::to_string);
    if let Some(sig) = signal {
        map.insert("signal".into(), json!(sig));
        map.insert("action".into(), json!(sig));
    } else if let Some(ty) = exc_type {
        map.insert("action".into(), json!(ty));
    }

    if map_str(map, "function").is_none() {
        if let Some(sym) = crashlog_faulting_symbol(map) {
            map.insert("function".into(), json!(sym));
            map.insert("symbol".into(), json!(sym));
        }
    }

    if map_str(map, "file_path").is_none() {
        if let Some(path) = map_str(map, "path").or_else(|| map_str(map, "crash_source")) {
            map.insert("file_path".into(), json!(path));
        }
    }
}

fn map_str<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    map.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty())
}

fn obj_str<'a>(obj: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    obj.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty())
}

fn crashlog_faulting_symbol(map: &Map<String, Value>) -> Option<String> {
    let threads = map.get("threads")?.as_array()?;
    let faulting = map.get("faulting_thread").and_then(|v| {
        v.as_u64().or_else(|| v.as_str()?.parse().ok())
    });
    let thread = threads
        .iter()
        .find(|t| t.get("triggered").and_then(|x| x.as_bool()) == Some(true))
        .or_else(|| {
            faulting.and_then(|ft| {
                threads
                    .iter()
                    .find(|t| t.get("id").and_then(|id| id.as_u64()) == Some(ft))
            })
        })
        .or_else(|| threads.first())?;
    let frames = thread.get("frames")?.as_array()?;
    for fr in frames {
        if let Some(sym) = fr.get("symbol").and_then(|s| s.as_str()).filter(|s| !s.is_empty()) {
            return Some(sym.to_string());
        }
        if let Some(img) = fr.get("image").and_then(|s| s.as_str()).filter(|s| !s.is_empty()) {
            return Some(img.to_string());
        }
    }
    None
}

fn parser_type_slug(pt: ParserType) -> String {
    pt.as_str().to_string()
}

fn snapshot_datetime(capture_datetime: Option<&str>) -> &str {
    capture_datetime.unwrap_or("1970-01-01T00:00:00Z")
}

fn emit_snapshot_row(
    parser_id: &str,
    datetime: &str,
    message: &str,
    fields: Map<String, Value>,
    out: &mut Vec<String>,
) {
    let mut map = Map::new();
    map.insert("message".into(), json!(message));
    map.insert("datetime".into(), json!(datetime));
    map.insert("data_type".into(), json!(parser_id));
    map.insert("sysdiagnose_parser".into(), json!(parser_id));
    map.insert("parser".into(), json!(parser_id));
    for (k, v) in fields {
        map.insert(k, v);
    }
    stamp_ios_bundle_id(parser_id, &mut map);
    if let Ok(line) = serde_json::to_string(&Value::Object(map)) {
        out.push(line);
    }
}

fn collect_transparency_json_lines(parser_id: &str, v: &Value, capture_datetime: Option<&str>, out: &mut Vec<String>) {
    if v.get("error").is_some() {
        return;
    }
    let datetime = snapshot_datetime(capture_datetime);
    let mut uris = Vec::new();
    walk_contact_uris(v, &mut uris);
    uris.sort();
    uris.dedup();
    for uri in uris {
        let mut fields = Map::new();
        fields.insert("contact_uri".into(), json!(uri));
        fields.insert(
            "uri_kind".into(),
            json!(if uri.contains("mailto:") { "mailto" } else { "tel" }),
        );
        emit_snapshot_row(
            parser_id,
            datetime,
            &format!("Transparency contact URI {uri}"),
            fields,
            out,
        );
    }
}

fn walk_contact_uris(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => {
            if s.starts_with("im://mailto:") || s.starts_with("im://tel:") {
                out.push(s.clone());
            }
        }
        Value::Object(m) => {
            for child in m.values() {
                walk_contact_uris(child, out);
            }
        }
        Value::Array(a) => {
            for child in a {
                walk_contact_uris(child, out);
            }
        }
        _ => {}
    }
}

fn collect_plist_url_lines(
    parser_id: &str,
    files: &Map<String, Value>,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    let datetime = snapshot_datetime(capture_datetime);
    for (path, plist) in files {
        if plist.get("error").is_some() {
            continue;
        }
        let mut hits = Vec::new();
        walk_plist_network_hits(path, plist, "", &mut hits);
        for (key_path, value) in hits {
            let mut fields = Map::new();
            fields.insert("plist_path".into(), json!(path));
            fields.insert("plist_key".into(), json!(key_path));
            fields.insert("url".into(), json!(value));
            emit_snapshot_row(
                parser_id,
                datetime,
                &format!("Plist URL {path} {key_path}: {value}"),
                fields,
                out,
            );
        }
    }
}

fn walk_plist_network_hits(path: &str, v: &Value, key_path: &str, out: &mut Vec<(String, String)>) {
    match v {
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                return;
            }
            let key_l = key_path.to_ascii_lowercase();
            let path_l = path.to_ascii_lowercase();
            let interesting_key = key_l.contains("url")
                || key_l.contains("quarantine")
                || key_l.contains("host")
                || key_l.contains("server")
                || key_l.contains("proxy");
            let interesting_path = path_l.contains("network")
                || path_l.contains("vpn")
                || path_l.contains("quarantine");
            if t.starts_with("http://")
                || t.starts_with("https://")
                || (interesting_key && (t.contains('.') || t.contains("://")))
                || (interesting_path && t.contains("://"))
            {
                out.push((key_path.to_string(), t.to_string()));
            }
        }
        Value::Object(m) => {
            for (k, child) in m {
                let child_path = if key_path.is_empty() {
                    k.clone()
                } else {
                    format!("{key_path}.{k}")
                };
                walk_plist_network_hits(path, child, &child_path, out);
            }
        }
        Value::Array(a) => {
            for (i, child) in a.iter().enumerate() {
                let child_path = format!("{key_path}[{i}]");
                walk_plist_network_hits(path, child, &child_path, out);
            }
        }
        _ => {}
    }
}

fn collect_network_extension_lines(
    parser_id: &str,
    v: &Value,
    capture_datetime: Option<&str>,
    out: &mut Vec<String>,
) {
    let datetime = snapshot_datetime(capture_datetime);
    let files = match v {
        Value::Object(m) if m.contains_key("files") => m.get("files").and_then(|f| f.as_object()),
        Value::Object(m) => Some(m),
        _ => None,
    };
    let Some(files) = files else {
        return;
    };
    for (path, plist) in files {
        if plist.get("error").is_some() {
            continue;
        }
        let mut hints = Vec::new();
        walk_network_extension_hints(plist, "", &mut hints);
        if hints.is_empty() {
            emit_snapshot_row(
                parser_id,
                datetime,
                &format!("Network extension plist {path}"),
                Map::from_iter([
                    ("plist_path".into(), json!(path)),
                    ("section".into(), json!("network_extension")),
                ]),
                out,
            );
            continue;
        }
        for (key_path, value) in hints {
            let mut fields = Map::new();
            fields.insert("plist_path".into(), json!(path));
            fields.insert("plist_key".into(), json!(key_path));
            fields.insert("network_hint".into(), json!(value));
            if value.parse::<std::net::IpAddr>().is_ok() {
                fields.insert("dest_ip".into(), json!(value));
            } else if value.contains('.') {
                fields.insert("destination_domain".into(), json!(value));
            }
            emit_snapshot_row(
                parser_id,
                datetime,
                &format!("Network extension {path} {key_path}: {value}"),
                fields,
                out,
            );
        }
    }
}

fn walk_network_extension_hints(v: &Value, key_path: &str, out: &mut Vec<(String, String)>) {
    match v {
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                return;
            }
            let key_l = key_path.to_ascii_lowercase();
            if key_l.contains("hostname")
                || key_l.contains("host")
                || key_l.contains("server")
                || key_l.contains("address")
                || key_l.contains("proxy")
                || key_l.contains("vpn")
                || key_l.contains("remote")
                || key_l.contains("url")
            {
                out.push((key_path.to_string(), t.to_string()));
            }
        }
        Value::Object(m) => {
            for (k, child) in m {
                let child_path = if key_path.is_empty() {
                    k.clone()
                } else {
                    format!("{key_path}.{k}")
                };
                walk_network_extension_hints(child, &child_path, out);
            }
        }
        Value::Array(a) => {
            for (i, child) in a.iter().enumerate() {
                walk_network_extension_hints(child, &format!("{key_path}[{i}]"), out);
            }
        }
        _ => {}
    }
}

fn finalize_sysdiagnose_row(parser_id: &str, map: &mut Map<String, Value>) {
    if parser_id == "crashlogs" {
        enrich_crashlog_timeline_fields(map);
    }
    if parser_id == "shutdownlogs" {
        enrich_shutdownlogs_timeline_fields(map);
    }
    alias_sysdiagnose_fields(map);
    if parser_id == "powerlogs" {
        enrich_powerlogs_battery_fields(map);
        enrich_powerlogs_lock_state_fields(map);
    }
    if parser_id == "knowledgec" {
        enrich_knowledgec_lock_state_fields(map);
    }
    stamp_ios_bundle_id(parser_id, map);
    if parser_id == "mobileinstallation" {
        // Reuse library stamp so prose like "version does" never becomes a version.
        let mut wrapped = Value::Object(map.clone());
        enrich_mobile_installation_event(&mut wrapped);
        if let Value::Object(enriched) = wrapped {
            *map = enriched;
        }
    }
}

/// Promote shutdown client fields for search / iOS process-events panel.
fn enrich_shutdownlogs_timeline_fields(map: &mut Map<String, Value>) {
    map.insert("event_type".into(), json!("ios_shutdown_client"));

    if map_str(map, "process_name").is_none() {
        if let Some(cmd) = map_str(map, "command") {
            map.insert("process_name".into(), json!(cmd));
        }
    }

    if map.get("process_id").is_none() {
        let pid_val = map.get("pid").cloned();
        if let Some(pid) = pid_val {
            let n = pid
                .as_i64()
                .or_else(|| pid.as_u64().map(|u| u as i64))
                .or_else(|| pid.as_str().and_then(|s| s.trim().parse::<i64>().ok()));
            if let Some(n) = n {
                map.insert("process_id".into(), json!(n));
                if !pid.is_number() {
                    map.insert("pid".into(), json!(n));
                }
            }
        }
    }

    if map_str(map, "path").is_none() {
        if let Some(exe) = map_str(map, "executable_path") {
            map.insert("path".into(), json!(exe));
        }
    }
}

fn alias_sysdiagnose_fields(map: &mut Map<String, Value>) {
    const ALIASES: &[(&str, &str)] = &[
        ("BUNDLE ID", "bundle_id"),
        ("PROCESS NAME", "process_name"),
        ("CLIENT", "client"),
        ("SERVICE", "service"),
        // powerlogs Battery Level (APOLLO column titles → searchable snake_case)
        ("RAW LEVEL", "raw_level"),
        ("raw level", "raw_level"),
        ("RAWLEVEL", "raw_level"),
        ("LEVEL", "level"),
        ("IS CHARGING", "is_charging"),
        ("is charging", "is_charging"),
        ("FULLY CHARGED", "fully_charged"),
        ("fully charged", "fully_charged"),
        // powerlogs / knowledgec lock state
        ("LOCK STATUS", "lock_status"),
        ("lock status", "lock_status"),
        ("IS LOCKED", "is_locked"),
        ("is locked", "is_locked"),
        ("AUTO LOCK TYPE", "auto_lock_type"),
        ("auto lock type", "auto_lock_type"),
        ("ADJUSTED_TIMESTAMP", "adjusted_timestamp"),
        ("adjusted_timestamp", "adjusted_timestamp"),
    ];
    for (from, to) in ALIASES {
        if !map.contains_key(*to) {
            if let Some(v) = map.get(*from).cloned() {
                map.insert((*to).into(), v);
            }
        }
    }
}

/// Ensure powerlogs Battery Level rows expose numeric `raw_level` / `level` for charts.
fn enrich_powerlogs_battery_fields(map: &mut Map<String, Value>) {
    let desc = map
        .get("timestamp_desc")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let message = map
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let is_battery_level =
        desc.eq_ignore_ascii_case("Battery Level") || message.starts_with("Battery Level:");
    if !is_battery_level {
        return;
    }
    if map.get("timestamp_desc").and_then(|v| v.as_str()).is_none() {
        map.insert("timestamp_desc".into(), json!("Battery Level"));
    }
    // Prefer already-aliased numeric fields; fall back to message scrape for resilience.
    if map.get("raw_level").is_none() {
        if let Some(n) = scrape_message_float(&message, "RAW LEVEL") {
            map.insert("raw_level".into(), json!(n));
        }
    }
    if map.get("level").is_none() {
        if let Some(n) = scrape_message_float(&message, "LEVEL") {
            map.insert("level".into(), json!(n));
        }
    }
}

fn scrape_message_float(message: &str, key: &str) -> Option<f64> {
    // Match `KEY=` only at attribute boundaries so LEVEL does not hit RAW LEVEL.
    let patterns = [
        format!(", {key}="),
        format!(": {key}="),
        format!(":{key}="),
    ];
    let rest = patterns
        .iter()
        .find_map(|needle| message.split(needle.as_str()).nth(1))?;
    let token = rest
        .split(',')
        .next()?
        .trim()
        .split_whitespace()
        .next()?;
    token.parse().ok()
}

fn datetime_missing(map: &Map<String, Value>) -> bool {
    map.get("datetime")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
}

fn looks_like_wall_datetime(s: &str) -> bool {
    let t = s.trim();
    if t.is_empty() || t.starts_with("1970-") {
        return false;
    }
    t.len() >= 19 && t.as_bytes().get(4) == Some(&b'-')
}

/// Lock / unlock Apollo rows: promote `datetime` from adjusted timestamp and keep
/// `lock_status` searchable for the Authentication tab.
fn enrich_powerlogs_lock_state_fields(map: &mut Map<String, Value>) {
    let desc = map
        .get("timestamp_desc")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let message = map
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let apollo = map
        .get("apollo_module")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let is_lock = desc == "lock state"
        || desc == "screen unlock state"
        || message.starts_with("Lock State:")
        || message.starts_with("Screen Unlock State:")
        || apollo == "powerlog_device_lock_state"
        || apollo == "powerlog_device_screen_autolock";
    if !is_lock {
        return;
    }

    if datetime_missing(map) {
        for key in [
            "adjusted_timestamp",
            "ADJUSTED_TIMESTAMP",
            "adjusted timestamp",
        ] {
            if let Some(raw) = map.get(key).and_then(|v| v.as_str()) {
                if looks_like_wall_datetime(raw) {
                    let iso = if raw.contains('T') {
                        raw.to_string()
                    } else {
                        format!("{}Z", raw.trim().replace(' ', "T"))
                    };
                    map.insert("datetime".into(), json!(iso));
                    break;
                }
            }
        }
    }

    if map.get("event_type").is_none() {
        map.insert("event_type".into(), json!("ios_lock_state"));
    }
}

fn enrich_knowledgec_lock_state_fields(map: &mut Map<String, Value>) {
    let desc = map
        .get("timestamp_desc")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let message = map
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let apollo = map
        .get("apollo_module")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let is_lock = desc == "device lock status"
        || desc == "keybag lock status"
        || message.starts_with("Device Lock Status:")
        || message.starts_with("Keybag Lock Status:")
        || apollo.contains("device_locked")
        || apollo.contains("keybag_locked");
    if !is_lock {
        return;
    }
    if map.get("event_type").is_none() {
        map.insert("event_type".into(), json!("ios_lock_state"));
    }
}

/// Canonicalize / extract `bundle_id` so inventory consumers can trust the field.
fn stamp_ios_bundle_id(parser_id: &str, map: &mut Map<String, Value>) {
    const EXTRACT_FROM_MESSAGE: &[&str] = &[
        "mobileinstallation",
        "appinstallation",
        "accessibility_tcc",
        "itunesstore",
        "mobilebackup",
        "powerlogs",
        "plists",
    ];

    const FIELD_KEYS: &[&str] = &[
        "bundle_id",
        "bundleid",
        "CFBundleIdentifier",
        "zbundleid",
        "ztargetbundleid",
        "softwareversionbundleid",
        "application_id",
        "application_identifier",
        "target_bundle_id",
        "client",
    ];

    for key in FIELD_KEYS {
        let Some(raw) = map.get(*key).and_then(|v| v.as_str()) else {
            continue;
        };
        if raw.trim().is_empty() {
            continue;
        }
        if let Some(id) = canonicalize_app_bundle_id(raw) {
            map.insert("bundle_id".into(), json!(id));
            return;
        }
    }

    if EXTRACT_FROM_MESSAGE.contains(&parser_id) {
        if let Some(message) = map.get("message").and_then(|v| v.as_str()) {
            if let Some(id) = extract_app_bundle_id_from_text(message) {
                map.insert("bundle_id".into(), json!(id));
                return;
            }
        }
    }

    // Drop invalid ids so the web UI does not need false-positive filters.
    if let Some(Value::String(s)) = map.get("bundle_id") {
        if !s.trim().is_empty() && canonicalize_app_bundle_id(s).is_none() {
            map.insert("bundle_id".into(), json!(""));
        }
    }
}

fn generic_event_to_timeline_row(
    parser_id: &str,
    ev: &Value,
    capture_datetime: Option<&str>,
) -> Option<String> {
    if ev.get("format").and_then(|x| x.as_str()) == Some("summary_text") {
        return None;
    }

    let message = ev
        .get("message")
        .and_then(|m| m.as_str())
        .map(str::to_string)
        .or_else(|| crashlog_message(ev))
        .filter(|m| !m.is_empty())?;

    let datetime = ev
        .get("datetime")
        .and_then(|d| d.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| snapshot_datetime(capture_datetime));

    let mut map = Map::new();
    map.insert("message".into(), json!(message));
    map.insert("datetime".into(), json!(datetime));
    map.insert("data_type".into(), json!(parser_id));
    map.insert("sysdiagnose_parser".into(), json!(parser_id));
    map.insert("parser".into(), json!(parser_id));
    if let Some(desc) = ev.get("timestamp_desc") {
        map.insert("timestamp_desc".into(), desc.clone());
    }
    if let Some(obj) = ev.as_object() {
        for (k, v) in obj {
            if k != "data" {
                map.insert(k.clone(), v.clone());
            }
        }
    }
    if let Some(data) = ev.get("data").and_then(|d| d.as_object()) {
        for (k, v) in data {
            map.insert(k.clone(), v.clone());
        }
    }
    finalize_sysdiagnose_row(parser_id, &mut map);
    serde_json::to_string(&Value::Object(map)).ok()
}

fn crashlog_message(ev: &Value) -> Option<String> {
    let data = ev.get("data")?;
    if let Some(reason) = data
        .pointer("/report/reason")
        .or_else(|| data.get("reason"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return Some(format!("Crashlog: {reason}"));
    }
    let bundle = data
        .get("procName")
        .or_else(|| data.pointer("/report/procName"))
        .or_else(|| data.get("bundleIdentifier"))
        .or_else(|| data.get("bundleID"))
        .or_else(|| data.get("bundleId"))
        .or_else(|| data.get("app_name"))
        .or_else(|| data.get("name"))
        .or_else(|| data.pointer("/identity/identity"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown app");
    let signal = data
        .pointer("/exception/signal")
        .or_else(|| data.pointer("/report/exception/signal"))
        .or_else(|| data.pointer("/exception/type"))
        .or_else(|| data.pointer("/report/exception/type"))
        .and_then(|v| v.as_str())
        .unwrap_or("crash");
    Some(format!("Crashlog: {bundle} ({signal})"))
}

fn row_object_to_line(
    parser_id: &str,
    obj: &Map<String, Value>,
    capture_datetime: Option<&str>,
) -> String {
    let message = obj
        .get("command")
        .or_else(|| obj.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or(parser_id);
    let mut map = Map::new();
    map.insert("message".into(), json!(message));
    map.insert(
        "datetime".into(),
        json!(obj
            .get("datetime")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| snapshot_datetime(capture_datetime))),
    );
    map.insert("data_type".into(), json!(parser_id));
    map.insert("sysdiagnose_parser".into(), json!(parser_id));
    map.insert("parser".into(), json!(parser_id));
    for (k, v) in obj {
        map.insert(k.clone(), v.clone());
    }
    finalize_sysdiagnose_row(parser_id, &mut map);
    serde_json::to_string(&Value::Object(map)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;
    use sysdiagnose_extractor_library::{Analyser, SysdiagnoseArchive};

    #[test]
    fn capture_datetime_from_archive_filename() {
        let path = Path::new(
            "/data/sysdiagnose_2026.04.10_12-57-08+0200_iPhone-OS_iPhone_23E246.tar.gz",
        );
        assert_eq!(
            capture_datetime_from_sysdiagnose_path(path).as_deref(),
            Some("2026-04-10T12:57:08Z")
        );
    }

    #[test]
    fn capture_datetime_from_sanitized_blob_filename() {
        let path = Path::new(
            "/data/sysdiagnose_2026.04.10_12-57-08_0200_iPhone-OS_iPhone_23E246.tar.gz",
        );
        assert_eq!(
            capture_datetime_from_sysdiagnose_path(path).as_deref(),
            Some("2026-04-10T12:57:08Z")
        );
    }

    #[test]
    fn flattens_remotectl_device_block_with_build_only() {
        let parsed = json!({
            "parser": "remotectl_dumpstate",
            "data": {
                "Device": {
                    "OSVersion": "18.0",
                    "BuildVersion": "22A335",
                    "ProductType": "iPhone16,1",
                }
            }
        });
        let mut lines = Vec::new();
        collect_events_from_parser(
            "remotectl_dumpstate",
            &parsed,
            Some("2026-04-10T12:57:08Z"),
            &mut lines,
        );
        assert_eq!(lines.len(), 1);
        let row: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(row["os_version"], "18.0");
        assert_eq!(row["device_model"], "iPhone16,1");
    }

    #[test]
    fn flattens_remotectl_local_device_properties_block() {
        let parsed = json!({
            "parser": "remotectl_dumpstate",
            "data": {
                "Local device": {
                    "OS Build": "26.3 (23D127)",
                    "Product Type": "iPhone18,3",
                    "Properties": {
                        "BuildVersion": "23D127",
                        "HumanReadableProductVersionString": "26.3",
                        "OSVersion": "26.3",
                        "ProductName": "iPhone OS",
                        "ProductType": "iPhone18,3",
                        "SerialNumber": "KXKW2NH09M",
                        "UniqueDeviceID": "00008150-000A62342613401C",
                        "CPUArchitecture": "arm64e",
                        "HWModel": "V57AP",
                    }
                }
            }
        });
        let mut lines = Vec::new();
        collect_events_from_parser(
            "remotectl_dumpstate",
            &parsed,
            Some("2026-04-07T15:01:20Z"),
            &mut lines,
        );
        assert_eq!(lines.len(), 1, "expected device_metadata row: {lines:?}");
        let row: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(row["event_type"], "device_metadata");
        assert_eq!(row["os_version"], "26.3");
        assert_eq!(row["device_model"], "iPhone18,3");
        assert_eq!(row["serial"], "KXKW2NH09M");
        assert_eq!(row["build_version"], "23D127");
        assert_eq!(row["CPUArchitecture"], "arm64e");
    }

    #[test]
    fn flattens_remotectl_double_nested_local_device() {
        let parsed = json!({
            "parser": "remotectl_dumpstate",
            "data": {
                "data": {
                    "Local device": {
                        "OS Build": "26.3 (23D127)",
                        "Product Type": "iPhone18,3",
                        "UUID": "D43E0CA8-67F1-4AA8-832E-608BC09840A1",
                        "Services": ["com.apple.sysdiagnose.remote"],
                        "Properties": {
                            "OSVersion": "26.3",
                            "SerialNumber": "KXKW2NH09M",
                            "ProductType": "iPhone18,3",
                        }
                    }
                }
            }
        });
        let mut lines = Vec::new();
        collect_events_from_parser(
            "remotectl_dumpstate",
            &parsed,
            Some("2026-04-07T15:01:20Z"),
            &mut lines,
        );
        assert_eq!(lines.len(), 1);
        let row: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(row["device_model"], "iPhone18,3");
        assert_eq!(row["serial"], "KXKW2NH09M");
        assert_eq!(row["RemotectlServicesCount"], "1");
    }

    #[test]
    fn flattens_remotectl_device_block() {
        let parsed = json!({
            "parser": "remotectl_dumpstate",
            "data": {
                "Device": {
                    "OSVersion": "17.2.1",
                    "BuildVersion": "21C62",
                    "ProductName": "iPhone OS",
                    "ProductType": "iPhone15,2",
                    "SerialNumber": "GOLDEN123",
                    "UniqueDeviceID": "00000000-1111-2222-3333-444444444444"
                }
            }
        });
        let mut lines = Vec::new();
        collect_events_from_parser(
            "remotectl_dumpstate",
            &parsed,
            Some("2026-04-10T12:57:08Z"),
            &mut lines,
        );
        assert_eq!(lines.len(), 1);
        let row: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(row["parser"], "remotectl_dumpstate");
        assert_eq!(row["os_version"], "17.2.1");
        assert_eq!(row["device_model"], "iPhone15,2");
        assert_eq!(row["serial"], "GOLDEN123");
        assert_eq!(row["unique_device_id"], "00000000-1111-2222-3333-444444444444");
    }

    #[test]
    fn flattens_transparency_contact_uris() {
        let parsed = json!({
            "stateMachine": {
                "ops": {
                    "owner": "im://mailto:alice@example.com"
                }
            }
        });
        let mut lines = Vec::new();
        collect_events_from_parser(
            "transparency_json",
            &parsed,
            Some("2026-04-10T12:57:08Z"),
            &mut lines,
        );
        assert_eq!(lines.len(), 1);
        let row: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(row["contact_uri"], "im://mailto:alice@example.com");
    }

    #[test]
    fn flattens_plist_urls() {
        let parsed = json!({
            "parser": "plists",
            "files": {
                "Quarantine.plist": {
                    "LSQuarantineURL": "https://evil.example/path"
                }
            },
            "meta": {}
        });
        let mut lines = Vec::new();
        collect_events_from_parser("plists", &parsed, Some("2026-04-10T12:57:08Z"), &mut lines);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("https://evil.example/path"));
    }

    #[test]
    fn stamp_canonicalizes_and_extracts_bundle_id() {
        let mut map = Map::new();
        map.insert(
            "message".into(),
            json!(
                "Staging <MIInstallableBundle ID=com.cbouvat.saracroche.blocker; Version=1>"
            ),
        );
        stamp_ios_bundle_id("mobileinstallation", &mut map);
        assert_eq!(map.get("bundle_id").and_then(|v| v.as_str()), Some("com.cbouvat.saracroche"));

        let mut noisy = Map::new();
        noisy.insert("bundle_id".into(), json!("portal.manage.microsoft.com"));
        noisy.insert(
            "message".into(),
            json!("Plist URL logs/parsecd/config.plist: https://cdn.smoot.apple.com/image/clock_1x.png"),
        );
        stamp_ios_bundle_id("plists", &mut noisy);
        assert_eq!(noisy.get("bundle_id").and_then(|v| v.as_str()), Some(""));
    }

    #[test]
    fn finalize_mobileinstallation_stamps_versions_not_prose() {
        let mut good = Map::new();
        good.insert(
            "message".into(),
            json!(
                "Staging <MIInstallableBundle ID=org.whispersystems.signal; Version=1, ShortVersion=7.12.0>"
            ),
        );
        finalize_sysdiagnose_row("mobileinstallation", &mut good);
        assert_eq!(good.get("short_version").and_then(|v| v.as_str()), Some("7.12.0"));
        assert_eq!(
            good.get("CFBundleShortVersionString").and_then(|v| v.as_str()),
            Some("7.12.0")
        );

        let mut prose = Map::new();
        prose.insert(
            "message".into(),
            json!("Install requested; version does not match existing container"),
        );
        prose.insert("short_version".into(), json!("does"));
        finalize_sysdiagnose_row("mobileinstallation", &mut prose);
        assert!(prose.get("short_version").is_none());
        assert!(prose.get("version").is_none());
    }

    #[test]
    fn flattens_network_iocs_hits() {
        let parsed = HashMap::from([(
            "powerlogs".to_string(),
            json!({
                "parser": "powerlogs",
                "events": [{
                    "data": {
                        "server ip": "203.0.113.10",
                        "serverhostname": "push.apple.com"
                    }
                }]
            }),
        )]);
        let arch = SysdiagnoseArchive::from_files_for_test(HashMap::new());
        let mut lines = Vec::new();
        let analyser = BuiltinAnalyser(AnalyserType::network_iocs);
        let iocs = analyser.analyse(&arch, &parsed).unwrap();
        collect_network_iocs_lines(&iocs, Some("2026-04-10T12:57:08Z"), &mut lines);
        assert!(!lines.is_empty());
        assert!(lines.iter().any(|l| l.contains("203.0.113.10")));
    }

    #[test]
    fn flattens_ioservice_compact_preview() {
        let parsed = json!({
            "parser": "ioservice",
            "format": "compact",
            "summary": {
                "source_path": "ioreg/IOService.txt",
                "node_count": 42,
                "property_count": 120
            },
            "device_properties": {
                "IOPlatformSerialNumber": "ABC123",
                "model": "iPhone"
            },
            "meta": { "tree_truncated": true }
        });
        let mut lines = Vec::new();
        collect_events_from_parser(
            "ioservice",
            &parsed,
            Some("2026-04-10T12:57:08Z"),
            &mut lines,
        );
        assert_eq!(lines.len(), 2);
        assert!(lines.iter().any(|l| l.contains("ioservice_summary")));
        assert!(lines.iter().any(|l| l.contains("device_properties")));
    }

    #[test]
    fn flattens_iousb_tree_into_device_events() {
        let parsed = json!({
            "parser": "iousb",
            "tree": {
                "class": "IORegistryRoot",
                "AppleUSBXHCI Root Hub Simulation@14000000": {
                    "class": "IOUSBHostDevice",
                    "USB Product Name": "USB2.0 Hub",
                    "USB Vendor Name": "Apple Inc.",
                    "idVendor": "<ac050000>",
                    "idProduct": "<01080000>",
                    "PortNum": 1,
                    "Composite Device@14100000": {
                        "class": "IOUSBHostDevice",
                        "USB Product Name": "iPhone",
                        "USB Vendor Name": "Apple Inc.",
                        "idVendor": "0x5ac",
                        "idProduct": "0x12a8",
                        "USB Serial Number": "ABC123"
                    }
                },
                "noise": { "class": "Other", "foo": "bar" }
            }
        });
        let mut lines = Vec::new();
        collect_events_from_parser("iousb", &parsed, Some("2026-04-10T12:57:08Z"), &mut lines);
        assert!(lines.len() >= 2, "expected summary + devices, got {}", lines.len());
        assert!(lines.iter().any(|l| l.contains("iousb_summary")));
        assert!(lines.iter().any(|l| l.contains("USB2.0 Hub")));
        assert!(lines.iter().any(|l| l.contains("iPhone")));
        assert!(lines.iter().any(|l| l.contains("0x05ac") || l.contains("0x5ac")));
        assert!(lines.iter().any(|l| l.contains(r#""parser":"iousb""#)));
    }

    #[test]
    fn flattens_logarchive_inventory_and_macos_unifiedlogs_events() {
        let parsed = json!({
            "parser": "logarchive",
            "inventory": { "file_count": 3, "total_bytes": 999 },
            "decode": "success",
            "decode_meta": {
                "status": "success",
                "event_count": 1,
                "max_lines": 2500,
                "tool": "macos-unifiedlogs"
            },
            "format": "jsonl",
            "events": [{
                "message": "connection to 203.0.113.1",
                "datetime": "2026-04-10T12:57:08+00:00",
                "timestamp_desc": "Unified Log",
                "module": "logarchive",
                "data": {
                    "subsystem": "com.apple.network",
                    "category": "connection",
                    "process": "kernel_task",
                    "pid": 0
                }
            }]
        });
        let mut lines = Vec::new();
        collect_events_from_parser(
            "logarchive",
            &parsed,
            Some("2026-04-10T12:57:08Z"),
            &mut lines,
        );
        assert_eq!(lines.len(), 2);
        assert!(lines.iter().any(|l| l.contains("logarchive_inventory")));
        assert!(lines.iter().any(|l| l.contains("macos-unifiedlogs")));
        let event: Value = serde_json::from_str(lines.iter().find(|l| l.contains("203.0.113.1")).unwrap()).unwrap();
        assert_eq!(event["event_type"], "logarchive_event");
        assert_eq!(event["logarchive_tool"], "macos-unifiedlogs");
        assert_eq!(event["bundle_id"], "com.apple.network");
    }

    #[test]
    fn flattens_logarchive_decode_failure_inventory() {
        let parsed = json!({
            "parser": "logarchive",
            "inventory": { "file_count": 2 },
            "decode": "failed",
            "decode_meta": {
                "status": "failed",
                "tool": "macos-unifiedlogs",
                "reason": "collect_timesync failed"
            }
        });
        let mut lines = Vec::new();
        collect_events_from_parser(
            "logarchive",
            &parsed,
            Some("2026-04-10T12:57:08Z"),
            &mut lines,
        );
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("decode failed"));
        assert!(lines[0].contains("macos-unifiedlogs"));
    }

    #[test]
    fn appends_lockdownd_device_metadata_when_remotectl_missing() {
        let results: Vec<(ParserType, Result<Value, Box<dyn std::error::Error + Send + Sync>>, std::time::Duration)> =
            vec![(
                ParserType::lockdownd,
                Ok(json!({
                    "parser": "lockdownd",
                    "format": "jsonl",
                    "events": [
                        { "message": "product_type: iPhone18,3", "datetime": "2026-04-07T15:01:20Z" },
                        { "message": "Build version: 23D127", "datetime": "2026-04-07T15:01:20Z" },
                        { "message": "Pair message: {\n    SerialNumber = KXKW2NH09M;\n}", "datetime": "2026-04-07T15:01:20Z" }
                    ]
                })),
                std::time::Duration::from_millis(1),
            )];
        let mut lines = Vec::new();
        for (pt, result, _) in &results {
            let Ok(v) = result else { continue };
            collect_events_from_parser(&parser_type_slug(*pt), v, Some("2026-04-07T15:01:20Z"), &mut lines);
        }
        append_lockdownd_device_metadata(&results, Some("2026-04-07T15:01:20Z"), &mut lines);
        let device_line = lines
            .iter()
            .find(|l| l.contains(r#""event_type":"device_metadata""#))
            .expect("device_metadata row");
        assert!(device_line.contains(r#""parser":"lockdownd""#));
        assert!(device_line.contains("iPhone18,3"));
        assert!(device_line.contains("23D127"));
        assert!(device_line.contains("KXKW2NH09M"));
    }

    #[test]
    fn appends_ps_everywhere_merged_process_rows() {
        let results: Vec<(ParserType, Result<Value, Box<dyn std::error::Error + Send + Sync>>, std::time::Duration)> =
            vec![
                (
                    ParserType::ps,
                    Ok(json!({
                        "parser": "ps",
                        "rows": [{
                            "user": "root",
                            "uid": 0,
                            "pid": 298,
                            "ppid": 1,
                            "command": "sshd: root@ttys000",
                            "name": "sshd",
                            "process_name": "sshd"
                        }]
                    })),
                    std::time::Duration::from_millis(1),
                ),
                (
                    ParserType::taskinfo,
                    Ok(json!({
                        "parser": "taskinfo",
                        "events": [{
                            "datetime": "2023-05-24T20:27:46Z",
                            "timestamp_desc": "process start time",
                            "message": "sshd started",
                            "data": {
                                "name": "sshd",
                                "process": "sshd",
                                "pid": 298,
                                "run time": "92 s",
                                "threads": [{"thread ID": "0x1"}]
                            }
                        }]
                    })),
                    std::time::Duration::from_millis(1),
                ),
                (
                    ParserType::spindumpnosymbols,
                    Ok(json!({
                        "parser": "spindumpnosymbols",
                        "format": "jsonl",
                        "events": [{
                            "datetime": "2023-05-24T20:28:00Z",
                            "timestamp_desc": "process running during spindump",
                            "message": "/usr/sbin/sshd [298] as 0 parent=launchd",
                            "data": {
                                "process": "sshd",
                                "pid": 298,
                                "uid": 0,
                                "parent": "launchd [1]",
                                "parent_pid": 1,
                                "path": "/usr/sbin/sshd",
                                "footprint": "1840 KB",
                                "time_since_fork": "89s"
                            }
                        }]
                    })),
                    std::time::Duration::from_millis(1),
                ),
            ];
        let arch = SysdiagnoseArchive::from_files_for_test(HashMap::new());
        let mut results = results;
        let jsonl = flatten_parse_results_to_jsonl(&mut results, Some("2023-05-24T21:00:00Z"), Some(&arch));
        assert!(jsonl.contains(r#""parser":"ps_everywhere""#));
        assert!(jsonl.contains(r#""process_name":"sshd""#));
        assert!(jsonl.contains(r#""process_id":298"#));
        assert!(jsonl.contains(r#""user":"root""#));
        assert!(jsonl.contains(r#""uid":0"#));
        assert!(jsonl.contains(r#""parent_pid":1"#));
        assert!(jsonl.contains(r#""file_path":"/usr/sbin/sshd""#) || jsonl.contains(r#""path":"/usr/sbin/sshd""#));
        assert!(jsonl.contains(r#""parent":"launchd [1]""#));
        assert!(
            jsonl.contains(r#""run_time":"92 s""#) || jsonl.contains(r#""run time":"92 s""#),
            "run_time should be hoisted flat"
        );
        assert!(jsonl.contains(r#""time_since_fork":"89s""#));
        assert!(
            !jsonl.contains(r#""ext":{"#),
            "ps_everywhere must not nest forensic fields under ext"
        );
    }

    #[test]
    fn appends_uuid2path_rows() {
        let results: Vec<(ParserType, Result<Value, Box<dyn std::error::Error + Send + Sync>>, std::time::Duration)> =
            vec![(
                ParserType::uuid2path,
                Ok(json!({
                    "logs/tailspindb/UUIDToBinaryLocations": {
                        "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE": "/usr/libexec/exampled"
                    }
                })),
                std::time::Duration::from_millis(1),
            )];
        let arch = SysdiagnoseArchive::from_files_for_test(HashMap::new());
        let mut results = results;
        let jsonl = flatten_parse_results_to_jsonl(&mut results, Some("2023-05-24T21:00:00Z"), Some(&arch));
        assert!(jsonl.contains(r#""parser":"uuid2path""#));
        assert!(jsonl.contains("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"));
        assert!(jsonl.contains("/usr/libexec/exampled"));
    }

    #[test]
    fn flattens_powerlogs_battery_level_promotes_raw_level() {
        let parsed = json!({
            "parser": "powerlogs",
            "events": [{
                "datetime": "2024-05-24T10:00:00Z",
                "message": "Battery Level: LEVEL=80, RAW LEVEL=79.5, IS CHARGING=1",
                "timestamp_desc": "Battery Level",
                "data": {
                    "LEVEL": 80,
                    "RAW LEVEL": 79.5,
                    "IS CHARGING": 1
                }
            }]
        });
        let mut lines = Vec::new();
        collect_events_from_parser("powerlogs", &parsed, Some("2024-05-24T12:00:00Z"), &mut lines);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains(r#""raw_level":79.5"#) || lines[0].contains(r#""raw_level": 79.5"#));
        assert!(lines[0].contains(r#""timestamp_desc":"Battery Level""#) || lines[0].contains(r#""timestamp_desc": "Battery Level""#));
        assert!(lines[0].contains(r#""level":80"#) || lines[0].contains(r#""level": 80"#));
    }

    #[test]
    fn flattens_powerlogs_lock_state_fills_datetime_and_event_type() {
        let parsed = json!({
            "parser": "powerlogs",
            "events": [{
                "datetime": "",
                "timestamp_desc": "Lock State",
                "message": "Lock State: lock status=DEVICE LOCKED",
                "data": {
                    "apollo_module": "powerlog_device_lock_state",
                    "adjusted_timestamp": "2026-08-03 12:50:42",
                    "lock status": "DEVICE LOCKED"
                }
            }]
        });
        let mut lines = Vec::new();
        collect_events_from_parser("powerlogs", &parsed, Some("2026-08-03T14:00:00Z"), &mut lines);
        assert_eq!(lines.len(), 1);
        assert!(
            lines[0].contains(r#""datetime":"2026-08-03T12:50:42Z""#)
                || lines[0].contains(r#""datetime": "2026-08-03T12:50:42Z""#)
        );
        assert!(lines[0].contains("ios_lock_state"));
        assert!(lines[0].contains("DEVICE LOCKED") || lines[0].contains("lock_status"));
    }

    #[test]
    fn flattens_psthread_entries_like_ps_rows() {
        let parsed = json!({
            "parser": "psthread",
            "entries": [{
                "user": "mobile",
                "pid": 42,
                "command": "SpringBoard",
                "message": "SpringBoard [42] as mobile"
            }]
        });
        let mut lines = Vec::new();
        collect_events_from_parser("psthread", &parsed, Some("2026-04-07T15:01:20Z"), &mut lines);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("SpringBoard"));
        assert!(lines[0].contains(r#""pid":42"#));
    }

    #[test]
    fn flattens_shutdownlogs_and_crashlogs_events() {
        let shutdown = json!({
            "parser": "shutdownlogs",
            "events": [{
                "datetime": "2026-04-07T15:01:20Z",
                "message": "SpringBoard is still there during shutdown after 3s",
                "timestamp_desc": "process running at shutdown",
                "data": { "pid": "42", "command": "SpringBoard", "time_waiting": 3.0 }
            }]
        });
        // Current extractor shape: format=jsonl + SAF event dict with nested report/threads.
        let crash = json!({
            "parser": "crashlogs",
            "format": "jsonl",
            "events": [{
                "module": "crashlogs",
                "datetime": "2023-05-24T13:08:25.000000Z",
                "message": "Crashlog: palera1nHelper",
                "timestamp_desc": "crashlog",
                "source": "crashes_and_spins/palera1nHelper-2023-05-24-130825.ips",
                "data": {
                    "name": "palera1nHelper",
                    "app_name": "palera1nHelper",
                    "bundleIdentifier": "com.example.app",
                    "ips_format": "two_part_json",
                    "faulting_thread": 0,
                    "exception": { "type": "EXC_CRASH", "signal": "SIGABRT" },
                    "report": {
                        "procName": "palera1nHelper",
                        "exception": { "type": "EXC_CRASH", "signal": "SIGABRT" }
                    },
                    "threads": [{
                        "id": 0,
                        "triggered": true,
                        "frames": [{ "symbol": "main", "image": "palera1nHelper" }]
                    }]
                }
            }]
        });
        let mut lines = Vec::new();
        collect_events_from_parser("shutdownlogs", &shutdown, Some("2026-04-07T15:01:20Z"), &mut lines);
        collect_events_from_parser("crashlogs", &crash, Some("2026-04-07T15:01:20Z"), &mut lines);
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("shutdown"));
        assert!(lines[0].contains(r#""process_name":"SpringBoard""#) || lines[0].contains(r#""process_name": "SpringBoard""#));
        assert!(lines[0].contains(r#""process_id":42"#) || lines[0].contains(r#""process_id": 42"#));
        assert!(lines[0].contains(r#""event_type":"ios_shutdown_client""#) || lines[0].contains(r#""event_type": "ios_shutdown_client""#));
        assert!(lines[1].contains("ios_crash"));
        assert!(lines[1].contains("com.example.app"));
        assert!(lines[1].contains("SIGABRT"));
        assert!(lines[1].contains("palera1nHelper"));
        assert!(lines[1].contains(r#""function":"main""#) || lines[1].contains(r#""function": "main""#));
        assert!(lines[1].contains(r#""process_name":"palera1nHelper""#) || lines[1].contains(r#""process_name": "palera1nHelper""#));
    }

    #[test]
    fn flattens_shutdownlogs_uuid_client_path() {
        let shutdown = json!({
            "parser": "shutdownlogs",
            "events": [{
                "datetime": "2026-04-07T15:01:20Z",
                "message": "filecoordinationd is still there during shutdown after 3s",
                "timestamp_desc": "process running at shutdown",
                "data": {
                    "pid": 4242,
                    "command": "filecoordinationd",
                    "path": "/usr/sbin/filecoordinationd/550e8400-e29b-41d4-a716-446655440000",
                    "executable_path": "/usr/sbin/filecoordinationd",
                    "uuid": "550e8400-e29b-41d4-a716-446655440000",
                    "source_path": "private/var/db/diagnostics/shutdown.0.log",
                    "time_waiting": 3.0,
                    "times_waiting": 1
                }
            }]
        });
        let mut lines = Vec::new();
        collect_events_from_parser("shutdownlogs", &shutdown, Some("2026-04-07T15:01:20Z"), &mut lines);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("filecoordinationd"));
        assert!(lines[0].contains("550e8400-e29b-41d4-a716-446655440000"));
        assert!(lines[0].contains("shutdown.0.log"));
        assert!(lines[0].contains(r#""process_name":"filecoordinationd""#) || lines[0].contains(r#""process_name": "filecoordinationd""#));
    }
}
