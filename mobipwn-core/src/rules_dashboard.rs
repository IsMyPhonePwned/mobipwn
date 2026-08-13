//! Rules dashboard aggregates (fleet health, alert velocity, bundled query packs).

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct FleetHealthSummary {
    pub total: i64,
    pub healthy: i64,
    pub slow: i64,
    pub errors: i64,
}

#[derive(Debug, Serialize)]
pub struct VelocityBucket {
    pub bucket_start: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct RuleRepositoryInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub rule_count: usize,
    pub deploy_command: String,
}

#[derive(Debug, Serialize)]
pub struct RepositoryRuleFile {
    pub path: String,
    pub name: String,
    pub severity: Option<String>,
    pub lifecycle: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RuleRepositoriesResponse {
    pub repositories: Vec<RuleRepositoryInfo>,
}

pub async fn fetch_fleet_health(pool: &PgPool) -> anyhow::Result<FleetHealthSummary> {
    let row: (i64, i64, i64, i64) = sqlx::query_as(
        r#"
        WITH sched AS (
            SELECT id FROM detection_rules
            WHERE enabled = true
              AND lifecycle IN ('live', 'alerting')
              AND mode = 'scheduled'
        ),
        latest AS (
            SELECT DISTINCT ON (rule_id)
                rule_id, started_at, duration_ms, error
            FROM detection_runs
            WHERE rule_id IN (SELECT id FROM sched)
            ORDER BY rule_id, started_at DESC
        )
        SELECT
            (SELECT COUNT(*)::bigint FROM sched),
            COUNT(*) FILTER (
                WHERE l.started_at >= NOW() - INTERVAL '24 hours'
                  AND COALESCE(l.error, '') = ''
            )::bigint,
            COUNT(*) FILTER (
                WHERE COALESCE(l.duration_ms, 0) >= 30000
            )::bigint,
            COUNT(*) FILTER (
                WHERE COALESCE(l.error, '') != ''
                   OR l.rule_id IS NULL
                   OR l.started_at < NOW() - INTERVAL '48 hours'
            )::bigint
        FROM sched s
        LEFT JOIN latest l ON l.rule_id = s.id
        "#,
    )
    .fetch_one(pool)
    .await?;
    Ok(FleetHealthSummary {
        total: row.0,
        healthy: row.1,
        slow: row.2,
        errors: row.3,
    })
}

pub async fn fetch_alert_velocity(pool: &PgPool, hours: i64) -> anyhow::Result<Vec<VelocityBucket>> {
    let hours = hours.clamp(1, 168);
    let rows = sqlx::query_as::<_, (DateTime<Utc>, i64)>(
        r#"
        SELECT bucket AS bucket_start, COALESCE(c.count, 0)::bigint AS count
        FROM generate_series(
            date_trunc('hour', NOW() - make_interval(hours => $1)),
            date_trunc('hour', NOW()) - INTERVAL '1 hour',
            INTERVAL '1 hour'
        ) AS bucket
        LEFT JOIN (
            SELECT date_trunc('hour', first_seen) AS bucket_start, COUNT(*)::bigint AS count
            FROM alerts
            WHERE first_seen >= NOW() - make_interval(hours => $1)
            GROUP BY bucket_start
        ) c ON c.bucket_start = bucket
        ORDER BY bucket ASC
        "#,
    )
    .bind(hours)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(bucket, count)| VelocityBucket {
            bucket_start: bucket.to_rfc3339(),
            count,
        })
        .collect())
}

fn queries_pack_root() -> PathBuf {
    std::env::var("MOBIPWN_QUERIES_PACK")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("examples/mobipwn-queries"))
}

fn scan_yaml_rules(dir: &Path) -> anyhow::Result<Vec<RepositoryRuleFile>> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    let mut stack = vec![dir.to_path_buf()];
    while let Some(path) = stack.pop() {
        for entry in std::fs::read_dir(&path)? {
            let entry = entry?;
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            if p.extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let rel = p
                .strip_prefix(dir)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            let text = std::fs::read_to_string(&p).unwrap_or_default();
            let name = text
                .lines()
                .find_map(|l| l.strip_prefix("name:").map(|s| s.trim().trim_matches('"').to_string()))
                .unwrap_or_else(|| rel.clone());
            let severity = text.lines().find_map(|l| {
                l.strip_prefix("severity:")
                    .map(|s| s.trim().trim_matches('"').to_string())
            });
            let lifecycle = text.lines().find_map(|l| {
                l.strip_prefix("lifecycle:")
                    .map(|s| s.trim().trim_matches('"').to_string())
            });
            out.push(RepositoryRuleFile {
                path: rel,
                name,
                severity,
                lifecycle,
            });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

pub fn list_repositories() -> RuleRepositoriesResponse {
    let root = queries_pack_root();
    let rules_dir = root.join("rules");
    let count = scan_yaml_rules(&rules_dir).map(|v| v.len()).unwrap_or(0);
    let deploy = format!("mobipwn-dac deploy {}", root.display());
    RuleRepositoriesResponse {
        repositories: vec![RuleRepositoryInfo {
            id: "bundled".into(),
            name: "mobipwn-queries (bundled)".into(),
            path: root.display().to_string(),
            rule_count: count,
            deploy_command: deploy,
        }],
    }
}

pub fn list_repository_rules(repo_id: &str) -> anyhow::Result<Vec<RepositoryRuleFile>> {
    if repo_id != "bundled" {
        anyhow::bail!("unknown repository");
    }
    let root = queries_pack_root();
    scan_yaml_rules(&root.join("rules"))
}
