use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dashboard {
    pub id: Uuid,
    pub name: String,
    pub layout: Value,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    name: String,
    layout: Value,
    is_default: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub struct DashboardRepository {
    pool: PgPool,
}

impl DashboardRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> anyhow::Result<Vec<Dashboard>> {
        let rows = sqlx::query_as::<_, Row>(
            "SELECT id, name, layout, is_default, created_at, updated_at FROM dashboards ORDER BY is_default DESC, name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| Dashboard {
                id: r.id,
                name: r.name,
                layout: r.layout,
                is_default: r.is_default,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
            .collect())
    }

    pub async fn get_default(&self) -> anyhow::Result<Option<Dashboard>> {
        let row = sqlx::query_as::<_, Row>(
            "SELECT id, name, layout, is_default, created_at, updated_at FROM dashboards WHERE is_default = true LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| Dashboard {
            id: r.id,
            name: r.name,
            layout: r.layout,
            is_default: r.is_default,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }))
    }

    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<Dashboard>> {
        let row = sqlx::query_as::<_, Row>(
            "SELECT id, name, layout, is_default, created_at, updated_at FROM dashboards WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| Dashboard {
            id: r.id,
            name: r.name,
            layout: r.layout,
            is_default: r.is_default,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }))
    }

    pub async fn create(&self, name: &str, layout: Value) -> anyhow::Result<Dashboard> {
        let row = sqlx::query_as::<_, Row>(
            "INSERT INTO dashboards (name, layout, is_default) VALUES ($1, $2, false) \
             RETURNING id, name, layout, is_default, created_at, updated_at",
        )
        .bind(name)
        .bind(layout)
        .fetch_one(&self.pool)
        .await?;
        Ok(Dashboard {
            id: row.id,
            name: row.name,
            layout: row.layout,
            is_default: row.is_default,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }

    pub async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        layout: Option<Value>,
    ) -> anyhow::Result<Option<Dashboard>> {
        let row = sqlx::query_as::<_, Row>(
            "UPDATE dashboards SET \
             name = COALESCE($2, name), \
             layout = COALESCE($3, layout), \
             updated_at = now() \
             WHERE id = $1 \
             RETURNING id, name, layout, is_default, created_at, updated_at",
        )
        .bind(id)
        .bind(name)
        .bind(layout)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| Dashboard {
            id: r.id,
            name: r.name,
            layout: r.layout,
            is_default: r.is_default,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }))
    }

    pub async fn delete(&self, id: Uuid) -> anyhow::Result<bool> {
        let result = sqlx::query("DELETE FROM dashboards WHERE id = $1 AND is_default = false")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn save_default_layout(&self, layout: Value) -> anyhow::Result<Dashboard> {
        if let Some(d) = self.get_default().await? {
            let row = sqlx::query_as::<_, Row>(
                "UPDATE dashboards SET layout = $2, updated_at = now() WHERE id = $1 \
                 RETURNING id, name, layout, is_default, created_at, updated_at",
            )
            .bind(d.id)
            .bind(layout)
            .fetch_one(&self.pool)
            .await?;
            return Ok(Dashboard {
                id: row.id,
                name: row.name,
                layout: row.layout,
                is_default: row.is_default,
                created_at: row.created_at,
                updated_at: row.updated_at,
            });
        }
        let row = sqlx::query_as::<_, Row>(
            "INSERT INTO dashboards (name, layout, is_default) VALUES ('Overview', $1, true) \
             RETURNING id, name, layout, is_default, created_at, updated_at",
        )
        .bind(layout)
        .fetch_one(&self.pool)
        .await?;
        Ok(Dashboard {
            id: row.id,
            name: row.name,
            layout: row.layout,
            is_default: row.is_default,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}
