use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::collect_blob::{delete_collect_blob_file, persist_collect_blob};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectBlob {
    pub id: Uuid,
    pub ingest_job_id: Option<Uuid>,
    pub source: String,
    pub platform: String,
    pub file_name: String,
    pub file_hash: String,
    pub file_size: i64,
    pub storage_path: String,
    pub case_user: Option<String>,
    pub ingest_tags: Vec<String>,
    pub origin: String,
    pub analyzed: bool,
    pub created_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_title: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewCollectBlob {
    pub ingest_job_id: Option<Uuid>,
    pub source: String,
    pub platform: String,
    pub file_name: String,
    pub file_hash: String,
    pub file_size: i64,
    pub case_user: Option<String>,
    pub ingest_tags: Vec<String>,
    pub origin: String,
    pub analyzed: bool,
}

#[derive(sqlx::FromRow)]
struct BlobRow {
    id: Uuid,
    ingest_job_id: Option<Uuid>,
    source: String,
    platform: String,
    file_name: String,
    file_hash: String,
    file_size: i64,
    storage_path: String,
    case_user: Option<String>,
    ingest_tags: Vec<String>,
    origin: String,
    analyzed: bool,
    created_at: DateTime<Utc>,
    case_id: Option<Uuid>,
    case_title: Option<String>,
}

const BLOB_SELECT: &str = "SELECT b.id, b.ingest_job_id, b.source, b.platform, b.file_name, \
    b.file_hash, b.file_size, b.storage_path, b.case_user, b.ingest_tags, b.origin, b.analyzed, b.created_at, \
    c.id AS case_id, c.title AS case_title \
    FROM collect_blobs b \
    LEFT JOIN cases c ON c.ingest_source = b.source";

fn row_to_blob(r: BlobRow) -> CollectBlob {
    CollectBlob {
        id: r.id,
        ingest_job_id: r.ingest_job_id,
        source: r.source,
        platform: r.platform,
        file_name: r.file_name,
        file_hash: r.file_hash,
        file_size: r.file_size,
        storage_path: r.storage_path,
        case_user: r.case_user,
        ingest_tags: r.ingest_tags,
        origin: r.origin,
        analyzed: r.analyzed,
        created_at: r.created_at,
        case_id: r.case_id,
        case_title: r.case_title,
    }
}

#[derive(Clone)]
pub struct CollectBlobRepository {
    pool: PgPool,
}

impl CollectBlobRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<CollectBlob>> {
        let row = sqlx::query_as::<_, BlobRow>(&format!("{BLOB_SELECT} WHERE b.id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(row_to_blob))
    }

    /// Latest `file_hash` per ingest source (newest blob wins).
    pub async fn latest_hashes_for_sources(
        &self,
        sources: &[String],
    ) -> anyhow::Result<HashMap<String, String>> {
        if sources.is_empty() {
            return Ok(HashMap::new());
        }
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT DISTINCT ON (source) source, file_hash \
             FROM collect_blobs \
             WHERE source = ANY($1) \
             ORDER BY source, created_at DESC",
        )
        .bind(sources)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().collect())
    }

    pub async fn list(
        &self,
        source: Option<&str>,
        limit: i64,
    ) -> anyhow::Result<Vec<CollectBlob>> {
        let rows = if let Some(src) = source.filter(|s| !s.is_empty()) {
            sqlx::query_as::<_, BlobRow>(&format!(
                "{BLOB_SELECT} WHERE b.source = $1 ORDER BY b.created_at DESC LIMIT $2"
            ))
            .bind(src)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, BlobRow>(&format!(
                "{BLOB_SELECT} ORDER BY b.created_at DESC LIMIT $1"
            ))
            .bind(limit)
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows.into_iter().map(row_to_blob).collect())
    }

    /// Delete every collect blob for `source` except `keep_id` (disk + row).
    pub async fn delete_others_for_source(&self, source: &str, keep_id: Uuid) -> anyhow::Result<u64> {
        let blobs = self.list(Some(source), 10_000).await?;
        let mut count = 0u64;
        for blob in blobs {
            if blob.id == keep_id {
                continue;
            }
            if self.delete(blob.id).await? {
                count += 1;
            }
        }
        Ok(count)
    }

    /// Keep only the newest archive for `source` (one blob per case ingest source).
    pub async fn retain_latest_for_source(&self, source: &str) -> anyhow::Result<Option<CollectBlob>> {
        let mut blobs = self.list(Some(source), 10_000).await?;
        let Some(latest) = blobs.first().cloned() else {
            return Ok(None);
        };
        for old in blobs.drain(1..) {
            let _ = self.delete(old.id).await;
        }
        Ok(Some(latest))
    }

    pub async fn insert_from_file(
        &self,
        archive_path: &Path,
        meta: NewCollectBlob,
    ) -> anyhow::Result<CollectBlob> {
        let (id, storage_path) = persist_collect_blob(archive_path, &meta.file_name)?;
        let row = sqlx::query_as::<_, BlobRow>(
            "INSERT INTO collect_blobs \
             (id, ingest_job_id, source, platform, file_name, file_hash, file_size, storage_path, case_user, ingest_tags, origin, analyzed) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
             RETURNING id, ingest_job_id, source, platform, file_name, file_hash, file_size, storage_path, \
               case_user, ingest_tags, origin, analyzed, created_at, NULL::uuid AS case_id, NULL::text AS case_title",
        )
        .bind(id)
        .bind(meta.ingest_job_id)
        .bind(&meta.source)
        .bind(&meta.platform)
        .bind(&meta.file_name)
        .bind(&meta.file_hash)
        .bind(meta.file_size)
        .bind(storage_path.to_string_lossy().as_ref())
        .bind(&meta.case_user)
        .bind(&meta.ingest_tags)
        .bind(&meta.origin)
        .bind(meta.analyzed)
        .fetch_one(&self.pool)
        .await?;
        let mut blob = row_to_blob(row);
        // One archive per ingest source / case — replace any older copies.
        let _ = self.delete_others_for_source(&blob.source, blob.id).await;
        if let Some(full) = self.get(blob.id).await? {
            blob.case_id = full.case_id;
            blob.case_title = full.case_title;
        }
        Ok(blob)
    }

    pub async fn mark_analyzed(&self, id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("UPDATE collect_blobs SET analyzed = true WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    pub async fn delete(&self, id: Uuid) -> anyhow::Result<bool> {
        let Some(blob) = self.get(id).await? else {
            return Ok(false);
        };
        delete_collect_blob_file(&blob.storage_path)?;
        let r = sqlx::query("DELETE FROM collect_blobs WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    pub async fn delete_by_source(&self, source: &str) -> anyhow::Result<u64> {
        let blobs = self.list(Some(source), 10_000).await?;
        let mut count = 0u64;
        for blob in blobs {
            if self.delete(blob.id).await? {
                count += 1;
            }
        }
        Ok(count)
    }
}
