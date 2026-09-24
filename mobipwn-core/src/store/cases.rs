use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::entities::PrimaryEntity;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseRecord {
    pub id: Uuid,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    /// Device owner (person whose mobile was ingested), not the analyst.
    pub user: String,
    pub tags: Vec<String>,
    /// ClickHouse `events.source` label when created from ingest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ingest_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_count: Option<u64>,
    /// Earliest ClickHouse ingest timestamp for this case source (from data summary).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_ingest_at: Option<String>,
    /// Latest ClickHouse ingest timestamp for this case source (from data summary).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_ingest_at: Option<String>,
    /// Completed ingest_jobs rows for this source (>1 implies at least one re-ingest).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ingest_run_count: Option<u32>,
    /// Dominant `device_model` from ClickHouse events for this case source (list enrichment).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
    /// Dominant `os_version` from ClickHouse events for this case source (list enrichment).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_version: Option<String>,
    /// Hardware / column `device_id` (often serial) — comparison picker enrichment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub android_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unique_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imei: Option<String>,
    /// Latest collect-blob SHA-256 for this case source (comparison picker enrichment).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob_file_hash: Option<String>,
    pub alert_count: i64,
    /// Analyst override for the case investigation anchor entity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_anchor: Option<PrimaryEntity>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Ingest label used for purge / tombstone (prefer `ingest_source`, else title).
pub fn case_ingest_label(case: &CaseRecord) -> Option<String> {
    case.ingest_source
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            let title = case.title.trim();
            if title.is_empty() {
                None
            } else {
                Some(title.to_string())
            }
        })
}

#[derive(Debug, Deserialize)]
pub struct CreateCase {
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub user: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCase {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub user: Option<String>,
    pub tags: Option<Vec<String>>,
    /// When true with `title`, also relabel ClickHouse `events.source` and `cases.ingest_source`.
    pub rename_ingest_source: Option<bool>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    title: String,
    description: String,
    status: String,
    priority: String,
    #[sqlx(rename = "case_user")]
    user: String,
    tags: Vec<String>,
    ingest_source: Option<String>,
    alert_count: i64,
    primary_anchor_type: Option<String>,
    primary_anchor_value: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

const CASE_SELECT: &str = "SELECT c.id, c.title, c.description, c.status::text, c.priority, c.case_user, c.tags, \
    c.ingest_source, \
    COALESCE((SELECT COUNT(*) FROM alerts a WHERE a.case_id = c.id), 0) AS alert_count, \
    c.primary_anchor_type, c.primary_anchor_value, \
    c.created_at, c.updated_at FROM cases c";

pub struct CaseRepository {
    pool: PgPool,
}

impl CaseRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(
        &self,
        status: Option<&str>,
        q: Option<&str>,
        owner: Option<&str>,
    ) -> anyhow::Result<Vec<CaseRecord>> {
        let pattern = q.filter(|s| !s.is_empty()).map(|s| format!("%{s}%"));
        let owner = owner.map(str::trim).filter(|s| !s.is_empty());
        let mut sql = format!("{CASE_SELECT} WHERE 1=1");
        let mut binds: Vec<String> = Vec::new();
        if let Some(st) = status.filter(|s| !s.is_empty()) {
            binds.push(st.to_string());
            sql.push_str(&format!(" AND c.status::text = ${}", binds.len()));
        }
        if let Some(pat) = pattern {
            binds.push(pat);
            let n = binds.len();
            sql.push_str(&format!(
                " AND (c.title ILIKE ${n} OR c.description ILIKE ${n} OR COALESCE(c.ingest_source, '') ILIKE ${n} OR c.case_user ILIKE ${n})"
            ));
        }
        if let Some(o) = owner {
            binds.push(o.to_string());
            sql.push_str(&format!(" AND c.case_user = ${}", binds.len()));
        }
        sql.push_str(" ORDER BY c.updated_at DESC LIMIT 200");
        let mut query = sqlx::query_as::<_, Row>(&sql);
        for b in &binds {
            query = query.bind(b);
        }
        let rows = query.fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(row_to_case).collect())
    }

