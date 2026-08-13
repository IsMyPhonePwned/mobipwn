use chrono::{DateTime, Utc};
use mobipwn_core::ch::query_json_each_row;
use mobipwn_core::config::AppConfig;
use mobipwn_core::mudm::{canonical, is_endpoint, ENDPOINT};
use ironsift::{RawConnectionEntry, RawFileEntry, RawLogEntry};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExtractKind {
    Process,
    File,
    Network,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ScopeFilter {
    pub source: Option<String>,
    pub sources: Option<Vec<String>>,
    pub case_id: Option<Uuid>,
    pub platform: Option<String>,
    pub device_id: Option<String>,
    pub machine_ids: Option<Vec<String>>,
    pub baseline_tags: Option<Vec<String>>,
    pub candidate_tags: Option<Vec<String>>,
    pub time_from: Option<DateTime<Utc>>,
    pub time_to: Option<DateTime<Utc>>,
    pub baseline_from: Option<DateTime<Utc>>,
    pub baseline_to: Option<DateTime<Utc>>,
    pub current_from: Option<DateTime<Utc>>,
    pub current_to: Option<DateTime<Utc>>,
}

impl ScopeFilter {
    /// Default IronSift scope: endpoint platform telemetry only.
    pub fn endpoint_defaults() -> Self {
        Self {
            platform: Some(ENDPOINT.to_string()),
            ..Default::default()
        }
    }
}

pub async fn extract_process_logs(
    config: &AppConfig,
    filter: &ScopeFilter,
) -> anyhow::Result<Vec<RawLogEntry>> {
    let sql = format!(
        "SELECT device_id, source, process_name, process_id, user, ext, timestamp \
         FROM {}.events \
         WHERE {} \
         ORDER BY timestamp \
         LIMIT 500000",
        config.clickhouse_database,
        build_where(filter, ExtractKind::Process)
    );
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    Ok(rows.into_iter().filter_map(row_to_process_log).collect())
}

pub async fn extract_process_logs_window(
    config: &AppConfig,
    filter: &ScopeFilter,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> anyhow::Result<Vec<RawLogEntry>> {
    let mut f = filter.clone();
    f.time_from = Some(from);
    f.time_to = Some(to);
    extract_process_logs(config, &f).await
}

pub async fn extract_file_logs(
    config: &AppConfig,
    filter: &ScopeFilter,
) -> anyhow::Result<Vec<RawFileEntry>> {
    let sql = format!(
        "SELECT device_id, source, process_name, user, file_hash, ext, timestamp \
         FROM {}.events \
         WHERE {} \
         ORDER BY timestamp \
         LIMIT 500000",
        config.clickhouse_database,
        build_where(filter, ExtractKind::File)
    );
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    Ok(rows.into_iter().filter_map(row_to_file_log).collect())
}

pub async fn extract_connection_logs(
    config: &AppConfig,
    filter: &ScopeFilter,
) -> anyhow::Result<Vec<RawConnectionEntry>> {
    let sql = format!(
        "SELECT device_id, source, process_name, src_ip, dest_ip, ext, timestamp \
         FROM {}.events \
         WHERE {} \
         ORDER BY timestamp \
         LIMIT 500000",
        config.clickhouse_database,
        build_where(filter, ExtractKind::Network)
    );
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    Ok(rows.into_iter().filter_map(row_to_connection_log).collect())
}

pub fn distinct_machine_ids(logs: &[RawLogEntry]) -> Vec<String> {
    let mut ids: Vec<String> = logs
        .iter()
        .map(|l| l.machine_id.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    ids.sort();
    ids
}

fn effective_platform(filter: &ScopeFilter) -> String {
    filter
        .platform
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(canonical)
        .unwrap_or_else(|| ENDPOINT.to_string())
}

fn platform_clause(filter: &ScopeFilter) -> String {
    let platform = effective_platform(filter);
    if platform == ENDPOINT {
        // Include legacy vector-tagged rows until re-ingested as endpoint.
        "platform IN ('endpoint', 'vector')".into()
    } else {
        format!("platform = '{}'", escape_sql(&platform))
    }
}

fn build_where(filter: &ScopeFilter, kind: ExtractKind) -> String {
    let endpoint = is_endpoint(&effective_platform(filter));
    let mut parts = vec![platform_clause(filter)];

    if let Some(ref sources) = filter.sources.as_ref().filter(|s| !s.is_empty()) {
        if sources.len() == 1 {
            parts.push(format!("source = '{}'", escape_sql(&sources[0])));
        } else {
            parts.push(format!(
                "source IN ({})",
                sql_in_list(sources)
            ));
        }
    } else if let Some(s) = filter.source.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!("source = '{}'", escape_sql(s)));
    }

    let mut machine_ids: Vec<String> = filter
        .machine_ids
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if let Some(d) = filter.device_id.as_deref().filter(|s| !s.is_empty()) {
        if !machine_ids.iter().any(|m| m == d) {
            machine_ids.push(d.to_string());
        }
    }
    if !machine_ids.is_empty() {
        if machine_ids.len() == 1 {
            parts.push(format!("device_id = '{}'", escape_sql(&machine_ids[0])));
        } else {
            parts.push(format!(
                "device_id IN ({})",
                sql_in_list(&machine_ids)
            ));
        }
    }
    if let Some(t) = filter.time_from {
        parts.push(format!(
            "timestamp >= parseDateTime64BestEffort('{}')",
            t.format("%Y-%m-%d %H:%M:%S%.6f")
        ));
    }
    if let Some(t) = filter.time_to {
        parts.push(format!(
            "timestamp <= parseDateTime64BestEffort('{}')",
            t.format("%Y-%m-%d %H:%M:%S%.6f")
        ));
    }
    match kind {
        ExtractKind::Process if endpoint => {
            parts.push(
                "(process_name != '' OR parser IN ('Process', 'process', 'vector'))".into(),
            );
        }
        ExtractKind::Process => {
            parts.push("parser IN ('Process', 'process')".into());
            parts.push("process_name != ''".into());
        }
        ExtractKind::File if endpoint => {
            parts.push(
                "(file_hash != '' OR JSONHas(ext, 'file_path') OR JSONHas(ext, 'path') OR parser IN ('file', 'File', 'vector'))".into(),
            );
        }
        ExtractKind::File => {
            parts.push("parser IN ('Crash', 'crash', 'Package', 'package')".into());
            parts.push(
                "(file_hash != '' OR JSONHas(ext, 'file_path') OR JSONHas(ext, 'path'))".into(),
            );
        }
        ExtractKind::Network if endpoint => {
            parts.push("(dest_ip != '' OR parser IN ('Network', 'network', 'vector'))".into());
        }
        ExtractKind::Network => {
            parts.push("parser IN ('Network', 'network')".into());
            parts.push("dest_ip != ''".into());
        }
    }
    parts.join(" AND ")
}

fn escape_sql(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

fn sql_in_list(values: &[String]) -> String {
    values
        .iter()
        .map(|v| format!("'{}'", escape_sql(v)))
        .collect::<Vec<_>>()
        .join(", ")
}

pub async fn list_device_ids_for_filter(
    config: &AppConfig,
    filter: &ScopeFilter,
) -> anyhow::Result<Vec<String>> {
    let sql = format!(
        "SELECT DISTINCT device_id FROM {}.events WHERE {} AND device_id != '' ORDER BY device_id LIMIT 10000",
        config.clickhouse_database,
        build_where(filter, ExtractKind::Process)
    );
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| opt_str(&r, "device_id"))
        .collect())
}

