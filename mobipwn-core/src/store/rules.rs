use crate::detection::{DetectionMode, DetectionRule, RuleLifecycle};
use crate::store::rule_versions::{rule_diff, RuleVersionRepository};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(sqlx::FromRow)]
struct RuleRow {
    id: Uuid,
    name: String,
    description: String,
    lifecycle: String,
    mode: String,
    query: String,
    cron: Option<String>,
    severity: String,
    mitre: Vec<String>,
    prevalence_threshold: Option<f64>,
    min_hits: i32,
    max_alerts_per_run: i32,
    signal_log_enabled: bool,
    enabled: bool,
    muted_until: Option<DateTime<Utc>>,
    sigma_yaml: Option<String>,
    realtime_mv: Option<String>,
    version: i32,
    updated_at: DateTime<Utc>,
    repository_id: Option<Uuid>,
    folder_id: Option<Uuid>,
    tags: Vec<String>,
    maintainer: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RuleListFilter {
    pub repository_id: Option<Uuid>,
    pub folder_id: Option<Uuid>,
    pub tag: Option<String>,
    pub maintainer: Option<String>,
}

fn parse_lifecycle(s: &str) -> RuleLifecycle {
    match s {
        "live" => RuleLifecycle::Live,
        "alerting" => RuleLifecycle::Alerting,
        _ => RuleLifecycle::Staging,
    }
}

fn parse_mode(s: &str) -> DetectionMode {
    match s {
        "realtime" => DetectionMode::Realtime,
        _ => DetectionMode::Scheduled,
    }
}

fn lifecycle_str(l: RuleLifecycle) -> &'static str {
    match l {
        RuleLifecycle::Staging => "staging",
        RuleLifecycle::Live => "live",
        RuleLifecycle::Alerting => "alerting",
    }
}

fn mode_str(m: DetectionMode) -> &'static str {
    match m {
        DetectionMode::Scheduled => "scheduled",
        DetectionMode::Realtime => "realtime",
    }
}

fn row_to_rule(r: RuleRow) -> DetectionRule {
    DetectionRule {
        id: r.id,
        name: r.name,
        description: r.description,
        lifecycle: parse_lifecycle(&r.lifecycle),
        mode: parse_mode(&r.mode),
        query: r.query,
        cron: r.cron,
        severity: r.severity,
        mitre: r.mitre,
        prevalence_threshold: r.prevalence_threshold,
        min_hits: r.min_hits.max(1),
        max_alerts_per_run: r.max_alerts_per_run.max(1),
        signal_log_enabled: r.signal_log_enabled,
        enabled: r.enabled,
        muted_until: r.muted_until,
        sigma_yaml: r.sigma_yaml,
        realtime_mv: r.realtime_mv,
        version: r.version as u32,
        updated_at: r.updated_at,
        repository_id: r.repository_id,
        folder_id: r.folder_id,
        tags: r.tags,
        maintainer: r.maintainer,
    }
}

const RULE_SELECT: &str = "SELECT id, name, description, lifecycle::text, mode::text, query, cron, severity, mitre, \
     prevalence_threshold, min_hits, max_alerts_per_run, signal_log_enabled, enabled, muted_until, sigma_yaml, realtime_mv, version, updated_at, \
     repository_id, folder_id, tags, maintainer";

pub struct RuleRepository {
    pool: PgPool,
    versions: RuleVersionRepository,
}

impl RuleRepository {
    pub fn new(pool: PgPool) -> Self {
        let versions = RuleVersionRepository::new(pool.clone());
        Self { pool, versions }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub fn versions(&self) -> &RuleVersionRepository {
        &self.versions
    }

    pub async fn list(&self) -> anyhow::Result<Vec<DetectionRule>> {
        self.list_filtered(&RuleListFilter::default()).await
    }

    pub async fn list_filtered(&self, filter: &RuleListFilter) -> anyhow::Result<Vec<DetectionRule>> {
        let mut q = format!("{RULE_SELECT} FROM detection_rules WHERE 1=1");
        if filter.repository_id.is_some() {
            q.push_str(" AND repository_id = $1");
        }
        if filter.folder_id.is_some() {
            q.push_str(if filter.repository_id.is_some() {
                " AND folder_id = $2"
            } else {
                " AND folder_id = $1"
            });
        }
        if filter.tag.is_some() {
            let idx = 1
                + usize::from(filter.repository_id.is_some())
                + usize::from(filter.folder_id.is_some());
            q.push_str(&format!(" AND ${idx} = ANY(tags)"));
        }
        if filter.maintainer.is_some() {
            let idx = 1
                + usize::from(filter.repository_id.is_some())
                + usize::from(filter.folder_id.is_some())
                + usize::from(filter.tag.is_some());
            q.push_str(&format!(" AND maintainer = ${idx}"));
        }
        q.push_str(" ORDER BY updated_at DESC");

        let mut query = sqlx::query_as::<_, RuleRow>(&q);
        if let Some(repo) = filter.repository_id {
            query = query.bind(repo);
        }
        if let Some(folder) = filter.folder_id {
            query = query.bind(folder);
        }
        if let Some(tag) = &filter.tag {
            query = query.bind(tag);
        }
        if let Some(maintainer) = filter.maintainer.clone() {
            query = query.bind(maintainer);
        }
        let rows = query.fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(row_to_rule).collect())
    }

