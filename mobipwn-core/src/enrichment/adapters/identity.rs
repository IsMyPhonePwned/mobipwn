use crate::config::AppConfig;
use crate::enrichment::ch::{escape_ch, exec_sql};
use crate::enrichment::options::SyncOptions;
use crate::enrichment::progress::SyncProgress;
use crate::enrichment::provider::{ProviderAdapter, SyncResult};
use async_trait::async_trait;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, Default)]
pub struct IdentityAdapter;

#[derive(Clone)]
struct IdentityRow {
    user: String,
    bundle_id: String,
    label: String,
}

#[async_trait]
impl ProviderAdapter for IdentityAdapter {
    fn slug(&self) -> &'static str {
        "mobile_identity"
    }

    fn config_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "csv_path": {
                    "type": "string",
                    "description": "CSV: user,bundle_id,label"
                }
            }
        })
    }

    fn covers_fields(&self) -> &'static [&'static str] {
        &["user", "bundle_id"]
    }

    async fn sync(
        &self,
        config: &AppConfig,
        provider_cfg: &Value,
        progress: &SyncProgress,
        _options: &SyncOptions,
    ) -> anyhow::Result<SyncResult> {
        let rows = if let Some(path) = provider_cfg.get("csv_path").and_then(|v| v.as_str()) {
            read_identity_csv(path)?
        } else {
            return Ok(SyncResult::with_rows(0, _options));
        };

        let mut written = 0usize;
        let db = &config.clickhouse_database;
        for row in rows {
            progress.provider(
                "mobile_identity",
                "write",
                format!("Identity mapping for user {} / bundle {}", row.user, row.bundle_id),
            );
            for (field, value, key, val) in [
                ("user", &row.user, "bundle_id", &row.bundle_id),
                ("bundle_id", &row.bundle_id, "user", &row.user),
            ] {
                let sql = format!(
                    "INSERT INTO {db}.custom_enrichment_results \
                     (field, value, enrichment_key, enrichment_value) \
                     VALUES ('{field}', '{}', '{key}', '{}')",
                    escape_ch(value),
                    escape_ch(val),
                );
                exec_sql(config, &sql).await?;
                written += 1;
            }
            if !row.label.is_empty() {
                let sql = format!(
                    "INSERT INTO {db}.custom_enrichment_results \
                     (field, value, enrichment_key, enrichment_value) \
                     VALUES ('bundle_id', '{}', 'label', '{}')",
                    escape_ch(&row.bundle_id),
                    escape_ch(&row.label),
                );
                exec_sql(config, &sql).await?;
                written += 1;
            }
        }
        Ok(SyncResult::with_rows(written, _options))
    }
}

fn read_identity_csv(path: &str) -> anyhow::Result<Vec<IdentityRow>> {
    let mut out = Vec::new();
    let data = std::fs::read_to_string(path)?;
    for line in data.lines().skip(1) {
        let parts: Vec<_> = line.split(',').map(str::trim).collect();
        if parts.len() >= 2 {
            out.push(IdentityRow {
                user: parts[0].into(),
                bundle_id: parts[1].into(),
                label: parts.get(2).unwrap_or(&"").to_string(),
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_identity_csv_with_optional_label() {
        let path = std::env::temp_dir().join(format!("mobipwn_identity_{}.csv", std::process::id()));
        std::fs::write(
            &path,
            "user,bundle_id,label\nalice,com.example.app,Corp device\nbob,com.other.app,\n",
        )
        .unwrap();
        let rows = read_identity_csv(path.to_str().unwrap()).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].user, "alice");
        assert_eq!(rows[0].label, "Corp device");
        assert!(rows[1].label.is_empty());
        std::fs::remove_file(path).ok();
    }
}
