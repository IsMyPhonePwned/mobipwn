//! Promote bugreport timeline JSON keys into top-level [`MudmEvent`] columns per parser.
//!
//! Timeline rows are built in **bugreport-extractor-library** (`src/timeline.rs`, `flatten_*`
//! + `push_event`). mobipwn maps them in [`super::normalize::normalize_timeline_line`] after
//! generic picks, via [`apply_bugreport_parser_fields`].

use super::MudmEvent;
use serde_json::Value;

/// Parser name (PascalCase `parser` or lowercase `bugreport_parser`) → MUDM columns filled from timeline JSON.
pub const PARSER_FIELD_MAP: &[(&str, &[&str])] = &[
    (
        "Package",
        &[
            "bundle_id←pkg|package_name",
            "action←event_type",
            "ext:installer←installerPackageName|initiatingPackageName|installer",
        ],
    ),
    ("Process", &["process_name←cmd", "process_id←pid", "user←user", "ext:ppid←ppid", "ext:parent←parent", "ext:parent_pid←parent_pid"]),
    ("Network", &["src_ip←local_ip|local_address", "dest_ip←peer_ip|remote_ip|remote_address", "bundle_id←package_name|owner|package|pkg", "process_name←process_cmd|owner", "process_id←uid|pid", "user←process_user", "ssid←ssid|wifi_network_name", "action←protocol|network_type|state|socket_direction", "ext:owner_type←owner_type", "ext:attribution_status←attribution_status", "ext:socket_direction←socket_direction", "ext:peer_ip←peer_ip", "ext:peer_ip_display←peer_ip_display", "ext:program_name←program_name", "ext:program_pid←program_pid"]),
    ("Battery", &["bundle_id←package_name", "action←action|status", "ext:vers←vers", "ext:previous_vers←previous_vers", "ext:daily_from←from", "ext:daily_to←to"]),
    (
        "Crash",
        &[
            "process_name←process_name|tombstone_process|cmd",
            "process_id←pid|tid",
            "action←signal|filename|abort_message|code",
            "bundle_id←package_name|pkg",
            "file_hash←hash|sha256",
            "ext:file_path←filename|path",
            "function←function|symbol|library",
        ],
    ),
    ("Power", &["action←event_type|reason"]),
    ("Usb", &["action←last_action|product_name|id", "app_name←manufacturer|driver"]),
    ("Bluetooth", &["app_name←name", "device_id←mac_address|masked_address|address"]),
    ("Header", &["device_model←Build fingerprint|androidboot.em.model|model", "os_version←release|Android SDK version", "device_id←serial|android_id"]),
    ("Memory", &[]),
    (
        "DevicePolicy|Adb|Vpn|Privacy",
        &["bundle_id←package_name|pkg", "permission←permission", "action←event_type|status"],
    ),
    (
        "Authentication",
        &["user←user|user_id", "action←auth_type|wake_reason|action", "ext:status←status"],
    ),
    (
        "Account",
        &[
            "user←user_name|owner_name|user_id",
            "action←event_type|account_type",
            "app_name←owner_name|user_name",
            "ext:account_name←account_name",
            "ext:account_type←account_type",
            "ext:email←email|account_name",
        ],
    ),
];

pub fn apply_bugreport_parser_fields(ev: &mut MudmEvent, line: &Value) {
    let slug = line
        .get("bugreport_parser")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let name = if ev.parser.is_empty() {
        slug.clone()
    } else {
        ev.parser.clone()
    };

    match name.as_str() {
        "Package" | "package" => apply_package(ev, line),
        "Process" | "process" => apply_process(ev, line),
        "Network" | "network" => apply_network(ev, line),
        "Battery" | "battery" => apply_battery(ev, line),
        "Crash" | "crash" => apply_crash(ev, line),
        "Power" | "power" => apply_power(ev, line),
        "Usb" | "usb" => apply_usb(ev, line),
        "Bluetooth" | "bluetooth" => apply_bluetooth(ev, line),
        "Header" | "header" => apply_header(ev, line),
        "Memory" | "memory" => {}
        "DevicePolicy" | "devicepolicy"
        |         "Adb" | "adb" => apply_generic_policy(ev, line),
        "Authentication" | "authentication" => apply_authentication(ev, line),
        "Account" | "account" => apply_account(ev, line),
        "Vpn" | "vpn"
        | "Privacy" | "privacy" => apply_generic_policy(ev, line),
        _ => apply_generic_policy(ev, line),
    }
}