    /// Distinct device owners on cases (non-empty `case_user`).
    pub async fn list_device_owners(&self) -> anyhow::Result<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT case_user FROM cases WHERE case_user <> '' ORDER BY case_user",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|(u,)| u).collect())
    }

    /// Create or refresh a case row for an ingest `source` label (e.g. `case-001`).
    pub async fn ensure_for_ingest_source(
        &self,
        source: &str,
        platform: &str,
        user: Option<&str>,
    ) -> anyhow::Result<(CaseRecord, bool)> {
        let source = source.trim();
        if source.is_empty() {
            anyhow::bail!("ingest source label is empty");
        }
        self.clear_ingest_source_tombstone(source).await?;
        if let Some(row) = sqlx::query_as::<_, Row>(&format!(
            "{CASE_SELECT} WHERE c.ingest_source = $1 LIMIT 1"
        ))
        .bind(source)
        .fetch_optional(&self.pool)
        .await?
        {
            if let Some(u) = user.map(str::trim).filter(|s| !s.is_empty()) {
                sqlx::query("UPDATE cases SET case_user = $2, updated_at = now() WHERE id = $1")
                    .bind(row.id)
                    .bind(u)
                    .execute(&self.pool)
                    .await?;
            } else {
                sqlx::query("UPDATE cases SET updated_at = now() WHERE id = $1")
                    .bind(row.id)
                    .execute(&self.pool)
                    .await?;
            }
            let case = self.get(row.id).await?.ok_or_else(|| anyhow::anyhow!("case missing"))?;
            return Ok((case, false));
        }

        let title = self.allocate_unique_title(source).await?;
        if title != source {
            tracing::info!(
                ingest_source = %source,
                case_title = %title,
                "case title already taken — allocated alternate name"
            );
        }
        let description = if platform == crate::mudm::ENDPOINT {
            format!(
                "Ingested endpoint telemetry ({platform}) — search with source=\"{source}\"."
            )
        } else {
            format!(
                "Ingested mobile data ({platform}) — search with source=\"{source}\" or open Data."
            )
        };
        let tags = vec![platform.to_string(), "ingested".to_string(), source.to_string()];
        let case_user = user.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("");
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO cases (title, description, status, priority, case_user, tags, ingest_source) \
             VALUES ($1, $2, 'open'::case_status, 'medium', $3, $4, $5) RETURNING id",
        )
        .bind(&title)
        .bind(&description)
        .bind(case_user)
        .bind(&tags)
        .bind(source)
        .fetch_one(&self.pool)
        .await?;
        let case = self
            .get(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("case not found after insert"))?;
        Ok((case, true))
    }

    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<CaseRecord>> {
        let row = sqlx::query_as::<_, Row>(&format!("{CASE_SELECT} WHERE c.id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(row_to_case))
    }

    pub async fn create(&self, body: &CreateCase) -> anyhow::Result<CaseRecord> {
        let status = body.status.as_deref().unwrap_or("open");
        let title = self.allocate_unique_title(body.title.trim()).await?;
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO cases (title, description, status, priority, case_user, tags) \
             VALUES ($1, $2, $3::case_status, $4, $5, $6) RETURNING id",
        )
        .bind(&title)
        .bind(body.description.as_deref().unwrap_or(""))
        .bind(status)
        .bind(body.priority.as_deref().unwrap_or("medium"))
        .bind(body.user.as_deref().unwrap_or(""))
        .bind(body.tags.as_deref().unwrap_or(&[]))
        .fetch_one(&self.pool)
        .await?;
        self.get(id).await?.ok_or_else(|| anyhow::anyhow!("case not found after insert"))
    }

    pub async fn update(&self, id: Uuid, body: &UpdateCase) -> anyhow::Result<Option<CaseRecord>> {
        let existing = self.get(id).await?;
        let Some(e) = existing else {
            return Ok(None);
        };
        sqlx::query(
            "UPDATE cases SET title = $2, description = $3, status = $4::case_status, priority = $5, \
             case_user = $6, tags = $7, updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .bind(body.title.as_deref().unwrap_or(&e.title))
        .bind(body.description.as_deref().unwrap_or(&e.description))
        .bind(body.status.as_deref().unwrap_or(&e.status))
        .bind(body.priority.as_deref().unwrap_or(&e.priority))
        .bind(body.user.as_deref().unwrap_or(&e.user))
        .bind(body.tags.as_deref().unwrap_or(&e.tags))
        .execute(&self.pool)
        .await?;
        self.get(id).await
    }

    /// Merge tags onto a case (`add`) and/or remove by exact match (`remove`).
    pub async fn set_primary_anchor(
        &self,
        id: Uuid,
        anchor: &PrimaryEntity,
    ) -> anyhow::Result<Option<CaseRecord>> {
        let entity_type = anchor.entity_type.trim();
        let entity_value = anchor.entity_value.trim();
        if entity_type.is_empty() || entity_value.is_empty() {
            anyhow::bail!("primary anchor type and value are required");
        }
        let updated = sqlx::query(
            "UPDATE cases SET primary_anchor_type = $2, primary_anchor_value = $3, updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .bind(entity_type)
        .bind(entity_value)
        .execute(&self.pool)
        .await?;
        if updated.rows_affected() == 0 {
            return Ok(None);
        }
        self.get(id).await
    }

    pub async fn clear_primary_anchor(&self, id: Uuid) -> anyhow::Result<Option<CaseRecord>> {
        let updated = sqlx::query(
            "UPDATE cases SET primary_anchor_type = NULL, primary_anchor_value = NULL, updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        if updated.rows_affected() == 0 {
            return Ok(None);
        }
        self.get(id).await
    }

    pub async fn patch_tags(
        &self,
        id: Uuid,
        add: &[String],
        remove: &[String],
    ) -> anyhow::Result<Option<CaseRecord>> {
        let existing = self.get(id).await?;
        let Some(e) = existing else {
            return Ok(None);
        };
        let mut tags = e.tags.clone();
        for t in remove {
            tags.retain(|x| x != t);
        }
        for t in add {
            let t = t.trim();
            if !t.is_empty() && !tags.iter().any(|x| x == t) {
                tags.push(t.to_string());
            }
        }
        self.update(
            id,
            &UpdateCase {
                title: None,
                description: None,
                status: None,
                priority: None,
                user: None,
                tags: Some(tags),
                rename_ingest_source: None,
            },
        )
        .await
    }

    /// Case ids tied to an ingest `source` label (title, ingest_source, or auto-generated description).
    pub async fn find_ids_for_ingest_source(&self, source: &str) -> anyhow::Result<Vec<Uuid>> {
        let source = source.trim();
        let desc_pattern = format!("%source=\"{source}\"%");
        let ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM cases \
             WHERE ingest_source = $1 \
                OR title = $1 \
                OR description LIKE $2 \
                OR $1 = ANY(tags)",
        )
        .bind(source)
        .bind(&desc_pattern)
        .fetch_all(&self.pool)
        .await?;
        Ok(ids)
    }

    /// Remove investigation cases linked to an ingest source (alerts.case_id → SET NULL).
    pub async fn delete_by_ingest_source(&self, source: &str) -> anyhow::Result<u64> {
        let ids = self.find_ids_for_ingest_source(source).await?;
        if ids.is_empty() {
            return Ok(0);
        }
        let r = sqlx::query("DELETE FROM cases WHERE id = ANY($1)")
            .bind(&ids)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected())
    }

    pub async fn delete_by_id(&self, id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("DELETE FROM cases WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    /// Mark an ingest source as deleted so `list_cases_with_ingest` does not auto-recreate it
    /// while ClickHouse rows are still visible (async `ALTER DELETE`).
    pub async fn tombstone_ingest_source(&self, source: &str) -> anyhow::Result<()> {
        let source = source.trim();
        if source.is_empty() {
            return Ok(());
        }
        sqlx::query(
            "INSERT INTO ingest_source_tombstones (source) VALUES ($1) \
             ON CONFLICT (source) DO UPDATE SET deleted_at = now()",
        )
        .bind(source)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn clear_ingest_source_tombstone(&self, source: &str) -> anyhow::Result<()> {
        let source = source.trim();
        if source.is_empty() {
            return Ok(());
        }
        sqlx::query("DELETE FROM ingest_source_tombstones WHERE source = $1")
            .bind(source)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn is_ingest_source_tombstoned(&self, source: &str) -> anyhow::Result<bool> {
        let source = source.trim();
        if source.is_empty() {
            return Ok(false);
        }
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM ingest_source_tombstones WHERE source = $1)",
        )
        .bind(source)
        .fetch_one(&self.pool)
        .await?;
        Ok(exists)
    }

    pub async fn find_ingest_sources_by_tags(&self, tags: &[String]) -> anyhow::Result<Vec<String>> {
        if tags.is_empty() {
            return Ok(vec![]);
        }
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT DISTINCT ingest_source FROM cases \
             WHERE ingest_source IS NOT NULL AND tags && $1::text[] \
             ORDER BY ingest_source",
        )
        .bind(tags)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn list_distinct_tags(&self) -> anyhow::Result<Vec<String>> {
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT DISTINCT unnest(tags) AS tag FROM cases WHERE tags IS NOT NULL ORDER BY tag",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// All cases tied to ingest data.
    pub async fn list_endpoint_cases(&self) -> anyhow::Result<Vec<CaseRecord>> {
        let rows = sqlx::query_as::<_, Row>(&format!(
            "{CASE_SELECT} WHERE c.ingest_source IS NOT NULL ORDER BY c.updated_at DESC LIMIT 200"
        ))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(row_to_case).collect())
    }

    pub async fn title_taken_by_other(&self, title: &str, except_id: Uuid) -> anyhow::Result<bool> {
        let taken: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM cases WHERE title = $1 AND id != $2)",
        )
        .bind(title)
        .bind(except_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(taken)
    }

    pub async fn rename(
        &self,
        id: Uuid,
        new_title: &str,
        rename_ingest_source: bool,
    ) -> anyhow::Result<Option<CaseRecord>> {
        let new_title = new_title.trim();
        if new_title.is_empty() {
            anyhow::bail!("case title is empty");
        }
        let existing = self.get(id).await?;
        let Some(e) = existing else {
            return Ok(None);
        };
        if e.title == new_title && !rename_ingest_source {
            return Ok(Some(e));
        }
        if self.title_taken_by_other(new_title, id).await? {
            anyhow::bail!("case title already taken: {new_title}");
        }

        let mut description = e.description.clone();
        if description.contains(&e.title) {
            description = description.replace(&e.title, new_title);
        }

        let new_ingest_source = if rename_ingest_source {
            Some(new_title.to_string())
        } else {
            e.ingest_source.clone()
        };

        let mut tags = e.tags.clone();
        if rename_ingest_source {
            if let Some(ref old) = e.ingest_source {
                if let Some(pos) = tags.iter().position(|t| t == old) {
                    tags[pos] = new_title.to_string();
                } else if !tags.iter().any(|t| t == new_title) {
                    tags.push(new_title.to_string());
                }
            }
        }

        sqlx::query(
            "UPDATE cases SET title = $2, description = $3, ingest_source = $4, tags = $5, updated_at = now() \
             WHERE id = $1",
        )
        .bind(id)
        .bind(new_title)
        .bind(&description)
        .bind(new_ingest_source.as_deref())
        .bind(&tags)
        .execute(&self.pool)
        .await?;
        self.get(id).await
    }

    async fn title_taken(&self, title: &str) -> anyhow::Result<bool> {
        let taken: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cases WHERE title = $1)")
            .bind(title)
            .fetch_one(&self.pool)
            .await?;
        Ok(taken)
    }

    /// Prefer `preferred` (e.g. ingest source or user title); if taken, use `case-XXXX` (4 hex chars).
    pub async fn allocate_unique_title(&self, preferred: &str) -> anyhow::Result<String> {
        let preferred = preferred.trim();
        if !preferred.is_empty() && !self.title_taken(preferred).await? {
            return Ok(preferred.to_string());
        }
        for _ in 0..32 {
            let candidate = random_case_title();
            if !self.title_taken(&candidate).await? {
                return Ok(candidate);
            }
        }
        anyhow::bail!("could not allocate a unique case title")
    }

    pub async fn link_alert(&self, case_id: Uuid, alert_id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("UPDATE alerts SET case_id = $1 WHERE id = $2")
            .bind(case_id)
            .bind(alert_id)
            .execute(&self.pool)
            .await?;
        if r.rows_affected() > 0 {
            sqlx::query("UPDATE cases SET updated_at = now() WHERE id = $1")
                .bind(case_id)
                .execute(&self.pool)
                .await?;
        }
        Ok(r.rows_affected() > 0)
    }

    pub async fn unlink_alert(&self, case_id: Uuid, alert_id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("UPDATE alerts SET case_id = NULL WHERE id = $1 AND case_id = $2")
            .bind(alert_id)
            .bind(case_id)
            .execute(&self.pool)
            .await?;
        if r.rows_affected() > 0 {
            sqlx::query("UPDATE cases SET updated_at = now() WHERE id = $1")
                .bind(case_id)
                .execute(&self.pool)
                .await?;
        }
        Ok(r.rows_affected() > 0)
    }
}