    pub async fn move_rule(
        &self,
        id: Uuid,
        repository_id: Option<Uuid>,
        folder_id: Option<Uuid>,
    ) -> anyhow::Result<Option<DetectionRule>> {
        let q = format!(
            "UPDATE detection_rules SET repository_id = $2, folder_id = $3, updated_at = now() WHERE id = $1 \
             RETURNING {RULE_SELECT}"
        );
        let row = sqlx::query_as::<_, RuleRow>(&q)
            .bind(id)
            .bind(repository_id)
            .bind(folder_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(row_to_rule))
    }

    pub async fn list_active_scheduled(&self) -> anyhow::Result<Vec<DetectionRule>> {
        let q = format!(
            "{RULE_SELECT} FROM detection_rules \
             WHERE enabled = true AND (muted_until IS NULL OR muted_until <= now()) \
             AND lifecycle IN ('live', 'alerting') AND mode = 'scheduled'"
        );
        let rows = sqlx::query_as::<_, RuleRow>(&q).fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(row_to_rule).collect())
    }

    /// Back-compat alias for jobs.
    pub async fn list_alerting_scheduled(&self) -> anyhow::Result<Vec<DetectionRule>> {
        self.list_active_scheduled().await
    }

    pub async fn list_active_realtime(&self) -> anyhow::Result<Vec<DetectionRule>> {
        let q = format!(
            "{RULE_SELECT} FROM detection_rules \
             WHERE enabled = true AND (muted_until IS NULL OR muted_until <= now()) \
             AND lifecycle IN ('live', 'alerting') AND mode = 'realtime'"
        );
        let rows = sqlx::query_as::<_, RuleRow>(&q).fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(row_to_rule).collect())
    }

    /// Live/alerting rules eligible for cron and post-ingest catch-up (scheduled + realtime).
    pub async fn list_active_detection(&self) -> anyhow::Result<Vec<DetectionRule>> {
        let q = format!(
            "{RULE_SELECT} FROM detection_rules \
             WHERE enabled = true AND (muted_until IS NULL OR muted_until <= now()) \
             AND lifecycle IN ('live', 'alerting')"
        );
        let rows = sqlx::query_as::<_, RuleRow>(&q).fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(row_to_rule).collect())
    }

    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<DetectionRule>> {
        let q = format!("{RULE_SELECT} FROM detection_rules WHERE id = $1");
        let row = sqlx::query_as::<_, RuleRow>(&q)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(row_to_rule))
    }

    pub async fn create(
        &self,
        rule: &DetectionRule,
        author: &str,
    ) -> anyhow::Result<DetectionRule> {
        let row = sqlx::query_as::<_, RuleRow>(
            "INSERT INTO detection_rules (id, name, description, lifecycle, mode, query, cron, severity, mitre, \
             prevalence_threshold, min_hits, max_alerts_per_run, signal_log_enabled, enabled, sigma_yaml, version, \
             repository_id, folder_id, tags, maintainer) \
             VALUES ($1, $2, $3, $4::rule_lifecycle, $5::detection_mode, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) \
             RETURNING id, name, description, lifecycle::text, mode::text, query, cron, severity, mitre, \
             prevalence_threshold, min_hits, max_alerts_per_run, signal_log_enabled, enabled, muted_until, sigma_yaml, realtime_mv, version, updated_at, \
             repository_id, folder_id, tags, maintainer",
        )
        .bind(rule.id)
        .bind(&rule.name)
        .bind(&rule.description)
        .bind(lifecycle_str(rule.lifecycle))
        .bind(mode_str(rule.mode))
        .bind(&rule.query)
        .bind(&rule.cron)
        .bind(&rule.severity)
        .bind(&rule.mitre)
        .bind(rule.prevalence_threshold)
        .bind(rule.min_hits.max(1))
        .bind(rule.max_alerts_per_run.max(1))
        .bind(rule.signal_log_enabled)
        .bind(rule.enabled)
        .bind(&rule.sigma_yaml)
        .bind(rule.version as i32)
        .bind(rule.repository_id)
        .bind(rule.folder_id)
        .bind(&rule.tags)
        .bind(&rule.maintainer)
        .fetch_one(&self.pool)
        .await?;
        let saved = row_to_rule(row);
        self.versions
            .insert(
                saved.id,
                saved.version as i32,
                &saved.query,
                None,
                author,
                &saved.mitre,
                None,
                saved.sigma_yaml.as_deref(),
                lifecycle_str(saved.lifecycle),
                mode_str(saved.mode),
                &saved.severity,
            )
            .await?;
        Ok(saved)
    }

    pub async fn update(
        &self,
        rule: &DetectionRule,
        author: &str,
    ) -> anyhow::Result<Option<DetectionRule>> {
        let prior = self.get(rule.id).await?;
        let row = sqlx::query_as::<_, RuleRow>(
            "UPDATE detection_rules SET name = $2, description = $3, lifecycle = $4::rule_lifecycle, \
             mode = $5::detection_mode, query = $6, cron = $7, severity = $8, mitre = $9, \
             prevalence_threshold = $10, min_hits = $11, max_alerts_per_run = $12, signal_log_enabled = $13, enabled = $14, \
             sigma_yaml = COALESCE($15, sigma_yaml), repository_id = $16, folder_id = $17, tags = $18, \
             maintainer = $19, version = version + 1, updated_at = now() \
             WHERE id = $1 \
             RETURNING id, name, description, lifecycle::text, mode::text, query, cron, severity, mitre, \
             prevalence_threshold, min_hits, max_alerts_per_run, signal_log_enabled, enabled, muted_until, sigma_yaml, realtime_mv, version, updated_at, \
             repository_id, folder_id, tags, maintainer",
        )
        .bind(rule.id)
        .bind(&rule.name)
        .bind(&rule.description)
        .bind(lifecycle_str(rule.lifecycle))
        .bind(mode_str(rule.mode))
        .bind(&rule.query)
        .bind(&rule.cron)
        .bind(&rule.severity)
        .bind(&rule.mitre)
        .bind(rule.prevalence_threshold)
        .bind(rule.min_hits.max(1))
        .bind(rule.max_alerts_per_run.max(1))
        .bind(rule.signal_log_enabled)
        .bind(rule.enabled)
        .bind(&rule.sigma_yaml)
        .bind(rule.repository_id)
        .bind(rule.folder_id)
        .bind(&rule.tags)
        .bind(&rule.maintainer)
        .fetch_optional(&self.pool)
        .await?;
        let Some(saved) = row.map(row_to_rule) else {
            return Ok(None);
        };
        let diff = prior.as_ref().and_then(|p| rule_diff(p, &saved));
        let query_before = prior.as_ref().map(|p| p.query.as_str());
        self.versions
            .insert(
                saved.id,
                saved.version as i32,
                &saved.query,
                query_before,
                author,
                &saved.mitre,
                diff.as_deref(),
                saved.sigma_yaml.as_deref(),
                lifecycle_str(saved.lifecycle),
                mode_str(saved.mode),
                &saved.severity,
            )
            .await?;
        Ok(Some(saved))
    }

    pub async fn set_realtime_mv(&self, id: Uuid, mv: Option<&str>) -> anyhow::Result<()> {
        sqlx::query("UPDATE detection_rules SET realtime_mv = $2 WHERE id = $1")
            .bind(id)
            .bind(mv)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_enabled(&self, id: Uuid, enabled: bool) -> anyhow::Result<Option<DetectionRule>> {
        let q = format!(
            "UPDATE detection_rules SET enabled = $2, updated_at = now() WHERE id = $1 \
             RETURNING {RULE_SELECT}"
        );
        let row = sqlx::query_as::<_, RuleRow>(&q)
            .bind(id)
            .bind(enabled)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(row_to_rule))
    }

    pub async fn set_muted_until(
        &self,
        id: Uuid,
        until: Option<DateTime<Utc>>,
    ) -> anyhow::Result<Option<DetectionRule>> {
        let q = format!(
            "UPDATE detection_rules SET muted_until = $2, updated_at = now() WHERE id = $1 \
             RETURNING {RULE_SELECT}"
        );
        let row = sqlx::query_as::<_, RuleRow>(&q)
            .bind(id)
            .bind(until)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(row_to_rule))
    }

    pub async fn delete(&self, id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("DELETE FROM detection_rules WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    pub async fn record_run(&self, id: Uuid, hit_count: i32) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE detection_rules SET last_run_at = now(), last_hit_count = $2, updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .bind(hit_count)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn count_by_maintainer(&self, maintainer: &str) -> anyhow::Result<i64> {
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM detection_rules WHERE maintainer = $1",
        )
        .bind(maintainer)
        .fetch_one(&self.pool)
        .await?;
        Ok(n)
    }

    pub async fn get_last_run(&self, id: Uuid) -> anyhow::Result<Option<DateTime<Utc>>> {
        let t: Option<DateTime<Utc>> =
            sqlx::query_scalar("SELECT last_run_at FROM detection_rules WHERE id = $1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?
                .flatten();
        Ok(t)
    }
}
