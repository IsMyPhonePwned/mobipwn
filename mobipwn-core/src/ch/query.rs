use crate::config::AppConfig;
use serde_json::Value;
use std::time::Duration;

/// Run arbitrary ClickHouse SQL and parse JSONEachRow lines.
pub async fn query_json_each_row(
    config: &AppConfig,
    database: &str,
    sql: &str,
) -> anyhow::Result<Vec<Value>> {
    let sql_body = if sql.to_ascii_uppercase().contains("FORMAT ") {
        sql.to_string()
    } else {
        format!("{sql} FORMAT JSONEachRow")
    };

    let max_exec = config.search_admission.max_execution_time_secs;

    let timeout_secs = if max_exec > 0 {
        max_exec as u64 + 10
    } else {
        AppConfig::clickhouse_query_timeout().as_secs()
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()?;

    let mut url_params: Vec<(&str, String)> = vec![("database", database.to_string())];
    if max_exec > 0 {
        url_params.push(("max_execution_time", max_exec.to_string()));
    }

    let mut req = client
        .post(&config.clickhouse_url)
        .query(&url_params)
        .body(sql_body);
    if let Some(user) = &config.clickhouse_user {
        req = req.header("X-ClickHouse-User", user);
    }
    if let Some(password) = &config.clickhouse_password {
        req = req.header("X-ClickHouse-Key", password);
    }
    let resp = req.send().await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        let detail = text.trim();
        if detail.is_empty() {
            anyhow::bail!("ClickHouse HTTP {status} for query");
        }
        if detail.contains("TIMEOUT_EXCEEDED") || detail.contains("Timeout exceeded") {
            anyhow::bail!(
                "query exceeded max execution time ({}s)",
                max_exec.max(1)
            );
        }
        anyhow::bail!("ClickHouse: {detail}");
    }
    let mut rows = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        rows.push(serde_json::from_str(line)?);
    }
    Ok(rows)
}
