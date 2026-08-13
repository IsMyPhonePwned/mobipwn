use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Alert triage lifecycle (nano-style: new → triaged → verified).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertStatus {
    New,
    Triaged,
    Verified,
    FalsePositive,
}

#[derive(Debug, Error)]
pub enum LifecycleError {
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition { from: AlertStatus, to: AlertStatus },
}

use super::StatusFilter;

pub fn parse_status_filter(s: &str) -> Option<StatusFilter> {
    match s.trim().to_lowercase().as_str() {
        "" | "all" => None,
        "open" | "queue" | "triage" => Some(StatusFilter::Open),
        other => Some(StatusFilter::Exact(parse_status(other))),
    }
}

pub fn parse_status(s: &str) -> AlertStatus {
    match s {
        "triaged" => AlertStatus::Triaged,
        "verified" | "resolved" => AlertStatus::Verified,
        "false_positive" => AlertStatus::FalsePositive,
        _ => AlertStatus::New,
    }
}

pub fn status_str(s: AlertStatus) -> &'static str {
    match s {
        AlertStatus::New => "new",
        AlertStatus::Triaged => "triaged",
        AlertStatus::Verified => "verified",
        AlertStatus::FalsePositive => "false_positive",
    }
}

pub fn is_closed(status: AlertStatus) -> bool {
    matches!(
        status,
        AlertStatus::Verified | AlertStatus::FalsePositive
    )
}

pub fn next_status(from: AlertStatus, to: AlertStatus) -> Result<AlertStatus, LifecycleError> {
    if from == to {
        return Ok(to);
    }
    let ok = matches!(
        (from, to),
        (AlertStatus::New, AlertStatus::Triaged)
            | (AlertStatus::New, AlertStatus::Verified)
            | (AlertStatus::New, AlertStatus::FalsePositive)
            | (AlertStatus::Triaged, AlertStatus::Verified)
            | (AlertStatus::Triaged, AlertStatus::FalsePositive)
            | (AlertStatus::Triaged, AlertStatus::New)
            | (AlertStatus::Verified, AlertStatus::New)
            | (AlertStatus::Verified, AlertStatus::Triaged)
            | (AlertStatus::FalsePositive, AlertStatus::New)
            | (AlertStatus::FalsePositive, AlertStatus::Triaged)
    );
    if ok {
        Ok(to)
    } else {
        Err(LifecycleError::InvalidTransition { from, to })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_open_status_filter() {
        assert_eq!(parse_status_filter("open"), Some(StatusFilter::Open));
        assert_eq!(parse_status_filter("triage"), Some(StatusFilter::Open));
        assert_eq!(parse_status_filter("all"), None);
        assert_eq!(parse_status_filter(""), None);
        assert_eq!(
            parse_status_filter("verified"),
            Some(StatusFilter::Exact(AlertStatus::Verified))
        );
        assert_eq!(
            parse_status_filter("resolved"),
            Some(StatusFilter::Exact(AlertStatus::Verified))
        );
    }

    #[test]
    fn allows_reopen_from_verified() {
        assert_eq!(
            next_status(AlertStatus::Verified, AlertStatus::New).unwrap(),
            AlertStatus::New
        );
    }

    #[test]
    fn allows_false_positive_from_triaged() {
        assert_eq!(
            next_status(AlertStatus::Triaged, AlertStatus::FalsePositive).unwrap(),
            AlertStatus::FalsePositive
        );
    }

    #[test]
    fn allows_false_positive_from_new() {
        assert_eq!(
            next_status(AlertStatus::New, AlertStatus::FalsePositive).unwrap(),
            AlertStatus::FalsePositive
        );
    }

    #[test]
    fn allows_reopen_from_false_positive() {
        assert_eq!(
            next_status(AlertStatus::FalsePositive, AlertStatus::New).unwrap(),
            AlertStatus::New
        );
    }

    #[test]
    fn closed_statuses() {
        assert!(is_closed(AlertStatus::Verified));
        assert!(is_closed(AlertStatus::FalsePositive));
        assert!(!is_closed(AlertStatus::New));
        assert!(!is_closed(AlertStatus::Triaged));
    }
}

/// Stable dedup key from rule + entity facets.
pub fn dedup_key(rule_id: &str, facets: &[(&str, &str)]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    rule_id.hash(&mut h);
    for (k, v) in facets {
        k.hash(&mut h);
        v.hash(&mut h);
    }
    format!("{:016x}", h.finish())
}