fn machine_id(row: &Value) -> String {
    opt_str(row, "device_id")
        .or_else(|| opt_str(row, "source"))
        .unwrap_or_else(|| "unknown".into())
}

fn row_to_process_log(row: Value) -> Option<RawLogEntry> {
    let ext = parse_ext(&row);
    let process_name = opt_str(&row, "process_name")
        .or_else(|| {
            ext.get("process")
                .or_else(|| ext.get("process_name"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .or_else(|| {
            opt_str(&row, "message").and_then(|m| parse_process_name_from_message(&m))
        })?;
    let pid = row.get("process_id").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let ppid = ext
        .get("ppid")
        .or_else(|| ext.get("parent_pid"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let path = ext
        .get("path")
        .or_else(|| ext.get("exe"))
        .and_then(|v| v.as_str())
        .unwrap_or(&process_name)
        .to_string();
    let args = ext
        .get("args")
        .or_else(|| ext.get("cmdline"))
        .or_else(|| ext.get("command_line"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let uid = ext
        .get("uid")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            opt_str(&row, "user")
                .and_then(|u| u.parse().ok())
        })
        .unwrap_or(1000) as u32;
    Some(RawLogEntry {
        machine_id: machine_id(&row),
        pid,
        ppid,
        name: process_name,
        uid,
        path,
        args,
        timestamp: opt_str(&row, "timestamp"),
    })
}

fn row_to_file_log(row: Value) -> Option<RawFileEntry> {
    let ext = parse_ext(&row);
    let path = ext
        .get("file_path")
        .or_else(|| ext.get("path"))
        .or_else(|| ext.get("filename"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| opt_str(&row, "file_hash"))?;
    let uid = ext
        .get("uid")
        .and_then(|v| v.as_u64())
        .unwrap_or(1000) as u32;
    Some(RawFileEntry {
        machine_id: machine_id(&row),
        path,
        uid,
        timestamp: opt_str(&row, "timestamp"),
        mtime: ext
            .get("mtime")
            .or_else(|| ext.get("modified"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        permissions: ext.get("permissions").or_else(|| ext.get("mode")).and_then(|v| v.as_str()).map(str::to_string),
        owner: ext.get("owner").and_then(|v| v.as_str()).map(str::to_string),
        group: ext.get("group").and_then(|v| v.as_str()).map(str::to_string),
        size: ext.get("size").and_then(|v| v.as_u64()),
    })
}

fn row_to_connection_log(row: Value) -> Option<RawConnectionEntry> {
    let ext = parse_ext(&row);
    let remote = opt_str(&row, "dest_ip").or_else(|| {
        ext.get("dest_ip")
            .or_else(|| ext.get("remote_ip"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    })?;
    let port = ext
        .get("remote_port")
        .or_else(|| ext.get("dest_port"))
        .and_then(|v| v.as_u64())
        .map(|p| p as u16);
    Some(RawConnectionEntry {
        machine_id: machine_id(&row),
        remote_ip: remote,
        local_ip: opt_str(&row, "src_ip"),
        remote_port: port,
        process_name: opt_str(&row, "process_name"),
        timestamp: opt_str(&row, "timestamp"),
    })
}

fn parse_ext(row: &Value) -> Value {
    match row.get("ext") {
        Some(Value::Object(_)) => row.get("ext").cloned().unwrap_or(Value::Null),
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn opt_str(row: &Value, key: &str) -> Option<String> {
    row.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn parse_process_name_from_message(message: &str) -> Option<String> {
    let msg = message.trim();
    let rest = msg.strip_prefix("process ")?;
    let token = rest.split_whitespace().next()?.trim();
    if token.is_empty() || token.eq_ignore_ascii_case("pid") {
        None
    } else {
        Some(token.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_where_defaults_to_endpoint_platform() {
        let f = ScopeFilter::default();
        let w = build_where(&f, ExtractKind::Process);
        assert!(w.contains("platform IN ('endpoint', 'vector')"));
    }

    #[test]
    fn build_where_includes_source() {
        let f = ScopeFilter {
            source: Some("case-001".into()),
            ..ScopeFilter::endpoint_defaults()
        };
        let w = build_where(&f, ExtractKind::Process);
        assert!(w.contains("source = 'case-001'"));
        assert!(w.contains("platform IN ('endpoint', 'vector')"));
    }
}
