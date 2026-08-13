use crate::ch::query_json_each_row;
use crate::config::AppConfig;
use crate::enrichment::ch::{escape_ch, exec_sql};
use crate::enrichment::options::SyncOptions;
use crate::enrichment::progress::SyncProgress;
use crate::enrichment::provider::{ProviderAdapter, SyncResult};
use crate::enrichment::sync_metrics::SyncStats;
use crate::mudm::resolve_field_sql;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;

#[derive(Debug, Clone, Copy, Default)]
pub struct VirusTotalAdapter;

#[derive(Debug, Clone)]
struct VtStats {
    malicious: u16,
    harmless: u16,
    undetected: u16,
    suspicious: u16,
    reputation: i32,
}

#[derive(Debug, Clone)]
struct VtRow {
    indicator: String,
    indicator_type: String,
    label: String,
    score: f32,
    stats: VtStats,
}

#[async_trait]
impl ProviderAdapter for VirusTotalAdapter {
    fn slug(&self) -> &'static str {
        "virustotal"
    }

    fn config_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "api_key": {
                    "type": "string",
                    "description": "VirusTotal API key (https://www.virustotal.com/gui/my-apikey)"
                },
                "max_indicators_per_type": {
                    "type": "integer",
                    "default": 25,
                    "description": "Max distinct IPs/domains/hashes to query per sync"
                },
                "lookback_days": {
                    "type": "integer",
                    "default": 90,
                    "description": "Only consider indicators seen in events within this window (defaults to MOBIPWN_EVENTS_TTL_DAYS)"
                },
                "request_delay_ms": {
                    "type": "integer",
                    "default": 15000,
                    "description": "Delay between API calls in ms. Use 15000 for free tier (~4 req/min), 0 to disable."
                }
            },
            "required": ["api_key"]
        })
    }

    fn covers_fields(&self) -> &'static [&'static str] {
        &["src_ip", "dest_ip", "destination_domain", "file_hash"]
    }

    async fn sync(
        &self,
        config: &AppConfig,
        provider_cfg: &Value,
        progress: &SyncProgress,
        options: &SyncOptions,
    ) -> anyhow::Result<SyncResult> {
        let api_key = provider_cfg
            .get("api_key")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow::anyhow!("virustotal api_key is required"))?;

        let max_per = provider_cfg
            .get("max_indicators_per_type")
            .and_then(|v| v.as_u64())
            .unwrap_or(25)
            .min(100) as u32;
        let lookback = provider_cfg
            .get("lookback_days")
            .and_then(|v| v.as_u64())
            .unwrap_or(config.events_ttl_days as u64)
            .clamp(1, config.events_ttl_days as u64) as u32;
        let delay_ms = provider_cfg
            .get("request_delay_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(15_000);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;

        #[derive(Clone)]
        struct VtJob {
            field: &'static str,
            indicator_type: &'static str,
            query_value: String,
        }

        let field_specs = [
            ("src_ip", "ip"),
            ("dest_ip", "ip"),
            ("destination_domain", "domain"),
            ("file_hash", "file_hash"),
        ];

        let mode = if options.full_resync {
            "full"
        } else {
            "incremental"
        };
        let mut stats = SyncStats::with_mode(mode);

        let mut jobs: Vec<VtJob> = Vec::new();
        let mut seen = HashSet::new();
        let existing = if options.full_resync {
            HashSet::new()
        } else {
            progress.provider(
                "virustotal",
                "collect",
                "Loading already enriched VirusTotal indicators…",
            );
            let keys = existing_vt_indicator_keys(config).await?;
            progress.provider(
                "virustotal",
                "collect_done",
                format!("{} indicator(s) already enriched (will skip)", keys.len()),
            );
            keys
        };

        for (field, indicator_type) in field_specs {
            progress.provider(
                "virustotal",
                "collect",
                format!("Scanning events for distinct {field} values…"),
            );
            let values = distinct_field_values(config, field, max_per, lookback).await?;
            progress.provider(
                "virustotal",
                "collect_done",
                format!("Found {} raw value(s) for {field}", values.len()),
            );
            for raw_value in values {
                let Some(query_value) = normalize_indicator(indicator_type, &raw_value) else {
                    stats.skipped_invalid += 1;
                    progress.request(
                        "virustotal",
                        field,
                        &raw_value,
                        "skip",
                        format!("Skip invalid indicator: {raw_value}"),
                    );
                    continue;
                };
                let dedupe_key = format!("{indicator_type}:{query_value}");
                if !options.full_resync && existing.contains(&dedupe_key) {
                    stats.skipped_already_enriched += 1;
                    progress.request(
                        "virustotal",
                        field,
                        &query_value,
                        "skip",
                        format!("Already enriched: {query_value}"),
                    );
                    continue;
                }
                if seen.insert(dedupe_key) {
                    jobs.push(VtJob {
                        field,
                        indicator_type,
                        query_value,
                    });
                } else {
                    stats.skipped_duplicate += 1;
                    progress.request(
                        "virustotal",
                        field,
                        &query_value,
                        "skip",
                        format!("Skip duplicate {indicator_type}:{query_value}"),
                    );
                }
            }
        }

        stats.queued = jobs.len() as u32;
        progress.provider(
            "virustotal",
            "plan",
            format!("Queued {} VirusTotal API request(s)", jobs.len()),
        );

        let mut written = 0usize;
        let total = jobs.len();
        for (idx, job) in jobs.iter().enumerate() {
            progress.ensure_not_cancelled()?;
            let n = idx + 1;
            stats.api_requests += 1;
            progress.request(
                "virustotal",
                job.field,
                &job.query_value,
                "query",
                format!(
                    "GET /api/v3/{} {} ({}) [{n}/{total}]",
                    job.indicator_type, job.query_value, job.field
                ),
            );
            match fetch_vt(&client, api_key, job.indicator_type, &job.query_value).await {
                Ok(Some(row)) => {
                    stats.api_ok += 1;
                    progress.request(
                        "virustotal",
                        job.field,
                        &job.query_value,
                        "query_ok",
                        format!("{} → {}", job.query_value, row.label),
                    );
                    write_vt_ioc(config, job.field, &row).await?;
                    progress.request(
                        "virustotal",
                        job.field,
                        &job.query_value,
                        "write",
                        format!("Stored enrichment row for {}", job.query_value),
                    );
                    written += 1;
                }
                Ok(None) => {
                    stats.api_miss += 1;
                    progress.request(
                        "virustotal",
                        job.field,
                        &job.query_value,
                        "query_miss",
                        format!("No VT report for {}", job.query_value),
                    );
                }
                Err(e) => {
                    stats.api_errors += 1;
                    progress.request(
                        "virustotal",
                        job.field,
                        &job.query_value,
                        "query_err",
                        format!("VT API error for {}: {e}", job.query_value),
                    );
                }
            }
            if n < total && delay_ms > 0 {
                progress.provider(
                    "virustotal",
                    "wait",
                    format!("Waiting {delay_ms} ms before next request (API rate limit)…"),
                );
                progress.sleep_cancellable(delay_ms).await?;
            }
        }

        stats.rows_written = written as u32;
        Ok(SyncResult {
            rows_written: written,
            stats,
        })
    }
}