fn apply_package(ev: &mut MudmEvent, line: &Value) {
    set_if_empty(&mut ev.bundle_id, pick(line, &["pkg", "package_name"]));
    set_if_empty(&mut ev.action, pick(line, &["event_type", "installer"]));
    set_if_empty(&mut ev.app_name, pick(line, &["label", "versionName"]));
}

fn apply_process(ev: &mut MudmEvent, line: &Value) {
    set_if_empty(&mut ev.process_name, pick(line, &["cmd", "command", "process_name"]));
    set_u32_if_zero(&mut ev.process_id, pick_u32(line, &["pid", "process_id"]));
    set_if_empty(&mut ev.user, pick(line, &["user", "username"]));
    // ppid/parent/command_line land in ext via TOP hygiene + enrich_sigma_ext
    // (apply runs before extract_ext, so do not write ev.ext here).
}

fn apply_network(ev: &mut MudmEvent, line: &Value) {
    let src = pick_ip(line, &["local_ip", "local_address"], &["local_ipv4"]);
    if !src.is_empty() {
        ev.src_ip = src;
    }
    let dest = pick_dest_ip(line);
    if !dest.is_empty() && !is_listener_socket(line) {
        ev.dest_ip = dest;
    }
    set_if_empty(
        &mut ev.ssid,
        pick(line, &["ssid", "wifi_ssid", "wifi_network_name", "bssid"]),
    );
    set_if_empty(
        &mut ev.action,
        pick(line, &["protocol", "network_type", "state", "name", "scan_event_type"]),
    );
    set_if_empty(
        &mut ev.bundle_id,
        pick(line, &["package_name", "package", "pkg"]),
    );
    set_u32_if_zero(&mut ev.process_id, pick_u32(line, &["uid", "pid"]));
    let process_cmd = pick(line, &["process_cmd"]);
    if !process_cmd.is_empty() {
        set_if_empty(&mut ev.process_name, process_cmd.clone());
        if ev.bundle_id.is_empty() && looks_like_package_name(&process_cmd) {
            ev.bundle_id = process_cmd;
        }
    }
    set_if_empty(&mut ev.user, pick(line, &["process_user"]));
    apply_network_owner(ev, line);
}

fn looks_like_package_name(name: &str) -> bool {
    name.contains('.') && !name.starts_with("binder:") && !name.contains(' ')
}

fn is_listener_socket(line: &Value) -> bool {
    pick(line, &["socket_direction"]) == "listen"
        || pick(line, &["state"]).eq_ignore_ascii_case("listen")
}

fn is_wildcard_ip_host(host: &str) -> bool {
    matches!(host, "*" | "::" | "0.0.0.0" | "0:0:0:0:0:0:0:0")
}

fn pick_dest_ip(line: &Value) -> String {
    let peer = pick(line, &["peer_ip"]);
    if !peer.is_empty() && !is_wildcard_ip_host(&peer) {
        return crate::net::ip_resolve::resolve_display_host(&peer);
    }
    let dest = pick_ip(line, &["remote_ip", "remote_address"], &["remote_ipv4"]);
    if dest.is_empty() || is_wildcard_ip_host(&dest) {
        return String::new();
    }
    dest
}

fn apply_network_owner(ev: &mut MudmEvent, line: &Value) {
    let owner_type = pick(line, &["owner_type"]);
    if owner_type == "stale" || pick(line, &["attribution_status"]) == "stale_socket" {
        return;
    }
    let owner = pick(line, &["owner"]);
    if owner.is_empty() || owner == "unattributed" || owner_type == "unknown" {
        return;
    }
    match owner_type.as_str() {
        "package" => {
            ev.bundle_id = owner;
        }
        "process" => {
            ev.process_name = owner;
        }
        _ if looks_like_package_name(&owner) => {
            if ev.bundle_id.is_empty() {
                ev.bundle_id = owner;
            }
        }
        _ => {
            if ev.process_name.is_empty() {
                ev.process_name = owner;
            }
        }
    }
}

