//! Optional fakeMustache pass before bugreport/sysdiagnose parse.

use fm_android::anonymize_bugreport;
use fm_apple::anonymize_sysdiagnose;
use fm_container::{is_tar_gz, is_tar_xz, is_zip};
use fm_core::{AnonOptions, Error as FmError, LogArchivePolicy, ProfileName};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AnonymizeIngestOptions {
    #[serde(default)]
    pub enabled: bool,
    /// `balanced` (default), `strict`, or `research`.
    #[serde(default = "default_profile")]
    pub profile: String,
    /// `drop` (default) or `jsonl` for iOS logarchive handling.
    #[serde(default = "default_logarchive")]
    pub logarchive: String,
    /// Human-readable ordinal pseudonyms (`user-1`, …).
    #[serde(default)]
    pub ordinal: bool,
    /// Keep GPS coordinates as-is.
    #[serde(default)]
    pub keep_location: bool,
    /// Keep cell IDs as-is.
    #[serde(default)]
    pub keep_cell_ids: bool,
    /// Generalize carrier names.
    #[serde(default)]
    pub generalize_carrier: bool,
    /// Drop carrier identifiers.
    #[serde(default)]
    pub drop_carrier: bool,
    /// Pseudonymize third-party package names.
    #[serde(default)]
    pub pseudo_third_party_packages: bool,
    /// Uniform time shift, e.g. `72h` or `3600s` (optional).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_shift: Option<String>,
    /// Only anonymize these kinds/groups (comma-separated). Everything else kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub only: Option<String>,
    /// Per-kind overrides, e.g. `["email=pseudo","gps=keep"]`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entities: Vec<String>,
    /// Package names whose free-text logs are dropped (comma-separated or list).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drop_text_from_packages: Vec<String>,
}

fn default_profile() -> String {
    "balanced".into()
}

fn default_logarchive() -> String {
    "drop".into()
}

impl AnonymizeIngestOptions {
    pub fn is_active(&self) -> bool {
        self.enabled
    }

    pub fn profile_name(&self) -> Result<ProfileName, String> {
        ProfileName::parse(self.profile.trim())
            .ok_or_else(|| format!("unknown anonymize profile {:?}", self.profile))
    }

    fn logarchive_policy(&self) -> Result<LogArchivePolicy, String> {
        match self.logarchive.trim().to_ascii_lowercase().as_str() {
            "" | "drop" => Ok(LogArchivePolicy::Drop),
            "jsonl" => Ok(LogArchivePolicy::Jsonl),
            other => Err(format!("logarchive must be drop or jsonl, got {other:?}")),
        }
    }

    fn parse_time_shift(&self) -> Result<Option<Duration>, String> {
        let Some(raw) = self.time_shift.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) else {
            return Ok(None);
        };
        parse_duration_spec(raw).map(Some)
    }

    /// Build fakeMustache options from this ingest payload.
    pub fn to_anon_options(&self) -> Result<AnonOptions, String> {
        let profile = self.profile_name()?;
        let mut opts = AnonOptions::builder()
            .profile(profile)
            .logarchive(self.logarchive_policy()?)
            .ordinal(self.ordinal)
            .keep_location(self.keep_location)
            .build();
        opts.keep_cell_ids = self.keep_cell_ids;
        opts.generalize_carrier = self.generalize_carrier;
        opts.drop_carrier = self.drop_carrier;
        opts.pseudo_third_party_packages = self.pseudo_third_party_packages;
        if let Some(d) = self.parse_time_shift()? {
            opts.time_shift = Some(d);
        }
        opts.drop_text_from_packages = self
            .drop_text_from_packages
            .iter()
            .flat_map(|s| s.split(','))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if let Some(only) = &self.only {
            let trimmed = only.trim();
            if !trimmed.is_empty() {
                opts.apply_only_spec(trimmed).map_err(|e| e.to_string())?;
            }
        }
        for spec in &self.entities {
            let trimmed = spec.trim();
            if trimmed.is_empty() {
                continue;
            }
            opts.apply_entity_spec(trimmed).map_err(|e| e.to_string())?;
        }
        Ok(opts)
    }
}

fn parse_duration_spec(raw: &str) -> Result<Duration, String> {
    let s = raw.trim().to_ascii_lowercase();
    let (num, mult) = if let Some(n) = s.strip_suffix('h') {
        (n, 3600u64)
    } else if let Some(n) = s.strip_suffix('m') {
        (n, 60u64)
    } else if let Some(n) = s.strip_suffix('s') {
        (n, 1u64)
    } else if let Some(n) = s.strip_suffix('d') {
        (n, 86400u64)
    } else {
        return Err(format!("time_shift must look like 72h / 30m / 3600s, got {raw:?}"));
    };
    let n: u64 = num
        .trim()
        .parse()
        .map_err(|_| format!("invalid time_shift number in {raw:?}"))?;
    Ok(Duration::from_secs(n.saturating_mul(mult)))
}

/// Rewrite `path` in place with a fakeMustache-anonymized archive. Returns profile used.
pub fn anonymize_archive_file(path: &Path, opts: &AnonymizeIngestOptions) -> anyhow::Result<String> {
    if !opts.enabled {
        anyhow::bail!("anonymize not enabled");
    }
    let profile = opts
        .profile_name()
        .map_err(|e| anyhow::anyhow!(e))?;
    let anon_opts = opts
        .to_anon_options()
        .map_err(|e| anyhow::anyhow!(e))?;
    let input = std::fs::read(path)?;
    if input.is_empty() {
        anyhow::bail!("empty archive");
    }
    let result = anonymize_bytes(&input, &anon_opts).map_err(map_fm)?;
    let tmp = path.with_extension("anon.tmp");
    std::fs::write(&tmp, &result.output)?;
    std::fs::rename(&tmp, path)?;
    tracing::info!(
        path = %path.display(),
        profile = profile.as_str(),
        ordinal = opts.ordinal,
        keep_location = opts.keep_location,
        input_bytes = input.len(),
        output_bytes = result.output.len(),
        residual = %result.report.residual_scan.status,
        "fakeMustache anonymize complete"
    );
    Ok(profile.as_str().to_string())
}

fn anonymize_bytes(input: &[u8], opts: &AnonOptions) -> Result<fm_core::AnonResult, FmError> {
    if is_zip(input) {
        anonymize_bugreport(input, opts)
    } else if is_tar_gz(input) || is_tar_xz(input) {
        anonymize_sysdiagnose(input, opts)
    } else {
        Err(FmError::UnsupportedArchive)
    }
}

fn map_fm(e: FmError) -> anyhow::Error {
    anyhow::anyhow!("{e}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_time_shift_hours() {
        assert_eq!(
            parse_duration_spec("72h").unwrap(),
            Duration::from_secs(72 * 3600)
        );
    }

    #[test]
    fn to_anon_options_applies_flags() {
        let opts = AnonymizeIngestOptions {
            enabled: true,
            profile: "strict".into(),
            ordinal: true,
            keep_location: true,
            only: Some("email,imei".into()),
            ..Default::default()
        };
        let a = opts.to_anon_options().unwrap();
        assert!(a.ordinal);
        assert!(a.keep_location);
        assert!(a.only_kinds.is_some());
    }
}
