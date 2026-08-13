use mobipwn_core::mudm::{normalize_timeline_line, MudmEvent, TimelinePlatform};
use serde_json::Value;

/// Parse newline-delimited JSON timeline export (bel / sdx / Vector).
pub fn ingest_jsonl(
    jsonl: &str,
    platform: TimelinePlatform,
    source_label: &str,
) -> Vec<MudmEvent> {
    jsonl
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|v| normalize_timeline_line(&v, platform, source_label))
        .collect()
}