pub async fn test_api_key(api_key: &str) -> anyhow::Result<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?;
    let v = vt_get(&client, api_key, "ip", "8.8.8.8").await?;
    let stats = parse_vt_stats(&v).ok_or_else(|| anyhow::anyhow!("unexpected VT response shape"))?;
    let label = format_vt_label(&stats);
    Ok(format!("API key valid — sample 8.8.8.8: {label}"))
}

async fn existing_vt_indicator_keys(config: &AppConfig) -> anyhow::Result<HashSet<String>> {
    let db = &config.clickhouse_database;
    let sql = format!(
        "SELECT indicator_type, indicator FROM {db}.ioc_enrichments WHERE startsWith(malware_family, 'VT ')"
    );
    let rows = query_json_each_row(config, db, &sql).await.unwrap_or_default();
    let mut keys = HashSet::new();
    for row in rows {
        let Some(indicator_type) = row.get("indicator_type").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(indicator) = row.get("indicator").and_then(|v| v.as_str()) else {
            continue;
        };
        if indicator.is_empty() {
            continue;
        }
        keys.insert(format!("{indicator_type}:{indicator}"));
    }
    Ok(keys)
}

async fn distinct_field_values(
    config: &AppConfig,
    field: &str,
    limit: u32,
    lookback_days: u32,
) -> anyhow::Result<Vec<String>> {
    let col = resolve_field_sql(field)
        .ok_or_else(|| anyhow::anyhow!("unsupported field: {field}"))?;
    let sql = format!(
        "SELECT v FROM ( \
         SELECT {col} AS v, max(ingest_time) AS last_seen \
         FROM {db}.events \
         WHERE notEmpty({col}) AND {col} != '::' \
         AND (timestamp >= now() - INTERVAL {lookback_days} DAY \
              OR ingest_time >= now() - INTERVAL {lookback_days} DAY) \
         GROUP BY v \
         ORDER BY last_seen DESC \
         LIMIT {limit})",
        db = config.clickhouse_database,
    );
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| r.get("v").and_then(|v| v.as_str()).map(String::from))
        .filter(|v| !v.trim().is_empty() && v != "::")
        .collect())
}

