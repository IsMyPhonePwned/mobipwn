use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SavedQuery {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub query: String,
    pub folder_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SavedQueriesBundle {
    pub folders: Vec<super::SavedQueryFolder>,
    pub queries: Vec<SavedQuery>,
}

#[derive(sqlx::FromRow)]
struct SavedQueryRow {
    id: Uuid,
    name: String,
    description: String,
    query: String,
    folder_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub struct SavedQueryRepository {
    pool: PgPool,
}

impl SavedQueryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> anyhow::Result<Vec<SavedQuery>> {
        let rows = sqlx::query_as::<_, SavedQueryRow>(
            "SELECT id, name, description, query, folder_id, created_at, updated_at \
             FROM saved_queries ORDER BY updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(row_to_query).collect())
    }

    pub async fn bundle(
        &self,
        folders: &super::SavedQueryFolderRepository,
    ) -> anyhow::Result<SavedQueriesBundle> {
        Ok(SavedQueriesBundle {
            folders: folders.list().await?,
            queries: self.list().await?,
        })
    }

    pub async fn create(
        &self,
        name: &str,
        description: &str,
        query: &str,
        folder_id: Option<Uuid>,
    ) -> anyhow::Result<SavedQuery> {
        let row = sqlx::query_as::<_, SavedQueryRow>(
            "INSERT INTO saved_queries (name, description, query, folder_id) VALUES ($1, $2, $3, $4) \
             RETURNING id, name, description, query, folder_id, created_at, updated_at",
        )
        .bind(name)
        .bind(description)
        .bind(query)
        .bind(folder_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row_to_query(row))
    }

    pub async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
        query: Option<&str>,
        folder_id: Option<Option<Uuid>>,
    ) -> anyhow::Result<Option<SavedQuery>> {
        let cur = self.get(id).await?;
        let Some(c) = cur else {
            return Ok(None);
        };
        let row = sqlx::query_as::<_, SavedQueryRow>(
            "UPDATE saved_queries SET name = $2, description = $3, query = $4, folder_id = $5, \
             updated_at = now() WHERE id = $1 \
             RETURNING id, name, description, query, folder_id, created_at, updated_at",
        )
        .bind(id)
        .bind(name.unwrap_or(&c.name))
        .bind(description.unwrap_or(&c.description))
        .bind(query.unwrap_or(&c.query))
        .bind(folder_id.unwrap_or(c.folder_id))
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(row_to_query))
    }

    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<SavedQuery>> {
        let row = sqlx::query_as::<_, SavedQueryRow>(
            "SELECT id, name, description, query, folder_id, created_at, updated_at \
             FROM saved_queries WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(row_to_query))
    }

    pub async fn delete(&self, id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("DELETE FROM saved_queries WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }
}

fn row_to_query(r: SavedQueryRow) -> SavedQuery {
    SavedQuery {
        id: r.id,
        name: r.name,
        description: r.description,
        query: r.query,
        folder_id: r.folder_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}
