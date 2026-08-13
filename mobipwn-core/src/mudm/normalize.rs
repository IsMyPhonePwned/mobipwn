use super::bugreport_parser_fields::apply_bugreport_parser_fields;
use super::platform::{self, ENDPOINT};
use crate::sigma_fields::enrich_sigma_ext;
use super::MudmEvent;
use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use serde_json::Value;

/// Timeline source platform from extractor libraries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimelinePlatform {
    AndroidBugreport,
    IosSysdiagnose,
    Vector,
}

/// Map one JSONL timeline row (bel / sdx export) into a [`MudmEvent`].
pub fn normalize_timeline_line(
    line: &Value,
    platform: TimelinePlatform,
    source_label: &str,
) -> Option<MudmEvent> {
    let message = synthesize_message(line)?;

    let ts = parse_timestamp(line)?;
    let mut ev = MudmEvent::new(ts, message);

    ev.source_type = match platform {
        TimelinePlatform::AndroidBugreport => "android_bugreport",
        TimelinePlatform::IosSysdiagnose => "ios_sysdiagnose",
        TimelinePlatform::Vector => "vector",
    }
    .into();
    ev.source = source_label.into();
    ev.platform = match platform {
        TimelinePlatform::AndroidBugreport => "android".into(),
        TimelinePlatform::IosSysdiagnose => "ios".into(),
        TimelinePlatform::Vector => line
            .get("platform")
            .and_then(|v| v.as_str())
            .map(platform::canonical)
            .unwrap_or_else(|| ENDPOINT.to_string()),
    };

    ev.parser = pick_str(line, &["parser", "bugreport_parser", "sysdiagnose_parser", "event_type"]);
    ev.data_type = pick_str(line, &["data_type"]);
    ev.event_time_binding = pick_str(line, &["event_time_binding"]);
    ev.process_name = pick_str(line, &[
        "process_name",
        "process",
        "cmd",
        "command",
        "command_line",
        "cmdline",
        "name",
        "parentcommandline",
        "tombstone_process",
    ]);
    ev.process_id = line
        .get("pid")
        .or_else(|| line.get("process_id"))
        .and_then(|v| v.as_u64())
        .map(|n| n.min(u32::MAX as u64) as u32)
        .unwrap_or(0);
    ev.user = pick_str(line, &["user", "username"]);
    ev.bundle_id = pick_str(line, &["pkg", "package", "package_name", "bundle_id", "bundleid"]);
    ev.app_name = pick_str(line, &["app", "app_name", "application", "name", "label"]);
    ev.device_model = pick_str(line, &[
        "model",
        "device_model",
        "brand",
        "device",
        "product",
        "product_type",
        "ProductType",
    ]);
    ev.os_version = pick_str(line, &[
        "build",
        "os_version",
        "version",
        "version_release",
        "fingerprint",
        "OSVersion",
    ]);
    ev.device_id = pick_str(line, &[
        "device_id",
        "machine_id",
        "serial",
        "android_id",
        "address",
        "mac",
        "SerialNumber",
        "unique_device_id",
        "UniqueDeviceID",
    ]);
    ev.src_ip = pick_str(line, &["src_ip", "local_ipv4", "local_ip"]);
    ev.dest_ip = pick_str(line, &["dest_ip", "remote_ipv4", "remote_ip"]);
    ev.ssid = pick_str(line, &["ssid", "wifi_ssid", "wifi_network_name"]);
    ev.permission = pick_str(line, &["permission", "tcc_service", "granted_permission"]);
    ev.file_hash = pick_str(line, &["hash", "file_hash", "sha256"]);
    ev.action = pick_str(line, &[
        "action",
        "event_type",
        "status",
        "signal",
        "reason",
        "protocol",
    ]);
    let sev = pick_str(line, &["severity"]);
    ev.severity = if sev.is_empty() { "info".into() } else { sev };

    if platform == TimelinePlatform::AndroidBugreport {
        apply_bugreport_parser_fields(&mut ev, line);
    }

    ev.ext = extract_ext(line);
    enrich_sigma_ext(&mut ev, line);

    if platform == TimelinePlatform::IosSysdiagnose {
        if ev.bundle_id.is_empty() {
            ev.bundle_id = pick_ios_bundle_id(line, &ev.ext);
        }
        apply_ios_sysdiagnose_fields(&mut ev, line);
    }

    Some(ev)
}

