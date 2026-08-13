use crate::ch::query_json_each_row;
use crate::config::AppConfig;
use crate::db::{DualPool, PoolHealth};
use crate::entities::{
    apply_primary_anchor, extract_entities_from_events, extract_entities_from_events_with_config,
    CaseEntitiesResponse, EntityExtractConfig, PrimaryEntity,
};

const MAX_EVENTS: u64 = 10_000;

pub async fn fetch_case_entities(
    pool: &DualPool,
    config: &AppConfig,
    ingest_source: &str,
    anchor_override: Option<&PrimaryEntity>,
) -> anyhow::Result<CaseEntitiesResponse> {
    fetch_case_entities_with_config(
        pool,
        config,
        ingest_source,
        anchor_override,
        &EntityExtractConfig::default(),
    )
    .await
}

pub async fn fetch_case_entities_with_config(
    pool: &DualPool,
    config: &AppConfig,
    ingest_source: &str,
    anchor_override: Option<&PrimaryEntity>,
    entity_cfg: &EntityExtractConfig,
) -> anyhow::Result<CaseEntitiesResponse> {
    if pool.health().await != PoolHealth::Full {
        anyhow::bail!("ClickHouse unavailable");
    }
    let source = ingest_source.trim();
    if source.is_empty() {
        return Ok(apply_primary_anchor(
            CaseEntitiesResponse {
                entities: Vec::new(),
                graph: Default::default(),
                primary_entity: None,
                auto_primary_entity: None,
                primary_entity_source: "auto".to_string(),
            },
            anchor_override,
        ));
    }

    let esc = escape_clickhouse_literal(source);
    let db = &config.clickhouse_database;
    let sql = format!(
        "SELECT user, device_id, device_model, bundle_id, src_ip, dest_ip, process_name, file_hash, message, ext \
         FROM {db}.events WHERE source = '{esc}' ORDER BY timestamp DESC LIMIT {MAX_EVENTS}"
    );
    let rows = query_json_each_row(config, db, &sql).await?;
    let (entities, graph, primary_entity) = if *entity_cfg == EntityExtractConfig::default() {
        extract_entities_from_events(&rows)
    } else {
        extract_entities_from_events_with_config(&rows, entity_cfg)
    };
    Ok(apply_primary_anchor(
        CaseEntitiesResponse {
            entities,
            graph,
            primary_entity,
            auto_primary_entity: None,
            primary_entity_source: "auto".to_string(),
        },
        anchor_override,
    ))
}

fn escape_clickhouse_literal(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "''")
}
