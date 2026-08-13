use serde_json::Value;

/// Entity facets used for alert dedup (rule + facets → one alert row).
pub fn detection_facets_from_event_row(row: &Value) -> Vec<(&'static str, String)> {
    let keys = ["platform", "bundle_id", "parser", "device_id"];
    keys.iter()
        .filter_map(|k| {
            row.get(*k)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| (*k, s.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn skips_empty_facet_fields() {
        let row = json!({
            "platform": "android",
            "parser": "Network",
            "bundle_id": "",
            "device_id": "dev-1"
        });
        let facets = detection_facets_from_event_row(&row);
        assert_eq!(facets.len(), 3);
        assert!(facets.iter().any(|(k, v)| *k == "platform" && v == "android"));
        assert!(facets.iter().any(|(k, v)| *k == "parser" && v == "Network"));
    }
}
