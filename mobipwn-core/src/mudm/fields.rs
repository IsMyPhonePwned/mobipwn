use serde::{Deserialize, Serialize};

/// Mobile-focused UDM field categories (subset aligned with nano UDM grouping).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MudmFieldCategory {
    System,
    Endpoint,
    Network,
    Authentication,
    Malware,
    Process,
    Mobile,
    Enrichment,
    ThreatIntelligence,
    Detection,
}

/// Core MUDM columns stored explicitly in ClickHouse `events` (ad-hoc → `ext` JSON).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MudmField {
    pub name: &'static str,
    pub column: &'static str,
    pub category: MudmFieldCategory,
    pub description: &'static str,
}

macro_rules! field {
    ($name:expr, $col:expr, $cat:expr, $desc:expr) => {
        MudmField {
            name: $name,
            column: $col,
            category: $cat,
            description: $desc,
        }
    };
}

/// Searchable / sidebar fields (bloom-filter indexed where noted in schema).
pub const SEARCHABLE_FIELDS: &[MudmField] = &[
    field!("message", "message", MudmFieldCategory::System, "Human-readable event text"),
    field!("timestamp", "timestamp", MudmFieldCategory::System, "Event time UTC"),
    field!("source_type", "source_type", MudmFieldCategory::System, "android_bugreport | ios_sysdiagnose | vector"),
    field!("source", "source", MudmFieldCategory::System, "Ingest label / case id (e.g. case-001)"),
    field!("platform", "platform", MudmFieldCategory::Mobile, "android | ios | endpoint"),
    field!("device_id", "device_id", MudmFieldCategory::Mobile, "Stable device identifier"),
    field!("device_model", "device_model", MudmFieldCategory::Mobile, "Hardware model"),
    field!("os_version", "os_version", MudmFieldCategory::Mobile, "OS build / version"),
    field!("bundle_id", "bundle_id", MudmFieldCategory::Mobile, "iOS bundle or Android package"),
    field!("app_name", "app_name", MudmFieldCategory::Mobile, "Display name"),
    field!("parser", "parser", MudmFieldCategory::Mobile, "Extractor parser module id"),
    field!("data_type", "data_type", MudmFieldCategory::System, "Timeline data_type"),
    field!("event_time_binding", "event_time_binding", MudmFieldCategory::Mobile, "per_record | snapshot_only | system_fallback"),
    field!("process_name", "process_name", MudmFieldCategory::Process, "Process / command"),
    field!("process_id", "process_id", MudmFieldCategory::Process, "PID"),
    field!("user", "user", MudmFieldCategory::Authentication, "Unix-style user"),
    field!("src_ip", "src_ip", MudmFieldCategory::Network, "Source IP"),
    field!("dest_ip", "dest_ip", MudmFieldCategory::Network, "Destination IP"),
    field!(
        "local_port",
        "",
        MudmFieldCategory::Network,
        "Local socket port (ext, Network parser)"
    ),
    field!(
        "remote_port",
        "",
        MudmFieldCategory::Network,
        "Remote socket port (ext, Network parser)"
    ),
    field!("ssid", "ssid", MudmFieldCategory::Network, "Wi-Fi SSID"),
    field!("permission", "permission", MudmFieldCategory::Mobile, "Android permission or iOS TCC"),
    field!("file_hash", "file_hash", MudmFieldCategory::Malware, "File hash if present"),
    field!("severity", "severity", MudmFieldCategory::System, "info | low | medium | high"),
    field!("action", "action", MudmFieldCategory::System, "Normalized action"),
    field!(
        "tags",
        "",
        MudmFieldCategory::System,
        "Case/dataset tags from ingest (stored in ext; comma-separated in search/export)"
    ),
    field!(
        "installer",
        "",
        MudmFieldCategory::Mobile,
        "Installing package (ext / package install log), e.g. com.android.vending"
    ),
    field!(
        "event_type",
        "",
        MudmFieldCategory::System,
        "Sigma/timeline event type (e.g. network_socket, tombstone_backtrace) in ext"
    ),
    field!(
        "timestamp_desc",
        "",
        MudmFieldCategory::System,
        "SAF/activity label (e.g. Battery Level, process start time) in ext"
    ),
    field!(
        "raw_level",
        "",
        MudmFieldCategory::Mobile,
        "iOS powerlogs battery raw level (0–100) in ext"
    ),
    field!(
        "level",
        "",
        MudmFieldCategory::Mobile,
        "iOS powerlogs battery level (0–100) in ext"
    ),
    field!(
        "is_charging",
        "",
        MudmFieldCategory::Mobile,
        "iOS powerlogs charging flag in ext"
    ),
    field!(
        "args",
        "",
        MudmFieldCategory::Process,
        "Process argv after the executable (ps / ps_everywhere) in ext"
    ),
    field!(
        "command_line",
        "",
        MudmFieldCategory::Process,
        "Full process command line when known (ext)"
    ),
    field!(
        "ppid",
        "",
        MudmFieldCategory::Process,
        "Parent process id (ext)"
    ),
    field!(
        "parent",
        "",
        MudmFieldCategory::Process,
        "Parent process name / label (ext)"
    ),
    field!(
        "path",
        "",
        MudmFieldCategory::Process,
        "Process executable path (ext; also mirrored as file_path)"
    ),
    field!(
        "versionName",
        "",
        MudmFieldCategory::Mobile,
        "Android package versionName (ext)"
    ),
    field!(
        "permissions",
        "",
        MudmFieldCategory::Mobile,
        "Permission list / rollup when present (ext)"
    ),
    field!(
        "lock_status",
        "",
        MudmFieldCategory::Mobile,
        "iOS powerlogs lock status string (ext)"
    ),
    field!(
        "is_locked",
        "",
        MudmFieldCategory::Mobile,
        "iOS powerlogs locked flag (ext)"
    ),
    field!(
        "destination_domain",
        "",
        MudmFieldCategory::Network,
        "Remote hostname from sockets (ext)"
    ),
    field!("remote_ip", "", MudmFieldCategory::Network, "Remote IP (ext)"),
    field!("function", "", MudmFieldCategory::Process, "Crash backtrace symbol (ext)"),
    field!("file_path", "", MudmFieldCategory::Malware, "Path / filename IoC (ext)"),
    field!("email", "", MudmFieldCategory::Authentication, "Email IoC (ext)"),
    field!(
        "ext",
        "ext",
        MudmFieldCategory::System,
        "Raw parser-specific JSON blob (ClickHouse column)"
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_id_has_value_is_numeric() {
        assert_eq!(
            field_has_value_sql("process_id").as_deref(),
            Some("process_id != 0")
        );
    }

    #[test]
    fn timestamp_uses_is_not_null() {
        assert_eq!(
            field_has_value_sql("timestamp").as_deref(),
            Some("isNotNull(timestamp)")
        );
    }

    #[test]
    fn string_fields_use_not_empty() {
        assert_eq!(
            field_has_value_sql("platform").as_deref(),
            Some("notEmpty(platform)")
        );
    }

    #[test]
    fn ext_column_resolves_to_ch_column() {
        assert_eq!(resolve_field_sql("ext").as_deref(), Some("ext"));
    }

    #[test]
    fn ext_field_resolves_to_json_extract() {
        assert_eq!(
            resolve_field_sql("function").as_deref(),
            Some("JSONExtractString(ext, 'function')")
        );
    }

    #[test]
    fn installer_sql_reads_package_metadata_keys() {
        let sql = installer_sql();
        assert!(sql.contains("installerPackageName"));
        assert!(sql.contains("originatingPackageName"));
        assert!(field_has_value_sql("installer").unwrap().contains("coalesce"));
    }

    #[test]
    fn tags_field_resolves_to_ext_array_concat() {
        assert_eq!(
            resolve_field_sql("tags").as_deref(),
            Some("arrayStringConcat(JSONExtract(ext, 'tags', 'Array(String)'), ',')")
        );
    }
}

/// API / UI catalog row for the MUDM field reference page.
#[derive(Debug, Clone, Serialize)]
pub struct MudmFieldCatalogEntry {
    pub name: String,
    pub category: MudmFieldCategory,
    pub description: String,
    /// `column` = top-level ClickHouse column; `ext` = JSON in `events.ext`.
    pub storage: &'static str,
    pub column: Option<String>,
}

pub fn mudm_field_catalog() -> Vec<MudmFieldCatalogEntry> {
    let mut out: Vec<MudmFieldCatalogEntry> = SEARCHABLE_FIELDS
        .iter()
        .map(|f| {
            let storage = if f.column.is_empty() { "ext" } else { "column" };
            MudmFieldCatalogEntry {
                name: f.name.to_string(),
                category: f.category,
                description: f.description.to_string(),
                storage,
                column: if f.column.is_empty() {
                    None
                } else {
                    Some(f.column.to_string())
                },
            }
        })
        .collect();
    out.push(MudmFieldCatalogEntry {
        name: "ingest_time".into(),
        category: MudmFieldCategory::System,
        description: "Wall-clock time the event was inserted into ClickHouse".into(),
        storage: "column",
        column: Some("ingest_time".into()),
    });
    out.push(MudmFieldCatalogEntry {
        name: "ext".into(),
        category: MudmFieldCategory::System,
        description: "Raw parser-specific JSON blob; use named ext fields in mPL (e.g. destination_domain)".into(),
        storage: "column",
        column: Some("ext".into()),
    });
    out
}

pub fn column_for_field(name: &str) -> Option<&'static str> {
    SEARCHABLE_FIELDS
        .iter()
        .find(|f| f.name == name)
        .filter(|f| !f.column.is_empty())
        .map(|f| f.column)
}

