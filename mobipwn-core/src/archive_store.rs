//! Durable archive storage — local disk or S3-compatible object store (MinIO, AWS).

use crate::collect_blob::{collect_blob_dir, sanitize_file_name};
use crate::config::{AppConfig, ArchiveBackend};
use anyhow::{anyhow, Context};
use bytes::Bytes;
use object_store::path::Path as ObjectPath;
use object_store::{ObjectStore, PutPayload};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

/// Persist an ingest/collect archive; returns a location string stored in Postgres.
///
/// Local: absolute filesystem path (backward compatible).
/// S3: `s3://bucket/key`.
pub async fn persist_archive(
    config: &AppConfig,
    source_path: &Path,
    file_name: &str,
) -> anyhow::Result<(Uuid, String)> {
    let id = Uuid::now_v7();
    let safe = sanitize_file_name(file_name);
    match config.archive_backend {
        ArchiveBackend::Local => {
            let dir = collect_blob_dir().join(id.to_string());
            std::fs::create_dir_all(&dir)?;
            let dest = dir.join(&safe);
            std::fs::copy(source_path, &dest)
                .with_context(|| format!("copy archive to {}", dest.display()))?;
            Ok((id, dest.to_string_lossy().into_owned()))
        }
        ArchiveBackend::S3 => {
            let bucket = config
                .s3_bucket
                .as_deref()
                .ok_or_else(|| anyhow!("MOBIPWN_S3_BUCKET required when archive backend is s3"))?;
            let key = format!(
                "{}/{}/{}",
                config.s3_prefix.trim_matches('/'),
                id,
                safe
            );
            let store = build_s3_store(config, bucket)?;
            let data = tokio::fs::read(source_path).await?;
            store
                .put(&ObjectPath::from(key.as_str()), PutPayload::from(Bytes::from(data)))
                .await
                .context("s3 put")?;
            Ok((id, format!("s3://{bucket}/{key}")))
        }
    }
}

/// Ensure the archive is available as a local file for parsers; may download from S3 to a cache dir.
/// Returns `(local_path, cleanup)` — if `cleanup` is true, caller should delete the file when done.
pub async fn materialize_archive(
    config: &AppConfig,
    location: &str,
) -> anyhow::Result<(PathBuf, bool)> {
    if let Some((bucket, key)) = parse_s3_uri(location) {
        let cache_dir = PathBuf::from(&config.upload_dir).join("s3-cache");
        std::fs::create_dir_all(&cache_dir)?;
        let file_name = key.rsplit('/').next().unwrap_or("archive.bin");
        let dest = cache_dir.join(format!(
            "{}_{}",
            Uuid::now_v7(),
            sanitize_file_name(file_name)
        ));
        let store = build_s3_store(config, &bucket)?;
        let result = store.get(&ObjectPath::from(key.as_str())).await.context("s3 get")?;
        let bytes = result.bytes().await.context("s3 get body")?;
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&dest, &bytes).await?;
        return Ok((dest, true));
    }
    let path = PathBuf::from(location);
    if !path.exists() {
        return Err(anyhow!("archive missing at {location}"));
    }
    Ok((path, false))
}

pub async fn delete_archive(config: &AppConfig, location: &str) -> anyhow::Result<()> {
    if let Some((bucket, key)) = parse_s3_uri(location) {
        let store = build_s3_store(config, &bucket)?;
        store
            .delete(&ObjectPath::from(key.as_str()))
            .await
            .context("s3 delete")?;
        return Ok(());
    }
    crate::collect_blob::delete_collect_blob_file(location)
}

pub(crate) fn parse_s3_uri(location: &str) -> Option<(String, String)> {
    let rest = location.strip_prefix("s3://")?;
    let (bucket, key) = rest.split_once('/')?;
    if bucket.is_empty() || key.is_empty() {
        return None;
    }
    Some((bucket.to_string(), key.to_string()))
}

