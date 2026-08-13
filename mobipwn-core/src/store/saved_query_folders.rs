use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SavedQueryFolder {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct FolderRow {
    id: Uuid,
    name: String,
    parent_id: Option<Uuid>,
    sort_order: i32,
    created_at: DateTime<Utc>,
}

pub struct SavedQueryFolderRepository {
    pool: PgPool,
}

impl SavedQueryFolderRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> anyhow::Result<Vec<SavedQueryFolder>> {
        let rows = sqlx::query_as::<_, FolderRow>(
            "SELECT id, name, parent_id, sort_order, created_at FROM saved_query_folders \
             ORDER BY sort_order, name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| SavedQueryFolder {
                id: r.id,
                name: r.name,
                parent_id: r.parent_id,
                sort_order: r.sort_order,
                created_at: r.created_at,
            })
            .collect())
    }

    pub async fn create(&self, name: &str, parent_id: Option<Uuid>) -> anyhow::Result<SavedQueryFolder> {
        let row = sqlx::query_as::<_, FolderRow>(
            "INSERT INTO saved_query_folders (name, parent_id) VALUES ($1, $2) \
             RETURNING id, name, parent_id, sort_order, created_at",
        )
        .bind(name)
        .bind(parent_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(SavedQueryFolder {
            id: row.id,
            name: row.name,
            parent_id: row.parent_id,
            sort_order: row.sort_order,
            created_at: row.created_at,
        })
    }

    pub async fn rename(&self, id: Uuid, name: &str) -> anyhow::Result<Option<SavedQueryFolder>> {
        let row = sqlx::query_as::<_, FolderRow>(
            "UPDATE saved_query_folders SET name = $2 WHERE id = $1 \
             RETURNING id, name, parent_id, sort_order, created_at",
        )
        .bind(id)
        .bind(name)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| SavedQueryFolder {
            id: r.id,
            name: r.name,
            parent_id: r.parent_id,
            sort_order: r.sort_order,
            created_at: r.created_at,
        }))
    }

    pub async fn delete(&self, id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("DELETE FROM saved_query_folders WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }
}