/// ClickHouse columns / coerced ext fields stored as numbers (not compared to `''`).
pub fn is_numeric_field(name: &str) -> bool {
    matches!(
        name,
        "process_id" | "ppid" | "raw_level" | "level" | "local_port" | "remote_port"
    )
}

fn is_datetime_field(name: &str) -> bool {
    matches!(name, "timestamp")
}

/// Android package installer (bugreport uses `installerPackageName` in timeline JSON).
pub fn installer_sql() -> String {
    "coalesce(
        nullif(JSONExtractString(ext, 'installer'), ''),
        nullif(JSONExtractString(ext, 'installerPackageName'), ''),
        nullif(JSONExtractString(ext, 'initiatingPackageName'), ''),
        nullif(JSONExtractString(ext, 'originatingPackageName'), '')
    )"
    .to_string()
}

/// SQL expression for an mPL field (top-level column or `ext` JSONExtract).
pub fn resolve_field_sql(field: &str) -> Option<String> {
    let normalized = match field {
        "sourcetype" => "source_type",
        other => other,
    };
    if !SEARCHABLE_FIELDS.iter().any(|f| f.name == normalized) {
        return None;
    }
    if normalized == "installer" {
        return Some(installer_sql());
    }
    if normalized == "tags" {
        return Some(crate::mudm::tags::tags_sql());
    }
    if let Some(col) = column_for_field(normalized) {
        return Some(col.to_string());
    }
    // Numeric ext fields: coerce so avg/min/max/sum work in stats/timechart.
    if matches!(
        normalized,
        "raw_level" | "level" | "local_port" | "remote_port" | "ppid"
    ) {
        return Some(format!(
            "toFloat64OrNull(nullIf(JSONExtractString(ext, '{normalized}'), ''))"
        ));
    }
    Some(format!("JSONExtractString(ext, '{normalized}')"))
}

/// Predicate meaning “field is set” (safe for UInt32, DateTime64, and strings).
pub fn field_has_value_sql(field: &str) -> Option<String> {
    if field == "tags" {
        return Some("length(JSONExtract(ext, 'tags', 'Array(String)')) > 0".into());
    }
    let col = resolve_field_sql(field)?;
    Some(if matches!(field, "raw_level" | "level") {
        // 0% charge is valid — do not use `!= 0`.
        format!("isNotNull({col})")
    } else if is_numeric_field(field) {
        format!("{col} != 0")
    } else if is_datetime_field(field) {
        format!("isNotNull({col})")
    } else {
        format!("notEmpty({col})")
    })
}

/// Expression used as the grouped value in field-stats (`toString` for numeric columns).
pub fn field_stats_value_sql(field: &str) -> Option<String> {
    let col = resolve_field_sql(field)?;
    Some(if is_numeric_field(field) {
        format!("toString({col})")
    } else {
        col
    })
}
