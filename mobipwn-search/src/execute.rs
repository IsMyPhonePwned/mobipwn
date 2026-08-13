use mobipwn_core::ch::query_json_each_row;
use mobipwn_core::config::AppConfig;
use mobipwn_core::db::PoolHealth;
use mobipwn_core::mudm::{field_has_value_sql, SEARCHABLE_FIELDS};
use mobipwn_core::DualPool;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::Instant;

use crate::admission::{resolve_time_bounds, validate_admission, ResolvedTimeBounds};
use crate::export::{format_rows, ExportFormat};
use crate::pagination::{
    apply_search_pagination, cursor_from_row, decode_search_after, encode_search_after,
    supports_cursor_pagination,
};
use crate::timechart::should_skip_row_limit;
use crate::{apply_row_limit, generate_clickhouse_sql, parse_mpl};

fn finalize_search_sql(mpl: &crate::mpl::MplQuery, sql: String, page_limit: u32) -> String {
    if should_skip_row_limit(mpl) {
        sql
    } else {
        apply_row_limit(sql, page_limit)
    }
}

fn json_u64(v: &Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

/// Union keys from all rows (stats/timechart rows may omit sparse fields in row 1).
fn columns_from_rows(rows: &[Value]) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut order = Vec::new();
    for row in rows {
        if let Some(obj) = row.as_object() {
            for key in obj.keys() {
                if seen.insert(key.clone()) {
                    order.push(key.clone());
                }
            }
        }
    }
    order
}

/// WHERE clause for sidebar scope (search clause + optional time; pipes ignored).
pub fn scope_filter_sql(
    config: &AppConfig,
    query: Option<&str>,
    time_from: Option<&str>,
    time_to: Option<&str>,
) -> anyhow::Result<String> {
    let mpl = query.map(parse_mpl).transpose()?;
    let empty = crate::mpl::MplQuery {
        time_range: None,
        search: crate::mpl::SearchExpr::True,
        commands: vec![],
    };
    let query_ref = mpl.as_ref().unwrap_or(&empty);
    let bounds = resolve_time_bounds(
        query_ref,
        time_from,
        time_to,
        config.search_admission.default_hours,
    );
    let mut where_parts = vec![crate::sql_gen::search_expr_sql(&query_ref.search)?];
    append_resolved_time_bounds(&mut where_parts, &bounds);
    Ok(where_parts.join(" AND "))
}

/// Time predicates shared by field-stats, histogram, prevalence scatter, etc.
pub(crate) fn append_resolved_time_bounds(where_parts: &mut Vec<String>, bounds: &ResolvedTimeBounds) {
    if let Some(f) = bounds.time_from.as_deref() {
        where_parts.push(format!("timestamp >= parseDateTime64BestEffort('{f}')"));
    }
    if let Some(t) = bounds.time_to.as_deref() {
        where_parts.push(format!("timestamp <= parseDateTime64BestEffort('{t}')"));
    }
}

