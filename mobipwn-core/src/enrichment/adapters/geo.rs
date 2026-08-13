use crate::config::AppConfig;
use crate::enrichment::ch::{escape_ch, exec_sql};
use crate::enrichment::options::SyncOptions;
use crate::enrichment::progress::SyncProgress;
use crate::enrichment::provider::{ProviderAdapter, SyncResult};
use async_trait::async_trait;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, Default)]
pub struct GeoIpAdapter;

#[async_trait]
impl ProviderAdapter for GeoIpAdapter {
    fn slug(&self) -> &'static str {
        "geo_lite"
    }

    fn config_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "csv_path": {
                    "type": "string",
                    "description": "Path to GeoIP CSV (ipinfo or MaxMind-style columns)"
                },
                "format": {
                    "type": "string",
                    "enum": ["ipinfo", "maxmind"],
                    "default": "ipinfo",
                    "description": "ipinfo: ip,country,city — maxmind: ip,country_iso,country,city,asn"
                }
            }
        })
    }

    fn covers_fields(&self) -> &'static [&'static str] {
        &["src_ip", "dest_ip"]
    }

    async fn sync(
        &self,
        config: &AppConfig,
        provider_cfg: &Value,
        progress: &SyncProgress,
        _options: &SyncOptions,
    ) -> anyhow::Result<SyncResult> {
        let format = provider_cfg
            .get("format")
            .and_then(|v| v.as_str())
            .unwrap_or("ipinfo");
        let rows = if let Some(path) = provider_cfg.get("csv_path").and_then(|v| v.as_str()) {
            read_geo_csv(path, format)?
        } else {
            vec![
                ("8.8.8.8".into(), "US".into(), "Mountain View".into(), String::new()),
                ("1.1.1.1".into(), "AU".into(), "Sydney".into(), String::new()),
            ]
        };

        let mut written = 0usize;
        for (ip, country, city, asn) in rows {
            progress.request(
                "geo_lite",
                "src_ip",
                &ip,
                "write",
                if asn.is_empty() {
                    format!("GeoIP {ip} → {country}, {city}")
                } else {
                    format!("GeoIP {ip} → {country}, {city} ({asn})")
                },
            );
            let sql = if asn.is_empty() {
                format!(
                    "INSERT INTO {}.ip_enrichments (ip, country, city) VALUES ('{}', '{}', '{}')",
                    config.clickhouse_database,
                    escape_ch(&ip),
                    escape_ch(&country),
                    escape_ch(&city),
                )
            } else {
                format!(
                    "INSERT INTO {}.ip_enrichments (ip, country, city, asn) VALUES ('{}', '{}', '{}', '{}')",
                    config.clickhouse_database,
                    escape_ch(&ip),
                    escape_ch(&country),
                    escape_ch(&city),
                    escape_ch(&asn),
                )
            };
            exec_sql(config, &sql).await?;
            written += 1;
        }
        Ok(SyncResult::with_rows(written, _options))
    }
}

fn read_geo_csv(path: &str, format: &str) -> anyhow::Result<Vec<(String, String, String, String)>> {
    let mut out = Vec::new();
    let data = std::fs::read_to_string(path)?;
    for line in data.lines().skip(1) {
        let parts: Vec<_> = line.split(',').map(str::trim).collect();
        match format {
            "maxmind" if parts.len() >= 4 => {
                let asn = parts.get(4).unwrap_or(&"").to_string();
                out.push((parts[0].into(), parts[1].into(), parts[3].into(), asn));
            }
            _ if parts.len() >= 3 => {
                out.push((parts[0].into(), parts[1].into(), parts[2].into(), String::new()));
            }
            _ => {}
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ipinfo_csv() {
        let dir = std::env::temp_dir().join("mobipwn_geo_test.csv");
        std::fs::write(&dir, "ip,country,city\n8.8.8.8,US,Mountain View\n").unwrap();
        let rows = read_geo_csv(dir.to_str().unwrap(), "ipinfo").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "8.8.8.8");
        std::fs::remove_file(dir).ok();
    }

    #[test]
    fn parses_maxmind_csv_with_asn() {
        let dir = std::env::temp_dir().join(format!("mobipwn_geo_mm_{}", std::process::id()));
        std::fs::write(
            &dir,
            "ip,country_iso,country,city,asn\n1.1.1.1,AU,Australia,Sydney,AS13335\n",
        )
        .unwrap();
        let rows = read_geo_csv(dir.to_str().unwrap(), "maxmind").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].3, "AS13335");
        std::fs::remove_file(dir).ok();
    }
}