const IOS_BUNDLE_ID_KEYS: &[&str] = &[
    "zbundleid",
    "ztargetbundleid",
    "CFBundleIdentifier",
    "softwareversionbundleid",
    "client",
    "application_id",
    "application_identifier",
    "target_bundle_id",
];

fn pick_ios_bundle_id(line: &Value, ext: &Value) -> String {
    let from_line = pick_str(
        line,
        &[
            "BUNDLE ID",
            "bundle id",
            "zbundleid",
            "ztargetbundleid",
            "CFBundleIdentifier",
            "softwareversionbundleid",
            "client",
            "application_id",
            "application_identifier",
            "target_bundle_id",
            "bundle_id",
            "bundleid",
            "package",
        ],
    );
    if !from_line.is_empty() {
        return from_line;
    }
    pick_str(ext, IOS_BUNDLE_ID_KEYS)
}

fn apply_ios_sysdiagnose_fields(ev: &mut MudmEvent, line: &Value) {
    if ev.bundle_id.is_empty() {
        ev.bundle_id = pick_str(
            line,
            &[
                "bundleIdentifier",
                "bundleID",
                "bundleId",
                "app_name",
            ],
        );
        if ev.bundle_id.is_empty() {
            if let Some(s) = line
                .pointer("/report/bundleID")
                .or_else(|| line.pointer("/report/bundleIdentifier"))
                .and_then(|v| v.as_str())
            {
                ev.bundle_id = s.to_string();
            }
        }
    }
    if ev.permission.is_empty() {
        ev.permission = pick_str(line, &["service", "SERVICE", "tcc_service"]);
    }
    if ev.process_name.is_empty() {
        ev.process_name = pick_str(
            line,
            &[
                "PROCESS NAME",
                "process_name",
                "procName",
                "name",
                "command",
                "process",
                "app_name",
            ],
        );
        if ev.process_name.is_empty() {
            if let Some(s) = line.pointer("/report/procName").and_then(|v| v.as_str()) {
                ev.process_name = s.to_string();
            }
        }
    }
    if ev.process_id == 0 {
        ev.process_id = pick_u32_line(line, &["pid", "PID", "process_id"]);
        if ev.process_id == 0 {
            if let Some(n) = line
                .pointer("/report/pid")
                .and_then(|v| v.as_u64())
                .or_else(|| {
                    line.pointer("/report/pid")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse().ok())
                })
            {
                ev.process_id = n.min(u32::MAX as u64) as u32;
            }
        }
    }
    let parser = ev.parser.to_lowercase();
    let dt = ev.data_type.to_lowercase();
    if parser == "crashlogs" || dt.contains("crash") || line.get("ips_format").is_some() {
        if ev.severity == "info" {
            ev.severity = "high".into();
        }
        if ev.action.is_empty() {
            if let Some(sig) = line
                .pointer("/exception/signal")
                .or_else(|| line.pointer("/report/exception/signal"))
                .or_else(|| line.get("signal"))
                .and_then(|v| v.as_str())
            {
                ev.action = sig.to_string();
            } else if let Some(ty) = line
                .pointer("/exception/type")
                .or_else(|| line.pointer("/report/exception/type"))
                .or_else(|| line.get("exception"))
                .and_then(|v| v.as_str())
            {
                ev.action = ty.to_string();
            }
        }
    }
}

fn pick_u32_line(line: &Value, keys: &[&str]) -> u32 {
    for k in keys {
        if let Some(v) = line.get(*k) {
            if let Some(n) = v.as_u64() {
                return n.min(u32::MAX as u64) as u32;
            }
            if let Some(s) = v.as_str() {
                if let Ok(n) = s.trim().parse::<u32>() {
                    return n;
                }
            }
        }
    }
    0
}

fn pick_str(line: &Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(s) = line.get(*k).and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return s.to_string();
            }
        }
    }
    String::new()
}

/// Build a display message — required for MUDM. IronSift Sigma JSONL often omits `message`.
fn synthesize_message(line: &Value) -> Option<String> {
    if let Some(m) = line.get("message").and_then(|v| v.as_str()) {
        let m = m.trim();
        if !m.is_empty() {
            return Some(m.to_string());
        }
    }

    let event_type = line
        .get("event_type")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");

    match event_type {
        "file_information" => {
            let path = pick_str(line, &["file_path", "path", "TargetFilename"]);
            if path.is_empty() {
                return None;
            }
            Some(format!("file_information {path}"))
        }
        "process_creation" | "process" => {
            let cmd = pick_str(line, &[
                "command_line",
                "cmdline",
                "command",
                "process_name",
                "name",
            ]);
            if cmd.is_empty() {
                return None;
            }
            Some(format!("{event_type} {cmd}"))
        }
        _ if !event_type.is_empty() => {
            let detail = pick_str(line, &[
                "command",
                "command_line",
                "file_path",
                "path",
                "process_name",
            ]);
            if detail.is_empty() {
                Some(event_type.to_string())
            } else {
                Some(format!("{event_type} {detail}"))
            }
        }
        _ => None,
    }
}