fn apply_battery(ev: &mut MudmEvent, line: &Value) {
    set_if_empty(&mut ev.bundle_id, pick(line, &["package_name", "pkg"]));
    set_if_empty(&mut ev.action, pick(line, &["status", "event_type", "level"]));
}

fn apply_crash(ev: &mut MudmEvent, line: &Value) {
    set_if_empty(
        &mut ev.process_name,
        pick(line, &["process_name", "tombstone_process", "cmd", "thread_name"]),
    );
    set_u32_if_zero(&mut ev.process_id, pick_u32(line, &["pid", "process_id", "tid"]));
    set_if_empty(
        &mut ev.action,
        pick(
            line,
            &[
                "signal",
                "filename",
                "event_type",
                "abort_message",
                "code",
                "fault_addr",
            ],
        ),
    );
    set_if_empty(&mut ev.bundle_id, pick(line, &["package_name", "pkg"]));
    set_if_empty(&mut ev.file_hash, pick(line, &["hash", "sha256"]));
    if ev.severity == "info" {
        let dt = ev.data_type.as_str();
        if dt.contains("tombstone")
            || line.get("signal").is_some()
            || pick(line, &["filename"]).ends_with(".txt")
        {
            ev.severity = "high".into();
        }
    }
}

fn apply_power(ev: &mut MudmEvent, line: &Value) {
    set_if_empty(&mut ev.action, pick(line, &["event_type", "reason", "status"]));
    set_if_empty(&mut ev.bundle_id, pick(line, &["package_name", "pkg"]));
}

fn apply_usb(ev: &mut MudmEvent, line: &Value) {
    // USB product id is published as `product_id` (flatten renames `pid`) so MUDM does not
    // treat it as a process id. Clear accidental numeric parse of legacy `pid` (e.g. "2").
    let is_usb_device = line
        .get("data_type")
        .and_then(|v| v.as_str())
        .is_some_and(|s| s.contains("usb_device"))
        || line.get("vid").is_some()
        || line.get("vendor_id").is_some()
        || line.get("product_id").is_some()
        || line.get("driver").is_some();
    if is_usb_device {
        ev.process_id = 0;
    }
    set_if_empty(
        &mut ev.action,
        pick(line, &["last_action", "product_name", "id", "mode", "state"]),
    );
    set_if_empty(
        &mut ev.app_name,
        pick(line, &["manufacturer", "driver", "product_name"]),
    );
}

fn apply_bluetooth(ev: &mut MudmEvent, line: &Value) {
    set_if_empty(&mut ev.app_name, pick(line, &["name", "alias"]));
    set_if_empty(
        &mut ev.device_id,
        pick(line, &["mac_address", "masked_address", "address", "mac", "identity_address"]),
    );
}

fn apply_header(ev: &mut MudmEvent, line: &Value) {
    let fingerprint = pick(
        line,
        &["Build fingerprint", "build fingerprint", "fingerprint"],
    );
    let fp = parse_android_build_fingerprint(&fingerprint);
    let cmdline = pick(line, &["Command line", "command line"]);
    let marketing = androidboot_em_model(&cmdline);

    set_if_empty(&mut ev.device_model, marketing);
    set_if_empty(
        &mut ev.device_model,
        pick(line, &["model", "brand", "device", "product"]),
    );
    if let Some(ref parts) = fp {
        set_if_empty(&mut ev.device_model, parts.display_model());
        if !parts.release.is_empty() {
            set_if_empty(
                &mut ev.os_version,
                format!("Android {}", parts.release),
            );
        }
    }
    set_if_empty(
        &mut ev.os_version,
        pick(
            line,
            &[
                "version_release",
                "Android SDK version",
                "android sdk version",
                "sdk",
                "Build",
                "build",
            ],
        ),
    );
    set_if_empty(
        &mut ev.device_id,
        pick(line, &["serial", "Serial number", "serialno", "android_id", "device_id"]),
    );
    set_if_empty(
        &mut ev.device_id,
        androidboot_cmdline_value(&cmdline, "androidboot.serialno"),
    );
}

