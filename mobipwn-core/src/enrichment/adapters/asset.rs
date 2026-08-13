use crate::config::AppConfig;
use crate::enrichment::ch::{escape_ch, exec_sql};
use crate::enrichment::options::SyncOptions;
use crate::enrichment::progress::SyncProgress;
use crate::enrichment::provider::{ProviderAdapter, SyncResult};
use async_trait::async_trait;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, Default)]
pub struct AssetInventoryAdapter;

#[derive(Clone)]
struct AssetRow {
    device_id: String,
    device_model: String,
    owner: String,
    tags: Vec<String>,
}

#[async_trait]
impl ProviderAdapter for AssetInventoryAdapter {
    fn slug(&self) -> &'static str {
        "device_inventory"
    }

    fn config_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "csv_path": {
                    "type": "string",
                    "description": "CSV: device_id,device_model,owner,tags (tags semicolon-separated)"
                }
            }
        })
    }

    fn covers_fields(&self) -> &'static [&'static str] {
        &["device_id", "device_model"]
    }

    async fn sync(
        &self,
        config: &AppConfig,
        provider_cfg: &Value,
        progress: &SyncProgress,
        _options: &SyncOptions,
    ) -> anyhow::Result<SyncResult> {
        let rows = if let Some(path) = provider_cfg.get("csv_path").and_then(|v| v.as_str()) {
            read_asset_csv(path)?
        } else {
            vec![AssetRow {
                device_id: "demo-device-001".into(),
                device_model: "Pixel 8".into(),
                owner: "security@example.com".into(),
                tags: vec!["corp".into(), "android".into()],
            }]
        };

        let mut written = 0usize;
        for row in rows {
            let tags_sql: String = row
                .tags
                .iter()
                .map(|t| format!("'{}'", escape_ch(t)))
                .collect::<Vec<_>>()
                .join(", ");
            let tags_expr = if tags_sql.is_empty() {
                "[]".to_string()
            } else {
                format!("[{tags_sql}]")
            };
            let sql = format!(
                "INSERT INTO {}.asset_enrichments (device_id, device_model, owner, tags) \
                 VALUES ('{}', '{}', '{}', {tags_expr})",
                config.clickhouse_database,
                escape_ch(&row.device_id),
                escape_ch(&row.device_model),
                escape_ch(&row.owner),
            );
            progress.request(
                "device_inventory",
                "device_id",
                &row.device_id,
                "write",
                format!(
                    "Asset {} → {} (owner: {})",
                    row.device_id, row.device_model, row.owner
                ),
            );
            exec_sql(config, &sql).await?;
            written += 1;
        }
        Ok(SyncResult::with_rows(written, _options))
    }
}

fn read_asset_csv(path: &str) -> anyhow::Result<Vec<AssetRow>> {
    let mut out = Vec::new();
    let data = std::fs::read_to_string(path)?;
    for line in data.lines().skip(1) {
        let parts: Vec<_> = line.split(',').map(str::trim).collect();
        if !parts.is_empty() {
            let tags = parts
                .get(3)
                .map(|s| s.split(';').map(str::trim).filter(|t| !t.is_empty()).map(String::from).collect())
                .unwrap_or_default();
            out.push(AssetRow {
                device_id: parts[0].into(),
                device_model: parts.get(1).unwrap_or(&"").to_string(),
                owner: parts.get(2).unwrap_or(&"").to_string(),
                tags,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_asset_csv() {
        let dir = std::env::temp_dir().join("mobipwn_asset_test.csv");
        std::fs::write(
            &dir,
            "device_id,device_model,owner,tags\nd1,Pixel 8,alice@co,corp;android\n",
        )
        .unwrap();
        let rows = read_asset_csv(dir.to_str().unwrap()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].tags, vec!["corp", "android"]);
        std::fs::remove_file(dir).ok();
    }

    #[test]
    fn parses_asset_csv_without_tags() {
        let dir = std::env::temp_dir().join(format!("mobipwn_asset_empty_{}", std::process::id()));
        std::fs::write(&dir, "device_id,device_model,owner,tags\nd2,Pixel 7,bob@co,\n").unwrap();
        let rows = read_asset_csv(dir.to_str().unwrap()).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].tags.is_empty());
        std::fs::remove_file(dir).ok();
    }
}
