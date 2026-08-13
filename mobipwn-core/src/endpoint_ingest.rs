use serde::{Deserialize, Serialize};

fn default_parent_dir_delimiter() -> char {
    '-'
}

/// How endpoint zip ingest derives `device_id` / `machine_id` per `.jsonl` file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EndpointZipDeviceRule {
    /// 1-based segment from the **immediate parent directory** name (split by `delimiter`).
    /// Example: `PulseSecure-Periodicsnapshot-standalone-HOST-20260504-0011` with field `4` → `HOST`.
    /// When `None`, use the `.jsonl` file stem.
    #[serde(default)]
    pub parent_dir_field: Option<usize>,
    #[serde(default = "default_parent_dir_delimiter")]
    pub delimiter: char,
}

impl Default for EndpointZipDeviceRule {
    fn default() -> Self {
        Self {
            parent_dir_field: None,
            delimiter: default_parent_dir_delimiter(),
        }
    }
}

impl EndpointZipDeviceRule {
    pub fn parent_dir_segment(field: usize, delimiter: char) -> Self {
        Self {
            parent_dir_field: Some(field),
            delimiter,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct EndpointIngestConfig {
    #[serde(default)]
    pub zip_device_rule: EndpointZipDeviceRule,
    /// Optional 1-based parent-dir segment added as an ingest tag (in addition to upload tags).
    #[serde(default)]
    pub zip_parent_tag_field: Option<usize>,
}

pub fn parent_dir_segment(name: &str, field: usize, delimiter: char) -> Option<String> {
    if field < 1 {
        return None;
    }
    let parts: Vec<&str> = name.split(delimiter).collect();
    parts
        .get(field - 1)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pulse_secure_parent_dir_field_4() {
        let name = "PulseSecure-Periodicsnapshot-standalone-HOSTEXAMPLE01-20260504-0011";
        assert_eq!(
            parent_dir_segment(name, 4, '-').as_deref(),
            Some("HOSTEXAMPLE01")
        );
    }
}
