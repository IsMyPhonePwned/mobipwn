pub const YARA_SCAN_LONG_HELP: &str = r#"Scan a file or directory with Yara-x
"#;

pub const FILES_FIND_LONG_HELP: &str = r#"Get the list of files with metadata (path, size, timestamps, uid/gid).

By default files are not hashed — use --hash for SHA-256 digests (slower).
Large files are skipped when hashing unless --max-hash-size is raised.
Common cache/thumbnail directories are excluded automatically; add more with --exclude-dir.
"#;

pub const PROCESS_LONG_HELP: &str = r#"Get the list of processes with details
"#;
