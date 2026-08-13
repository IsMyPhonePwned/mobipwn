use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RuleRepositoryRecord {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub rule_count: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RuleFolderRecord {
    pub id: Uuid,
    pub repository_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub name: String,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub rule_count: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RuleOrganizationBundle {
    pub repositories: Vec<RuleRepositoryRecord>,
    pub folders: Vec<RuleFolderRecord>,
}

#[derive(sqlx::FromRow)]
struct RepoRow {
    id: Uuid,
    name: String,
    description: String,
    sort_order: i32,
    created_at: DateTime<Utc>,
    rule_count: i64,
}

#[derive(sqlx::FromRow)]
struct FolderRow {
    id: Uuid,
    repository_id: Uuid,
    parent_id: Option<Uuid>,
    name: String,
    sort_order: i32,
    created_at: DateTime<Utc>,
    rule_count: i64,
}

pub struct RuleOrganizationRepository {
    pool: PgPool,
}

impl RuleOrganizationRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn bundle(&self) -> anyhow::Result<RuleOrganizationBundle> {
        let repositories = self.list_repositories().await?;
        let folders = self.list_folders(None).await?;
        Ok(RuleOrganizationBundle {
            repositories,
            folders,
        })
    }

    pub async fn list_repositories(&self) -> anyhow::Result<Vec<RuleRepositoryRecord>> {
        let rows = sqlx::query_as::<_, RepoRow>(
            "SELECT r.id, r.name, r.description, r.sort_order, r.created_at, \
             COUNT(dr.id)::bigint AS rule_count \
             FROM rule_repositories r \
             LEFT JOIN detection_rules dr ON dr.repository_id = r.id \
             GROUP BY r.id \
             ORDER BY r.sort_order, r.name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| RuleRepositoryRecord {
                id: r.id,
                name: r.name,
                description: r.description,
                sort_order: r.sort_order,
                created_at: r.created_at,
                rule_count: r.rule_count,
            })
            .collect())
    }

    pub async fn create_repository(
        &self,
        name: &str,
        description: Option<&str>,
    ) -> anyhow::Result<RuleRepositoryRecord> {
        let row = sqlx::query_as::<_, RepoRow>(
            "INSERT INTO rule_repositories (name, description) VALUES ($1, COALESCE($2, '')) \
             RETURNING id, name, description, sort_order, created_at, 0::bigint AS rule_count",
        )
        .bind(name)
        .bind(description)
        .fetch_one(&self.pool)
        .await?;
        Ok(RuleRepositoryRecord {
            id: row.id,
            name: row.name,
            description: row.description,
            sort_order: row.sort_order,
            created_at: row.created_at,
            rule_count: 0,
        })
    }

    pub async fn list_folders(
        &self,
        repository_id: Option<Uuid>,
    ) -> anyhow::Result<Vec<RuleFolderRecord>> {
        let rows = if let Some(repo) = repository_id {
            sqlx::query_as::<_, FolderRow>(
                "SELECT f.id, f.repository_id, f.parent_id, f.name, f.sort_order, f.created_at, \
                 COUNT(dr.id)::bigint AS rule_count \
                 FROM rule_folders f \
                 LEFT JOIN detection_rules dr ON dr.folder_id = f.id \
                 WHERE f.repository_id = $1 \
                 GROUP BY f.id \
                 ORDER BY f.sort_order, f.name",
            )
            .bind(repo)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, FolderRow>(
                "SELECT f.id, f.repository_id, f.parent_id, f.name, f.sort_order, f.created_at, \
                 COUNT(dr.id)::bigint AS rule_count \
                 FROM rule_folders f \
                 LEFT JOIN detection_rules dr ON dr.folder_id = f.id \
                 GROUP BY f.id \
                 ORDER BY f.repository_id, f.sort_order, f.name",
            )
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows
            .into_iter()
            .map(|r| RuleFolderRecord {
                id: r.id,
                repository_id: r.repository_id,
                parent_id: r.parent_id,
                name: r.name,
                sort_order: r.sort_order,
                created_at: r.created_at,
                rule_count: r.rule_count,
            })
            .collect())
    }

    pub async fn create_folder(
        &self,
        repository_id: Uuid,
        name: &str,
        parent_id: Option<Uuid>,
    ) -> anyhow::Result<RuleFolderRecord> {
        let row = sqlx::query_as::<_, FolderRow>(
            "INSERT INTO rule_folders (repository_id, parent_id, name) VALUES ($1, $2, $3) \
             RETURNING id, repository_id, parent_id, name, sort_order, created_at, 0::bigint AS rule_count",
        )
        .bind(repository_id)
        .bind(parent_id)
        .bind(name)
        .fetch_one(&self.pool)
        .await?;
        Ok(RuleFolderRecord {
            id: row.id,
            repository_id: row.repository_id,
            parent_id: row.parent_id,
            name: row.name,
            sort_order: row.sort_order,
            created_at: row.created_at,
            rule_count: 0,
        })
    }

    pub async fn rename_folder(&self, id: Uuid, name: &str) -> anyhow::Result<Option<RuleFolderRecord>> {
        let row = sqlx::query_as::<_, FolderRow>(
            "UPDATE rule_folders SET name = $2 WHERE id = $1 \
             RETURNING id, repository_id, parent_id, name, sort_order, created_at, \
             (SELECT COUNT(*)::bigint FROM detection_rules WHERE folder_id = $1) AS rule_count",
        )
        .bind(id)
        .bind(name)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| RuleFolderRecord {
            id: r.id,
            repository_id: r.repository_id,
            parent_id: r.parent_id,
            name: r.name,
            sort_order: r.sort_order,
            created_at: r.created_at,
            rule_count: r.rule_count,
        }))
    }

    pub async fn delete_folder(&self, id: Uuid) -> anyhow::Result<bool> {
        sqlx::query("UPDATE detection_rules SET folder_id = NULL WHERE folder_id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        let r = sqlx::query("DELETE FROM rule_folders WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }
}
