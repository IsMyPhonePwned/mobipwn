use mobipwn_core::ch::query_json_each_row;
use mobipwn_core::config::AppConfig;
use mobipwn_core::prevalence::lookup_artifact_prevalence;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;

use crate::admission::{resolve_time_bounds, validate_admission};
use crate::execute::scope_filter_sql;
use crate::parse_mpl;

const MAX_ARTIFACTS: usize = 200;
const DEFAULT_RARITY_THRESHOLD: f64 = 0.7;

#[derive(Debug, Deserialize)]
pub struct PrevalenceScatterRequest {
    pub query: String,
    pub time_from: Option<String>,
    pub time_to: Option<String>,
    /// Hide artifacts seen on more than this many devices (asset-mode slider).
    pub max_device_count: Option<u32>,
    pub rarity_threshold: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScatterPoint {
    pub artifact: String,
    pub artifact_type: String,
    pub first_seen: String,
    pub last_seen: String,
    pub total_occurrences: u64,
    pub host_count: u64,
    pub is_rare: bool,
    pub prevalence_score: f64,
}

#[derive(Debug, Serialize)]
pub struct PrevalenceScatterResponse {
    pub hash_points: Vec<ScatterPoint>,
    pub ip_points: Vec<ScatterPoint>,
    pub rarity_threshold: f64,
    pub max_artifact_host_count: u64,
    pub total_unfiltered_artifacts: usize,
    pub elapsed_ms: u64,
}

fn json_ts(v: Option<&Value>) -> String {
    v.and_then(|x| x.as_str().map(String::from).or_else(|| Some(x.to_string())))
        .unwrap_or_default()
}

fn json_u64(v: Option<&Value>) -> u64 {
    v.and_then(|x| {
        x.as_u64()
            .or_else(|| x.as_str().and_then(|s| s.parse().ok()))
    })
    .unwrap_or(0)
}

async fn artifacts_in_scope(
    config: &AppConfig,
    filter_sql: &str,
    artifact_type: &str,
    column: &str,
) -> anyhow::Result<Vec<(String, String, String, String, u64)>> {
    let sql = format!(
        "SELECT {column} AS artifact, \
         min(timestamp) AS first_seen, max(timestamp) AS last_seen, count() AS total_occurrences \
         FROM {db}.events WHERE {filter_sql} AND {column} != '' \
         GROUP BY artifact ORDER BY total_occurrences DESC LIMIT {limit}",
        db = config.clickhouse_database,
        column = column,
        filter_sql = filter_sql,
        limit = MAX_ARTIFACTS,
    );
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| {
            let artifact = r.get("artifact")?.as_str()?.to_string();
            if artifact.is_empty() {
                return None;
            }
            Some((
                artifact_type.to_string(),
                artifact,
                json_ts(r.get("first_seen")),
                json_ts(r.get("last_seen")),
                json_u64(r.get("total_occurrences")),
            ))
        })
        .collect())
}

pub async fn run_prevalence_scatter(
    config: &AppConfig,
    req: PrevalenceScatterRequest,
) -> anyhow::Result<PrevalenceScatterResponse> {
    let admission = &config.search_admission;
    let mpl = parse_mpl(&req.query)?;
    let bounds = resolve_time_bounds(
        &mpl,
        req.time_from.as_deref(),
        req.time_to.as_deref(),
        admission.default_hours,
    );
    validate_admission(
        &mpl,
        req.query.len(),
        admission.max_limit,
        admission,
        &bounds,
    )
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    let start = Instant::now();
    let filter_sql = scope_filter_sql(
        config,
        Some(&req.query),
        req.time_from.as_deref(),
        req.time_to.as_deref(),
    )?;

    let mut scope_rows = artifacts_in_scope(config, &filter_sql, "hash", "file_hash").await?;
    scope_rows.extend(artifacts_in_scope(config, &filter_sql, "ip", "dest_ip").await?);

    let rarity_threshold = req.rarity_threshold.unwrap_or(DEFAULT_RARITY_THRESHOLD);
    let max_device = req.max_device_count;

    let hash_values: Vec<String> = scope_rows
        .iter()
        .filter(|(t, _, _, _, _)| t == "hash")
        .map(|(_, a, _, _, _)| a.clone())
        .collect();
    let ip_values: Vec<String> = scope_rows
        .iter()
        .filter(|(t, _, _, _, _)| t == "ip")
        .map(|(_, a, _, _, _)| a.clone())
        .collect();

    let hash_prev = lookup_artifact_prevalence(config, "file_hash", &hash_values).await?;
    let ip_prev = lookup_artifact_prevalence(config, "dest_ip", &ip_values).await?;

    let mut hash_points = Vec::new();
    let mut ip_points = Vec::new();
    let mut max_host: u64 = 0;

    for (artifact_type, artifact, first_seen, last_seen, total_occurrences) in scope_rows {
        let (field, prev_map) = if artifact_type == "hash" {
            ("file_hash", &hash_prev)
        } else {
            ("dest_ip", &ip_prev)
        };
        let (_events, host_count, prevalence_score) = prev_map
            .get(&artifact)
            .copied()
            .unwrap_or((0, 0, 1.0));
        let _ = field;
        max_host = max_host.max(host_count);
        let is_rare = prevalence_score >= rarity_threshold;
        if let Some(cap) = max_device {
            if host_count > cap as u64 {
                continue;
            }
        }
        let point = ScatterPoint {
            artifact,
            artifact_type: artifact_type.clone(),
            first_seen,
            last_seen,
            total_occurrences,
            host_count,
            is_rare,
            prevalence_score,
        };
        if artifact_type == "hash" {
            hash_points.push(point);
        } else {
            ip_points.push(point);
        }
    }

    let total_unfiltered = hash_points.len() + ip_points.len();

    Ok(PrevalenceScatterResponse {
        hash_points,
        ip_points,
        rarity_threshold,
        max_artifact_host_count: max_host,
        total_unfiltered_artifacts: total_unfiltered,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}
