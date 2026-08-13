/// Controls how enrichment providers sync data into ClickHouse.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SyncOptions {
    /// When false (default), skip indicators already present in enrichment tables.
    /// When true, re-fetch / re-insert everything the provider would sync.
    pub full_resync: bool,
}

impl SyncOptions {
    pub fn incremental() -> Self {
        Self { full_resync: false }
    }

    pub fn full_resync() -> Self {
        Self {
            full_resync: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_incremental() {
        assert_eq!(SyncOptions::default(), SyncOptions::incremental());
        assert!(!SyncOptions::default().full_resync);
    }

    #[test]
    fn full_resync_sets_flag() {
        assert!(SyncOptions::full_resync().full_resync);
        assert_ne!(SyncOptions::incremental(), SyncOptions::full_resync());
    }
}
