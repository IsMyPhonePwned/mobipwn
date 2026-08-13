use crate::mpl::{MplCommand, MplQuery};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchCursor {
    pub timestamp: String,
    pub id: String,
}

#[derive(Debug, thiserror::Error)]
pub enum CursorError {
    #[error("invalid search_after token")]
    InvalidToken,
}

/// Event-row searches support keyset pagination; aggregations do not.
pub fn supports_cursor_pagination(mpl: &MplQuery) -> bool {
    !mpl.commands.iter().any(|c| {
        matches!(
            c,
            MplCommand::Stats { .. }
                | MplCommand::Timechart { .. }
                | MplCommand::Dedup { .. }
                | MplCommand::Join { .. }
        )
    })
}

pub fn encode_search_after(cursor: &SearchCursor) -> String {
    hex::encode(serde_json::to_string(cursor).unwrap_or_default())
}

pub fn decode_search_after(token: &str) -> Result<SearchCursor, CursorError> {
    let bytes = hex::decode(token.trim()).map_err(|_| CursorError::InvalidToken)?;
    serde_json::from_slice(&bytes).map_err(|_| CursorError::InvalidToken)
}

pub fn cursor_from_row(row: &Value) -> Option<SearchCursor> {
    let timestamp = row
        .get("timestamp")
        .and_then(|v| v.as_str().map(String::from).or_else(|| Some(v.to_string())))?;
    let id = row
        .get("id")
        .and_then(|v| v.as_str().map(String::from).or_else(|| Some(v.to_string())))?;
    Some(SearchCursor { timestamp, id })
}

fn sql_has_group_by(sql: &str) -> bool {
    sql.to_ascii_uppercase().contains(" GROUP BY ")
}

fn sql_has_order_by(sql: &str) -> bool {
    sql.to_ascii_uppercase().contains(" ORDER BY ")
}

/// Stable keyset pagination on `(timestamp DESC, id DESC)` for raw event rows.
pub fn apply_search_pagination(sql: String, cursor: Option<&SearchCursor>, limit: u32) -> String {
    let fetch = limit.saturating_add(1);
    if sql_has_group_by(&sql) {
        return crate::sql_gen::apply_row_limit(sql, limit);
    }

    let ordered = if sql_has_order_by(&sql) {
        format!("SELECT * FROM ({sql})")
    } else {
        format!("SELECT * FROM ({sql}) ORDER BY timestamp DESC, id DESC")
    };

    if let Some(c) = cursor {
        format!(
            "SELECT * FROM ({ordered}) WHERE (timestamp, id) < (parseDateTime64BestEffort('{ts}'), toUUID('{id}')) LIMIT {fetch}",
            ts = c.timestamp.replace('\'', "''"),
            id = c.id.replace('\'', "''"),
        )
    } else {
        format!("{ordered} LIMIT {fetch}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mpl::parse_mpl;

    #[test]
    fn roundtrip_search_after_token() {
        let c = SearchCursor {
            timestamp: "2026-06-01T12:00:00.000Z".into(),
            id: "550e8400-e29b-41d4-a716-446655440000".into(),
        };
        let token = encode_search_after(&c);
        assert_eq!(decode_search_after(&token).unwrap(), c);
    }

    #[test]
    fn stats_query_not_pageable() {
        let q = parse_mpl(r#"last 1h platform="android" | stats count by parser"#).unwrap();
        assert!(!supports_cursor_pagination(&q));
    }

    #[test]
    fn head_query_is_pageable() {
        let q = parse_mpl(r#"source="case-001" | head 100"#).unwrap();
        assert!(supports_cursor_pagination(&q));
    }
}
