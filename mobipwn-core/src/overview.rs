use crate::ch::query_json_each_row;
use crate::config::AppConfig;
use serde::Serialize;
use sqlx::PgPool;

#[derive(Debug, Serialize)]
pub struct OverviewStats {
    pub events_24h: u64,
    pub alerts_new: i64,
    pub rules_total: i64,
    pub rules_alerting: i64,
    pub providers_enabled: usize,
    pub mudm_fields_covered: usize,
    pub cases_total: i64,
    pub cases_android: i64,
    pub cases_ios: i64,
    pub cases_endpoint: i64,
}

pub async fn fetch_overview(
    pool: &PgPool,
    config: &AppConfig,
) -> anyhow::Result<OverviewStats> {
    let events_24h = match query_json_each_row(
        config,
        &config.clickhouse_database,
        &format!(
            "SELECT count() AS c FROM {}.events WHERE timestamp >= now() - INTERVAL 24 HOUR",
            config.clickhouse_database
        ),
    )
    .await
    {
        Ok(rows) => rows
            .first()
            .and_then(|r| r.get("c"))
            .map(|v| {
                v.as_u64()
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                    .unwrap_or(0)
            })
            .unwrap_or(0),
        Err(_) => 0,
    };

    let alerts_new: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM alerts WHERE status = 'new' AND dismissed_at IS NULL",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let rules_total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM detection_rules")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let rules_alerting: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM detection_rules WHERE lifecycle = 'alerting'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let providers_enabled: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM enrichment_providers WHERE enabled = true",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let mudm_fields_covered: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(array_length(covers_fields, 1)), 0) FROM enrichment_providers WHERE enabled = true",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let cases_total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cases")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let cases_android: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cases WHERE tags @> ARRAY['android']::text[]",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let cases_ios: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cases WHERE tags @> ARRAY['ios']::text[]",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let cases_endpoint: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cases WHERE tags @> ARRAY['endpoint']::text[]",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    Ok(OverviewStats {
        events_24h,
        alerts_new,
        rules_total,
        rules_alerting,
        providers_enabled: providers_enabled as usize,
        mudm_fields_covered: mudm_fields_covered as usize,
        cases_total,
        cases_android,
        cases_ios,
        cases_endpoint,
    })
}
