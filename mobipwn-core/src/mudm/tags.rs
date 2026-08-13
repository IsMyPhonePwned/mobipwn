use super::MudmEvent;
use serde_json::{json, Value};

/// ClickHouse expression: comma-separated case/dataset tags stored in `ext.tags`.
pub fn tags_sql() -> String {
    "arrayStringConcat(JSONExtract(ext, 'tags', 'Array(String)'), ',')".to_string()
}

/// Predicate: event carries a specific ingest/case tag.
pub fn tag_contains_sql(tag: &str) -> String {
    let escaped = tag.replace('\'', "''");
    format!(
        "has(JSONExtract(ext, 'tags', 'Array(String)'), '{escaped}')"
    )
}

/// Merge ingest tags into each event's `ext.tags` JSON array (deduped, order preserved).
pub fn stamp_ingest_tags(events: &mut [MudmEvent], tags: &[String]) {
    if tags.is_empty() {
        return;
    }
    for ev in events.iter_mut() {
        merge_tags_into_ext(&mut ev.ext, tags);
    }
}

fn merge_tags_into_ext(ext: &mut Value, tags: &[String]) {
    let mut merged: Vec<String> = ext
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::trim))
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    for t in tags {
        let t = t.trim();
        if t.is_empty() {
            continue;
        }
        if !merged.iter().any(|x| x == t) {
            merged.push(t.to_string());
        }
    }
    if let Some(obj) = ext.as_object_mut() {
        obj.insert("tags".into(), json!(merged));
    } else {
        *ext = json!({ "tags": merged });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn stamp_merges_without_duplicates() {
        let mut ev = MudmEvent::new(Utc::now(), "test");
        ev.ext = json!({ "tags": ["baseline"], "other": 1 });
        stamp_ingest_tags(std::slice::from_mut(&mut ev), &["prod".into(), "baseline".into()]);
        assert_eq!(
            ev.ext.get("tags").and_then(|v| v.as_array()).map(|a| a.len()),
            Some(2)
        );
    }
}
