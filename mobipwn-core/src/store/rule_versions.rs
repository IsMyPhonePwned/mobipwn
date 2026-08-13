use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize)]
pub struct RuleVersion {
    pub id: Uuid,
    pub rule_id: Uuid,
    pub version: i32,
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_before: Option<String>,
    pub author: String,
    pub mitre: Vec<String>,
    pub diff: Option<String>,
    pub sigma_yaml: Option<String>,
    pub lifecycle: Option<String>,
    pub mode: Option<String>,
    pub severity: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub struct RuleVersionRepository {
    pool: PgPool,
}

impl RuleVersionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn insert(
        &self,
        rule_id: Uuid,
        version: i32,
        query: &str,
        query_before: Option<&str>,
        author: &str,
        mitre: &[String],
        diff: Option<&str>,
        sigma_yaml: Option<&str>,
        lifecycle: &str,
        mode: &str,
        severity: &str,
    ) -> anyhow::Result<RuleVersion> {
        let row = sqlx::query_as::<_, VersionRow>(
            "INSERT INTO detection_rule_versions (rule_id, version, query, query_before, author, mitre, diff, sigma_yaml, lifecycle, mode, severity) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
             RETURNING id, rule_id, version, query, query_before, author, mitre, diff, sigma_yaml, lifecycle, mode, severity, created_at",
        )
        .bind(rule_id)
        .bind(version)
        .bind(query)
        .bind(query_before)
        .bind(author)
        .bind(mitre)
        .bind(diff)
        .bind(sigma_yaml)
        .bind(lifecycle)
        .bind(mode)
        .bind(severity)
        .fetch_one(&self.pool)
        .await?;
        Ok(row_to_version(row))
    }

    pub async fn list_for_rule(&self, rule_id: Uuid, limit: i64) -> anyhow::Result<Vec<RuleVersion>> {
        let rows = sqlx::query_as::<_, VersionRow>(
            "SELECT id, rule_id, version, query, query_before, author, mitre, diff, sigma_yaml, lifecycle, mode, severity, created_at \
             FROM detection_rule_versions WHERE rule_id = $1 ORDER BY version DESC LIMIT $2",
        )
        .bind(rule_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(row_to_version).collect())
    }
}

#[derive(sqlx::FromRow)]
struct VersionRow {
    id: Uuid,
    rule_id: Uuid,
    version: i32,
    query: String,
    query_before: Option<String>,
    author: String,
    mitre: Vec<String>,
    diff: Option<String>,
    sigma_yaml: Option<String>,
    lifecycle: Option<String>,
    mode: Option<String>,
    severity: Option<String>,
    created_at: DateTime<Utc>,
}

fn row_to_version(r: VersionRow) -> RuleVersion {
    RuleVersion {
        id: r.id,
        rule_id: r.rule_id,
        version: r.version,
        query: r.query,
        query_before: r.query_before,
        author: r.author,
        mitre: r.mitre,
        diff: r.diff,
        sigma_yaml: r.sigma_yaml,
        lifecycle: r.lifecycle,
        mode: r.mode,
        severity: r.severity,
        created_at: r.created_at,
    }
}

pub fn query_diff(old: &str, new: &str) -> Option<String> {
    if old == new {
        return None;
    }
    Some(
        serde_json::json!({
            "query": { "before": old, "after": new }
        })
        .to_string(),
    )
}

fn field_change(
    changes: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    before: &str,
    after: &str,
) {
    if before != after {
        changes.insert(
            key.to_string(),
            serde_json::json!({ "before": before, "after": after }),
        );
    }
}

fn opt_str(v: &Option<String>) -> &str {
    v.as_deref().unwrap_or("")
}

/// JSON diff of meaningful rule fields for version history.
pub fn rule_diff(
    prior: &crate::detection::DetectionRule,
    saved: &crate::detection::DetectionRule,
) -> Option<String> {
    use crate::detection::{DetectionMode, RuleLifecycle};
    let lifecycle = |l: RuleLifecycle| match l {
        RuleLifecycle::Staging => "staging",
        RuleLifecycle::Live => "live",
        RuleLifecycle::Alerting => "alerting",
    };
    let mode = |m: DetectionMode| match m {
        DetectionMode::Scheduled => "scheduled",
        DetectionMode::Realtime => "realtime",
    };

    let mut changes = serde_json::Map::new();
    field_change(&mut changes, "name", &prior.name, &saved.name);
    field_change(&mut changes, "query", &prior.query, &saved.query);
    field_change(
        &mut changes,
        "lifecycle",
        lifecycle(prior.lifecycle),
        lifecycle(saved.lifecycle),
    );
    field_change(&mut changes, "mode", mode(prior.mode), mode(saved.mode));
    field_change(&mut changes, "severity", &prior.severity, &saved.severity);
    field_change(&mut changes, "maintainer", opt_str(&prior.maintainer), opt_str(&saved.maintainer));
    field_change(
        &mut changes,
        "cron",
        prior.cron.as_deref().unwrap_or(""),
        saved.cron.as_deref().unwrap_or(""),
    );
    field_change(
        &mut changes,
        "enabled",
        &prior.enabled.to_string(),
        &saved.enabled.to_string(),
    );
    field_change(
        &mut changes,
        "min_hits",
        &prior.min_hits.to_string(),
        &saved.min_hits.to_string(),
    );
    field_change(
        &mut changes,
        "max_alerts_per_run",
        &prior.max_alerts_per_run.to_string(),
        &saved.max_alerts_per_run.to_string(),
    );
    if changes.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(changes).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detection::{DetectionMode, DetectionRule, RuleLifecycle};
    use chrono::Utc;
    use uuid::Uuid;

    fn sample_rule() -> DetectionRule {
        DetectionRule {
            id: Uuid::now_v7(),
            name: "test".into(),
            description: String::new(),
            lifecycle: RuleLifecycle::Staging,
            mode: DetectionMode::Scheduled,
            query: "source=*".into(),
            cron: None,
            severity: "medium".into(),
            mitre: vec![],
            prevalence_threshold: None,
            min_hits: 1,
            max_alerts_per_run: 50,
            signal_log_enabled: true,
            enabled: true,
            muted_until: None,
            sigma_yaml: None,
            realtime_mv: None,
            version: 1,
            updated_at: Utc::now(),
            repository_id: None,
            folder_id: None,
            tags: vec![],
            maintainer: None,
        }
    }

    #[test]
    fn rule_diff_tracks_query_change() {
        let prior = sample_rule();
        let mut saved = sample_rule();
        saved.query = "source=\"case-002\" | head 10".into();
        let diff = rule_diff(&prior, &saved).unwrap();
        assert!(diff.contains("\"query\""));
        assert!(diff.contains("case-002"));
    }

    #[test]
    fn rule_diff_tracks_maintainer_change() {
        let mut saved = sample_rule();
        saved.maintainer = Some("alice".into());
        let prior = sample_rule();
        let diff = rule_diff(&prior, &saved).unwrap();
        assert!(diff.contains("maintainer"));
        assert!(diff.contains("alice"));
    }
}
