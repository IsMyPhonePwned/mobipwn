use crate::config::AppConfig;
use serde::Serialize;
use sqlx::PgPool;

use super::ch::{exec_sql, reload_enrichment_dictionaries};

#[derive(Debug, Clone, Serialize)]
pub struct CleanSummary {
    /// `"all"` or the provider slug when clearing a single provider.
    pub scope: String,
    pub tables_truncated: Vec<String>,
    pub dictionaries_reloaded: bool,
}

const ENRICHMENT_TABLES: &[&str] = &[
    "ip_enrichments",
    "ioc_enrichments",
    "custom_enrichment_results",
    "asset_enrichments",
    "package_enrichments",
];

const KNOWN_PROVIDER_SLUGS: &[&str] = &[
    "geo_lite",
    "virustotal",
    "threatfox",
    "mobile_identity",
    "device_inventory",
    "google_play",
];

/// Remove synced enrichment rows from ClickHouse and reset provider sync metadata.
/// Pass `None` to clear all providers; pass a slug to clear one provider only.
pub async fn clean_enrichment_data(
    pool: &PgPool,
    config: &AppConfig,
    slug: Option<&str>,
) -> anyhow::Result<CleanSummary> {
    match slug {
        None => clean_all(pool, config).await,
        Some(s) => clean_provider(pool, config, s).await,
    }
}

async fn clean_all(pool: &PgPool, config: &AppConfig) -> anyhow::Result<CleanSummary> {
    let db = &config.clickhouse_database;
    let mut tables_truncated = Vec::new();

    for table in ENRICHMENT_TABLES {
        exec_sql(config, &format!("TRUNCATE TABLE {db}.{table}")).await?;
        tables_truncated.push(table.to_string());
    }

    reset_provider_sync_metadata(pool, None).await?;

    let dictionaries_reloaded = reload_dictionaries(config).await;

    Ok(CleanSummary {
        scope: "all".into(),
        tables_truncated,
        dictionaries_reloaded,
    })
}

async fn clean_provider(
    pool: &PgPool,
    config: &AppConfig,
    slug: &str,
) -> anyhow::Result<CleanSummary> {
    if !KNOWN_PROVIDER_SLUGS.contains(&slug) {
        anyhow::bail!("unknown enrichment provider slug: {slug}");
    }

    let db = &config.clickhouse_database;
    let mut tables_truncated = Vec::new();

    for (table, sql) in provider_clean_actions(db, slug)? {
        exec_sql(config, &sql).await?;
        tables_truncated.push(table);
    }

    reset_provider_sync_metadata(pool, Some(slug)).await?;

    let dictionaries_reloaded = reload_dictionaries(config).await;

    Ok(CleanSummary {
        scope: slug.to_string(),
        tables_truncated,
        dictionaries_reloaded,
    })
}

fn provider_clean_actions(db: &str, slug: &str) -> anyhow::Result<Vec<(String, String)>> {
    let actions = match slug {
        "geo_lite" => vec![(
            "ip_enrichments".into(),
            format!("TRUNCATE TABLE {db}.ip_enrichments"),
        )],
        "virustotal" => vec![
            (
                "ioc_enrichments".into(),
                format!(
                    "ALTER TABLE {db}.ioc_enrichments DELETE WHERE startsWith(malware_family, 'VT ')"
                ),
            ),
            (
                "custom_enrichment_results".into(),
                format!(
                    "ALTER TABLE {db}.custom_enrichment_results DELETE WHERE startsWith(malware_family, 'VT ')"
                ),
            ),
        ],
        "threatfox" => vec![
            (
                "ioc_enrichments".into(),
                format!(
                    "ALTER TABLE {db}.ioc_enrichments DELETE WHERE NOT startsWith(malware_family, 'VT ')"
                ),
            ),
            (
                "custom_enrichment_results".into(),
                format!(
                    "ALTER TABLE {db}.custom_enrichment_results DELETE \
                     WHERE indicator_type != '' AND NOT startsWith(malware_family, 'VT ')"
                ),
            ),
        ],
        "mobile_identity" => vec![(
            "custom_enrichment_results".into(),
            format!(
                "ALTER TABLE {db}.custom_enrichment_results DELETE \
                 WHERE enrichment_key IN ('bundle_id', 'user', 'label')"
            ),
        )],
        "device_inventory" => vec![(
            "asset_enrichments".into(),
            format!("TRUNCATE TABLE {db}.asset_enrichments"),
        )],
        "google_play" => vec![(
            "package_enrichments".into(),
            format!("TRUNCATE TABLE {db}.package_enrichments"),
        )],
        _ => anyhow::bail!("unknown enrichment provider slug: {slug}"),
    };
    Ok(actions)
}

async fn reset_provider_sync_metadata(pool: &PgPool, slug: Option<&str>) -> anyhow::Result<()> {
    match slug {
        None => {
            sqlx::query(
                "UPDATE enrichment_providers \
                 SET last_sync_at = NULL, last_sync_status = NULL, last_sync_error = NULL",
            )
            .execute(pool)
            .await?;
        }
        Some(slug) => {
            sqlx::query(
                "UPDATE enrichment_providers \
                 SET last_sync_at = NULL, last_sync_status = NULL, last_sync_error = NULL \
                 WHERE slug = $1",
            )
            .bind(slug)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

async fn reload_dictionaries(config: &AppConfig) -> bool {
    reload_enrichment_dictionaries(config)
        .await
        .inspect_err(|e| tracing::warn!(error = %e, "failed to reload enrichment dictionaries after clean"))
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_clean_actions_cover_all_known_slugs() {
        for slug in KNOWN_PROVIDER_SLUGS {
            let actions = provider_clean_actions("mobipwn", slug).unwrap();
            assert!(!actions.is_empty(), "expected actions for {slug}");
        }
    }

    #[test]
    fn rejects_unknown_provider_slug() {
        assert!(provider_clean_actions("mobipwn", "unknown").is_err());
    }

    #[test]
    fn virustotal_clean_targets_vt_prefix() {
        let actions = provider_clean_actions("mobipwn", "virustotal").unwrap();
        assert_eq!(actions.len(), 2);
        for (_, sql) in &actions {
            assert!(sql.contains("startsWith(malware_family, 'VT ')"));
        }
    }

    #[test]
    fn threatfox_clean_excludes_vt_prefix() {
        let actions = provider_clean_actions("mobipwn", "threatfox").unwrap();
        for (_, sql) in &actions {
            assert!(sql.contains("NOT startsWith(malware_family, 'VT ')"));
        }
    }

    #[test]
    fn geo_lite_truncates_ip_table() {
        let actions = provider_clean_actions("mobipwn", "geo_lite").unwrap();
        assert_eq!(actions.len(), 1);
        assert!(actions[0].1.contains("TRUNCATE TABLE mobipwn.ip_enrichments"));
    }
}