fn parse_timestamp(line: &Value) -> Option<DateTime<Utc>> {
    if let Some(micros) = line.get("timestamp").and_then(|v| v.as_i64()) {
        let secs = micros / 1_000_000;
        let nsec = ((micros % 1_000_000).unsigned_abs() as u32) * 1_000;
        return Utc.timestamp_opt(secs, nsec).single();
    }
    for key in ["datetime", "timestamp", "date"] {
        if let Some(raw) = line.get(key).and_then(|v| v.as_str()) {
            if let Some(dt) = parse_timestamp_str(raw) {
                return Some(dt);
            }
        }
    }
    None
}

fn parse_timestamp_str(raw: &str) -> Option<DateTime<Utc>> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(Utc.from_utc_datetime(&naive));
        }
    }
    None
}

/// Fields already mapped to top-level columns stay out of `ext`.
fn extract_ext(line: &Value) -> Value {
    let obj = line.as_object();
    let Some(map) = obj else {
        return Value::Object(Default::default());
    };
    const TOP: &[&str] = &[
        "message",
        "datetime",
        "timestamp",
        // Keep `timestamp_desc` out of TOP so it is stored in `ext` and searchable
        // (SAF powerlogs ACTIVITY, spindump labels, etc.).
        "data_type",
        "parser",
        "bugreport_parser",
        "sysdiagnose_parser",
        "event_time_binding",
        "time_is_approximate",
        "command",
        "cmd",
        "process",
        "process_name",
        "tombstone_process",
        "pid",
        "process_id",
        "user",
        "username",
        "package",
        "pkg",
        "package_name",
        "bundle_id",
        "bundleid",
        "platform",
        "severity",
        "action",
        "event_type",
        "status",
        "signal",
        "reason",
        "protocol",
        "network_type",
        "state",
        "model",
        "brand",
        "device",
        "product",
        "build",
        "version_release",
        "fingerprint",
        "serial",
        "android_id",
        "device_id",
        "machine_id",
        // Keep forensic process / package fields in `ext` (not Mudm columns):
        // command_line, path, ppid, parent, versionName — same pattern as timestamp_desc.
        // `file_path` stays in TOP; enrich_sigma_ext rescues path → file_path.
        "file_path",
        "date",
        "local_address",
        "remote_address",
        "local_ip",
        "remote_ip",
        "ssid",
        "wifi_ssid",
        "permission",
        "product_name",
        "manufacturer",
        "installer",
        "label",
        "filename",
        "hash",
        "sha256",
        "name",
        "address",
        "mac",
        "id",
        // Prevent nested flatten blobs from becoming MudmEvent.ext.ext
        "ext",
    ];
    let mut out = serde_json::Map::new();
    for (k, v) in map {
        if k == "ext" {
            // Hoist nested flatten keys (legacy ps_everywhere) into top-level ext.
            if let Some(nested) = v.as_object() {
                for (nk, nv) in nested {
                    out.entry(nk.clone()).or_insert_with(|| nv.clone());
                }
            }
            continue;
        }
        if !TOP.contains(&k.as_str()) {
            out.insert(k.clone(), v.clone());
        }
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_bugreport_process_row() {
        let line = json!({
            "message": "Process pid=1 user=root cmd=init",
            "datetime": "2024-06-01T12:00:00Z",
            "timestamp": 1717243200000000_i64,
            "data_type": "android:bugreport:process",
            "parser": "Process",
            "bugreport_parser": "process",
            "event_time_binding": "snapshot_only",
            "cmd": "init",
            "pid": 1,
            "user": "root"
        });
        let ev = normalize_timeline_line(
            &line,
            TimelinePlatform::AndroidBugreport,
            "case-1",
        )
        .unwrap();
        assert_eq!(ev.platform, "android");
        assert_eq!(ev.process_name, "init");
        assert_eq!(ev.process_id, 1);
        assert_eq!(ev.user, "root");
        assert_eq!(ev.event_time_binding, "snapshot_only");
    }

    #[test]
    fn process_forensic_fields_survive_in_ext() {
        let line = json!({
            "message": "Process pid=42 cmd=/usr/bin/sshd -D",
            "datetime": "2024-06-01T12:00:00Z",
            "timestamp": 1717243200000000_i64,
            "parser": "Process",
            "bugreport_parser": "process",
            "cmd": "sshd",
            "pid": 42,
            "ppid": 1,
            "parent": "init",
            "path": "/usr/bin/sshd",
            "command_line": "/usr/bin/sshd -D",
            "args": "-D",
            "versionName": "1.2.3"
        });
        let ev = normalize_timeline_line(
            &line,
            TimelinePlatform::AndroidBugreport,
            "case-1",
        )
        .unwrap();
        assert_eq!(ev.process_name, "sshd");
        assert_eq!(
            ev.ext.get("command_line").and_then(|v| v.as_str()),
            Some("/usr/bin/sshd -D")
        );
        assert_eq!(ev.ext.get("ppid").and_then(|v| v.as_u64()), Some(1));
        assert_eq!(ev.ext.get("parent").and_then(|v| v.as_str()), Some("init"));
        assert_eq!(ev.ext.get("path").and_then(|v| v.as_str()), Some("/usr/bin/sshd"));
        assert_eq!(
            ev.ext.get("file_path").and_then(|v| v.as_str()),
            Some("/usr/bin/sshd")
        );
        assert_eq!(ev.ext.get("args").and_then(|v| v.as_str()), Some("-D"));
        assert_eq!(
            ev.ext.get("versionName").and_then(|v| v.as_str()),
            Some("1.2.3")
        );
        assert!(ev.ext.get("ext").is_none(), "must not nest ext.ext");
    }

    #[test]
    fn nested_flatten_ext_is_hoisted() {
        let line = json!({
            "message": "sshd",
            "datetime": "2024-06-01T12:00:00Z",
            "timestamp": 1717243200000000_i64,
            "parser": "ps_everywhere",
            "process_name": "sshd",
            "pid": 298,
            "ext": {
                "ppid": 1,
                "parent": "launchd",
                "path": "/usr/sbin/sshd"
            }
        });
        let ev = normalize_timeline_line(
            &line,
            TimelinePlatform::IosSysdiagnose,
            "case-ios",
        )
        .unwrap();
        assert_eq!(ev.ext.get("ppid").and_then(|v| v.as_u64()), Some(1));
        assert_eq!(ev.ext.get("parent").and_then(|v| v.as_str()), Some("launchd"));
        assert!(ev.ext.get("ext").is_none());
    }

    #[test]
    fn vector_platform_maps_to_endpoint() {
        let line = json!({
            "message": "process start init",
            "datetime": "2024-06-01T12:00:00Z",
            "parser": "vector",
            "platform": "vector"
        });
        let ev = normalize_timeline_line(&line, TimelinePlatform::Vector, "agent-1").unwrap();
        assert_eq!(ev.platform, "endpoint");
    }

    #[test]
    fn normalizes_bugreport_package_row() {
        let line = json!({
            "message": "Package install log: INSTALL pkg=com.example",
            "datetime": "2024-06-01T12:00:00Z",
            "timestamp": 1717243200000000_i64,
            "parser": "Package",
            "bugreport_parser": "package",
            "pkg": "com.example",
            "event_type": "INSTALL"
        });
        let ev = normalize_timeline_line(
            &line,
            TimelinePlatform::AndroidBugreport,
            "case-1",
        )
        .unwrap();
        assert_eq!(ev.bundle_id, "com.example");
        assert_eq!(ev.action, "INSTALL");
    }

    #[test]
    fn normalizes_ironsift_file_information_row() {
        let line = json!({
            "timestamp": "2026-05-03T16:49:55",
            "date": "2025-09-24T00:00:00",
            "event_type": "file_information",
            "permissions": "drwxr-xr-x.",
            "owner": "root",
            "group": "root",
            "size": 4096,
            "file_path": "/data/var/log"
        });
        let ev = normalize_timeline_line(&line, TimelinePlatform::Vector, "vpn-2026-05-03").unwrap();
        assert!(ev.message.contains("/data/var/log"));
        assert_eq!(ev.parser, "file_information");
        assert_eq!(ev.action, "file_information");
        assert_eq!(ev.platform, "endpoint");
        assert!(ev.ext.get("owner").is_some());
    }

    #[test]
    fn normalizes_ironsift_process_row() {
        let line = json!({
            "timestamp": "2026-04-27T00:10:05",
            "event_type": "process_creation",
            "command_line": "/sbin/init",
            "process_name": "init",
            "pid": 1,
            "machine_id": "vpn-host-1"
        });
        let ev = normalize_timeline_line(&line, TimelinePlatform::Vector, "vpn").unwrap();
        assert_eq!(ev.process_name, "init");
        assert_eq!(ev.device_id, "vpn-host-1");
    }

    #[test]
    fn keeps_timestamp_desc_and_raw_level_in_ext() {
        let line = json!({
            "message": "Battery Level: LEVEL=80, RAW LEVEL=79.5",
            "datetime": "2024-05-24T10:00:00Z",
            "parser": "powerlogs",
            "timestamp_desc": "Battery Level",
            "raw_level": 79.5,
            "level": 80,
        });
        let ev = normalize_timeline_line(&line, TimelinePlatform::IosSysdiagnose, "case-ios").unwrap();
        assert_eq!(ev.parser, "powerlogs");
        assert_eq!(
            ev.ext.get("timestamp_desc").and_then(|v| v.as_str()),
            Some("Battery Level")
        );
        assert_eq!(ev.ext.get("raw_level").and_then(|v| v.as_f64()), Some(79.5));
    }

    #[test]
    fn normalizes_ios_remotectl_device_metadata() {
        let line = json!({
            "message": "iOS device iPhone15,2 iOS 17.2.1 serial GOLDEN123",
            "datetime": "2026-04-10T12:57:08Z",
            "parser": "remotectl_dumpstate",
            "event_type": "device_metadata",
            "os_version": "17.2.1",
            "device_model": "iPhone15,2",
            "serial": "GOLDEN123",
            "unique_device_id": "00000000-1111-2222-3333-444444444444",
        });
        let ev = normalize_timeline_line(&line, TimelinePlatform::IosSysdiagnose, "case-ios").unwrap();
        assert_eq!(ev.parser, "remotectl_dumpstate");
        assert_eq!(ev.os_version, "17.2.1");
        assert_eq!(ev.device_model, "iPhone15,2");
        assert_eq!(ev.device_id, "GOLDEN123");
    }

    #[test]
    fn normalizes_ios_bundle_id_from_sqlite_column() {
        let line = json!({
            "message": "appinstallation row",
            "datetime": "2024-06-01T12:00:00Z",
            "parser": "appinstallation",
            "zbundleid": "com.example.app",
            "CFBundleDisplayName": "Example",
        });
        let ev = normalize_timeline_line(&line, TimelinePlatform::IosSysdiagnose, "case-ios").unwrap();
        assert_eq!(ev.bundle_id, "com.example.app");
        assert_eq!(ev.app_name, "Example");
    }

    #[test]
    fn usb_product_id_survives_in_ext_not_as_process_id() {
        let line = json!({
            "message": "USB device: 1d6b:2 (hub)",
            "datetime": "2024-06-01T12:00:00Z",
            "timestamp": 1717243200000000_i64,
            "parser": "Usb",
            "data_type": "android:bugreport:usb_device",
            "vid": "1d6b",
            "vendor_id": "1d6b",
            "product_id": "2",
            "driver": "hub",
            "interface": "9/0/0",
            "first_seen": "08-03 12:06:36.337",
            "last_seen": "08-03 12:07:07.121",
            "last_action": "remove",
        });
        let ev = normalize_timeline_line(&line, TimelinePlatform::AndroidBugreport, "case-1").unwrap();
        assert_eq!(ev.process_id, 0);
        assert_eq!(ev.action, "remove");
        assert_eq!(ev.app_name, "hub");
        assert_eq!(ev.ext.get("vid").and_then(|v| v.as_str()), Some("1d6b"));
        assert_eq!(ev.ext.get("product_id").and_then(|v| v.as_str()), Some("2"));
        assert_eq!(ev.ext.get("driver").and_then(|v| v.as_str()), Some("hub"));
        assert_eq!(ev.ext.get("interface").and_then(|v| v.as_str()), Some("9/0/0"));
        assert_eq!(
            ev.ext.get("first_seen").and_then(|v| v.as_str()),
            Some("08-03 12:06:36.337")
        );
        assert!(ev.ext.get("pid").is_none());
    }
}