/// Random display title when `preferred` is already used (`case-A3F2` style).
fn random_case_title() -> String {
    let u = Uuid::now_v7();
    let b = u.into_bytes();
    format!("case-{:02X}{:02X}", b[10], b[11])
}

#[cfg(test)]
mod tests {
    use super::random_case_title;

    #[test]
    fn random_case_title_format() {
        let t = random_case_title();
        assert!(t.starts_with("case-"));
        assert_eq!(t.len(), "case-".len() + 4);
    }
}

fn row_to_case(r: Row) -> CaseRecord {
    let primary_anchor = match (r.primary_anchor_type, r.primary_anchor_value) {
        (Some(entity_type), Some(entity_value))
            if !entity_type.trim().is_empty() && !entity_value.trim().is_empty() =>
        {
            Some(PrimaryEntity {
                entity_type,
                entity_value,
            })
        }
        _ => None,
    };
    CaseRecord {
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        priority: r.priority,
        user: r.user,
        tags: r.tags,
        ingest_source: r.ingest_source,
        event_count: None,
        first_ingest_at: None,
        last_ingest_at: None,
        ingest_run_count: None,
        device_model: None,
        os_version: None,
        device_id: None,
        serial_number: None,
        android_id: None,
        unique_device_id: None,
        imei: None,
        blob_file_hash: None,
        alert_count: r.alert_count,
        primary_anchor,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}