/// ClickHouse expression matching [`normalize_indicator`] for IP fields.
pub fn clickhouse_ip_indicator_key(column: &str) -> String {
    crate::net::ip_resolve::clickhouse_ip_indicator_key(column)
}

/// Normalize indicator values for VT API calls and dictionary keys.
pub fn normalize_indicator(indicator_type: &str, raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() || value == "::" {
        return None;
    }
    match indicator_type {
        "ip" => normalize_ip(value),
        "domain" => normalize_domain(value),
        "file_hash" => normalize_file_hash(value),
        _ => None,
    }
}

fn normalize_ip(raw: &str) -> Option<String> {
    crate::net::ip_resolve::normalize_ip_for_enrichment(raw)
}

fn normalize_domain(raw: &str) -> Option<String> {
    let domain = raw.trim().trim_end_matches('.').to_lowercase();
    if domain.is_empty() || domain.len() > 253 || domain.contains('%') || domain.contains(' ') {
        return None;
    }
    if !domain
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return None;
    }
    if !domain.contains('.') {
        return None;
    }
    Some(domain)
}

fn normalize_file_hash(raw: &str) -> Option<String> {
    let hash = raw.trim().to_lowercase();
    if !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match hash.len() {
        32 | 40 | 64 => Some(hash),
        _ => None,
    }
}

async fn fetch_vt(
    client: &reqwest::Client,
    api_key: &str,
    indicator_type: &str,
    value: &str,
) -> anyhow::Result<Option<VtRow>> {
    let v = vt_get(client, api_key, indicator_type, value).await?;
    let Some(stats) = parse_vt_stats(&v) else {
        return Ok(None);
    };
    let label = format_vt_label(&stats);
    let score = vt_score(&v, &stats);
    Ok(Some(VtRow {
        indicator: value.to_string(),
        indicator_type: indicator_type.to_string(),
        label,
        score,
        stats,
    }))
}

async fn vt_get(
    client: &reqwest::Client,
    api_key: &str,
    indicator_type: &str,
    value: &str,
) -> anyhow::Result<Value> {
    let path = match indicator_type {
        "ip" => format!("https://www.virustotal.com/api/v3/ip_addresses/{value}"),
        "domain" => format!("https://www.virustotal.com/api/v3/domains/{value}"),
        "file_hash" => format!("https://www.virustotal.com/api/v3/files/{value}"),
        other => anyhow::bail!("unsupported indicator type: {other}"),
    };
    let resp = client
        .get(&path)
        .header("x-apikey", api_key)
        .header("accept", "application/json")
        .send()
        .await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(json!({}));
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("virustotal HTTP {status}: {body}");
    }
    Ok(resp.json().await?)
}