/// Parsed Android `Build fingerprint` (`brand/product/device:release/id/inc:type/tags`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AndroidBuildFingerprint {
    pub brand: String,
    pub product: String,
    pub device: String,
    pub release: String,
    pub build_id: String,
}

impl AndroidBuildFingerprint {
    /// Prefer product codename, then device, prefixed with brand when useful.
    pub fn display_model(&self) -> String {
        let name = if !self.product.is_empty() {
            self.product.as_str()
        } else {
            self.device.as_str()
        };
        if name.is_empty() {
            return self.brand.clone();
        }
        if self.brand.is_empty() || self.brand.eq_ignore_ascii_case(name) {
            return name.to_string();
        }
        format!("{}/{}", self.brand, name)
    }
}

/// Parse dumpstate `Build fingerprint` into brand/product/device/release/build_id.
pub fn parse_android_build_fingerprint(fingerprint: &str) -> Option<AndroidBuildFingerprint> {
    let trimmed = fingerprint
        .trim()
        .trim_matches(|c| c == '\'' || c == '"');
    if trimmed.is_empty() {
        return None;
    }
    let first_colon = trimmed.find(':')?;
    let left = &trimmed[..first_colon];
    let rest = &trimmed[first_colon + 1..];
    let last_colon = rest.rfind(':').unwrap_or(rest.len());
    let release_part = &rest[..last_colon];
    let mut left_parts = left.split('/');
    let brand = left_parts.next().unwrap_or("").to_string();
    let product = left_parts.next().unwrap_or("").to_string();
    let device = left_parts.next().unwrap_or("").to_string();
    let mut rel_parts = release_part.split('/');
    let release = rel_parts.next().unwrap_or("").to_string();
    let build_id = rel_parts.next().unwrap_or("").to_string();
    if brand.is_empty() && product.is_empty() && device.is_empty() && release.is_empty() {
        return None;
    }
    Some(AndroidBuildFingerprint {
        brand,
        product,
        device,
        release,
        build_id,
    })
}

/// Extract marketing model from kernel cmdline (`androidboot.em.model=SM-A346B`).
pub fn androidboot_em_model(cmdline: &str) -> String {
    androidboot_cmdline_value(cmdline, "androidboot.em.model")
}

