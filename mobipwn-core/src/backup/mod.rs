mod ch;
mod pg;
pub mod sections;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use crate::config::AppConfig;
use crate::DualPool;

pub use sections::{
    list_section_info, BackupSection, BackupSectionInfo, BACKUP_FORMAT_VERSION,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupBundle {
    pub format_version: u32,
    pub exported_at: String,
    pub sections_included: Vec<String>,
    pub data: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    #[default]
    Replace,
    Merge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionImportResult {
    pub section: String,
    pub tables: std::collections::HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportBackupResult {
    pub imported_sections: Vec<SectionImportResult>,
    pub warnings: Vec<String>,
}

pub async fn export_backup(
    pool: &DualPool,
    config: &AppConfig,
    sections: &[BackupSection],
) -> anyhow::Result<BackupBundle> {
    let pg = &pool.postgres;
    let mut data = Map::new();
    let mut included = Vec::new();
    let mut warnings = Vec::new();

    for section in sections {
        included.push(section.id().to_string());
        if section.postgres_tables().is_empty() {
            if section.clickhouse_tables().is_empty() {
                continue;
            }
            match ch::export_clickhouse_section(pool, config, *section).await {
                Ok(payload) => {
                    data.insert(section.id().to_string(), payload);
                }
                Err(e) => warnings.push(format!("{}: {e}", section.id())),
            }
            continue;
        }

        let mut payload = pg::export_section_tables(pg, *section).await?;
        pg::redact_section_rows(*section, &mut payload);

        if !section.clickhouse_tables().is_empty() {
            match ch::export_clickhouse_section(pool, config, *section).await {
                Ok(ch_payload) => {
                    if let (Value::Object(pg_tables), Value::Object(ch_tables)) =
                        (&mut payload, ch_payload)
                    {
                        for (k, v) in ch_tables {
                            pg_tables.insert(k, v);
                        }
                    }
                }
                Err(e) => warnings.push(format!("{}: {e}", section.id())),
            }
        }

        data.insert(section.id().to_string(), payload);
    }

    if !warnings.is_empty() {
        data.insert(
            "_warnings".to_string(),
            Value::Array(warnings.into_iter().map(Value::String).collect()),
        );
    }

    Ok(BackupBundle {
        format_version: BACKUP_FORMAT_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        sections_included: included,
        data,
    })
}

pub async fn import_backup(
    pool: &DualPool,
    config: &AppConfig,
    bundle: &BackupBundle,
    sections: &[BackupSection],
    mode: ImportMode,
) -> anyhow::Result<ImportBackupResult> {
    if bundle.format_version != BACKUP_FORMAT_VERSION {
        anyhow::bail!(
            "unsupported backup format version {} (expected {})",
            bundle.format_version,
            BACKUP_FORMAT_VERSION
        );
    }

    let pg = &pool.postgres;
    let merge = matches!(mode, ImportMode::Merge);
    let mut imported = Vec::new();
    let mut warnings = Vec::new();

    for section in sections {
        let Some(payload) = bundle.data.get(section.id()) else {
            warnings.push(format!("section '{}' not present in backup file", section.id()));
            continue;
        };

        if section.postgres_tables().is_empty() {
            if section.clickhouse_tables().is_empty() {
                continue;
            }
            let counts = ch::import_clickhouse_section(
                pool,
                config,
                *section,
                payload,
                !merge,
            )
            .await?;
            imported.push(SectionImportResult {
                section: section.id().to_string(),
                tables: counts,
            });
            continue;
        }

        let counts = pg::import_section_tables(pg, *section, payload, merge).await?;

        if !section.clickhouse_tables().is_empty() {
            match ch::import_clickhouse_section(pool, config, *section, payload, !merge).await {
                Ok(ch_counts) => {
                    let mut merged = counts;
                    merged.extend(ch_counts);
                    imported.push(SectionImportResult {
                        section: section.id().to_string(),
                        tables: merged,
                    });
                }
                Err(e) => {
                    warnings.push(format!("{}: {e}", section.id()));
                    imported.push(SectionImportResult {
                        section: section.id().to_string(),
                        tables: counts,
                    });
                }
            }
        } else {
            imported.push(SectionImportResult {
                section: section.id().to_string(),
                tables: counts,
            });
        }
    }

    Ok(ImportBackupResult {
        imported_sections: imported,
        warnings,
    })
}

pub fn parse_section_ids(ids: &[String]) -> anyhow::Result<Vec<BackupSection>> {
    let mut out = Vec::new();
    for id in ids {
        let section = BackupSection::from_id(id)
            .ok_or_else(|| anyhow::anyhow!("unknown backup section: {id}"))?;
        if !out.contains(&section) {
            out.push(section);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sections_dedupes() {
        let ids = vec!["config".into(), "rules".into(), "config".into()];
        let parsed = parse_section_ids(&ids).unwrap();
        assert_eq!(parsed.len(), 2);
    }
}
