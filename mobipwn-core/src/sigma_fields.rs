//! Sigma / Amnesty investigation field alignment for timeline → MUDM `ext` and columns.

use crate::mudm::MudmEvent;
use serde_json::Value;

/// Promote parser + timeline keys used by website/Sigma rules into `ext` and core columns.
pub fn enrich_sigma_ext(ev: &mut MudmEvent, line: &Value) {
    let Some(ext) = ev.ext.as_object_mut() else {
        return;
    };

    if let Some(et) = pick_str(line, &["event_type"]) {
        ext.insert("event_type".into(), Value::String(et.clone()));
    } else if ev.data_type.contains("tombstone")
        && (line.get("function").is_some()
            || line.get("symbol").is_some()
            || ev.data_type.contains("frame")
            || ev.data_type.contains("backtrace"))
    {
        // Amnesty / website rules use `data_type=*tombstone_backtrace*` (not `tombstone_frame`).
        ext.insert("event_type".into(), Value::String("tombstone_backtrace".into()));
    } else if let Some(short) = short_data_type(&ev.data_type) {
        ext.insert("event_type".into(), Value::String(short));
    }

    for key in &[
        "remote_address",
        "remote_ip",
        "hostname",
        "destination_domain",
    ] {
        if let Some(domain) = domain_from_line_field(line, key) {
            if !domain.is_empty() {
                ext.insert("destination_domain".into(), Value::String(domain.clone()));
                if ev.dest_ip.is_empty() {
                    ev.dest_ip = domain.clone();
                }
                break;
            }
        }
    }

    if let Some(ip) = pick_str(line, &["peer_ip", "remote_ipv4", "remote_ip"]) {
        let host = host_from_address(&ip);
        if !host.is_empty() && host != "::" && host != "0.0.0.0" {
            ext.insert("remote_ip".into(), Value::String(host.clone()));
            if ev.dest_ip.is_empty() {
                ev.dest_ip = host;
            }
        }
    }

    if let Some(f) = pick_str(line, &["function", "symbol", "library"]) {
        if line.get("function").is_some()
            || line.get("symbol").is_some()
            || ev.data_type.contains("tombstone")
            || ev.parser.eq_ignore_ascii_case("crashlogs")
            || line.get("ips_format").is_some()
        {
            ext.insert("function".into(), Value::String(f));
        }
    }

    for k in &["file_path", "path", "filename", "resourcePath"] {
        if let Some(p) = pick_str(line, &[k]) {
            ext.insert("file_path".into(), Value::String(p));
            break;
        }
    }

    for k in &["email", "from", "to", "addr", "account_name"] {
        if let Some(e) = pick_str(line, &[k]) {
            if e.contains('@') {
                ext.insert("email".into(), Value::String(e));
                break;
            }
        }
    }

    if let Some(h) = pick_str(line, &["hash", "sha256", "file_hash"]) {
        if ev.file_hash.is_empty() && h.len() >= 32 {
            ev.file_hash = h;
        }
    }

    if let Some(inst) = pick_str(
        line,
        &[
            "installer",
            "installerPackageName",
            "initiatingPackageName",
            "originatingPackageName",
        ],
    ) {
        ext.insert("installer".into(), Value::String(inst));
    } else if let Some(v) = ext.get("installerPackageName").and_then(|x| x.as_str()) {
        if !v.is_empty() {
            ext.insert("installer".into(), Value::String(v.to_string()));
        }
    }

    // Process / package fields that must survive TOP hygiene (ext-only, not CH columns).
    if let Some(cl) = pick_str(line, &["command_line", "cmdline"]) {
        ext.insert("command_line".into(), Value::String(cl));
    }
    if let Some(ppid) = line.get("ppid").cloned().or_else(|| line.get("parent_pid").cloned()) {
        if !ext.contains_key("ppid") {
            ext.insert("ppid".into(), ppid);
        }
    }
    if let Some(parent) = pick_str(line, &["parent"]) {
        ext.insert("parent".into(), Value::String(parent));
    }
    if let Some(vn) = pick_str(line, &["versionName", "version_name"]) {
        ext.insert("versionName".into(), Value::String(vn));
    }
}

pub fn short_data_type(data_type: &str) -> Option<String> {
    if data_type.is_empty() {
        return None;
    }
    if let Some(short) = data_type.rsplit(':').next() {
        if !short.is_empty() {
            return Some(short.to_string());
        }
    }
    Some(data_type.to_string())
}

pub fn domain_from_line_field(line: &Value, key: &str) -> Option<String> {
    line.get(key)
        .and_then(|v| v.as_str())
        .map(host_from_address)
        .filter(|s| !s.is_empty() && !looks_like_pure_ip(s))
}

/// Host part of `host:port`, `[ipv6]:port`, `ip:port`, or bare hostname/IP string.
pub fn host_from_address(s: &str) -> String {
    crate::net::ip_resolve::resolve_display_host(s.trim().trim_matches('"'))
}

fn looks_like_pure_ip(s: &str) -> bool {
    s.chars()
        .all(|c| c.is_ascii_digit() || c == '.' || c == ':')
        && s.contains('.')
}

fn pick_str(line: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = line.get(*k).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn host_from_address_strips_port() {
        assert_eq!(host_from_address("evil.com:443"), "evil.com");
        assert_eq!(host_from_address("10.0.0.1:8080"), "10.0.0.1");
    }

    #[test]
    fn enrich_tombstone_frame_as_backtrace_event_type() {
        let line = json!({
            "message": "backtrace #0",
            "data_type": "android:bugreport:tombstone_frame",
            "function": "QuramDngOpcodeScalePerColumn::processArea"
        });
        let mut ev = MudmEvent::new(chrono::Utc::now(), "msg");
        ev.data_type = "android:bugreport:tombstone_frame".into();
        enrich_sigma_ext(&mut ev, &line);
        assert_eq!(
            ev.ext.get("event_type").and_then(|v| v.as_str()),
            Some("tombstone_backtrace")
        );
    }

    #[test]
    fn enrich_network_socket_domain() {
        let line = json!({
            "message": "Socket tcp 10.0.0.1:1234 -> evil.com:443",
            "data_type": "android:bugreport:network_socket",
            "remote_address": "evil.com:443",
            "remote_ip": "93.184.216.34"
        });
        let mut ev = MudmEvent::new(chrono::Utc::now(), "msg");
        ev.data_type = "android:bugreport:network_socket".into();
        enrich_sigma_ext(&mut ev, &line);
        assert_eq!(
            ev.ext.get("event_type").and_then(|v| v.as_str()),
            Some("network_socket")
        );
        assert_eq!(
            ev.ext.get("destination_domain").and_then(|v| v.as_str()),
            Some("evil.com")
        );
    }
}