#[derive(Debug, Deserialize)]
pub struct SearchRunRequest {
    pub query: String,
    pub time_from: Option<String>,
    pub time_to: Option<String>,
    pub limit: Option<u32>,
    /// Opaque token from a prior response for the next page of event rows.
    pub search_after: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchRunResponse {
    pub sql: String,
    pub rows: Vec<Value>,
    pub row_count: usize,
    pub elapsed_ms: u64,
    pub columns: Vec<String>,
    pub time_from: Option<String>,
    pub time_to: Option<String>,
    pub has_more: bool,
    pub search_after: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchExportRequest {
    pub query: String,
    pub time_from: Option<String>,
    pub time_to: Option<String>,
    pub limit: Option<u32>,
    #[serde(default)]
    pub format: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchExportResponse {
    pub body: String,
    pub content_type: String,
    pub filename: String,
    pub row_count: usize,
}

pub async fn run_search(
    pool: &Arc<DualPool>,
    config: &AppConfig,
    req: SearchRunRequest,
) -> anyhow::Result<SearchRunResponse> {
    if pool.health().await == PoolHealth::PostgresOnly {
        anyhow::bail!("ClickHouse unavailable (degraded mode)");
    }

    let admission = &config.search_admission;
    let limit = req
        .limit
        .unwrap_or(1000)
        .min(admission.max_limit);

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
        limit,
        admission,
        &bounds,
    )
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    let mut sql = generate_clickhouse_sql(
        &mpl,
        &config.clickhouse_database,
        bounds.time_from.as_deref(),
        bounds.time_to.as_deref(),
    )?;

    let pageable = supports_cursor_pagination(&mpl);
    let cursor = if pageable {
        req.search_after
            .as_deref()
            .map(decode_search_after)
            .transpose()
            .map_err(|e| anyhow::anyhow!("{e}"))?
    } else {
        None
    };

    sql = if pageable {
        apply_search_pagination(sql, cursor.as_ref(), limit)
    } else {
        finalize_search_sql(&mpl, sql, limit)
    };

    let start = Instant::now();
    let mut rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    if admission.max_execution_time_secs > 0
        && elapsed_ms > admission.max_execution_time_secs as u64 * 1000
    {
        anyhow::bail!(
            "query exceeded max execution time ({}s)",
            admission.max_execution_time_secs
        );
    }

    let mut has_more = false;
    let mut next_token = None;
    if pageable && rows.len() > limit as usize {
        has_more = true;
        rows.truncate(limit as usize);
    }
    if has_more {
        if let Some(last) = rows.last().and_then(cursor_from_row) {
            next_token = Some(encode_search_after(&last));
        }
    }

    let columns = columns_from_rows(&rows);

    Ok(SearchRunResponse {
        row_count: rows.len(),
        sql,
        rows,
        elapsed_ms,
        columns,
        time_from: bounds.time_from,
        time_to: bounds.time_to,
        has_more,
        search_after: next_token,
    })
}

pub async fn run_search_export(
    pool: &Arc<DualPool>,
    config: &AppConfig,
    req: SearchExportRequest,
) -> anyhow::Result<SearchExportResponse> {
    if pool.health().await == PoolHealth::PostgresOnly {
        anyhow::bail!("ClickHouse unavailable (degraded mode)");
    }

    let format = req
        .format
        .as_deref()
        .and_then(ExportFormat::from_str)
        .unwrap_or(ExportFormat::Jsonl);

    let admission = &config.search_admission;
    let limit = req
        .limit
        .unwrap_or(admission.max_export_limit)
        .min(admission.max_export_limit);

    let resp = run_search(
        pool,
        config,
        SearchRunRequest {
            query: req.query,
            time_from: req.time_from,
            time_to: req.time_to,
            limit: Some(limit),
            search_after: None,
        },
    )
    .await?;

    let content_type = format.content_type().to_string();
    let extension = format.file_extension();
    let body = format_rows(&resp.columns, &resp.rows, format);
    let filename = format!(
        "mobipwn-search-{}.{}",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        extension
    );

    Ok(SearchExportResponse {
        row_count: resp.row_count,
        content_type,
        filename,
        body,
    })
}

#[derive(Debug, Deserialize)]
pub struct FieldStatsRequest {
    pub field: String,
    pub hours: Option<u32>,
    pub limit: Option<u32>,
    pub time_from: Option<String>,
    pub time_to: Option<String>,
    /// Optional mPL search filter (search clause + `last Nh` only; pipes ignored).
    pub query: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FieldStatValue {
    pub value: String,
    pub count: u64,
}

#[derive(Debug, Serialize)]
pub struct FieldStatsResponse {
    pub field: String,
    pub values: Vec<FieldStatValue>,
    pub elapsed_ms: u64,
}

pub async fn run_field_stats(
    config: &AppConfig,
    req: FieldStatsRequest,
) -> anyhow::Result<FieldStatsResponse> {
    let limit = req.limit.unwrap_or(20).min(100);
    let value_expr = mobipwn_core::mudm::field_stats_value_sql(&req.field)
        .ok_or_else(|| anyhow::anyhow!("unknown field: {}", req.field))?;
    let has_value = mobipwn_core::mudm::field_has_value_sql(&req.field)
        .ok_or_else(|| anyhow::anyhow!("unknown field: {}", req.field))?;

    let mut filter_sql = scope_filter_sql(
        config,
        req.query.as_deref(),
        req.time_from.as_deref(),
        req.time_to.as_deref(),
    )?;
    filter_sql.push_str(" AND ");
    filter_sql.push_str(&has_value);

    let mut sql = format!(
        "SELECT {value_expr} AS value, count() AS cnt FROM {db}.events WHERE {filter_sql}",
        db = config.clickhouse_database,
        value_expr = value_expr
    );

    sql.push_str(&format!(
        " GROUP BY {value_expr} ORDER BY cnt DESC LIMIT {limit}",
        value_expr = value_expr
    ));

    let start = Instant::now();
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    let values = rows
        .into_iter()
        .filter_map(|r| {
            let value = r.get("value")?.as_str()?.to_string();
            let count = json_u64(r.get("cnt")?)?;
            Some(FieldStatValue { value, count })
        })
        .collect();

    Ok(FieldStatsResponse {
        field: req.field,
        values,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

#[derive(Debug, Deserialize)]
pub struct FieldsInScopeRequest {
    pub query: Option<String>,
    pub time_from: Option<String>,
    pub time_to: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FieldsInScopeResponse {
    pub fields: Vec<String>,
    pub elapsed_ms: u64,
}

pub async fn run_fields_in_scope(
    config: &AppConfig,
    req: FieldsInScopeRequest,
) -> anyhow::Result<FieldsInScopeResponse> {
    let filter_sql = scope_filter_sql(
        config,
        req.query.as_deref(),
        req.time_from.as_deref(),
        req.time_to.as_deref(),
    )?;

    // Aliases must not match column names used in WHERE (CH: ILLEGAL_AGGREGATION).
    let count_exprs: Vec<String> = SEARCHABLE_FIELDS
        .iter()
        .filter_map(|f| {
            field_has_value_sql(f.name).map(|pred| {
                format!("countIf({pred}) AS `cnt_{name}`", name = f.name)
            })
        })
        .collect();

    let sql = format!(
        "SELECT {counts} FROM {db}.events WHERE {filter_sql}",
        counts = count_exprs.join(", "),
        db = config.clickhouse_database,
    );

    let start = Instant::now();
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    let row = rows.first().ok_or_else(|| anyhow::anyhow!("no field scope row"))?;

    let mut populated: Vec<(String, u64)> = SEARCHABLE_FIELDS
        .iter()
        .filter_map(|f| {
            let key = format!("cnt_{}", f.name);
            let count = json_u64(row.get(&key)?)?;
            (count > 0).then(|| (f.name.to_string(), count))
        })
        .collect();
    populated.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    Ok(FieldsInScopeResponse {
        fields: populated.into_iter().map(|(name, _)| name).collect(),
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

#[derive(Debug, Deserialize)]
pub struct HistogramRequest {
    pub query: String,
    pub span_minutes: Option<u32>,
    pub time_from: Option<String>,
    pub time_to: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HistogramBucket {
    pub bucket: String,
    pub count: u64,
}

#[derive(Debug, Serialize)]
pub struct HistogramResponse {
    pub buckets: Vec<HistogramBucket>,
    pub elapsed_ms: u64,
}

pub async fn run_histogram(
    config: &AppConfig,
    req: HistogramRequest,
) -> anyhow::Result<HistogramResponse> {
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

    let span = req.span_minutes.unwrap_or(60);
    // Histogram uses search + time filter only (pipes like timechart break subquery wraps).
    let mut where_parts = vec![crate::sql_gen::search_expr_sql(&mpl.search)?];
    append_resolved_time_bounds(&mut where_parts, &bounds);
    let filter_sql = where_parts.join(" AND ");
    let sql = format!(
        "SELECT toStartOfInterval(timestamp, INTERVAL {span} MINUTE) AS bucket, count() AS c \
         FROM {db}.events WHERE {filter_sql} GROUP BY bucket ORDER BY bucket ASC",
        db = config.clickhouse_database,
    );

    let start = Instant::now();
    let rows = query_json_each_row(config, &config.clickhouse_database, &sql).await?;
    let buckets = rows
        .into_iter()
        .filter_map(|r| {
            let bucket = r
                .get("bucket")
                .map(|v| v.as_str().map(String::from).or_else(|| Some(v.to_string())))
                .flatten()?;
            let count = json_u64(r.get("c")?)?;
            Some(HistogramBucket { bucket, count })
        })
        .collect();

    Ok(HistogramResponse {
        buckets,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mobipwn_core::config::{AppConfig, SearchAdmissionConfig};

    fn test_config() -> AppConfig {
        AppConfig {
            postgres_url: String::new(),
            clickhouse_url: String::new(),
            clickhouse_user: None,
            clickhouse_password: None,
            clickhouse_database: "mobipwn".into(),
            events_ttl_days: 90,
            api_bind: String::new(),
            search_bind: String::new(),
            jobs_enabled: false,
            search_admission: SearchAdmissionConfig {
                max_limit: 10_000,
                max_export_limit: 50_000,
                max_query_len: 8192,
                require_time_range: true,
                default_hours: 24,
                max_joins: 2,
                max_execution_time_secs: 60,
            },
            require_auth: false,
            expose_dev_logs: false,
        }
    }

    #[test]
    fn field_stats_where_for_source_scoped_query_has_no_wall_clock_window() {
        let sql = scope_filter_sql(&test_config(), Some(r#"source="case-001""#), None, None).unwrap();
        assert!(sql.contains("source = 'case-001'"));
        assert!(!sql.contains("INTERVAL"));
        assert!(!sql.contains("parseDateTime64BestEffort"));
    }

    #[test]
    fn fields_in_scope_sql_uses_count_if_per_field() {
        let filter =
            scope_filter_sql(&test_config(), Some(r#"platform="android""#), None, None).unwrap();
        assert!(filter.contains("platform"));
        assert!(field_has_value_sql("process_id").unwrap().contains("!= 0"));
    }

    #[test]
    fn finalize_search_sql_skips_row_limit_for_timechart() {
        let q = parse_mpl(r#"platform="android" | timechart span=1h count by parser limit=8"#).unwrap();
        let sql = generate_clickhouse_sql(&q, "mobipwn", None, None).unwrap();
        let out = finalize_search_sql(&q, sql.clone(), 500);
        assert_eq!(out, sql);
    }

    #[test]
    fn finalize_search_sql_applies_row_limit_for_head() {
        let q = parse_mpl(r#"platform="android" | head 100"#).unwrap();
        let sql = generate_clickhouse_sql(&q, "mobipwn", None, None).unwrap();
        let out = finalize_search_sql(&q, sql, 500);
        assert!(out.contains("LIMIT 500"));
    }
}
