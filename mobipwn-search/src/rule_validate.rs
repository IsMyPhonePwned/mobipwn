//! Detection rule validate: SQL plan, cost estimate, sample hits.

use mobipwn_core::config::{AppConfig, SearchAdmissionConfig};
use mobipwn_core::db::{DualPool, PoolHealth};
use serde::Serialize;
use serde_json::Value;

use crate::admission::{resolve_time_bounds, validate_admission};
use crate::{
    apply_row_limit, generate_clickhouse_sql, generate_events_filter_sql, parse_mpl,
};

#[derive(Debug, Clone, Serialize)]
pub struct RuleValidationResult {
    pub sql: String,
    pub filter_sql: String,
    pub explain: Vec<String>,
    pub cost_tier: String,
    pub cost_reason: String,
    pub time_from: Option<String>,
    pub time_to: Option<String>,
    pub row_count: usize,
    pub sample_rows: Vec<Value>,
    pub elapsed_ms: u64,
    pub realtime_compatible: bool,
}

pub fn estimate_rule_cost(
    mpl: &crate::mpl::MplQuery,
    bounds: &crate::admission::ResolvedTimeBounds,
    admission: &SearchAdmissionConfig,
) -> (String, String) {
    if mpl.join_count() > 0 {
        return (
            "high".into(),
            "Query contains joins — expensive on large event tables.".into(),
        );
    }
    if !mpl.commands.is_empty() {
        let has_stats = mpl.commands.iter().any(|c| {
            matches!(
                c,
                crate::mpl::MplCommand::Stats { .. }
                    | crate::mpl::MplCommand::Timechart { .. }
            )
        });
        if has_stats {
            return (
                "medium".into(),
                "Aggregations require a full pass; scheduled runs cap at 100 rows.".into(),
            );
        }
    }
    if bounds.time_from.is_none() && bounds.time_to.is_none() {
        if mpl.filters_field("source") || mpl.filters_investigation_ioc() {
            return (
                "medium".into(),
                "Unbounded time but scoped by source/IoC fields — scans matching partitions.".into(),
            );
        }
        if admission.require_time_range {
            return (
                "high".into(),
                "No time window — add `last 24h` or source= filter.".into(),
            );
        }
        return (
            "high".into(),
            "No time bounds — may scan entire events table.".into(),
        );
    }
    (
        "low".into(),
        "Bounded time window and filter-only search.".into(),
    )
}

pub async fn validate_detection_rule(
    pool: &DualPool,
    config: &AppConfig,
    query: &str,
    mode: &str,
) -> anyhow::Result<RuleValidationResult> {
    if pool.health().await == PoolHealth::PostgresOnly {
        anyhow::bail!("ClickHouse unavailable");
    }

    let mpl = parse_mpl(query)?;
    let admission = &config.search_admission;
    let bounds = resolve_time_bounds(&mpl, None, None, admission.default_hours);
    validate_admission(
        &mpl,
        query.len(),
        100,
        admission,
        &bounds,
    )
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    let mut explain = Vec::new();
    if let Some(tr) = mpl.time_range {
        let label = match tr.anchor {
            crate::mpl::TimeAnchor::Last => "last",
            crate::mpl::TimeAnchor::NowMinus => "now-",
        };
        explain.push(format!("Time modifier: {label}{} {:?}", tr.amount, tr.unit));
    } else if bounds.time_from.is_some() {
        explain.push(format!(
            "Time window: {} → {}",
            bounds.time_from.as_deref().unwrap_or("?"),
            bounds.time_to.as_deref().unwrap_or("now")
        ));
    } else {
        explain.push("No wall-clock time cap (source/IoC hunt or admission off)".into());
    }

    let filter_sql = generate_events_filter_sql(
        &mpl,
        &config.clickhouse_database,
        bounds.time_from.as_deref(),
        bounds.time_to.as_deref(),
    )
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    let mut sql = generate_clickhouse_sql(
        &mpl,
        &config.clickhouse_database,
        bounds.time_from.as_deref(),
        bounds.time_to.as_deref(),
    )?;
    sql = apply_row_limit(sql, 10);

    explain.push(format!("Compiled SQL (sample limit 10): {sql}"));

    if mode == "realtime" {
        if mpl.commands.is_empty() {
            explain.push("Real-time: will compile to a ClickHouse materialized view on each new event.".into());
        } else {
            explain.push(format!(
                "Real-time: incompatible with pipe commands {}. \
                 Each event is matched on the search filter only — use scheduled mode for stats, head, lookup, etc., \
                 or remove everything after the first |.",
                mpl.pipe_summary()
            ));
        }
    } else {
        explain.push("Scheduled: evaluated by mobipwn-jobs on cron.".into());
    }

    let (cost_tier, cost_reason) = estimate_rule_cost(&mpl, &bounds, admission);
    explain.push(format!("Cost estimate: {cost_tier} — {cost_reason}"));

    let start = std::time::Instant::now();
    let rows = mobipwn_core::ch::query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(RuleValidationResult {
        sql,
        filter_sql,
        explain,
        cost_tier,
        cost_reason,
        time_from: bounds.time_from,
        time_to: bounds.time_to,
        row_count: rows.len(),
        sample_rows: rows,
        elapsed_ms,
        realtime_compatible: mpl.commands.is_empty(),
    })
}
