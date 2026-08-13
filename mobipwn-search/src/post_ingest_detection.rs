//! Run detection rules after ingest completes (catch-up for uploaded case data).

use mobipwn_core::{
    effective_app_config, AlertRepository, DetectionRunRepository, RuleRepository,
    SettingsRepository, SuppressionRepository,
};
use tracing::info;

use crate::detection_run::{execute_detection_rule, ExecuteDetectionOptions};
use crate::parse_mpl;

/// Prepend `source="…"` when the rule does not already filter on source (sandbox-style scope).
pub fn scope_rule_query_to_source(query: &str, source: &str) -> String {
    let trimmed = query.trim();
    let src = source.trim();
    if trimmed.is_empty() || src.is_empty() {
        return trimmed.to_string();
    }
    if let Ok(mpl) = parse_mpl(trimmed) {
        if mpl.filters_field("source") {
            return trimmed.to_string();
        }
    }
    let esc = src.replace('\\', "\\\\").replace('"', "\\\"");
    format!(r#"source="{esc}" {trimmed}"#)
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct PostIngestDetectionSummary {
    pub rules_run: u32,
    pub hit_count: i32,
    pub alerts_created: i32,
}

pub async fn run_post_ingest_detections(
    base_config: &mobipwn_core::config::AppConfig,
    settings: &SettingsRepository,
    rules: &RuleRepository,
    alerts: &AlertRepository,
    runs: &DetectionRunRepository,
    suppressions: &SuppressionRepository,
    source: &str,
) -> anyhow::Result<PostIngestDetectionSummary> {
    let source = source.trim();
    if source.is_empty() {
        return Ok(PostIngestDetectionSummary::default());
    }

    let config = effective_app_config(settings, base_config).await?;
    let active = rules.list_active_detection().await?;
    let mut summary = PostIngestDetectionSummary::default();

    for mut rule in active {
        rule.query = scope_rule_query_to_source(&rule.query, source);
        let result = execute_detection_rule(
            &config,
            rules,
            alerts,
            runs,
            suppressions,
            &rule,
            ExecuteDetectionOptions {
                manual: false,
                create_alerts: true,
            },
        )
        .await?;
        summary.rules_run += 1;
        summary.hit_count += result.hit_count;
        summary.alerts_created += result.alerts_created;
        if result.hit_count > 0 {
            info!(
                rule = %rule.name,
                source,
                hits = result.hit_count,
                alerts = result.alerts_created,
                "post-ingest detection"
            );
        }
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_query_without_source_filter() {
        let q = scope_rule_query_to_source(r#"parser="Network""#, "case-abc");
        assert!(q.starts_with(r#"source="case-abc""#));
        assert!(q.contains(r#"parser="Network""#));
    }

    #[test]
    fn leaves_explicit_source_filter() {
        let original = r#"source="case-xyz" parser="Network""#;
        assert_eq!(scope_rule_query_to_source(original, "case-abc"), original);
    }
}
