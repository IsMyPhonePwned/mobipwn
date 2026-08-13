use crate::config::AppConfig;
use crate::enrichment::ch::{escape_ch, exec_sql};
use crate::enrichment::options::SyncOptions;
use crate::enrichment::progress::SyncProgress;
use crate::enrichment::provider::{ProviderAdapter, SyncResult};
use async_trait::async_trait;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, Default)]
pub struct ThreatIntelAdapter;

#[derive(Clone)]
struct IocRow {
    field: String,
    value: String,
    indicator_type: String,
    malware_family: String,
    score: f32,
}

#[async_trait]
impl ProviderAdapter for ThreatIntelAdapter {
    fn slug(&self) -> &'static str {
        "threatfox"
    }

    fn config_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "json_path": {
                    "type": "string",
                    "description": "Path to IOC JSON array [{indicator,type,malware_family,score}]"
                },
                "csv_path": {
                    "type": "string",
                    "description": "Path to IOC CSV: indicator,indicator_type,malware_family,score"
                },
                "field": {
                    "type": "string",
                    "default": "file_hash",
                    "description": "MUDM field enriched by these indicators"
                }
            }
        })
    }

    fn covers_fields(&self) -> &'static [&'static str] {
        &["file_hash"]
    }

    async fn sync(
        &self,
        config: &AppConfig,
        provider_cfg: &Value,
        progress: &SyncProgress,
        _options: &SyncOptions,
    ) -> anyhow::Result<SyncResult> {
        let field = provider_cfg
            .get("field")
            .and_then(|v| v.as_str())
            .unwrap_or("file_hash")
            .to_string();

        let rows = if let Some(path) = provider_cfg.get("json_path").and_then(|v| v.as_str()) {
            let body = std::fs::read_to_string(path)?;
            let v: Value = serde_json::from_str(&body)?;
            parse_ioc_json(&v, &field)
        } else if let Some(path) = provider_cfg.get("csv_path").and_then(|v| v.as_str()) {
            read_ioc_csv(path, &field)?
        } else {
            vec![IocRow {
                field: field.clone(),
                value: "deadbeef".into(),
                indicator_type: "hash".into(),
                malware_family: "demo".into(),
                score: 0.9,
            }]
        };

        let mut written = 0usize;
        for row in rows {
            progress.request(
                "threatfox",
                &row.field,
                &row.value,
                "write",
                format!(
                    "IOC {} → {} (score {})",
                    row.value, row.malware_family, row.score
                ),
            );
            write_ioc(config, &row).await?;
            written += 1;
        }
        Ok(SyncResult::with_rows(written, _options))
    }
}

async fn write_ioc(config: &AppConfig, row: &IocRow) -> anyhow::Result<()> {
    let db = &config.clickhouse_database;
    let ioc_sql = format!(
        "INSERT INTO {db}.ioc_enrichments (indicator, indicator_type, malware_family, score) \
         VALUES ('{}', '{}', '{}', {})",
        escape_ch(&row.value),
        escape_ch(&row.indicator_type),
        escape_ch(&row.malware_family),
        row.score,
    );
    exec_sql(config, &ioc_sql).await?;

    let custom_sql = format!(
        "INSERT INTO {db}.custom_enrichment_results \
         (field, value, indicator_type, malware_family, score) \
         VALUES ('{}', '{}', '{}', '{}', {})",
        escape_ch(&row.field),
        escape_ch(&row.value),
        escape_ch(&row.indicator_type),
        escape_ch(&row.malware_family),
        row.score,
    );
    exec_sql(config, &custom_sql).await?;
    Ok(())
}

fn read_ioc_csv(path: &str, field: &str) -> anyhow::Result<Vec<IocRow>> {
    let mut out = Vec::new();
    let data = std::fs::read_to_string(path)?;
    for line in data.lines().skip(1) {
        let parts: Vec<_> = line.split(',').map(str::trim).collect();
        if parts.len() >= 2 {
            let score = parts
                .get(3)
                .and_then(|s| s.parse::<f32>().ok())
                .unwrap_or(0.5);
            out.push(IocRow {
                field: field.into(),
                value: parts[0].into(),
                indicator_type: parts[1].into(),
                malware_family: parts.get(2).unwrap_or(&"").to_string(),
                score,
            });
        }
    }
    Ok(out)
}

fn parse_ioc_json(v: &Value, field: &str) -> Vec<IocRow> {
    let mut out = Vec::new();
    if let Some(arr) = v.as_array() {
        for item in arr {
            if let (Some(i), Some(t)) = (
                item.get("indicator").and_then(|x| x.as_str()),
                item.get("type").or_else(|| item.get("indicator_type")).and_then(|x| x.as_str()),
            ) {
                let family = item
                    .get("malware_family")
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                let score = item.get("score").and_then(|x| x.as_f64()).unwrap_or(0.5) as f32;
                out.push(IocRow {
                    field: field.into(),
                    value: i.into(),
                    indicator_type: t.into(),
                    malware_family: family.into(),
                    score,
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ioc_json() {
        let v: Value = json!([{"indicator": "abc", "type": "hash", "score": 0.8}]);
        let rows = parse_ioc_json(&v, "file_hash");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].value, "abc");
    }

    #[test]
    fn parse_ioc_json_empty_for_non_array() {
        assert!(parse_ioc_json(&json!({"indicator": "x"}), "file_hash").is_empty());
    }

    #[test]
    fn parse_ioc_json_uses_indicator_type_field() {
        let v = json!([{"indicator": "1.2.3.4", "indicator_type": "ip", "malware_family": "Emotet"}]);
        let rows = parse_ioc_json(&v, "dest_ip");
        assert_eq!(rows[0].indicator_type, "ip");
        assert_eq!(rows[0].malware_family, "Emotet");
    }

    #[test]
    fn read_ioc_csv_parses_scores() {
        let path = std::env::temp_dir().join(format!("mobipwn_ioc_{}.csv", std::process::id()));
        std::fs::write(
            &path,
            "value,type,family,score\nbad.com,domain,Emotet,0.9\n",
        )
        .unwrap();
        let rows = read_ioc_csv(path.to_str().unwrap(), "destination_domain").unwrap();
        assert_eq!(rows.len(), 1);
        assert!((rows[0].score - 0.9).abs() < f32::EPSILON);
        std::fs::remove_file(path).ok();
    }
}