fn parse_vt_stats(v: &Value) -> Option<VtStats> {
    let attrs = v.get("data")?.get("attributes")?;
    let stats = attrs.get("last_analysis_stats")?;
    Some(VtStats {
        malicious: stats
            .get("malicious")
            .and_then(|x| x.as_u64())
            .unwrap_or(0)
            .min(u16::MAX as u64) as u16,
        harmless: stats
            .get("harmless")
            .and_then(|x| x.as_u64())
            .unwrap_or(0)
            .min(u16::MAX as u64) as u16,
        undetected: stats
            .get("undetected")
            .and_then(|x| x.as_u64())
            .unwrap_or(0)
            .min(u16::MAX as u64) as u16,
        suspicious: stats
            .get("suspicious")
            .and_then(|x| x.as_u64())
            .unwrap_or(0)
            .min(u16::MAX as u64) as u16,
        reputation: attrs.get("reputation").and_then(|x| x.as_i64()).unwrap_or(0) as i32,
    })
}

fn format_vt_label(stats: &VtStats) -> String {
    let mut parts = vec![format!("malicious:{}", stats.malicious)];
    if stats.suspicious > 0 {
        parts.push(format!("suspicious:{}", stats.suspicious));
    }
    if stats.harmless > 0 {
        parts.push(format!("harmless:{}", stats.harmless));
    }
    if stats.undetected > 0 {
        parts.push(format!("undetected:{}", stats.undetected));
    }
    if stats.reputation != 0 {
        parts.push(format!("reputation:{}", stats.reputation));
    }
    format!("VT {}", parts.join(", "))
}

fn vt_score(v: &Value, stats: &VtStats) -> f32 {
    if stats.reputation != 0 {
        return (stats.reputation as f32 / 100.0).clamp(-1.0, 1.0);
    }
    let attrs = match v.get("data").and_then(|d| d.get("attributes")) {
        Some(a) => a,
        None => return 0.0,
    };
    let s = match attrs.get("last_analysis_stats") {
        Some(s) => s,
        None => return 0.0,
    };
    let malicious = s.get("malicious").and_then(|x| x.as_u64()).unwrap_or(0) as f32;
    let suspicious = s.get("suspicious").and_then(|x| x.as_u64()).unwrap_or(0) as f32;
    let total = s
        .as_object()
        .map(|o| o.values().filter_map(|x| x.as_u64()).sum::<u64>() as f32)
        .unwrap_or(0.0);
    if total <= 0.0 {
        return 0.0;
    }
    ((malicious + suspicious * 0.5) / total).clamp(0.0, 1.0)
}

