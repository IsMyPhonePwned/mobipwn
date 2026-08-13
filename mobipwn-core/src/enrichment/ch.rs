use crate::config::AppConfig;

pub fn escape_ch(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "''")
}

fn ch_literal(s: &str) -> String {
    format!("'{}'", escape_ch(s))
}

fn clickhouse_source_auth(config: &AppConfig) -> String {
    let user = config
        .clickhouse_user
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("default");
    let mut parts = vec![format!("USER {}", ch_literal(user))];
    if let Some(password) = config
        .clickhouse_password
        .as_deref()
        .filter(|s| !s.is_empty())
    {
        parts.push(format!("PASSWORD {}", ch_literal(password)));
    }
    parts.join("\n    ")
}

/// DDL statements to (re)create enrichment dictionaries with ClickHouse credentials.
/// Required when the server user has a password — dictGet uses the dictionary source,
/// not the HTTP session that created it.
pub fn enrichment_dictionary_ddl(config: &AppConfig) -> Vec<String> {
    let db = &config.clickhouse_database;
    let auth = clickhouse_source_auth(config);
    vec![
        format!("DROP DICTIONARY IF EXISTS {db}.ip_enrichment_dict"),
        format!(
            "CREATE DICTIONARY {db}.ip_enrichment_dict \
             ( \
                 `ip` String, \
                 `country` String, \
                 `city` String \
             ) \
             PRIMARY KEY ip \
             SOURCE(CLICKHOUSE( \
                 HOST 'localhost' \
                 PORT 9000 \
                 {auth} \
                 DB {db_lit} \
                 TABLE 'ip_enrichments' \
             )) \
             LIFETIME(MIN 300 MAX 600) \
             LAYOUT(HASHED())",
            db_lit = ch_literal(db),
        ),
        format!("DROP DICTIONARY IF EXISTS {db}.ioc_enrichment_dict"),
        format!(
            "CREATE DICTIONARY {db}.ioc_enrichment_dict \
             ( \
                 `indicator` String, \
                 `malware_family` String, \
                 `score` Float32, \
                 `vt_malicious` UInt16, \
                 `vt_harmless` UInt16, \
                 `vt_undetected` UInt16, \
                 `vt_suspicious` UInt16, \
                 `vt_reputation` Int32 \
             ) \
             PRIMARY KEY indicator \
             SOURCE(CLICKHOUSE( \
                 HOST 'localhost' \
                 PORT 9000 \
                 {auth} \
                 DB {db_lit} \
                 TABLE 'ioc_enrichments' \
             )) \
             LIFETIME(MIN 300 MAX 600) \
             LAYOUT(HASHED())",
            db_lit = ch_literal(db),
        ),
        format!("DROP DICTIONARY IF EXISTS {db}.package_enrichment_dict"),
        format!(
            "CREATE DICTIONARY {db}.package_enrichment_dict \
             ( \
                 `package_id` String, \
                 `on_play_store` UInt8, \
                 `play_store_url` String, \
                 `app_title` String \
             ) \
             PRIMARY KEY package_id \
             SOURCE(CLICKHOUSE( \
                 HOST 'localhost' \
                 PORT 9000 \
                 {auth} \
                 DB {db_lit} \
                 TABLE 'package_enrichments' \
             )) \
             LIFETIME(MIN 300 MAX 600) \
             LAYOUT(HASHED())",
            db_lit = ch_literal(db),
        ),
    ]
}

pub async fn ensure_enrichment_dictionaries(config: &AppConfig) -> anyhow::Result<()> {
    for stmt in enrichment_dictionary_ddl(config) {
        exec_sql(config, &stmt).await?;
    }
    Ok(())
}

pub async fn exec_sql(config: &AppConfig, sql: &str) -> anyhow::Result<()> {
    crate::ch::post_sql(config, sql).await?;
    Ok(())
}

/// Recreate dictionaries with credentials (if needed) and reload from source tables.
pub async fn reload_enrichment_dictionaries(config: &AppConfig) -> anyhow::Result<()> {
    ensure_enrichment_dictionaries(config).await?;
    let db = &config.clickhouse_database;
    for dict in ["ip_enrichment_dict", "ioc_enrichment_dict", "package_enrichment_dict"] {
        exec_sql(config, &format!("SYSTEM RELOAD DICTIONARY {db}.{dict}")).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dictionary_ddl_includes_clickhouse_password() {
        let config = AppConfig {
            clickhouse_url: "http://127.0.0.1:8123".into(),
            clickhouse_user: Some("default".into()),
            clickhouse_password: Some("mobipwn".into()),
            clickhouse_database: "mobipwn".into(),
            ..AppConfig::from_env()
        };
        let ddl = enrichment_dictionary_ddl(&config).join("\n");
        assert!(ddl.contains("PASSWORD 'mobipwn'"));
        assert!(ddl.contains("USER 'default'"));
        assert!(ddl.contains("mobipwn.ip_enrichment_dict"));
    }

    #[test]
    fn escape_ch_doubles_quotes_and_backslashes() {
        assert_eq!(escape_ch(r"O'Brien\test"), r"O''Brien\\test");
    }
}
