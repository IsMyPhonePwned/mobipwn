use crate::alerts::{
    dedup_key, is_closed, next_status, parse_status, status_str, Alert, AlertContext, AlertFacetGroup,
    AlertListFilter, AlertStatus, DismissedFilter, StatusFilter,
};
use sqlx::types::Json;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(sqlx::FromRow)]
struct AlertRow {
    id: Uuid,
    rule_id: Uuid,
    rule_name: String,
    status: String,
    dedup_key: String,
    group_id: Option<Uuid>,
    title: String,
    severity: String,
    first_seen: chrono::DateTime<chrono::Utc>,
    last_seen: chrono::DateTime<chrono::Utc>,
    opened_at: chrono::DateTime<chrono::Utc>,
    resolved_at: Option<chrono::DateTime<chrono::Utc>>,
    resolution_count: i32,
    event_count: i32,
    sample_event_id: Option<Uuid>,
    context: Json<AlertContext>,
    assignee: Option<String>,
    tags: Vec<String>,
    dismissed_at: Option<chrono::DateTime<chrono::Utc>>,
    case_id: Option<Uuid>,
    case_title: Option<String>,
}

fn row_to_alert(r: AlertRow) -> Alert {
    Alert {
        id: r.id,
        rule_id: r.rule_id,
        rule_name: r.rule_name,
        status: parse_status(&r.status),
        dedup_key: r.dedup_key,
        group_id: r.group_id,
        title: r.title,
        severity: r.severity,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        opened_at: r.opened_at,
        resolved_at: r.resolved_at,
        resolution_count: r.resolution_count.max(0) as u32,
        event_count: r.event_count as u32,
        sample_event_id: r.sample_event_id,
        context: r.context.0,
        assignee: r.assignee,
        tags: r.tags,
        dismissed_at: r.dismissed_at,
        case_id: r.case_id,
        case_title: r.case_title,
    }
}

const ALERT_FROM: &str = "FROM alerts a JOIN detection_rules r ON r.id = a.rule_id \
    LEFT JOIN cases c ON c.id = a.case_id";

const ALERT_SELECT: &str = "SELECT a.id, a.rule_id, r.name AS rule_name, a.status::text, a.dedup_key, a.group_id, \
    a.title, a.severity, a.first_seen, a.last_seen, a.opened_at, a.resolved_at, a.resolution_count, \
    a.event_count, a.sample_event_id, a.context, \
    a.assignee, a.tags, a.dismissed_at, a.case_id, c.title AS case_title";

const ALERT_RETURNING: &str = "RETURNING id, rule_id, \
    (SELECT name FROM detection_rules WHERE id = alerts.rule_id) AS rule_name, \
    status::text, dedup_key, group_id, title, severity, first_seen, last_seen, opened_at, resolved_at, \
    resolution_count, event_count, \
    sample_event_id, context, assignee, tags, dismissed_at, case_id, \
    (SELECT title FROM cases WHERE id = alerts.case_id) AS case_title";

const ALERT_STATUS_ORDER: &str = "CASE a.status::text \
    WHEN 'new' THEN 0 \
    WHEN 'triaged' THEN 1 \
    WHEN 'verified' THEN 2 \
    WHEN 'false_positive' THEN 3 \
    ELSE 4 END";

fn list_where(filter: &AlertListFilter) -> String {
    let mut clauses = vec!["TRUE".to_string()];
    let mut bind_idx = 1usize;
    match filter.status {
        Some(StatusFilter::Exact(_)) => {
            clauses.push(format!("a.status = ${bind_idx}::alert_status"));
            bind_idx += 1;
        }
        Some(StatusFilter::Open) => {
            clauses.push("a.status IN ('new'::alert_status, 'triaged'::alert_status)".to_string());
        }
        None => {}
    }
    if filter.assignee.is_some() {
        clauses.push(format!("a.assignee = ${bind_idx}"));
        bind_idx += 1;
    }
    if filter.case_id.is_some() {
        clauses.push(format!("a.case_id = ${bind_idx}::uuid"));
    }
    let dismissed_sql = filter.dismissed.sql_and("a");
    format!("{} {}", clauses.join(" AND "), dismissed_sql)
}