async fn write_vt_ioc(config: &AppConfig, field: &str, row: &VtRow) -> anyhow::Result<()> {
    let db = &config.clickhouse_database;
    let s = &row.stats;
    let ioc_sql = format!(
        "INSERT INTO {db}.ioc_enrichments \
         (indicator, indicator_type, malware_family, score, vt_malicious, vt_harmless, vt_undetected, vt_suspicious, vt_reputation) \
         VALUES ('{}', '{}', '{}', {}, {}, {}, {}, {}, {})",
        escape_ch(&row.indicator),
        escape_ch(&row.indicator_type),
        escape_ch(&row.label),
        row.score,
        s.malicious,
        s.harmless,
        s.undetected,
        s.suspicious,
        s.reputation,
    );
    exec_sql(config, &ioc_sql).await?;
    let custom_sql = format!(
        "INSERT INTO {db}.custom_enrichment_results \
         (field, value, indicator_type, malware_family, score) \
         VALUES ('{}', '{}', '{}', '{}', {})",
        escape_ch(field),
        escape_ch(&row.indicator),
        escape_ch(&row.indicator_type),
        escape_ch(&row.label),
        row.score,
    );
    exec_sql(config, &custom_sql).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_vt_label_from_stats() {
        let stats = VtStats {
            malicious: 3,
            harmless: 60,
            undetected: 2,
            suspicious: 0,
            reputation: -12,
        };
        let label = format_vt_label(&stats);
        assert!(label.contains("malicious:3"));
        assert!(label.contains("reputation:-12"));
    }

    #[test]
    fn parses_vt_stats_from_api_json() {
        let v = json!({
            "data": {
                "attributes": {
                    "last_analysis_stats": { "malicious": 1, "harmless": 55, "undetected": 36, "suspicious": 2 },
                    "reputation": 0
                }
            }
        });
        let stats = parse_vt_stats(&v).unwrap();
        assert_eq!(stats.malicious, 1);
        assert_eq!(stats.harmless, 55);
        assert_eq!(stats.undetected, 36);
        assert_eq!(stats.suspicious, 2);
    }

    #[test]
    fn normalizes_ipv4_mapped_addresses() {
        assert_eq!(
            normalize_indicator("ip", "::ffff:8.8.8.8").as_deref(),
            Some("8.8.8.8")
        );
        assert_eq!(normalize_indicator("ip", "8.8.8.8").as_deref(), Some("8.8.8.8"));
        assert!(normalize_indicator("ip", "::").is_none());
    }

    #[test]
    fn normalizes_nat64_well_known_prefix() {
        assert_eq!(
            normalize_indicator("ip", "64:ff9b::253b:1955").as_deref(),
            Some("37.59.25.85")
        );
    }

    #[test]
    fn strips_interface_zone_from_ip() {
        assert_eq!(
            normalize_indicator("ip", "192.168.8.183%wlan0").as_deref(),
            None
        );
        assert_eq!(
            normalize_indicator("ip", "fe80::1%eth0").as_deref(),
            None
        );
        assert_eq!(
            normalize_indicator("ip", "93.184.216.34%wlan0").as_deref(),
            Some("93.184.216.34")
        );
    }

    #[test]
    fn skips_private_ips() {
        assert!(normalize_indicator("ip", "10.0.0.1").is_none());
        assert!(normalize_indicator("ip", "192.168.1.1").is_none());
        assert!(normalize_indicator("ip", "127.0.0.1").is_none());
    }

    #[test]
    fn normalizes_domains_and_hashes() {
        assert_eq!(
            normalize_indicator("domain", "Example.COM.").as_deref(),
            Some("example.com")
        );
        assert!(normalize_indicator("domain", "not-a-domain").is_none());
        assert_eq!(
            normalize_indicator(
                "file_hash",
                "275a021bbfb6489e54d471899f7bdf9e5db342bcfebda5a0310772c0a12eaf57"
            )
            .as_deref()
            .map(str::len),
            Some(64)
        );
        assert!(normalize_indicator("file_hash", "abc").is_none());
    }

    #[test]
    fn clickhouse_ip_indicator_key_strips_mapped_prefix() {
        let expr = clickhouse_ip_indicator_key("dest_ip");
        assert!(expr.contains("::ffff:"));
        assert!(expr.contains("dest_ip"));
    }

    #[test]
    fn vt_score_from_reputation() {
        let stats = VtStats {
            malicious: 0,
            harmless: 0,
            undetected: 0,
            suspicious: 0,
            reputation: -50,
        };
        let score = vt_score(&json!({}), &stats);
        assert!((score - (-0.5)).abs() < f32::EPSILON);
    }

    #[test]
    fn vt_score_from_analysis_stats() {
        let v = json!({
            "data": {
                "attributes": {
                    "last_analysis_stats": {
                        "malicious": 10,
                        "suspicious": 4,
                        "harmless": 50,
                        "undetected": 16
                    },
                    "reputation": 0
                }
            }
        });
        let stats = parse_vt_stats(&v).unwrap();
        let score = vt_score(&v, &stats);
        assert!(score > 0.0 && score <= 1.0);
    }

    #[test]
    fn format_vt_label_omits_zero_optional_parts() {
        let stats = VtStats {
            malicious: 2,
            harmless: 0,
            undetected: 0,
            suspicious: 0,
            reputation: 0,
        };
        let label = format_vt_label(&stats);
        assert_eq!(label, "VT malicious:2");
    }
}
