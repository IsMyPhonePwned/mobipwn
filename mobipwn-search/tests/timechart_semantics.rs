//! Regression tests for timechart `limit` semantics vs nano / Splunk / OpenSearch PPL.
//!
//! nano nPL documents `timechart` as time-bucketed aggregation with optional `by`
//! (see <https://nano.rs/docs/search-commands/>). OpenSearch PPL spells out that
//! `limit` selects the top N split-by values by **sum across all time buckets**, with
//! default 10 and `limit=0` for unlimited — not a global row cap on the result grid.
//!
//! mobipwn had two bugs (2026-06):
//! 1. SQL used `ORDER BY bucket ASC, c DESC LIMIT N` → one dominant series (Package).
//! 2. `apply_row_limit` wrapped timechart SQL because the CTE contained `LIMIT`.

use mobipwn_search::{
    apply_row_limit, effective_timechart_series_limit, generate_clickhouse_sql, parse_mpl,
    should_skip_row_limit,
};
use mobipwn_search::timechart::{
    distinct_series, legacy_row_cap_rows, top_series_rows, top_series_rows_with_other,
    OTHER_SERIES_LABEL,
};

const QUERY: &str = r#"platform="android" | timechart span=1h count by parser limit=8"#;

#[test]
fn nano_aligned_sql_selects_top_series_by_total_volume() {
    let q = parse_mpl(QUERY).unwrap();
    let sql = generate_clickhouse_sql(&q, "mobipwn", None, None).unwrap();

    assert!(
        sql.contains("top_series"),
        "expected top_series CTE, got: {sql}"
    );
    assert!(
        sql.contains("ORDER BY sum(c) DESC LIMIT 8"),
        "limit must rank series by total volume: {sql}"
    );
    assert!(
        sql.contains("rolled AS"),
        "useother=true rolls tail series into Other: {sql}"
    );
    assert!(sql.contains("'Other'"), "sql: {sql}");
    assert!(
        !sql.trim_end().ends_with("ORDER BY bucket ASC, c DESC LIMIT 8"),
        "global row LIMIT is the pre-fix bug: {sql}"
    );
}

#[test]
fn omitted_limit_defaults_to_ten_per_opensearch_ppl() {
    let q = parse_mpl(r#"platform="android" | timechart span=1h count by parser"#).unwrap();
    assert_eq!(
        effective_timechart_series_limit(
            &match &q.commands[0] {
                mobipwn_search::mpl::MplCommand::Timechart { by, .. } => by.clone(),
                _ => panic!("timechart"),
            },
            match &q.commands[0] {
                mobipwn_search::mpl::MplCommand::Timechart { limit, .. } => *limit,
                _ => panic!("timechart"),
            },
        ),
        Some(10)
    );
    let sql = generate_clickhouse_sql(&q, "mobipwn", None, None).unwrap();
    assert!(sql.contains("LIMIT 10"), "sql: {sql}");
}

#[test]
fn limit_zero_means_unlimited_series() {
    let q = parse_mpl(r#"platform="android" | timechart span=1h count by parser limit=0"#).unwrap();
    let sql = generate_clickhouse_sql(&q, "mobipwn", None, None).unwrap();
    assert!(!sql.contains("top_series"), "sql: {sql}");
}

#[test]
fn apply_row_limit_must_not_wrap_timechart_sql() {
    let q = parse_mpl(QUERY).unwrap();
    assert!(should_skip_row_limit(&q));
    let sql = generate_clickhouse_sql(&q, "mobipwn", None, None).unwrap();
    let wrapped = apply_row_limit(sql.clone(), 500);
    assert_ne!(
        wrapped, sql,
        "apply_row_limit would break timechart; execute must skip it"
    );
    assert!(wrapped.starts_with("SELECT * FROM ("));
}

#[test]
fn regression_legacy_row_cap_truncates_buckets() {
    let grid: Vec<(u32, String, u32)> = (0..24)
        .flat_map(|b| {
            [
                (b, "Package".to_string(), 100),
                (b, "Network".to_string(), 50),
                (b, "Process".to_string(), 10),
            ]
        })
        .collect();

    let legacy = legacy_row_cap_rows(&grid, 8);
    assert_eq!(legacy.len(), 8);
    let max_legacy_bucket = legacy.iter().map(|(b, _, _)| *b).max().unwrap_or(0);
    assert!(max_legacy_bucket < 3);

    let fixed = top_series_rows(&grid, 8);
    assert_eq!(
        distinct_series(&fixed),
        vec![
            "Network".to_string(),
            "Package".to_string(),
            "Process".to_string()
        ]
    );
    assert_eq!(fixed.len(), 72, "every bucket kept for each top series");
    assert_eq!(fixed.iter().map(|(b, _, _)| *b).max(), Some(23));
}

#[test]
fn regression_dominant_series_only_data_is_single_series() {
    // When only one parser has events, both legacy and fixed correctly show one series.
    let grid: Vec<(u32, String, u32)> = (0..8)
        .map(|b| (b, "Package".to_string(), 100))
        .collect();
    assert_eq!(distinct_series(&legacy_row_cap_rows(&grid, 8)), vec!["Package".to_string()]);
    assert_eq!(distinct_series(&top_series_rows(&grid, 8)), vec!["Package".to_string()]);
}

#[test]
fn useother_false_sql_drops_tail_without_other_bucket() {
    let q = parse_mpl(
        r#"platform="android" | timechart span=1h count by parser limit=3 useother=false"#,
    )
    .unwrap();
    let sql = generate_clickhouse_sql(&q, "mobipwn", None, None).unwrap();
    assert!(sql.contains("WHERE series IN (SELECT series FROM top_series)"), "sql: {sql}");
    assert!(!sql.contains("rolled AS"), "sql: {sql}");
}

#[test]
fn useother_simulation_aggregates_tail_into_other() {
    let grid: Vec<(u32, String, u32)> = (0..4)
        .flat_map(|b| {
            [
                (b, "Package".to_string(), 100),
                (b, "Network".to_string(), 50),
                (b, "Process".to_string(), 10),
                (b, "Crash".to_string(), 5),
                (b, "Auth".to_string(), 1),
            ]
        })
        .collect();
    let out = top_series_rows_with_other(&grid, 3, true);
    assert!(distinct_series(&out).contains(&OTHER_SERIES_LABEL.to_string()));
    let other: u32 = out
        .iter()
        .filter(|(_, s, _)| s == OTHER_SERIES_LABEL)
        .map(|(_, _, c)| c)
        .sum();
    // Top 3: Package, Network, Process — tail per bucket: Crash + Auth
    assert_eq!(other, 4 * (5 + 1));
}

#[test]
fn golden_timechart_compiles_with_platform_filter() {
    let cases = [
        r#"platform="android" | timechart span=1h count by parser limit=8"#,
        r#"last 24h platform="android" | timechart span=1h count by parser"#,
        r#"source="case-001" | timechart span=1h count by parser limit=5"#,
    ];
    for q in cases {
        let mpl = parse_mpl(q).expect(q);
        generate_clickhouse_sql(&mpl, "mobipwn", None, None).expect(q);
    }
}
