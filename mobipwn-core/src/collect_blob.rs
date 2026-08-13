use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Root directory for durable collect archive files.
pub fn collect_blob_dir() -> PathBuf {
    std::env::var("MOBIPWN_COLLECT_BLOB_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("mobipwn_collect_blobs"))
}

pub fn sanitize_file_name(name: &str) -> String {
    let trimmed = name.trim();
    let base = Path::new(trimmed)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("archive.bin");
    base.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Copy an ingest archive into durable blob storage; returns absolute storage path.
pub fn persist_collect_blob(
    source_path: &Path,
    file_name: &str,
) -> anyhow::Result<(Uuid, PathBuf)> {
    let id = Uuid::now_v7();
    let dir = collect_blob_dir().join(id.to_string());
    std::fs::create_dir_all(&dir)?;
    let safe = sanitize_file_name(file_name);
    let dest = dir.join(safe);
    std::fs::copy(source_path, &dest)?;
    Ok((id, dest))
}

pub fn delete_collect_blob_file(storage_path: &str) -> anyhow::Result<()> {
    let path = Path::new(storage_path);
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::remove_dir(parent);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_path_components() {
        assert_eq!(sanitize_file_name("../../evil.zip"), "evil.zip");
    }
}