/// Extract a single `key=value` token from dumpstate kernel cmdline / bootconfig text.
pub fn androidboot_cmdline_value(cmdline: &str, key: &str) -> String {
    let prefix = format!("{key}=");
    for token in cmdline.split_whitespace() {
        if let Some(v) = token.strip_prefix(&prefix) {
            let t = v.trim().trim_matches(|c| c == '\'' || c == '"');
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    String::new()
}

/// Hardware serial from cmdline (`androidboot.serialno=…`).
pub fn androidboot_serialno(cmdline: &str) -> String {
    androidboot_cmdline_value(cmdline, "androidboot.serialno")
}

fn apply_generic_policy(ev: &mut MudmEvent, line: &Value) {
    set_if_empty(&mut ev.bundle_id, pick(line, &["package_name", "pkg", "package"]));
    set_if_empty(&mut ev.permission, pick(line, &["permission", "granted_permission"]));
    set_if_empty(&mut ev.action, pick(line, &["event_type", "status", "state"]));
    set_if_empty(&mut ev.user, pick(line, &["user", "username"]));
}

fn apply_authentication(ev: &mut MudmEvent, line: &Value) {
    set_if_empty(&mut ev.user, pick(line, &["user", "username"]));
    if ev.user.is_empty() {
        if let Some(uid) = line.get("user_id").and_then(|v| v.as_u64()) {
            ev.user = uid.to_string();
        }
    }
    // `normalize` often fills action from generic `event_type=authentication_event`
    // before we run — overwrite with the concrete auth method when present.
    let preferred = pick(line, &["auth_type", "wake_reason", "action"]);
    let generic = matches!(
        ev.action.as_str(),
        "" | "authentication_event" | "success" | "failed"
    );
    if !preferred.is_empty() && (generic || preferred != "authentication_event") {
        if generic {
            ev.action = preferred;
        } else {
            set_if_empty(&mut ev.action, preferred);
        }
    } else {
        set_if_empty(
            &mut ev.action,
            pick(line, &["auth_type", "event_type", "status", "wake_reason"]),
        );
    }
    if ev.action.is_empty() || ev.action == "authentication_event" {
        let success = line.get("success").and_then(|v| v.as_bool());
        if let Some(ok) = success {
            ev.action = if ok { "success".into() } else { "failed".into() };
        }
    }
}

fn apply_account(ev: &mut MudmEvent, line: &Value) {
    set_if_empty(
        &mut ev.user,
        pick(line, &["user_name", "owner_name", "user"]),
    );
    if ev.user.is_empty() {
        if let Some(uid) = line.get("user_id").and_then(|v| v.as_u64()) {
            ev.user = uid.to_string();
        } else if let Some(uid) = line.get("current_user").and_then(|v| v.as_u64()) {
            ev.user = uid.to_string();
        }
    }
    set_if_empty(
        &mut ev.action,
        pick(line, &["event_type", "account_type", "action"]),
    );
    set_if_empty(
        &mut ev.app_name,
        pick(line, &["owner_name", "user_name", "account_name"]),
    );
    // Prefer concrete account type over generic event_type for account rows.
    if ev.action == "account" {
        let atype = pick(line, &["account_type"]);
        if !atype.is_empty() {
            ev.action = atype;
        }
    }
}

fn pick(line: &Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(s) = line.get(*k).and_then(|v| v.as_str()) {
            let t = s.trim().trim_matches('"');
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    String::new()
}

fn pick_u32(line: &Value, keys: &[&str]) -> u32 {
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

/// Extract host from socket address fields; prefers embedded IPv4 for `ipv4_mapped` endpoints.
fn pick_ip(line: &Value, keys: &[&str], ipv4_keys: &[&str]) -> String {
    for k in ipv4_keys {
        if let Some(s) = line.get(*k).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    let raw = pick(line, keys);
    if raw.is_empty() {
        return raw;
    }
    host_from_address(&raw)
}

fn host_from_address(raw: &str) -> String {
    crate::net::ip_resolve::resolve_display_host(raw)
}

fn set_if_empty(field: &mut String, val: String) {
    if field.is_empty() && !val.is_empty() {
        *field = val;
    }
}

fn set_u32_if_zero(field: &mut u32, val: u32) {
    if *field == 0 && val != 0 {
        *field = val;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;

    #[test]
    fn package_install_log_maps_pkg_and_event_type() {
        let line = json!({
            "message": "Package install log: INSTALL pkg=com.foo",
            "timestamp": 1717243200000000_i64,
            "parser": "Package",
            "bugreport_parser": "package",
            "pkg": "com.foo",
            "event_type": "INSTALL"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Package".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.bundle_id, "com.foo");
        assert_eq!(ev.action, "INSTALL");
    }

    #[test]
    fn network_socket_splits_address() {
        let line = json!({
            "message": "Socket tcp",
            "timestamp": 1717243200000000_i64,
            "parser": "Network",
            "local_address": "10.0.0.2:443",
            "remote_address": "8.8.8.8:53",
            "protocol": "tcp"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.src_ip, "10.0.0.2");
        assert_eq!(ev.dest_ip, "8.8.8.8");
        assert_eq!(ev.action, "tcp");
    }

    #[test]
    fn network_socket_ipv4_mapped_uses_embedded_ipv4() {
        let line = json!({
            "message": "Socket tcp",
            "parser": "Network",
            "remote_ip": "::ffff:142.250.110.188",
            "remote_ip_version": "ipv4_mapped",
            "remote_ipv4": "142.250.110.188",
            "remote_port": 443,
            "protocol": "tcp",
            "uid": 10123
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.dest_ip, "142.250.110.188");
        assert_eq!(ev.process_id, 10123);
    }

    #[test]
    fn network_socket_nat64_resolves_embedded_ipv4() {
        let line = json!({
            "message": "Socket tcp",
            "parser": "Network",
            "remote_ip": "64:ff9b::253b:1955",
            "remote_port": 443,
            "protocol": "tcp"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.dest_ip, "37.59.25.85");
    }

    #[test]
    fn network_socket_process_cmd_when_no_package() {
        let line = json!({
            "message": "Socket tcp",
            "parser": "Network",
            "uid": 1017,
            "process_cmd": "keystore2",
            "process_pid": 659,
            "process_user": "u0_system",
            "remote_ip": "8.8.8.8",
            "protocol": "tcp"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.process_name, "keystore2");
        assert_eq!(ev.process_id, 1017);
        assert_eq!(ev.user, "u0_system");
        assert!(ev.bundle_id.is_empty());
    }

    #[test]
    fn network_socket_owner_package_from_netstat() {
        let line = json!({
            "parser": "Network",
            "uid": 10109,
            "owner": "com.real.app",
            "owner_type": "package",
            "program_name": "com.real.app",
            "program_pid": 4242,
            "protocol": "tcp"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.bundle_id, "com.real.app");
        assert_eq!(ev.process_id, 10109);
    }

    #[test]
    fn network_socket_owner_process() {
        let line = json!({
            "parser": "Network",
            "uid": 1017,
            "owner": "keystore2",
            "owner_type": "process",
            "process_cmd": "keystore2",
            "protocol": "tcp"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.process_name, "keystore2");
        assert!(ev.bundle_id.is_empty());
    }

    #[test]
    fn network_socket_stale_owner_not_promoted() {
        let line = json!({
            "parser": "Network",
            "uid": 0,
            "owner": "unattributed (stale socket)",
            "owner_type": "stale",
            "attribution_status": "stale_socket",
            "remote_ipv4": "142.250.75.227",
            "protocol": "tcp6",
            "state": "LAST_ACK"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert!(ev.bundle_id.is_empty());
        assert!(ev.process_name.is_empty());
        assert_eq!(ev.dest_ip, "142.250.75.227");
    }

    #[test]
    fn network_socket_listener_keeps_owner_not_wildcard_dest() {
        let line = json!({
            "parser": "Network",
            "socket_direction": "listen",
            "remote_ip": "::",
            "owner": "com.android.proxyhandler",
            "owner_type": "package",
            "package_name": "com.android.proxyhandler",
            "protocol": "tcp6",
            "state": "LISTEN"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.bundle_id, "com.android.proxyhandler");
        assert!(ev.dest_ip.is_empty());
    }

    #[test]
    fn network_socket_peer_ip_preferred_over_wildcard_remote() {
        let line = json!({
            "parser": "Network",
            "peer_ip": "142.250.75.227",
            "remote_ip": "::",
            "protocol": "tcp"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.dest_ip, "142.250.75.227");
    }

    #[test]
    fn network_socket_unknown_owner_not_promoted() {
        let line = json!({
            "parser": "Network",
            "owner": "unattributed",
            "owner_type": "unknown",
            "attribution_status": "unresolved",
            "uid": 99999,
            "protocol": "tcp"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert!(ev.bundle_id.is_empty());
        assert!(ev.process_name.is_empty());
        assert_eq!(ev.process_id, 99999);
    }

    #[test]
    fn network_socket_process_cmd_package_shape_becomes_bundle_id() {
        let line = json!({
            "parser": "Network",
            "uid": 10109,
            "process_cmd": "com.example.app",
            "protocol": "tcp"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.bundle_id, "com.example.app");
        assert_eq!(ev.process_name, "com.example.app");
    }

    #[test]
    fn network_wifi_scan_event_maps_package_and_uid() {
        let line = json!({
            "message": "WiFi scan event",
            "parser": "Network",
            "package": "com.example.app",
            "uid": 10042,
            "scan_event_type": "SCAN_RESULTS"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Network".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.bundle_id, "com.example.app");
        assert_eq!(ev.process_id, 10042);
        assert_eq!(ev.action, "SCAN_RESULTS");
    }

    #[test]
    fn authentication_prefers_auth_type_over_generic_event_type() {
        let line = json!({
            "parser": "Authentication",
            "event_type": "authentication_event",
            "auth_type": "biometric",
            "user_id": 0,
            "success": true
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Authentication".into();
        ev.action = "authentication_event".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.action, "biometric");
        assert_eq!(ev.user, "0");
    }

    #[test]
    fn crash_tombstone_maps_process_and_signal() {
        let line = json!({
            "message": "Native crash (tombstone): zygote signal=SIGSEGV",
            "timestamp": 1717243200000000_i64,
            "parser": "Crash",
            "data_type": "android:bugreport:tombstone",
            "process_name": "zygote",
            "pid": 999,
            "signal": "SIGSEGV"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Crash".into();
        ev.data_type = "android:bugreport:tombstone".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.process_name, "zygote");
        assert_eq!(ev.process_id, 999);
        assert_eq!(ev.action, "SIGSEGV");
        assert_eq!(ev.severity, "high");
    }

    #[test]
    fn crash_backtrace_uses_tombstone_process() {
        let line = json!({
            "message": "Backtrace[0] libc.so abort",
            "parser": "Crash",
            "data_type": "android:bugreport:tombstone_frame",
            "tombstone_process": "com.example.app",
            "library": "libc.so",
            "function": "abort"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Crash".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.process_name, "com.example.app");
    }

    #[test]
    fn process_uses_cmd_and_pid() {
        let line = json!({
            "message": "Process",
            "timestamp": 1717243200000000_i64,
            "parser": "Process",
            "cmd": "system_server",
            "pid": 1234,
            "user": "system"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Process".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.process_name, "system_server");
        assert_eq!(ev.process_id, 1234);
        assert_eq!(ev.user, "system");
    }

    #[test]
    fn account_maps_google_account_and_owner() {
        let line = json!({
            "parser": "Account",
            "event_type": "account",
            "account_name": "alice@gmail.com",
            "account_type": "com.google",
            "user_id": 0,
            "user_name": "Owner",
            "email": "alice@gmail.com"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Account".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.user, "Owner");
        assert_eq!(ev.action, "com.google");
        assert_eq!(ev.app_name, "Owner");
    }

    #[test]
    fn parse_fingerprint_samsung_a34() {
        let fp = parse_android_build_fingerprint(
            "'samsung/a34xeea/a34x:14/UP1A.231005.007/A346BXXS9CYD1:user/release-keys'",
        )
        .unwrap();
        assert_eq!(fp.brand, "samsung");
        assert_eq!(fp.product, "a34xeea");
        assert_eq!(fp.device, "a34x");
        assert_eq!(fp.release, "14");
        assert_eq!(fp.build_id, "UP1A.231005.007");
        assert_eq!(fp.display_model(), "samsung/a34xeea");
    }

    #[test]
    fn androidboot_em_model_from_cmdline() {
        let cmd = "console=tty0 androidboot.em.model=SM-A346B androidboot.serialno=ABC";
        assert_eq!(androidboot_em_model(cmd), "SM-A346B");
        assert_eq!(androidboot_serialno(cmd), "ABC");
    }

    #[test]
    fn header_maps_fingerprint_and_marketing_model() {
        let line = json!({
            "parser": "Header",
            "Build fingerprint": "'samsung/a34xeea/a34x:14/UP1A.231005.007/A346BXXS9CYD1:user/release-keys'",
            "Command line": "androidboot.em.model=SM-A346B androidboot.serialno=RZCX8116ANX",
            "Android SDK version": "34"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Header".into();
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.device_model, "SM-A346B");
        assert_eq!(ev.os_version, "Android 14");
        assert_eq!(ev.device_id, "RZCX8116ANX");
    }

    #[test]
    fn usb_device_maps_last_action_and_clears_process_id() {
        let line = json!({
            "parser": "Usb",
            "data_type": "android:bugreport:usb_device",
            "vid": "1d6b",
            "product_id": "2",
            "pid": "2",
            "driver": "hub",
            "last_action": "remove",
            "manufacturer": "Linux Foundation"
        });
        let mut ev = MudmEvent::new(Utc::now(), "x".to_string());
        ev.parser = "Usb".into();
        ev.process_id = 2;
        apply_bugreport_parser_fields(&mut ev, &line);
        assert_eq!(ev.process_id, 0);
        assert_eq!(ev.action, "remove");
        assert_eq!(ev.app_name, "Linux Foundation");
    }
}
