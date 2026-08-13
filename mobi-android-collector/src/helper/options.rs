use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Options {
    pub root_path: PathBuf,
    pub sorted: bool,
    pub skip_hidden: bool,
    pub max_depth: usize,
    pub max_file_cnt: usize,
    pub dir_include: Option<Vec<String>>,
    pub dir_exclude: Option<Vec<String>>,
    pub file_include: Option<Vec<String>>,
    pub file_exclude: Option<Vec<String>>,
    pub case_sensitive: bool,
    pub follow_links: bool,
    /// When false, file inventory collects metadata only (much faster on device).
    pub hash_files: bool,
    /// Maximum file size (bytes) to hash when `hash_files` is enabled.
    pub max_hash_bytes: u64,
}

impl Options {
    pub fn new(
        root_path: PathBuf,
        sorted: bool,
        skip_hidden: bool,
        max_depth: usize,
        max_file_cnt: usize,
        dir_include: Option<Vec<String>>,
        dir_exclude: Option<Vec<String>>,
        file_include: Option<Vec<String>>,
        file_exclude: Option<Vec<String>>,
        case_sensitive: bool,
        follow_links: bool,
        hash_files: bool,
        max_hash_bytes: u64,
    ) -> Self {
        Self {
            root_path,
            sorted,
            skip_hidden,
            max_depth,
            max_file_cnt,
            dir_include,
            dir_exclude,
            file_include,
            file_exclude,
            case_sensitive,
            follow_links,
            hash_files,
            max_hash_bytes,
        }
    }
}
