use crate::config::AppConfig;

/// Build ClickHouse HTTP POST with optional auth (required on CH 24.8+ Docker images).
pub async fn post_sql(config: &AppConfig, sql: &str) -> anyhow::Result<String> {
    let client = reqwest::Client::new();
    let mut req = client.post(&config.clickhouse_url).body(sql.to_string());
    if let Some(user) = &config.clickhouse_user {
        req = req.header("X-ClickHouse-User", user);
    }
    if let Some(password) = &config.clickhouse_password {
        req = req.header("X-ClickHouse-Key", password);
    }
    let resp = req.send().await?.error_for_status()?;
    Ok(resp.text().await?)
}
