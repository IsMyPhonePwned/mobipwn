use crate::marketplace::{EnrichmentProvider, ProviderKind};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(sqlx::FromRow)]
struct ProviderRow {
    id: Uuid,
    slug: String,
    name: String,
    kind: String,
    enabled: bool,
    covers_fields: Vec<String>,
    config: serde_json::Value,
    last_sync_at: Option<chrono::DateTime<chrono::Utc>>,
    last_sync_status: Option<String>,
    last_sync_error: Option<String>,
}

fn parse_kind(s: &str) -> ProviderKind {
    match s {
        "threat_intel" => ProviderKind::ThreatIntel,
        "identity" => ProviderKind::Identity,
        "asset_inventory" => ProviderKind::AssetInventory,
        "geolocation" => ProviderKind::Geolocation,
        _ => ProviderKind::Geolocation,
    }
}

fn row_to_provider(r: ProviderRow) -> EnrichmentProvider {
    EnrichmentProvider {
        id: r.id,
        slug: r.slug,
        name: r.name,
        kind: parse_kind(&r.kind),
        enabled: r.enabled,
        covers_fields: r.covers_fields,
        config: r.config,
        last_sync_at: r.last_sync_at,
        last_sync_status: r.last_sync_status,
        last_sync_error: r.last_sync_error,
        enriched_field_count: 0,
        enriched_fields: Vec::new(),
    }
}

const PROVIDER_SELECT: &str =
    "SELECT id, slug, name, kind::text, enabled, covers_fields, config, \
     last_sync_at, last_sync_status, last_sync_error";

pub struct ProviderRepository {
    pool: PgPool,
}

impl ProviderRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> anyhow::Result<Vec<EnrichmentProvider>> {
        let rows = sqlx::query_as::<_, ProviderRow>(
            &format!("{PROVIDER_SELECT} FROM enrichment_providers ORDER BY name"),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(row_to_provider).collect())
    }

    pub async fn set_enabled(&self, id: Uuid, enabled: bool) -> anyhow::Result<Option<EnrichmentProvider>> {
        let row = sqlx::query_as::<_, ProviderRow>(
            &format!(
                "UPDATE enrichment_providers SET enabled = $2 WHERE id = $1 \
                 RETURNING id, slug, name, kind::text, enabled, covers_fields, config, \
                 last_sync_at, last_sync_status, last_sync_error"
            ),
        )
        .bind(id)
        .bind(enabled)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(row_to_provider))
    }

    pub async fn update_config(
        &self,
        id: Uuid,
        config: serde_json::Value,
    ) -> anyhow::Result<Option<EnrichmentProvider>> {
        let row = sqlx::query_as::<_, ProviderRow>(
            &format!(
                "UPDATE enrichment_providers SET config = $2 WHERE id = $1 \
                 RETURNING id, slug, name, kind::text, enabled, covers_fields, config, \
                 last_sync_at, last_sync_status, last_sync_error"
            ),
        )
        .bind(id)
        .bind(config)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(row_to_provider))
    }

    pub async fn coverage_summary(&self) -> anyhow::Result<(usize, usize)> {
        let enabled: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM enrichment_providers WHERE enabled = true",
        )
        .fetch_one(&self.pool)
        .await?;
        let fields: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(array_length(covers_fields, 1)), 0) FROM enrichment_providers WHERE enabled = true",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok((enabled as usize, fields as usize))
    }
}
