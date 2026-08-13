use crate::ch::query_json_each_row;
use crate::config::AppConfig;
use crate::marketplace::EnrichmentProvider;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// For each provider slug, MUDM fields that have enrichment rows in ClickHouse.
pub async fn enrichment_field_stats(
    config: &AppConfig,
    providers: &[EnrichmentProvider],
) -> anyhow::Result<HashMap<String, Vec<String>>> {
    let db = &config.clickhouse_database;
    let mut out: HashMap<String, Vec<String>> = providers
        .iter()
        .map(|p| (p.slug.clone(), Vec::new()))
        .collect();

    let custom_rows = query_json_each_row(
        config,
        db,
        &format!(
            "SELECT \
               field, \
               countIf(startsWith(malware_family, 'VT ')) AS vt_rows, \
               countIf(indicator_type != '' AND NOT startsWith(malware_family, 'VT ')) AS threat_rows, \
               countIf(enrichment_key IN ('bundle_id', 'user', 'label')) AS identity_rows \
             FROM {db}.custom_enrichment_results \
             GROUP BY field"
        ),
    )
    .await
    .unwrap_or_default();

    for provider in providers {
        let covers: HashSet<&str> = provider.covers_fields.iter().map(String::as_str).collect();
        let enriched: Vec<String> = match provider.slug.as_str() {
            "virustotal" => fields_with_rows(&custom_rows, &covers, "vt_rows"),
            "threatfox" => fields_with_rows(&custom_rows, &covers, "threat_rows"),
            "mobile_identity" => fields_with_rows(&custom_rows, &covers, "identity_rows"),
            "geo_lite" | "device_inventory" | "google_play" => Vec::new(),
            _ => Vec::new(),
        };
        out.insert(provider.slug.clone(), enriched);
    }

    if table_has_rows(config, db, "ip_enrichments").await {
        if let Some(provider) = providers.iter().find(|p| p.slug == "geo_lite") {
            out.insert(
                provider.slug.clone(),
                provider.covers_fields.clone(),
            );
        }
    }

    if table_has_rows(config, db, "asset_enrichments").await {
        if let Some(provider) = providers.iter().find(|p| p.slug == "device_inventory") {
            out.insert(
                provider.slug.clone(),
                provider.covers_fields.clone(),
            );
        }
    }

    if table_has_rows(config, db, "package_enrichments").await {
        if let Some(provider) = providers.iter().find(|p| p.slug == "google_play") {
            out.insert(
                provider.slug.clone(),
                provider.covers_fields.clone(),
            );
        }
    }

    Ok(out)
}

fn fields_with_rows(
    rows: &[Value],
    covers: &HashSet<&str>,
    count_key: &str,
) -> Vec<String> {
    let mut fields: Vec<String> = rows
        .iter()
        .filter_map(|row| {
            let field = row.get("field")?.as_str()?;
            if !covers.contains(field) {
                return None;
            }
            let count = row_count(row.get(count_key));
            if count > 0 {
                Some(field.to_string())
            } else {
                None
            }
        })
        .collect();
    fields.sort();
    fields.dedup();
    fields
}

async fn table_has_rows(config: &AppConfig, db: &str, table: &str) -> bool {
    let Ok(rows) = query_json_each_row(
        config,
        db,
        &format!("SELECT count() AS c FROM {db}.{table}"),
    )
    .await
    else {
        return false;
    };
    rows.first()
        .and_then(|r| r.get("c"))
        .map(|v| row_count(Some(v)) > 0)
        .unwrap_or(false)
}

fn row_count(v: Option<&Value>) -> u64 {
    match v {
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_vt_fields_with_rows() {
        let rows = vec![
            json!({"field": "dest_ip", "vt_rows": 5, "threat_rows": 0, "identity_rows": 0}),
            json!({"field": "file_hash", "vt_rows": 0, "threat_rows": 0, "identity_rows": 0}),
        ];
        let covers: HashSet<&str> = ["dest_ip", "file_hash"].into_iter().collect();
        let fields = fields_with_rows(&rows, &covers, "vt_rows");
        assert_eq!(fields, vec!["dest_ip"]);
    }

    #[test]
    fn row_count_accepts_number_and_string() {
        assert_eq!(row_count(Some(&json!(42))), 42);
        assert_eq!(row_count(Some(&json!("99"))), 99);
        assert_eq!(row_count(Some(&json!("bad"))), 0);
        assert_eq!(row_count(None), 0);
    }

    #[test]
    fn fields_with_rows_ignores_uncovered_fields() {
        let rows = vec![json!({"field": "user", "vt_rows": 5})];
        let covers: HashSet<&str> = ["dest_ip"].into_iter().collect();
        assert!(fields_with_rows(&rows, &covers, "vt_rows").is_empty());
    }
}
