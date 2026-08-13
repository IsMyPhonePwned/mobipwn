//! Side-by-side comparison of two investigation cases (entities + device snapshot).
//! Supports Android bugreports and iOS sysdiagnoses.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::ch::query_json_each_row;
use crate::config::AppConfig;
use crate::db::{DualPool, PoolHealth};
use crate::entities::{fetch_case_entities, EntityTypeSummary};
use crate::mudm::{
    androidboot_cmdline_value, androidboot_em_model, androidboot_serialno,
    parse_android_build_fingerprint,
};
use crate::store::{CaseRecord, CollectBlob};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ComparePlatform {
    Android,
    Ios,
}

impl ComparePlatform {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "android" | "bugreport" | "apk" => Some(Self::Android),
            "ios" | "sysdiagnose" | "iphone" | "ipad" => Some(Self::Ios),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Android => "android",
            Self::Ios => "ios",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Android => "Android",
            Self::Ios => "iOS",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareCaseMeta {
    pub case_id: Uuid,
    pub title: String,
    pub ingest_source: String,
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_ingest_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_ingest_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub android_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imei: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unique_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob_file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob_file_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob_created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareEntityItem {
    pub value: String,
    pub count_a: u64,
    pub count_b: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityCompareSection {
    pub entity_type: String,
    pub label: String,
    pub only_a: Vec<CompareEntityItem>,
    pub only_b: Vec<CompareEntityItem>,
    pub shared: Vec<CompareEntityItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareSummary {
    pub shared_count: usize,
    pub only_a_count: usize,
    pub only_b_count: usize,
    pub sections: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseComparisonResponse {
    pub platform: String,
    pub case_a: CompareCaseMeta,
    pub case_b: CompareCaseMeta,
    pub summary: CompareSummary,
    pub sections: Vec<EntityCompareSection>,
}

/// Legacy alias kept for any in-flight callers.
pub type BugreportComparisonResponse = CaseComparisonResponse;

pub fn is_android_case(case: &CaseRecord) -> bool {
    if case.ingest_source.as_deref().unwrap_or("").is_empty() {
        return false;
    }
    case.tags.iter().any(|t| {
        let t = t.to_lowercase();
        t == "android" || t == "bugreport" || t == "apk"
    })
}

pub fn is_ios_case(case: &CaseRecord) -> bool {
    if case.ingest_source.as_deref().unwrap_or("").is_empty() {
        return false;
    }
    case.tags.iter().any(|t| {
        let t = t.to_lowercase();
        t == "ios" || t == "sysdiagnose" || t == "iphone" || t == "ipad"
    })
}

pub fn is_comparable_case(case: &CaseRecord, platform: ComparePlatform) -> bool {
    match platform {
        ComparePlatform::Android => is_android_case(case),
        ComparePlatform::Ios => is_ios_case(case),
    }
}

/// Deprecated name — use [`is_android_case`].
pub fn is_android_bugreport_case(case: &CaseRecord) -> bool {
    is_android_case(case)
}

pub fn entity_type_label(entity_type: &str) -> &'static str {
    match entity_type {
        "bundle" => "Installed packages",
        "process" => "Running processes",
        "ip" => "IP addresses",
        "domain" => "Domains",
        "host" => "Hosts / devices",
        "user" => "Users",
        "hash" => "File hashes",
        "file" => "Files",
        "url" => "URLs",
        "email" => "Emails",
        "bluetooth" => "Bluetooth devices",
        "usb" => "USB devices",
        "usb_port" => "USB ports",
        "adb" => "ADB / debugging",
        "ssid" => "Wi‑Fi networks",
        "account" => "Accounts",
        "vpn" => "VPN",
        _ => "Other",
    }
}

/// High-signal sections for bugreport/sysdiagnose diffs (shown first).
const SECTION_ORDER: &[&str] = &[
    "usb",
    "usb_port",
    "adb",
    "bluetooth",
    "ssid",
    "account",
    "vpn",
    "bundle",
    "process",
    "ip",
    "domain",
    "host",
    "user",
    "hash",
    "file",
    "url",
    "email",
];

/// Telemetry types that fluctuate between near-identical captures — omit from compare.
const COMPARE_DROP_ENTITY_TYPES: &[&str] = &["ip", "domain", "url", "hash", "file", "email", "user", "host"];

fn entity_maps(entities: &[EntityTypeSummary]) -> HashMap<String, HashMap<String, u64>> {
    let mut out: HashMap<String, HashMap<String, u64>> = HashMap::new();
    for group in entities {
        let map = out.entry(group.entity_type.clone()).or_default();
        for e in &group.entities {
            *map.entry(e.entity_value.clone()).or_insert(0) += e.occurrence_count;
        }
    }
    out
}

fn merge_type_maps(
    base: &mut HashMap<String, HashMap<String, u64>>,
    extra: HashMap<String, HashMap<String, u64>>,
) {
    for (ty, values) in extra {
        let dest = base.entry(ty).or_default();
        for (k, c) in values {
            *dest.entry(k).or_insert(0) += c;
        }
    }
}

pub fn compare_value_maps(
    map_a: HashMap<String, HashMap<String, u64>>,
    map_b: HashMap<String, HashMap<String, u64>>,
) -> (CompareSummary, Vec<EntityCompareSection>) {
    let mut types: HashSet<String> = map_a.keys().cloned().chain(map_b.keys().cloned()).collect();

    let mut sections = Vec::new();
    let mut only_a_total = 0usize;
    let mut only_b_total = 0usize;
    let mut shared_total = 0usize;

    let mut ordered: Vec<String> = SECTION_ORDER
        .iter()
        .filter(|t| types.remove(**t))
        .map(|s| (*s).to_string())
        .collect();
    let mut rest: Vec<String> = types.into_iter().collect();
    rest.sort();
    ordered.append(&mut rest);

    for entity_type in ordered {
        let a = map_a.get(&entity_type);
        let b = map_b.get(&entity_type);
        let keys_a: HashSet<&String> = a.map(|m| m.keys().collect()).unwrap_or_default();
        let keys_b: HashSet<&String> = b.map(|m| m.keys().collect()).unwrap_or_default();

        let mut only_a = Vec::new();
        let mut only_b = Vec::new();
        let mut shared = Vec::new();

        for key in &keys_a {
            if keys_b.contains(key) {
                continue;
            }
            only_a.push(CompareEntityItem {
                value: (*key).clone(),
                count_a: a.and_then(|m| m.get(*key)).copied().unwrap_or(0),
                count_b: 0,
            });
        }
        for key in &keys_b {
            if keys_a.contains(key) {
                continue;
            }
            only_b.push(CompareEntityItem {
                value: (*key).clone(),
                count_a: 0,
                count_b: b.and_then(|m| m.get(*key)).copied().unwrap_or(0),
            });
        }
        for key in keys_a.intersection(&keys_b) {
            shared.push(CompareEntityItem {
                value: (*key).clone(),
                count_a: a.and_then(|m| m.get(*key)).copied().unwrap_or(0),
                count_b: b.and_then(|m| m.get(*key)).copied().unwrap_or(0),
            });
        }

        only_a.sort_by(|x, y| y.count_a.cmp(&x.count_a).then_with(|| x.value.cmp(&y.value)));
        only_b.sort_by(|x, y| y.count_b.cmp(&x.count_b).then_with(|| x.value.cmp(&y.value)));
        shared.sort_by(|x, y| {
            (y.count_a + y.count_b)
                .cmp(&(x.count_a + x.count_b))
                .then_with(|| x.value.cmp(&y.value))
        });

        only_a_total += only_a.len();
        only_b_total += only_b.len();
        shared_total += shared.len();

        if only_a.is_empty() && only_b.is_empty() && shared.is_empty() {
            continue;
        }

        sections.push(EntityCompareSection {
            label: entity_type_label(&entity_type).to_string(),
            entity_type,
            only_a,
            only_b,
            shared,
        });
    }

    let summary = CompareSummary {
        shared_count: shared_total,
        only_a_count: only_a_total,
        only_b_count: only_b_total,
        sections: sections.len(),
    };
    (summary, sections)
}

pub fn compare_entity_responses(
    entities_a: &[EntityTypeSummary],
    entities_b: &[EntityTypeSummary],
) -> (CompareSummary, Vec<EntityCompareSection>) {
    compare_value_maps(entity_maps(entities_a), entity_maps(entities_b))
}

struct DeviceSnapshot {
    device_model: Option<String>,
    device_id: Option<String>,
    serial_number: Option<String>,
    android_id: Option<String>,
    imei: Option<String>,
    meid: Option<String>,
    unique_device_id: Option<String>,
    os_version: Option<String>,
    product_name: Option<String>,
    build_fingerprint: Option<String>,
    build_id: Option<String>,
    sdk: Option<String>,
}

fn opt_nonempty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

fn escape_clickhouse_literal(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "''")
}

fn json_field<'a>(row: Option<&'a serde_json::Value>, key: &str) -> Option<String> {
    row.and_then(|r| r.get(key))
        .and_then(|v| v.as_str())
        .and_then(opt_nonempty)
}

async fn fetch_column_device_fields(
    config: &AppConfig,
    source: &str,
) -> (Option<String>, Option<String>, Option<String>) {
    let esc = escape_clickhouse_literal(source);
    let db = &config.clickhouse_database;
    let sql = format!(
        "SELECT device_model, device_id, os_version, count() AS c \
         FROM {db}.events \
         WHERE source = '{esc}' AND (device_model != '' OR device_id != '' OR os_version != '') \
         GROUP BY device_model, device_id, os_version \
         ORDER BY c DESC \
         LIMIT 1"
    );
    let rows = query_json_each_row(config, db, &sql).await.unwrap_or_default();
    let row = rows.first();
    (
        json_field(row, "device_model"),
        json_field(row, "device_id"),
        json_field(row, "os_version"),
    )
}

fn first_regex_capture(haystack: &str, pattern: &str) -> Option<String> {
    let re = regex::Regex::new(pattern).ok()?;
    re.captures(haystack)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| !s.is_empty())
}

fn looks_like_imei(s: &str) -> bool {
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    (14..=17).contains(&digits.len())
}

fn looks_like_android_id(s: &str) -> bool {
    let t = s.trim();
    t.len() >= 8
        && t.len() <= 32
        && t.chars()
            .all(|c| c.is_ascii_hexdigit())
}

async fn fetch_android_radio_ids(
    config: &AppConfig,
    source: &str,
) -> (Option<String>, Option<String>, Option<String>) {
    let esc = escape_clickhouse_literal(source);
    let db = &config.clickhouse_database;
    let sql = format!(
        "SELECT \
            message, \
            JSONExtractString(ext, 'imei') AS imei, \
            JSONExtractString(ext, 'IMEI') AS imei_u, \
            JSONExtractString(ext, 'meid') AS meid, \
            JSONExtractString(ext, 'MEID') AS meid_u, \
            JSONExtractString(ext, 'android_id') AS android_id \
         FROM {db}.events \
         WHERE source = '{esc}' \
           AND ( \
             JSONExtractString(ext, 'imei') != '' \
             OR JSONExtractString(ext, 'IMEI') != '' \
             OR JSONExtractString(ext, 'meid') != '' \
             OR JSONExtractString(ext, 'android_id') != '' \
             OR positionCaseInsensitiveUTF8(message, 'IMEI') > 0 \
             OR positionCaseInsensitiveUTF8(message, 'MEID') > 0 \
             OR positionCaseInsensitiveUTF8(message, 'android_id') > 0 \
           ) \
         LIMIT 40"
    );
    let rows = query_json_each_row(config, db, &sql).await.unwrap_or_default();
    let mut imei = None;
    let mut meid = None;
    let mut android_id = None;
    for row in &rows {
        if imei.is_none() {
            imei = json_field(Some(row), "imei")
                .or_else(|| json_field(Some(row), "imei_u"))
                .filter(|s| looks_like_imei(s));
            if imei.is_none() {
                let msg = row.get("message").and_then(|v| v.as_str()).unwrap_or("");
                imei = first_regex_capture(msg, r"(?i)\bIMEI\s*[:=]?\s*([0-9\s-]{14,22})")
                    .map(|s| s.chars().filter(|c| c.is_ascii_digit()).collect::<String>())
                    .filter(|s| looks_like_imei(s));
            }
        }
        if meid.is_none() {
            meid = json_field(Some(row), "meid")
                .or_else(|| json_field(Some(row), "meid_u"));
            if meid.is_none() {
                let msg = row.get("message").and_then(|v| v.as_str()).unwrap_or("");
                meid = first_regex_capture(msg, r"(?i)\bMEID\s*[:=]?\s*([0-9A-Fa-f\s-]{8,20})")
                    .map(|s| {
                        s.chars()
                            .filter(|c| c.is_ascii_hexdigit())
                            .collect::<String>()
                    })
                    .filter(|s| s.len() >= 8);
            }
        }
        if android_id.is_none() {
            android_id = json_field(Some(row), "android_id").filter(|s| looks_like_android_id(s));
            if android_id.is_none() {
                let msg = row.get("message").and_then(|v| v.as_str()).unwrap_or("");
                android_id =
                    first_regex_capture(msg, r"(?i)\bandroid[_ ]?id\s*[:=]?\s*([0-9a-fA-F]{8,32})")
                        .filter(|s| looks_like_android_id(s));
            }
        }
        if imei.is_some() && meid.is_some() && android_id.is_some() {
            break;
        }
    }
    (imei, meid, android_id)
}

async fn fetch_android_device_snapshot(
    config: &AppConfig,
    source: &str,
) -> anyhow::Result<DeviceSnapshot> {
    let esc = escape_clickhouse_literal(source);
    let db = &config.clickhouse_database;

    let header_sql = format!(
        "SELECT \
            JSONExtractString(ext, 'Build fingerprint') AS fingerprint, \
            JSONExtractString(ext, 'Command line') AS cmdline, \
            JSONExtractString(ext, 'Bootconfig') AS bootconfig, \
            JSONExtractString(ext, 'Android SDK version') AS sdk, \
            JSONExtractString(ext, 'Build') AS build, \
            JSONExtractString(ext, 'serial') AS serial, \
            JSONExtractString(ext, 'Serial number') AS serial_number, \
            JSONExtractString(ext, 'android_id') AS android_id, \
            JSONExtractString(ext, 'IMEI') AS imei, \
            JSONExtractString(ext, 'imei') AS imei_l, \
            JSONExtractString(ext, 'MEID') AS meid \
         FROM {db}.events \
         WHERE source = '{esc}' AND parser = 'Header' \
         LIMIT 1"
    );
    let header_rows = query_json_each_row(config, db, &header_sql)
        .await
        .unwrap_or_default();
    let header = header_rows.first();
    let fingerprint = json_field(header, "fingerprint");
    let cmdline = header
        .and_then(|r| r.get("cmdline"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let bootconfig = header
        .and_then(|r| r.get("bootconfig"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let sdk = json_field(header, "sdk");
    let build = json_field(header, "build");

    let marketing = androidboot_em_model(cmdline);
    let fp = fingerprint
        .as_deref()
        .and_then(parse_android_build_fingerprint);

    let mut device_model = if !marketing.is_empty() {
        Some(marketing)
    } else {
        fp.as_ref()
            .map(|p| p.display_model())
            .filter(|s| !s.is_empty())
    };
    let mut os_version = fp
        .as_ref()
        .filter(|p| !p.release.is_empty())
        .map(|p| format!("Android {}", p.release))
        .or_else(|| sdk.as_ref().map(|s| format!("API {s}")));
    let build_id = fp
        .as_ref()
        .map(|p| p.build_id.clone())
        .filter(|s| !s.is_empty())
        .or(build);

    let serial_from_cmdline = {
        let from_cmd = androidboot_serialno(cmdline);
        if from_cmd.is_empty() {
            androidboot_serialno(bootconfig)
        } else {
            from_cmd
        }
    };
    let mut serial_number = json_field(header, "serial_number")
        .or_else(|| json_field(header, "serial"))
        .or_else(|| opt_nonempty(&serial_from_cmdline));
    let mut android_id = json_field(header, "android_id");
    let mut imei = json_field(header, "imei")
        .or_else(|| json_field(header, "imei_l"))
        .filter(|s| looks_like_imei(s));
    let mut meid = json_field(header, "meid");

    let (col_model, col_device_id, col_os) = fetch_column_device_fields(config, source).await;
    if device_model.is_none() {
        device_model = col_model;
    }
    if os_version.is_none() {
        os_version = col_os.filter(|s| {
            s.starts_with("Android")
                || s.starts_with("iPhone OS")
                || s.chars().all(|c| c.is_ascii_digit())
        });
    }
    // Column device_id is often the hardware serial when Header mapping filled it.
    if serial_number.is_none() {
        serial_number = col_device_id.clone().filter(|s| {
            // Avoid Bluetooth MACs accidentally treated as serial.
            !(s.contains(':') && s.len() <= 17)
        });
    }

    let (radio_imei, radio_meid, radio_android_id) =
        fetch_android_radio_ids(config, source).await;
    if imei.is_none() {
        imei = radio_imei;
    }
    if meid.is_none() {
        meid = radio_meid;
    }
    if android_id.is_none() {
        android_id = radio_android_id;
    }

    let device_id = serial_number
        .clone()
        .or(col_device_id)
        .or_else(|| android_id.clone());

    Ok(DeviceSnapshot {
        device_model,
        device_id,
        serial_number,
        android_id,
        imei,
        meid,
        unique_device_id: None,
        os_version,
        product_name: None,
        build_fingerprint: fingerprint,
        build_id,
        sdk,
    })
}

async fn fetch_ios_device_snapshot(
    config: &AppConfig,
    source: &str,
) -> anyhow::Result<DeviceSnapshot> {
    let esc = escape_clickhouse_literal(source);
    let db = &config.clickhouse_database;

    // Prefer remotectl / lockdown / ioservice device_metadata rows.
    let meta_sql = format!(
        "SELECT \
            device_model, \
            device_id, \
            os_version, \
            JSONExtractString(ext, 'unique_device_id') AS unique_device_id, \
            JSONExtractString(ext, 'build_version') AS build_version, \
            JSONExtractString(ext, 'product_name') AS product_name, \
            JSONExtractString(ext, 'product_type') AS product_type \
         FROM {db}.events \
         WHERE source = '{esc}' \
           AND ( \
             JSONExtractString(ext, 'event_type') = 'device_metadata' \
             OR parser IN ('remotectl_dumpstate', 'lockdownd', 'ioservice') \
           ) \
           AND (device_model != '' OR device_id != '' OR os_version != '' \
                OR JSONExtractString(ext, 'unique_device_id') != '') \
         LIMIT 1"
    );
    let meta_rows = query_json_each_row(config, db, &meta_sql)
        .await
        .unwrap_or_default();
    let meta = meta_rows.first();

    let mut device_model = json_field(meta, "device_model").or_else(|| json_field(meta, "product_type"));
    let mut device_id = json_field(meta, "device_id");
    let mut os_version = json_field(meta, "os_version").map(|v| {
        if v.starts_with("iOS") || v.starts_with("iPhone OS") {
            v
        } else {
            format!("iOS {v}")
        }
    });
    let unique_device_id = json_field(meta, "unique_device_id");
    let build_id = json_field(meta, "build_version");
    let product_name = json_field(meta, "product_name");

    let (col_model, col_id, col_os) = fetch_column_device_fields(config, source).await;
    if device_model.is_none() {
        device_model = col_model;
    }
    if device_id.is_none() {
        device_id = col_id.clone();
    }
    if os_version.is_none() {
        os_version = col_os.map(|v| {
            if v.starts_with("iOS") || v.starts_with("iPhone OS") || v.starts_with("Android") {
                v
            } else {
                format!("iOS {v}")
            }
        });
    }
    // When serial is missing, surface UDID as device_id for identity panels.
    if device_id.is_none() {
        device_id = unique_device_id.clone();
    }

    Ok(DeviceSnapshot {
        device_model,
        serial_number: device_id.clone(),
        android_id: None,
        imei: None,
        meid: None,
        unique_device_id,
        device_id,
        os_version,
        product_name,
        build_fingerprint: None,
        build_id,
        sdk: None,
    })
}

async fn fetch_device_snapshot(
    config: &AppConfig,
    source: &str,
    platform: ComparePlatform,
) -> anyhow::Result<DeviceSnapshot> {
    match platform {
        ComparePlatform::Android => fetch_android_device_snapshot(config, source).await,
        ComparePlatform::Ios => fetch_ios_device_snapshot(config, source).await,
    }
}

fn case_source_key(case: &CaseRecord) -> String {
    case.ingest_source
        .clone()
        .unwrap_or_else(|| case.title.clone())
}

/// Attach durable device identifiers so the comparison picker can distinguish prior reports.
pub async fn enrich_eligible_case_identifiers(
    config: &AppConfig,
    platform: ComparePlatform,
    cases: &mut [CaseRecord],
) {
    let mut sources: Vec<String> = cases
        .iter()
        .map(case_source_key)
        .filter(|s| !s.trim().is_empty())
        .collect();
    if sources.is_empty() {
        return;
    }
    sources.sort();
    sources.dedup();

    let in_list = sources
        .iter()
        .map(|s| format!("'{}'", escape_clickhouse_literal(s)))
        .collect::<Vec<_>>()
        .join(",");
    let db = &config.clickhouse_database;

    let sql = match platform {
        ComparePlatform::Android => format!(
            "SELECT \
                source, \
                any(device_id) AS device_id, \
                any(JSONExtractString(ext, 'serial')) AS serial, \
                any(JSONExtractString(ext, 'Serial number')) AS serial_number, \
                any(JSONExtractString(ext, 'android_id')) AS android_id, \
                any(JSONExtractString(ext, 'IMEI')) AS imei, \
                any(JSONExtractString(ext, 'imei')) AS imei_l, \
                any(JSONExtractString(ext, 'Command line')) AS cmdline, \
                any(JSONExtractString(ext, 'Bootconfig')) AS bootconfig \
             FROM {db}.events \
             WHERE source IN ({in_list}) AND parser = 'Header' \
             GROUP BY source"
        ),
        ComparePlatform::Ios => format!(
            "SELECT \
                source, \
                any(device_id) AS device_id, \
                any(unique_device_id) AS unique_device_id, \
                any(JSONExtractString(ext, 'unique_device_id')) AS unique_device_id_ext, \
                any(JSONExtractString(ext, 'SerialNumber')) AS serial_number, \
                any(JSONExtractString(ext, 'serial_number')) AS serial_number_l \
             FROM {db}.events \
             WHERE source IN ({in_list}) \
               AND ( \
                 parser IN ('remotectl_dumpstate', 'lockdownd', 'ioservice') \
                 OR device_id != '' \
                 OR unique_device_id != '' \
               ) \
             GROUP BY source"
        ),
    };

    let rows = query_json_each_row(config, db, &sql)
        .await
        .unwrap_or_default();

    let mut by_source: HashMap<String, DeviceIdBits> = HashMap::new();
    for row in &rows {
        let Some(source) = row.get("source").and_then(|v| v.as_str()) else {
            continue;
        };
        let bits = match platform {
            ComparePlatform::Android => {
                let cmdline = row
                    .get("cmdline")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let bootconfig = row
                    .get("bootconfig")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let serial_from_cmdline = {
                    let from_cmd = androidboot_serialno(cmdline);
                    if from_cmd.is_empty() {
                        androidboot_serialno(bootconfig)
                    } else {
                        from_cmd
                    }
                };
                let serial_number = json_field(Some(row), "serial_number")
                    .or_else(|| json_field(Some(row), "serial"))
                    .or_else(|| opt_nonempty(&serial_from_cmdline));
                let device_id = json_field(Some(row), "device_id");
                let mut android_id =
                    json_field(Some(row), "android_id").filter(|s| looks_like_android_id(s));
                // Samsung dumpstate often redacts serial/IMEI but keeps sec_ext.uniqueno.
                if android_id.is_none() {
                    let uniqueno = androidboot_cmdline_value(cmdline, "sec_ext.uniqueno");
                    if looks_like_android_id(&uniqueno) {
                        android_id = Some(uniqueno);
                    }
                }
                if android_id.is_none() {
                    let uniqueno = androidboot_cmdline_value(bootconfig, "sec_ext.uniqueno");
                    if looks_like_android_id(&uniqueno) {
                        android_id = Some(uniqueno);
                    }
                }
                let imei = json_field(Some(row), "imei")
                    .or_else(|| json_field(Some(row), "imei_l"))
                    .filter(|s| looks_like_imei(s));
                DeviceIdBits {
                    device_id: device_id.clone(),
                    serial_number: serial_number.or_else(|| {
                        device_id.filter(|s| !(s.contains(':') && s.len() <= 17))
                    }),
                    android_id,
                    unique_device_id: None,
                    imei,
                }
            }
            ComparePlatform::Ios => {
                let unique_device_id = json_field(Some(row), "unique_device_id")
                    .or_else(|| json_field(Some(row), "unique_device_id_ext"));
                let serial_number = json_field(Some(row), "serial_number")
                    .or_else(|| json_field(Some(row), "serial_number_l"));
                let mut device_id = json_field(Some(row), "device_id");
                if device_id.is_none() {
                    device_id = unique_device_id.clone();
                }
                DeviceIdBits {
                    device_id,
                    serial_number,
                    android_id: None,
                    unique_device_id,
                    imei: None,
                }
            }
        };
        by_source.insert(source.to_string(), bits);
    }

    for case in cases.iter_mut() {
        let key = case_source_key(case);
        let Some(bits) = by_source.get(&key) else {
            continue;
        };
        case.device_id = bits.device_id.clone();
        case.serial_number = bits.serial_number.clone();
        case.android_id = bits.android_id.clone();
        case.unique_device_id = bits.unique_device_id.clone();
        case.imei = bits.imei.clone();
    }

    // Header often omits IMEI; fill gaps from radio / dumpsys-style events.
    if platform == ComparePlatform::Android {
        let missing_imei: Vec<String> = cases
            .iter()
            .filter(|c| c.imei.as_deref().unwrap_or("").is_empty())
            .map(case_source_key)
            .filter(|s| !s.trim().is_empty())
            .collect();
        if !missing_imei.is_empty() {
            let mut missing = missing_imei;
            missing.sort();
            missing.dedup();
            let missing_list = missing
                .iter()
                .map(|s| format!("'{}'", escape_clickhouse_literal(s)))
                .collect::<Vec<_>>()
                .join(",");
            let radio_sql = format!(
                "SELECT \
                    source, \
                    any(JSONExtractString(ext, 'imei')) AS imei, \
                    any(JSONExtractString(ext, 'IMEI')) AS imei_u, \
                    any(JSONExtractString(ext, 'android_id')) AS android_id, \
                    any(message) AS message \
                 FROM {db}.events \
                 WHERE source IN ({missing_list}) \
                   AND ( \
                     JSONExtractString(ext, 'imei') != '' \
                     OR JSONExtractString(ext, 'IMEI') != '' \
                     OR JSONExtractString(ext, 'android_id') != '' \
                     OR positionCaseInsensitiveUTF8(message, 'IMEI') > 0 \
                     OR positionCaseInsensitiveUTF8(message, 'android_id') > 0 \
                   ) \
                 GROUP BY source"
            );
            let radio_rows = query_json_each_row(config, db, &radio_sql)
                .await
                .unwrap_or_default();
            let mut radio_by_source: HashMap<String, (Option<String>, Option<String>)> =
                HashMap::new();
            for row in &radio_rows {
                let Some(source) = row.get("source").and_then(|v| v.as_str()) else {
                    continue;
                };
                let mut imei = json_field(Some(row), "imei")
                    .or_else(|| json_field(Some(row), "imei_u"))
                    .filter(|s| looks_like_imei(s));
                if imei.is_none() {
                    let msg = row.get("message").and_then(|v| v.as_str()).unwrap_or("");
                    imei = first_regex_capture(msg, r"(?i)\bIMEI\s*[:=]?\s*([0-9\s-]{14,22})")
                        .map(|s| s.chars().filter(|c| c.is_ascii_digit()).collect::<String>())
                        .filter(|s| looks_like_imei(s));
                }
                let android_id =
                    json_field(Some(row), "android_id").filter(|s| looks_like_android_id(s));
                radio_by_source.insert(source.to_string(), (imei, android_id));
            }
            for case in cases.iter_mut() {
                let key = case_source_key(case);
                let Some((imei, android_id)) = radio_by_source.get(&key) else {
                    continue;
                };
                if case.imei.is_none() {
                    case.imei = imei.clone();
                }
                if case.android_id.is_none() {
                    case.android_id = android_id.clone();
                }
            }
        }
    }
}

#[derive(Default)]
struct DeviceIdBits {
    device_id: Option<String>,
    serial_number: Option<String>,
    android_id: Option<String>,
    unique_device_id: Option<String>,
    imei: Option<String>,
}

/// Attach latest archive SHA-256 per ingest source (from collect_blobs).
pub fn attach_eligible_blob_hashes(
    cases: &mut [CaseRecord],
    hash_by_source: &HashMap<String, String>,
) {
    for case in cases.iter_mut() {
        let key = case_source_key(case);
        if let Some(hash) = hash_by_source.get(&key).cloned() {
            case.blob_file_hash = Some(hash);
        }
    }
}

fn case_meta(
    case: &CaseRecord,
    platform: ComparePlatform,
    device: DeviceSnapshot,
    event_count: Option<u64>,
    blob: Option<&CollectBlob>,
) -> CompareCaseMeta {
    CompareCaseMeta {
        case_id: case.id,
        title: case.title.clone(),
        ingest_source: case.ingest_source.clone().unwrap_or_default(),
        platform: platform.as_str().to_string(),
        event_count,
        case_user: {
            let u = case.user.trim();
            if u.is_empty() {
                None
            } else {
                Some(u.to_string())
            }
        },
        first_ingest_at: case.first_ingest_at.clone(),
        last_ingest_at: case.last_ingest_at.clone(),
        device_model: device.device_model,
        device_id: device.device_id,
        serial_number: device.serial_number,
        android_id: device.android_id,
        imei: device.imei,
        meid: device.meid,
        unique_device_id: device.unique_device_id,
        os_version: device.os_version,
        product_name: device.product_name,
        build_fingerprint: device.build_fingerprint,
        build_id: device.build_id,
        sdk: device.sdk,
        blob_file_name: blob.map(|b| b.file_name.clone()),
        blob_file_hash: blob
            .map(|b| b.file_hash.clone())
            .filter(|h| !h.is_empty()),
        blob_created_at: blob.map(|b| b.created_at.to_rfc3339()),
    }
}

fn rows_to_value_counts(rows: &[serde_json::Value]) -> HashMap<String, u64> {
    let mut out = HashMap::new();
    for row in rows {
        let value = row
            .get("value")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let Some(value) = value else { continue };
        let count = row
            .get("c")
            .and_then(|v| v.as_u64())
            .or_else(|| row.get("c").and_then(|v| v.as_i64()).map(|n| n.max(0) as u64))
            .unwrap_or(1);
        *out.entry(value.to_string()).or_insert(0) += count.max(1);
    }
    out
}

async fn fetch_grouped_values(config: &AppConfig, sql: &str) -> HashMap<String, u64> {
    let db = &config.clickhouse_database;
    let rows = query_json_each_row(config, db, sql).await.unwrap_or_default();
    rows_to_value_counts(&rows)
}

/// External-device / wireless / account artifacts not covered by generic entity extraction.
async fn fetch_compare_artifacts(
    config: &AppConfig,
    source: &str,
    platform: ComparePlatform,
) -> HashMap<String, HashMap<String, u64>> {
    let esc = escape_clickhouse_literal(source);
    let db = &config.clickhouse_database;
    let mut out: HashMap<String, HashMap<String, u64>> = HashMap::new();

    let bluetooth_sql = format!(
        "SELECT \
            if(device_id != '', device_id, \
              if(app_name != '', app_name, \
                if(JSONExtractString(ext, 'mac_address') != '', JSONExtractString(ext, 'mac_address'), \
                  JSONExtractString(ext, 'address')))) AS value, \
            count() AS c \
         FROM {db}.events \
         WHERE source = '{esc}' AND parser = 'Bluetooth' \
           AND (device_id != '' OR app_name != '' \
                OR JSONExtractString(ext, 'mac_address') != '' \
                OR JSONExtractString(ext, 'address') != '') \
         GROUP BY value \
         HAVING value != '' \
         ORDER BY c DESC \
         LIMIT 500"
    );

    // Prefer stable VID:PID; include product/driver for readability. Also cover
    // Samsung SFS usb_device_attached (parser SamsungSfsLogs) and broader Usb rows.
    let usb_sql = match platform {
        ComparePlatform::Android => format!(
            "SELECT \
                multiIf( \
                  (JSONExtractString(ext, 'vid') != '' OR JSONExtractString(ext, 'vendor_id') != '') \
                    AND (JSONExtractString(ext, 'product_id') != '' OR JSONExtractString(ext, 'pid') != ''), \
                    concat( \
                      if(JSONExtractString(ext, 'product_name') != '', \
                        concat(JSONExtractString(ext, 'product_name'), ' '), ''), \
                      lower(replaceRegexpOne( \
                        if(JSONExtractString(ext, 'vid') != '', JSONExtractString(ext, 'vid'), JSONExtractString(ext, 'vendor_id')), \
                        '^0x', '')), \
                      ':', \
                      lower(replaceRegexpOne( \
                        if(JSONExtractString(ext, 'product_id') != '', JSONExtractString(ext, 'product_id'), JSONExtractString(ext, 'pid')), \
                        '^0x', '')), \
                      if(JSONExtractString(ext, 'driver') != '', \
                        concat(' (', JSONExtractString(ext, 'driver'), ')'), '') \
                    ), \
                  JSONExtractString(ext, 'vid') != '' OR JSONExtractString(ext, 'vendor_id') != '', \
                    concat( \
                      lower(replaceRegexpOne( \
                        if(JSONExtractString(ext, 'vid') != '', JSONExtractString(ext, 'vid'), JSONExtractString(ext, 'vendor_id')), \
                        '^0x', '')), \
                      if(JSONExtractString(ext, 'driver') != '', \
                        concat(' (', JSONExtractString(ext, 'driver'), ')'), '') \
                    ), \
                  startsWith(message, 'USB device'), message, \
                  JSONExtractString(ext, 'driver') != '', JSONExtractString(ext, 'driver'), \
                  JSONExtractString(ext, 'product_name') != '', JSONExtractString(ext, 'product_name'), \
                  JSONExtractString(ext, 'interface') != '', concat('iface:', JSONExtractString(ext, 'interface')), \
                  '' \
                ) AS value, \
                count() AS c \
             FROM {db}.events \
             WHERE source = '{esc}' \
               AND ( \
                 (parser = 'Usb' AND ( \
                   data_type LIKE '%usb_device%' \
                   OR startsWith(message, 'USB device') \
                   OR JSONExtractString(ext, 'vid') != '' \
                   OR JSONExtractString(ext, 'vendor_id') != '' \
                   OR JSONExtractString(ext, 'product_id') != '' \
                   OR JSONExtractString(ext, 'driver') != '' \
                   OR JSONExtractString(ext, 'product_name') != '' \
                 )) \
                 OR (parser = 'SamsungSfsLogs' AND ( \
                   data_type LIKE '%usb_device%' \
                   OR JSONExtractString(ext, 'event') = 'usb_device_attached' \
                   OR JSONExtractString(ext, 'vendor_id') != '' \
                 )) \
               ) \
               AND NOT (data_type LIKE '%usb_port%' OR startsWith(message, 'USB port:')) \
             GROUP BY value \
             HAVING value != '' AND value != ':' AND value != '?:' \
             ORDER BY c DESC \
             LIMIT 500"
        ),
        ComparePlatform::Ios => format!(
            "SELECT \
                multiIf( \
                  JSONExtractString(ext, 'id_vendor') != '' OR JSONExtractString(ext, 'usb_vendor') != '', \
                    concat( \
                      if(JSONExtractString(ext, 'usb_product') != '', JSONExtractString(ext, 'usb_product'), \
                        if(JSONExtractString(ext, 'usb_vendor') != '', JSONExtractString(ext, 'usb_vendor'), 'USB')), \
                      ' (', \
                      if(JSONExtractString(ext, 'id_vendor') != '', JSONExtractString(ext, 'id_vendor'), '?'), \
                      '/', \
                      if(JSONExtractString(ext, 'id_product') != '', JSONExtractString(ext, 'id_product'), '?'), \
                      ')' \
                    ), \
                  JSONExtractString(ext, 'usb_product') != '', JSONExtractString(ext, 'usb_product'), \
                  message != '', message, \
                  '' \
                ) AS value, \
                count() AS c \
             FROM {db}.events \
             WHERE source = '{esc}' AND parser = 'iousb' \
               AND (JSONExtractString(ext, 'usb_kind') = 'device' \
                    OR JSONExtractString(ext, 'id_vendor') != '' \
                    OR JSONExtractString(ext, 'usb_product') != '') \
             GROUP BY value \
             HAVING value != '' \
             ORDER BY c DESC \
             LIMIT 500"
        ),
    };

    let usb_port_sql = match platform {
        ComparePlatform::Android => Some(format!(
            "SELECT \
                concat( \
                  'port:', \
                  if(JSONExtractString(ext, 'id') != '', JSONExtractString(ext, 'id'), \
                    replaceRegexpOne(message, '^USB port:\\\\s*', '')) \
                ) AS value, \
                count() AS c \
             FROM {db}.events \
             WHERE source = '{esc}' AND parser = 'Usb' \
               AND (data_type LIKE '%usb_port%' OR startsWith(message, 'USB port:')) \
             GROUP BY value \
             HAVING value != '' AND value != 'port:' \
             ORDER BY c DESC \
             LIMIT 200"
        )),
        ComparePlatform::Ios => None,
    };

    let adb_sql = match platform {
        ComparePlatform::Android => Some(format!(
            "SELECT \
                multiIf( \
                  JSONExtractString(ext, 'identifier') != '', \
                    concat('key:', JSONExtractString(ext, 'identifier')), \
                  JSONExtractString(ext, 'last_key_received') != '', \
                    concat('last_key:', JSONExtractString(ext, 'last_key_received')), \
                  JSONExtractString(ext, 'connected_to_adb') != '', \
                    concat('connected:', JSONExtractString(ext, 'connected_to_adb')), \
                  JSONExtractString(ext, 'event') = 'adb_connection', \
                    if(message != '', message, 'adb_connection'), \
                  startsWith(message, 'ADB'), message, \
                  '' \
                ) AS value, \
                count() AS c \
             FROM {db}.events \
             WHERE source = '{esc}' \
               AND ( \
                 parser = 'Adb' \
                 OR (parser = 'SamsungSfsLogs' AND ( \
                   data_type LIKE '%adb%' \
                   OR JSONExtractString(ext, 'event') = 'adb_connection' \
                 )) \
               ) \
             GROUP BY value \
             HAVING value != '' \
             ORDER BY c DESC \
             LIMIT 200"
        )),
        ComparePlatform::Ios => None,
    };

    let ssid_sql = format!(
        "SELECT ssid AS value, count() AS c \
         FROM {db}.events \
         WHERE source = '{esc}' AND ssid != '' \
         GROUP BY ssid \
         ORDER BY c DESC \
         LIMIT 500"
    );

    let account_sql = format!(
        "SELECT \
            if(JSONExtractString(ext, 'account_name') != '', JSONExtractString(ext, 'account_name'), \
              if(JSONExtractString(ext, 'email') != '', JSONExtractString(ext, 'email'), \
                if(app_name != '', app_name, user))) AS value, \
            count() AS c \
         FROM {db}.events \
         WHERE source = '{esc}' AND parser = 'Account' \
         GROUP BY value \
         HAVING value != '' \
         ORDER BY c DESC \
         LIMIT 500"
    );

    let vpn_sql = format!(
        "SELECT \
            if(bundle_id != '', bundle_id, \
              if(app_name != '', app_name, \
                if(JSONExtractString(ext, 'package_name') != '', JSONExtractString(ext, 'package_name'), \
                  if(message != '', message, action)))) AS value, \
            count() AS c \
         FROM {db}.events \
         WHERE source = '{esc}' AND parser = 'Vpn' \
         GROUP BY value \
         HAVING value != '' \
         ORDER BY c DESC \
         LIMIT 200"
    );

    let package_sql = match platform {
        ComparePlatform::Android => format!(
            "SELECT bundle_id AS value, count() AS c \
             FROM {db}.events \
             WHERE source = '{esc}' AND parser = 'Package' \
               AND data_type LIKE '%package_metadata%' AND bundle_id != '' \
             GROUP BY bundle_id \
             ORDER BY c DESC \
             LIMIT 5000"
        ),
        ComparePlatform::Ios => format!(
            "SELECT bundle_id AS value, count() AS c \
             FROM {db}.events \
             WHERE source = '{esc}' AND bundle_id != '' \
               AND ( \
                 parser IN ('mobileinstallation', 'appinstallation', 'accessibility_tcc', 'itunesstore', 'mobilebackup') \
                 OR (parser = 'powerlogs' AND positionCaseInsensitive(message, 'App Info:') > 0) \
                 OR (parser = 'plists' AND positionCaseInsensitive(message, 'itunesmetadata') > 0) \
               ) \
             GROUP BY bundle_id \
             ORDER BY c DESC \
             LIMIT 5000"
        ),
    };

    let process_sql = format!(
        "SELECT process_name AS value, count() AS c \
         FROM {db}.events \
         WHERE source = '{esc}' AND parser = 'Process' AND process_name != '' \
         GROUP BY process_name \
         ORDER BY c DESC \
         LIMIT 2000"
    );

    let usb_port_fut = async {
        match &usb_port_sql {
            Some(sql) => fetch_grouped_values(config, sql).await,
            None => HashMap::new(),
        }
    };
    let adb_fut = async {
        match &adb_sql {
            Some(sql) => fetch_grouped_values(config, sql).await,
            None => HashMap::new(),
        }
    };

    let (bluetooth, usb, usb_port, adb, ssid, account, vpn, packages, processes) = tokio::join!(
        fetch_grouped_values(config, &bluetooth_sql),
        fetch_grouped_values(config, &usb_sql),
        usb_port_fut,
        adb_fut,
        fetch_grouped_values(config, &ssid_sql),
        fetch_grouped_values(config, &account_sql),
        fetch_grouped_values(config, &vpn_sql),
        fetch_grouped_values(config, &package_sql),
        fetch_grouped_values(config, &process_sql),
    );

    if !bluetooth.is_empty() {
        out.insert("bluetooth".into(), bluetooth);
    }
    if !usb.is_empty() {
        out.insert("usb".into(), usb);
    }
    if !usb_port.is_empty() {
        out.insert("usb_port".into(), usb_port);
    }
    if !adb.is_empty() {
        out.insert("adb".into(), adb);
    }
    if !ssid.is_empty() {
        out.insert("ssid".into(), ssid);
    }
    if !account.is_empty() {
        out.insert("account".into(), account);
    }
    if !vpn.is_empty() {
        out.insert("vpn".into(), vpn);
    }
    // Overwrite opportunistic entity extraction with real inventories.
    if !packages.is_empty() {
        out.insert("bundle".into(), packages);
    }
    if !processes.is_empty() {
        out.insert("process".into(), processes);
    }
    out
}

pub async fn compare_cases(
    pool: &DualPool,
    config: &AppConfig,
    platform: ComparePlatform,
    case_a: &CaseRecord,
    case_b: &CaseRecord,
    blob_a: Option<&CollectBlob>,
    blob_b: Option<&CollectBlob>,
) -> anyhow::Result<CaseComparisonResponse> {
    if pool.health().await != PoolHealth::Full {
        anyhow::bail!("ClickHouse unavailable");
    }
    if !is_comparable_case(case_a, platform) || !is_comparable_case(case_b, platform) {
        anyhow::bail!(
            "both cases must be {} ingests",
            platform.label()
        );
    }
    let source_a = case_a
        .ingest_source
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("case A has no ingest source"))?;
    let source_b = case_b
        .ingest_source
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("case B has no ingest source"))?;

    let (entities_a, entities_b, device_a, device_b, count_a, count_b, artifacts_a, artifacts_b) =
        tokio::join!(
            fetch_case_entities(pool, config, source_a, case_a.primary_anchor.as_ref()),
            fetch_case_entities(pool, config, source_b, case_b.primary_anchor.as_ref()),
            fetch_device_snapshot(config, source_a, platform),
            fetch_device_snapshot(config, source_b, platform),
            crate::data::count_events_by_source(config, source_a),
            crate::data::count_events_by_source(config, source_b),
            fetch_compare_artifacts(config, source_a, platform),
            fetch_compare_artifacts(config, source_b, platform),
        );

    let entities_a = entities_a?;
    let entities_b = entities_b?;
    let device_a = device_a?;
    let device_b = device_b?;
    let count_a = count_a?;
    let count_b = count_b?;

    let mut map_a = entity_maps(&entities_a.entities);
    let mut map_b = entity_maps(&entities_b.entities);
    for ty in COMPARE_DROP_ENTITY_TYPES {
        map_a.remove(*ty);
        map_b.remove(*ty);
    }
    // Prefer inventory-backed package/process maps from artifacts (overwrites sample noise).
    map_a.remove("bundle");
    map_b.remove("bundle");
    map_a.remove("process");
    map_b.remove("process");
    merge_type_maps(&mut map_a, artifacts_a);
    merge_type_maps(&mut map_b, artifacts_b);
    let (summary, sections) = compare_value_maps(map_a, map_b);

    Ok(CaseComparisonResponse {
        platform: platform.as_str().to_string(),
        case_a: case_meta(case_a, platform, device_a, Some(count_a), blob_a),
        case_b: case_meta(case_b, platform, device_b, Some(count_b), blob_b),
        summary,
        sections,
    })
}

/// Deprecated name — use [`compare_cases`] with [`ComparePlatform::Android`].
pub async fn compare_bugreport_cases(
    pool: &DualPool,
    config: &AppConfig,
    case_a: &CaseRecord,
    case_b: &CaseRecord,
    blob_a: Option<&CollectBlob>,
    blob_b: Option<&CollectBlob>,
) -> anyhow::Result<CaseComparisonResponse> {
    compare_cases(
        pool,
        config,
        ComparePlatform::Android,
        case_a,
        case_b,
        blob_a,
        blob_b,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::{EntityType, ExtractedEntity};

    fn entity(entity_type: EntityType, value: &str, count: u64) -> ExtractedEntity {
        ExtractedEntity {
            entity_type,
            entity_value: value.into(),
            occurrence_count: count,
            is_primary: false,
            risk_score: None,
            enrichment_data: None,
        }
    }

    fn group(entity_type: EntityType, entities: Vec<ExtractedEntity>) -> EntityTypeSummary {
        EntityTypeSummary {
            entity_type: entity_type.as_str().to_string(),
            count: entities.len(),
            entities,
        }
    }

    fn sample_case(tags: Vec<&str>) -> CaseRecord {
        CaseRecord {
            id: Uuid::nil(),
            title: "t".into(),
            description: String::new(),
            status: "open".into(),
            priority: "normal".into(),
            user: String::new(),
            tags: tags.into_iter().map(str::to_string).collect(),
            ingest_source: Some("case-1".into()),
            event_count: Some(1),
            first_ingest_at: None,
            last_ingest_at: None,
            ingest_run_count: None,
            device_model: None,
            os_version: None,
            device_id: None,
            serial_number: None,
            android_id: None,
            unique_device_id: None,
            imei: None,
            blob_file_hash: None,
            alert_count: 0,
            primary_anchor: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn compare_splits_only_and_shared() {
        let a = vec![
            group(EntityType::Bundle, vec![
                entity(EntityType::Bundle, "com.foo", 10),
                entity(EntityType::Bundle, "com.shared", 2),
            ]),
            group(EntityType::Process, vec![entity(EntityType::Process, "init", 5)]),
        ];
        let b = vec![
            group(EntityType::Bundle, vec![
                entity(EntityType::Bundle, "com.bar", 8),
                entity(EntityType::Bundle, "com.shared", 3),
            ]),
            group(
                EntityType::Ip,
                vec![entity(EntityType::Ip, "1.2.3.4", 1)],
            ),
        ];
        let (summary, sections) = compare_entity_responses(&a, &b);
        assert_eq!(summary.only_a_count, 2);
        assert_eq!(summary.only_b_count, 2);
        assert_eq!(summary.shared_count, 1);
        let bundles = sections.iter().find(|s| s.entity_type == "bundle").unwrap();
        assert_eq!(bundles.only_a[0].value, "com.foo");
        assert_eq!(bundles.only_b[0].value, "com.bar");
        assert_eq!(bundles.shared[0].value, "com.shared");
    }

    #[test]
    fn compare_includes_external_device_artifact_types() {
        let mut map_a = HashMap::new();
        map_a.insert(
            "bluetooth".into(),
            HashMap::from([("AA:BB:CC:DD:EE:FF".into(), 2u64)]),
        );
        map_a.insert(
            "usb".into(),
            HashMap::from([("1d6b:2".into(), 1u64), ("239a:80f4".into(), 3u64)]),
        );
        let mut map_b = HashMap::new();
        map_b.insert(
            "bluetooth".into(),
            HashMap::from([
                ("AA:BB:CC:DD:EE:FF".into(), 1u64),
                ("11:22:33:44:55:66".into(), 4u64),
            ]),
        );
        map_b.insert("usb".into(), HashMap::from([("239a:80f4".into(), 1u64)]));
        map_b.insert("ssid".into(), HashMap::from([("CafeWifi".into(), 5u64)]));

        let (summary, sections) = compare_value_maps(map_a, map_b);
        assert_eq!(summary.only_a_count, 1); // 1d6b:2
        assert_eq!(summary.only_b_count, 2); // new BT + CafeWifi
        assert_eq!(summary.shared_count, 2); // shared BT + shared USB
        assert!(sections.iter().any(|s| s.entity_type == "bluetooth"));
        assert!(sections.iter().any(|s| s.entity_type == "usb"));
        assert!(sections.iter().any(|s| s.entity_type == "ssid"));
        assert_eq!(entity_type_label("bluetooth"), "Bluetooth devices");
        assert_eq!(entity_type_label("usb"), "USB devices");
        assert_eq!(entity_type_label("usb_port"), "USB ports");
        assert_eq!(entity_type_label("adb"), "ADB / debugging");
    }

    #[test]
    fn compare_splits_usb_ports_and_adb() {
        let mut map_a = HashMap::new();
        map_a.insert(
            "usb".into(),
            HashMap::from([("1d6b:2 (hub)".into(), 1u64)]),
        );
        map_a.insert(
            "usb_port".into(),
            HashMap::from([("port:0".into(), 1u64)]),
        );
        map_a.insert(
            "adb".into(),
            HashMap::from([("connected:false".into(), 1u64)]),
        );
        let mut map_b = HashMap::new();
        map_b.insert(
            "usb".into(),
            HashMap::from([
                ("1d6b:2 (hub)".into(), 1u64),
                ("239a:80f4 (cdc_acm)".into(), 2u64),
            ]),
        );
        map_b.insert(
            "usb_port".into(),
            HashMap::from([("port:0".into(), 1u64), ("port:1".into(), 1u64)]),
        );
        map_b.insert(
            "adb".into(),
            HashMap::from([
                ("connected:true".into(), 1u64),
                ("key:alice@host".into(), 1u64),
            ]),
        );

        let (summary, sections) = compare_value_maps(map_a, map_b);
        assert_eq!(summary.only_a_count, 1); // connected:false
        assert_eq!(summary.only_b_count, 4); // new usb + port:1 + connected:true + key
        assert_eq!(summary.shared_count, 2); // usb hub + port:0
        assert!(sections.iter().any(|s| s.entity_type == "usb_port"));
        assert!(sections.iter().any(|s| s.entity_type == "adb"));
        let usb = sections.iter().find(|s| s.entity_type == "usb").unwrap();
        assert_eq!(usb.only_b.len(), 1);
        assert_eq!(usb.only_b[0].value, "239a:80f4 (cdc_acm)");
    }

    #[test]
    fn platform_case_detection() {
        let android = sample_case(vec!["android", "ingested"]);
        let ios = sample_case(vec!["ios", "sysdiagnose"]);
        assert!(is_android_case(&android));
        assert!(!is_ios_case(&android));
        assert!(is_ios_case(&ios));
        assert!(!is_android_case(&ios));
        assert!(is_comparable_case(&android, ComparePlatform::Android));
        assert!(is_comparable_case(&ios, ComparePlatform::Ios));
        assert!(!is_comparable_case(&ios, ComparePlatform::Android));
    }

    #[test]
    fn parse_platform() {
        assert_eq!(ComparePlatform::parse("android"), Some(ComparePlatform::Android));
        assert_eq!(ComparePlatform::parse("iOS"), Some(ComparePlatform::Ios));
        assert_eq!(ComparePlatform::parse("sysdiagnose"), Some(ComparePlatform::Ios));
        assert_eq!(ComparePlatform::parse("other"), None);
    }
}