fn build_s3_store(config: &AppConfig, bucket: &str) -> anyhow::Result<Arc<dyn ObjectStore>> {
    let access = config
        .s3_access_key
        .as_deref()
        .ok_or_else(|| anyhow!("MOBIPWN_S3_ACCESS_KEY (or AWS_ACCESS_KEY_ID) required for s3"))?;
    let secret = config
        .s3_secret_key
        .as_deref()
        .ok_or_else(|| anyhow!("MOBIPWN_S3_SECRET_KEY (or AWS_SECRET_ACCESS_KEY) required for s3"))?;

    let mut builder = object_store::aws::AmazonS3Builder::new()
        .with_bucket_name(bucket)
        .with_access_key_id(access)
        .with_secret_access_key(secret)
        .with_region(&config.s3_region);

    if let Some(endpoint) = &config.s3_endpoint {
        builder = builder
            .with_endpoint(endpoint)
            .with_virtual_hosted_style_request(false);
    }

    let store = builder.build().context("build s3 object store")?;
    Ok(Arc::new(store))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AppConfig, ArchiveBackend, IngestMode};

    fn local_config(upload_dir: &Path) -> AppConfig {
        let mut cfg = AppConfig::from_env();
        cfg.archive_backend = ArchiveBackend::Local;
        cfg.upload_dir = upload_dir.to_string_lossy().into_owned();
        cfg.ingest_mode = IngestMode::Both;
        cfg
    }

    #[test]
    fn parses_s3_uri() {
        assert_eq!(
            parse_s3_uri("s3://mybucket/prefix/id/file.tar.gz"),
            Some(("mybucket".into(), "prefix/id/file.tar.gz".into()))
        );
        assert_eq!(parse_s3_uri("/tmp/file"), None);
        assert_eq!(parse_s3_uri("s3://bucketonly"), None);
        assert_eq!(parse_s3_uri("s3:///no-bucket/key"), None);
    }

    #[tokio::test]
    async fn local_persist_materialize_delete_roundtrip() {
        let root = std::env::temp_dir().join(format!("mobipwn-archive-test-{}", Uuid::now_v7()));
        let upload = root.join("uploads");
        let blobs = root.join("blobs");
        std::fs::create_dir_all(&upload).unwrap();
        std::fs::create_dir_all(&blobs).unwrap();
        // Point collect blob dir via env for this test process.
        std::env::set_var("MOBIPWN_COLLECT_BLOB_DIR", &blobs);

        let cfg = local_config(&upload);
        let src = root.join("sample.bin");
        std::fs::write(&src, b"hello-archive").unwrap();

        let (id, location) = persist_archive(&cfg, &src, "sample.bin").await.unwrap();
        assert!(!location.starts_with("s3://"));
        assert!(Path::new(&location).exists());
        assert_eq!(id.get_version(), Some(uuid::Version::SortRand));

        let (path, cleanup) = materialize_archive(&cfg, &location).await.unwrap();
        assert!(!cleanup);
        assert_eq!(std::fs::read(&path).unwrap(), b"hello-archive");

        delete_archive(&cfg, &location).await.unwrap();
        assert!(!Path::new(&location).exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn materialize_missing_local_errors() {
        let cfg = local_config(Path::new("/tmp"));
        let err = materialize_archive(&cfg, "/tmp/mobipwn-definitely-missing-xyz.bin")
            .await
            .unwrap_err();
        assert!(err.to_string().contains("archive missing"));
    }

    #[tokio::test]
    async fn s3_persist_requires_bucket() {
        let mut cfg = AppConfig::from_env();
        cfg.archive_backend = ArchiveBackend::S3;
        cfg.s3_bucket = None;
        let src = std::env::temp_dir().join("mobipwn-s3-test.bin");
        std::fs::write(&src, b"x").unwrap();
        let err = persist_archive(&cfg, &src, "x.bin").await.unwrap_err();
        assert!(err.to_string().contains("MOBIPWN_S3_BUCKET"));
        let _ = std::fs::remove_file(&src);
    }
}