fn bind_list_filter<'q>(
    q: sqlx::query::QueryAs<'q, sqlx::Postgres, AlertRow, sqlx::postgres::PgArguments>,
    filter: &AlertListFilter,
) -> sqlx::query::QueryAs<'q, sqlx::Postgres, AlertRow, sqlx::postgres::PgArguments> {
    let mut q = q;
    if let Some(StatusFilter::Exact(st)) = filter.status {
        q = q.bind(status_str(st));
    }
    if let Some(assignee) = filter.assignee.clone() {
        q = q.bind(assignee);
    }
    if let Some(case_id) = filter.case_id {
        q = q.bind(case_id);
    }
    q
}

pub struct AlertRepository {
    pool: PgPool,
}

impl AlertRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(
        &self,
        status: Option<AlertStatus>,
        dismissed: DismissedFilter,
    ) -> anyhow::Result<Vec<Alert>> {
        self.list_filtered(&AlertListFilter {
            status: status.map(StatusFilter::Exact),
            dismissed,
            case_id: None,
            assignee: None,
        })
        .await
    }

    pub async fn list_filtered(&self, filter: &AlertListFilter) -> anyhow::Result<Vec<Alert>> {
        let where_sql = list_where(filter);
        let sql = format!(
            "{ALERT_SELECT} {ALERT_FROM} WHERE {where_sql} \
             ORDER BY {ALERT_STATUS_ORDER}, a.last_seen DESC"
        );
        let q = bind_list_filter(sqlx::query_as::<_, AlertRow>(&sql), filter);
        let rows = q.fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(row_to_alert).collect())
    }

    pub async fn list_facet_groups(
        &self,
        status: Option<AlertStatus>,
        dismissed: DismissedFilter,
    ) -> anyhow::Result<Vec<AlertFacetGroup>> {
        self.list_facet_groups_filtered(&AlertListFilter {
            status: status.map(StatusFilter::Exact),
            dismissed,
            case_id: None,
            assignee: None,
        })
        .await
    }

    pub async fn list_facet_groups_filtered(
        &self,
        filter: &AlertListFilter,
    ) -> anyhow::Result<Vec<AlertFacetGroup>> {
        let alerts = self.list_filtered(filter).await?;
        Ok(alerts
            .into_iter()
            .map(|a| AlertFacetGroup {
                alert_id: a.id,
                rule_id: a.rule_id,
                rule_name: a.rule_name.clone(),
                dedup_key: a.dedup_key.clone(),
                facet_label: a.context.location_label(),
                status: a.status,
                title: a.title.clone(),
                severity: a.severity.clone(),
                event_count: a.event_count,
                first_seen: a.first_seen,
                last_seen: a.last_seen,
                opened_at: a.opened_at,
                resolved_at: a.resolved_at,
                resolution_count: a.resolution_count,
                sample_event_id: a.sample_event_id,
                context: a.context.clone(),
                assignee: a.assignee.clone(),
                tags: a.tags.clone(),
                dismissed_at: a.dismissed_at,
                case_id: a.case_id,
                case_title: a.case_title,
            })
            .collect())
    }

    pub async fn list_rule_summaries(
        &self,
        status: Option<AlertStatus>,
        dismissed: DismissedFilter,
    ) -> anyhow::Result<Vec<(Uuid, String, AlertStatus, i64, i64, chrono::DateTime<chrono::Utc>)>> {
        self.list_rule_summaries_filtered(&AlertListFilter {
            status: status.map(StatusFilter::Exact),
            dismissed,
            case_id: None,
            assignee: None,
        })
        .await
    }

    pub async fn list_rule_summaries_filtered(
        &self,
        filter: &AlertListFilter,
    ) -> anyhow::Result<Vec<(Uuid, String, AlertStatus, i64, i64, chrono::DateTime<chrono::Utc>)>> {
        let where_sql = list_where(filter);
        let sql = format!(
            "SELECT a.rule_id, r.name, a.status::text, COUNT(*), COALESCE(SUM(a.event_count), 0), MAX(a.last_seen) \
             FROM alerts a JOIN detection_rules r ON r.id = a.rule_id \
             WHERE {where_sql} \
             GROUP BY a.rule_id, r.name, a.status ORDER BY MAX(a.last_seen) DESC"
        );
        let mut q = sqlx::query_as::<_, (Uuid, String, String, i64, i64, chrono::DateTime<chrono::Utc>)>(&sql);
        if let Some(StatusFilter::Exact(st)) = filter.status {
            q = q.bind(status_str(st));
        }
        if let Some(assignee) = filter.assignee.clone() {
            q = q.bind(assignee);
        }
        if let Some(case_id) = filter.case_id {
            q = q.bind(case_id);
        }
        let rows = q.fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|(rule_id, rule_name, st, count, events, last_seen)| {
                (rule_id, rule_name, parse_status(&st), count, events, last_seen)
            })
            .collect())
    }

    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<Alert>> {
        let row = sqlx::query_as::<_, AlertRow>(&format!(
            "{ALERT_SELECT} {ALERT_FROM} WHERE a.id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(row_to_alert))
    }

    async fn resolve_case_id_for_source(&self, source: &str) -> Option<Uuid> {
        let source = source.trim();
        if source.is_empty() {
            return None;
        }
        let desc_pattern = format!("%source=\"{source}\"%");
        sqlx::query_scalar(
            "SELECT id FROM cases \
             WHERE ingest_source = $1 OR title = $1 OR description LIKE $2 \
             ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(source)
        .bind(&desc_pattern)
        .fetch_optional(&self.pool)
        .await
        .ok()
        .flatten()
    }

    async fn resolve_case_id(
        &self,
        context: &AlertContext,
        source_hint: Option<&str>,
    ) -> Option<Uuid> {
        for source in [context.source.as_deref(), source_hint]
            .into_iter()
            .flatten()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if let Some(id) = self.resolve_case_id_for_source(source).await {
                return Some(id);
            }
        }
        None
    }

    pub async fn upsert_from_detection(
        &self,
        rule_id: Uuid,
        _rule_name: &str,
        severity: &str,
        title: &str,
        facets: &[(&str, &str)],
        sample_event_id: Option<Uuid>,
        context: &AlertContext,
        source_hint: Option<&str>,
    ) -> anyhow::Result<Alert> {
        let key = dedup_key(&rule_id.to_string(), facets);
        let ctx = Json(context.clone());
        let case_id = self.resolve_case_id(context, source_hint).await;
        let row = sqlx::query_as::<_, AlertRow>(
            &format!(
                "INSERT INTO alerts (rule_id, dedup_key, title, severity, sample_event_id, context, case_id) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7) \
                 ON CONFLICT (rule_id, dedup_key) DO UPDATE SET \
                   last_seen = now(), event_count = alerts.event_count + 1, \
                   title = EXCLUDED.title, \
                   sample_event_id = COALESCE(EXCLUDED.sample_event_id, alerts.sample_event_id), \
                   context = EXCLUDED.context, \
                   case_id = COALESCE(alerts.case_id, EXCLUDED.case_id) \
                 {ALERT_RETURNING}"
            ),
        )
        .bind(rule_id)
        .bind(&key)
        .bind(title)
        .bind(severity)
        .bind(sample_event_id)
        .bind(ctx)
        .bind(case_id)
        .fetch_one(&self.pool)
        .await?;
        if let Some(cid) = row.case_id {
            sqlx::query("UPDATE cases SET updated_at = now() WHERE id = $1")
                .bind(cid)
                .execute(&self.pool)
                .await
                .ok();
        }
        Ok(row_to_alert(row))
    }

    pub async fn update_status(
        &self,
        id: Uuid,
        to: AlertStatus,
    ) -> anyhow::Result<Option<Alert>> {
        let current = self.get(id).await?;
        let Some(cur) = current else {
            return Ok(None);
        };
        next_status(cur.status, to).map_err(|e| anyhow::anyhow!("{e}"))?;
        let closing = is_closed(to) && !is_closed(cur.status);
        let reopening = !is_closed(to) && is_closed(cur.status);
        let row = if closing {
            sqlx::query_as::<_, AlertRow>(
                &format!(
                    "UPDATE alerts SET status = $2::alert_status, resolved_at = now(), \
                     resolution_count = resolution_count + 1 WHERE id = $1 {ALERT_RETURNING}"
                ),
            )
            .bind(id)
            .bind(status_str(to))
            .fetch_optional(&self.pool)
            .await?
        } else if reopening {
            sqlx::query_as::<_, AlertRow>(
                &format!(
                    "UPDATE alerts SET status = $2::alert_status, resolved_at = NULL, opened_at = now() \
                     WHERE id = $1 {ALERT_RETURNING}"
                ),
            )
            .bind(id)
            .bind(status_str(to))
            .fetch_optional(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, AlertRow>(
                &format!("UPDATE alerts SET status = $2::alert_status WHERE id = $1 {ALERT_RETURNING}"),
            )
            .bind(id)
            .bind(status_str(to))
            .fetch_optional(&self.pool)
            .await?
        };
        Ok(row.map(row_to_alert))
    }

    pub async fn update_meta(
        &self,
        id: Uuid,
        assignee: Option<Option<String>>,
        tags: Option<Vec<String>>,
    ) -> anyhow::Result<Option<Alert>> {
        let cur = self.get(id).await?;
        let Some(c) = cur else {
            return Ok(None);
        };
        let next_assignee = assignee.unwrap_or(c.assignee);
        let next_tags = tags.unwrap_or(c.tags);
        let row = sqlx::query_as::<_, AlertRow>(
            &format!("UPDATE alerts SET assignee = $2, tags = $3 WHERE id = $1 {ALERT_RETURNING}"),
        )
        .bind(id)
        .bind(next_assignee)
        .bind(&next_tags)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(row_to_alert))
    }

    pub async fn set_dismissed(&self, id: Uuid, dismissed: bool) -> anyhow::Result<Option<Alert>> {
        let row = if dismissed {
            sqlx::query_as::<_, AlertRow>(
                &format!(
                    "UPDATE alerts SET dismissed_at = now() WHERE id = $1 AND dismissed_at IS NULL {ALERT_RETURNING}"
                ),
            )
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, AlertRow>(
                &format!(
                    "UPDATE alerts SET dismissed_at = NULL WHERE id = $1 AND dismissed_at IS NOT NULL {ALERT_RETURNING}"
                ),
            )
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
        };
        Ok(row.map(row_to_alert))
    }

    pub async fn bulk_update_status(
        &self,
        ids: &[Uuid],
        to: AlertStatus,
    ) -> anyhow::Result<Vec<Alert>> {
        let mut updated = Vec::new();
        for id in ids {
            if let Some(a) = self.update_status(*id, to).await? {
                updated.push(a);
            }
        }
        Ok(updated)
    }

    pub async fn bulk_update_by_rule(
        &self,
        rule_id: Uuid,
        from_status: Option<AlertStatus>,
        to: AlertStatus,
    ) -> anyhow::Result<Vec<Alert>> {
        let rows: Vec<Uuid> = if let Some(st) = from_status {
            sqlx::query_scalar(
                "SELECT id FROM alerts WHERE rule_id = $1 AND status = $2::alert_status AND dismissed_at IS NULL",
            )
            .bind(rule_id)
            .bind(status_str(st))
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_scalar(
                "SELECT id FROM alerts WHERE rule_id = $1 AND dismissed_at IS NULL",
            )
            .bind(rule_id)
            .fetch_all(&self.pool)
            .await?
        };
        self.bulk_update_status(&rows, to).await
    }

    pub async fn dismiss(&self, id: Uuid) -> anyhow::Result<bool> {
        Ok(self.set_dismissed(id, true).await?.is_some())
    }

    pub async fn dismiss_many(&self, ids: &[Uuid]) -> anyhow::Result<u64> {
        if ids.is_empty() {
            return Ok(0);
        }
        let r = sqlx::query(
            "UPDATE alerts SET dismissed_at = now() WHERE id = ANY($1) AND dismissed_at IS NULL",
        )
        .bind(ids)
        .execute(&self.pool)
        .await?;
        Ok(r.rows_affected())
    }

    /// Hard delete — kept for admin/maintenance; UI uses soft dismiss instead.
    pub async fn delete(&self, id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("DELETE FROM alerts WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    pub async fn delete_many(&self, ids: &[Uuid]) -> anyhow::Result<u64> {
        if ids.is_empty() {
            return Ok(0);
        }
        let r = sqlx::query("DELETE FROM alerts WHERE id = ANY($1)")
            .bind(ids)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected())
    }

    /// Remove alerts tied to an ingest source (context or linked case).
    pub async fn delete_for_ingest_source(
        &self,
        source: &str,
        case_ids: &[Uuid],
    ) -> anyhow::Result<u64> {
        let r = if case_ids.is_empty() {
            sqlx::query("DELETE FROM alerts WHERE context->>'source' = $1")
                .bind(source)
                .execute(&self.pool)
                .await?
        } else {
            sqlx::query(
                "DELETE FROM alerts WHERE context->>'source' = $1 OR case_id = ANY($2)",
            )
            .bind(source)
            .bind(case_ids)
            .execute(&self.pool)
            .await?
        };
        Ok(r.rows_affected())
    }
}
