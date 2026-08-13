use crate::mpl::{MplCommand, MplQuery, TimeUnit};
use chrono::{Duration, Utc};
use mobipwn_core::config::SearchAdmissionConfig;
use regex::Regex;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AdmissionError {
    #[error("query too long (max {max} characters)")]
    QueryTooLong { max: usize },
    #[error("time range required for broad searches — add filters or use `last 24h` / time picker")]
    TimeRangeRequired,
    #[error("too many join commands (max {max})")]
    TooManyJoins { max: usize },
    #[error("invalid rex pattern: {0}")]
    InvalidRexPattern(String),
    #[error("rex pattern too long (max {max} characters)")]
    RexPatternTooLong { max: usize },
    #[error("result limit exceeds maximum ({max})")]
    LimitTooHigh { max: u32 },
    #[error("query exceeded max execution time ({max_secs}s)")]
    ExecutionTimeExceeded { max_secs: u32 },
}

#[derive(Debug, Clone)]
pub struct ResolvedTimeBounds {
    pub time_from: Option<String>,
    pub time_to: Option<String>,
}

/// Merge query `last`/`now-`, case-scoped hunts, API time picker, and defaults.
///
/// Order: explicit **From/To** (timeline zoom / picker) wins over `last` in the bar; then
/// `last`/`now-`; then unbounded case/IoC hunts; then default window.
pub fn resolve_time_bounds(
    query: &MplQuery,
    req_from: Option<&str>,
    req_to: Option<&str>,
    default_hours: u32,
) -> ResolvedTimeBounds {
    if req_from.is_some() || req_to.is_some() {
        return ResolvedTimeBounds {
            time_from: req_from.map(String::from),
            time_to: req_to.map(String::from),
        };
    }

    if let Some(tr) = query.time_range {
        let now = Utc::now();
        let duration = match tr.unit {
            TimeUnit::Minutes => Duration::minutes(tr.amount as i64),
            TimeUnit::Hours => Duration::hours(tr.amount as i64),
            TimeUnit::Days => Duration::days(tr.amount as i64),
            TimeUnit::Weeks => Duration::weeks(tr.amount as i64),
        };
        let from = now - duration;
        return ResolvedTimeBounds {
            time_from: Some(from.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
            time_to: Some(now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
        };
    }

    // Case / platform / parser hunts — event timestamps are device-relative, not wall-clock "now".
    if query.skips_default_time_window() {
        return ResolvedTimeBounds {
            time_from: None,
            time_to: None,
        };
    }

    if default_hours > 0 {
        let now = Utc::now();
        let from = now - Duration::hours(default_hours as i64);
        return ResolvedTimeBounds {
            time_from: Some(from.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
            time_to: Some(now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
        };
    }

    ResolvedTimeBounds {
        time_from: None,
        time_to: None,
    }
}

/// Real-time materialized views match rows at insert time. Do not apply the default
/// wall-clock search window — device/bugreport `timestamp` values are often far in the past.
/// Only explicit `last` / `now-` modifiers in the query are honored.
pub fn resolve_realtime_mv_time_bounds(query: &MplQuery) -> ResolvedTimeBounds {
    resolve_time_bounds(query, None, None, 0)
}

pub fn validate_admission(
    query: &MplQuery,
    raw_query_len: usize,
    limit: u32,
    config: &SearchAdmissionConfig,
    bounds: &ResolvedTimeBounds,
) -> Result<(), AdmissionError> {
    if raw_query_len > config.max_query_len {
        return Err(AdmissionError::QueryTooLong {
            max: config.max_query_len,
        });
    }

    if limit > config.max_limit {
        return Err(AdmissionError::LimitTooHigh {
            max: config.max_limit,
        });
    }

    if query.join_count() > config.max_joins {
        return Err(AdmissionError::TooManyJoins {
            max: config.max_joins,
        });
    }

    validate_rex_commands(query)?;

    if config.require_time_range
        && bounds.time_from.is_none()
        && query.is_broad_search()
    {
        return Err(AdmissionError::TimeRangeRequired);
    }

    Ok(())
}

fn validate_rex_commands(query: &MplQuery) -> Result<(), AdmissionError> {
    for cmd in &query.commands {
        match cmd {
            MplCommand::Rex { pattern, .. } => validate_rex_pattern(pattern)?,
            MplCommand::Join { subquery, .. } => validate_rex_commands_in_query(subquery)?,
            _ => {}
        }
    }
    Ok(())
}

fn validate_rex_commands_in_query(query: &MplQuery) -> Result<(), AdmissionError> {
    for cmd in &query.commands {
        if let MplCommand::Rex { pattern, .. } = cmd {
            validate_rex_pattern(pattern)?;
        }
    }
    Ok(())
}

fn validate_rex_pattern(pattern: &str) -> Result<(), AdmissionError> {
    const MAX_REX_LEN: usize = 512;
    if pattern.len() > MAX_REX_LEN {
        return Err(AdmissionError::RexPatternTooLong { max: MAX_REX_LEN });
    }
    Regex::new(pattern).map_err(|e| AdmissionError::InvalidRexPattern(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mpl::parse_mpl;

    #[test]
    fn broad_star_gets_default_window_when_configured() {
        let q = parse_mpl("*").unwrap();
        let bounds = resolve_time_bounds(&q, None, None, 24);
        assert!(bounds.time_from.is_some());
        assert!(bounds.time_to.is_some());
    }

    #[test]
    fn broad_search_requires_time_when_configured() {
        let q = parse_mpl("*").unwrap();
        let cfg = SearchAdmissionConfig {
            require_time_range: true,
            default_hours: 0,
            max_limit: 1000,
            max_export_limit: 5000,
            max_query_len: 8192,
            max_joins: 2,
            max_execution_time_secs: 60,
        };
        let bounds = ResolvedTimeBounds {
            time_from: None,
            time_to: None,
        };
        assert!(validate_admission(&q, 1, 100, &cfg, &bounds).is_err());
    }

    #[test]
    fn last_modifier_resolves_bounds() {
        let q = parse_mpl("last 1h platform=\"android\"").unwrap();
        let bounds = resolve_time_bounds(&q, None, None, 0);
        assert!(bounds.time_from.is_some());
        assert!(bounds.time_to.is_some());
    }

    #[test]
    fn source_filter_skips_default_time_window() {
        let q = parse_mpl(r#"source="case-001" | head 10"#).unwrap();
        let bounds = resolve_time_bounds(&q, None, None, 24);
        assert!(bounds.time_from.is_none());
        assert!(bounds.time_to.is_none());
    }

    #[test]
    fn source_filter_respects_explicit_last_modifier() {
        let q = parse_mpl(r#"last 1h source="case-001" | head 10"#).unwrap();
        let bounds = resolve_time_bounds(&q, None, None, 24);
        assert!(bounds.time_from.is_some());
        assert!(bounds.time_to.is_some());
    }

    #[test]
    fn platform_filter_skips_default_time_window() {
        let q = parse_mpl(
            r#"platform="android" | timechart span=1h count by parser limit=8"#,
        )
        .unwrap();
        let bounds = resolve_time_bounds(&q, None, None, 24);
        assert!(bounds.time_from.is_none());
        assert!(bounds.time_to.is_none());
    }

    #[test]
    fn api_time_picker_wins_over_last_in_query() {
        let q = parse_mpl(r#"last 24h platform="android""#).unwrap();
        let bounds = resolve_time_bounds(
            &q,
            Some("2026-06-01T00:00:00.000Z"),
            Some("2026-06-04T00:00:00.000Z"),
            24,
        );
        assert_eq!(bounds.time_from.as_deref(), Some("2026-06-01T00:00:00.000Z"));
        assert_eq!(bounds.time_to.as_deref(), Some("2026-06-04T00:00:00.000Z"));
    }

    #[test]
    fn api_time_picker_narrows_case_hunt() {
        let q = parse_mpl(r#"source="case-001" | head 10"#).unwrap();
        let bounds = resolve_time_bounds(
            &q,
            Some("2026-01-01T00:00:00.000Z"),
            Some("2026-06-04T00:00:00.000Z"),
            24,
        );
        assert!(bounds.time_from.is_some() && bounds.time_to.is_some());
    }

    #[test]
    fn explicit_last_in_query_wins_over_skip() {
        let q = parse_mpl(r#"last 1h source="case-001" | head 10"#).unwrap();
        let bounds = resolve_time_bounds(&q, None, None, 24);
        assert!(bounds.time_from.is_some());
    }
}
