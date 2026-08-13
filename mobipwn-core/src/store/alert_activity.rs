use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct AlertActivityEntry {
    pub id: String,
    pub alert_id: Uuid,
    pub kind: String,
    pub body: String,
    pub author: String,
    pub created_at: DateTime<Utc>,
    pub rule_name: Option<String>,
    pub alert_title: Option<String>,
    pub alert_status: Option<String>,
    /// `event` — live row in alert_events; `deletion` — permanent delete; `archived` — from deletion audit snapshot.
    pub source: String,
    pub alert_exists: bool,
}

#[derive(Debug, Clone, Default)]
pub struct AlertActivityFilter {
    pub alert_id: Option<Uuid>,
    pub kind: Option<String>,
    pub limit: i64,
}

pub struct AlertActivityRepository {
    pool: PgPool,
}

impl AlertActivityRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_recent(
        &self,
        filter: &AlertActivityFilter,
    ) -> anyhow::Result<Vec<AlertActivityEntry>> {
        let limit = filter.limit.clamp(1, 500);
        let mut entries = Vec::new();

        entries.extend(self.fetch_live_events(filter.alert_id).await?);
        entries.extend(self.fetch_deletions(filter.alert_id).await?);
        entries.extend(self.fetch_archived_events(filter.alert_id).await?);

        if let Some(kind) = filter.kind.as_deref().filter(|k| !k.is_empty()) {
            entries.retain(|e| e.kind == kind);
        }

        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        entries.truncate(limit as usize);
        Ok(entries)
    }

    async fn fetch_live_events(
        &self,
        alert_id: Option<Uuid>,
    ) -> anyhow::Result<Vec<AlertActivityEntry>> {
        let rows = if let Some(id) = alert_id {
            sqlx::query_as::<_, LiveEventRow>(
                "SELECT e.id, e.alert_id, e.kind, e.body, e.author, e.created_at, \
                 r.name AS rule_name, a.title AS alert_title, a.status::text AS alert_status, \
                 (a.id IS NOT NULL) AS alert_exists \
                 FROM alert_events e \
                 LEFT JOIN alerts a ON a.id = e.alert_id \
                 LEFT JOIN detection_rules r ON r.id = a.rule_id \
                 WHERE e.alert_id = $1 \
                 ORDER BY e.created_at DESC",
            )
            .bind(id)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, LiveEventRow>(
                "SELECT e.id, e.alert_id, e.kind, e.body, e.author, e.created_at, \
                 r.name AS rule_name, a.title AS alert_title, a.status::text AS alert_status, \
                 (a.id IS NOT NULL) AS alert_exists \
                 FROM alert_events e \
                 LEFT JOIN alerts a ON a.id = e.alert_id \
                 LEFT JOIN detection_rules r ON r.id = a.rule_id \
                 ORDER BY e.created_at DESC \
                 LIMIT 1000",
            )
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows
            .into_iter()
            .map(|r| AlertActivityEntry {
                id: r.id.to_string(),
                alert_id: r.alert_id,
                kind: r.kind,
                body: r.body,
                author: r.author,
                created_at: r.created_at,
                rule_name: r.rule_name,
                alert_title: r.alert_title,
                alert_status: r.alert_status,
                source: "event".into(),
                alert_exists: r.alert_exists,
            })
            .collect())
    }

    async fn fetch_deletions(
        &self,
        alert_id: Option<Uuid>,
    ) -> anyhow::Result<Vec<AlertActivityEntry>> {
        let rows = if let Some(id) = alert_id {
            sqlx::query_as::<_, DeletionRow>(
                "SELECT ada.id, ada.alert_id, ada.deleted_by, ada.reason, ada.deleted_at, \
                 ada.alert_snapshot, \
                 EXISTS (SELECT 1 FROM alerts a WHERE a.id = ada.alert_id) AS alert_exists \
                 FROM alert_deletion_audit ada \
                 WHERE ada.alert_id = $1 \
                 ORDER BY ada.deleted_at DESC",
            )
            .bind(id)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, DeletionRow>(
                "SELECT ada.id, ada.alert_id, ada.deleted_by, ada.reason, ada.deleted_at, \
                 ada.alert_snapshot, \
                 EXISTS (SELECT 1 FROM alerts a WHERE a.id = ada.alert_id) AS alert_exists \
                 FROM alert_deletion_audit ada \
                 ORDER BY ada.deleted_at DESC \
                 LIMIT 500",
            )
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows
            .into_iter()
            .map(|r| {
                let rule_name = r
                    .alert_snapshot
                    .get("rule_name")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let alert_title = r
                    .alert_snapshot
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let alert_status = r
                    .alert_snapshot
                    .get("status")
                    .and_then(|v| v.as_str().map(str::to_string).or_else(|| Some(v.to_string())));
                let body = r
                    .reason
                    .filter(|s| !s.is_empty())
                    .map(|reason| format!("Alert permanently deleted: {reason}"))
                    .unwrap_or_else(|| "Alert permanently deleted".into());
                AlertActivityEntry {
                    id: format!("del-{}", r.id),
                    alert_id: r.alert_id,
                    kind: "deleted".into(),
                    body,
                    author: r.deleted_by,
                    created_at: r.deleted_at,
                    rule_name,
                    alert_title,
                    alert_status,
                    source: "deletion".into(),
                    alert_exists: r.alert_exists,
                }
            })
            .collect())
    }

    async fn fetch_archived_events(
        &self,
        alert_id: Option<Uuid>,
    ) -> anyhow::Result<Vec<AlertActivityEntry>> {
        let rows = if let Some(id) = alert_id {
            sqlx::query_as::<_, ArchivedEventRow>(
                "SELECT ada.alert_id, ada.alert_snapshot, ev.value AS event_json \
                 FROM alert_deletion_audit ada \
                 CROSS JOIN LATERAL jsonb_array_elements(ada.events_snapshot) AS ev(value) \
                 WHERE ada.alert_id = $1 AND ev.value->>'kind' IS DISTINCT FROM 'deleted'",
            )
            .bind(id)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, ArchivedEventRow>(
                "SELECT ada.alert_id, ada.alert_snapshot, ev.value AS event_json \
                 FROM alert_deletion_audit ada \
                 CROSS JOIN LATERAL jsonb_array_elements(ada.events_snapshot) AS ev(value) \
                 WHERE ev.value->>'kind' IS DISTINCT FROM 'deleted' \
                 ORDER BY (ev.value->>'created_at') DESC NULLS LAST \
                 LIMIT 2000",
            )
            .fetch_all(&self.pool)
            .await?
        };

        let mut out = Vec::new();
        for (i, r) in rows.into_iter().enumerate() {
            let ev = &r.event_json;
            let kind = ev
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let body = ev
                .get("body")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let author = ev
                .get("author")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let created_at = ev
                .get("created_at")
                .and_then(parse_json_time)
                .unwrap_or_else(Utc::now);
            let event_id = ev
                .get("id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("arch-{}-{}", r.alert_id, i));
            let rule_name = r
                .alert_snapshot
                .get("rule_name")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let alert_title = r
                .alert_snapshot
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let alert_status = r
                .alert_snapshot
                .get("status")
                .and_then(|v| v.as_str().map(str::to_string).or_else(|| Some(v.to_string())));

            out.push(AlertActivityEntry {
                id: format!("arch-{event_id}"),
                alert_id: r.alert_id,
                kind,
                body,
                author,
                created_at,
                rule_name,
                alert_title,
                alert_status,
                source: "archived".into(),
                alert_exists: false,
            });
        }
        Ok(out)
    }
}

fn parse_json_time(v: &serde_json::Value) -> Option<DateTime<Utc>> {
    if let Some(s) = v.as_str() {
        return DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|d| d.with_timezone(&Utc))
            .or_else(|| {
                chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                    .ok()
                    .map(|n| n.and_utc())
            });
    }
    None
}

#[derive(sqlx::FromRow)]
struct LiveEventRow {
    id: Uuid,
    alert_id: Uuid,
    kind: String,
    body: String,
    author: String,
    created_at: DateTime<Utc>,
    rule_name: Option<String>,
    alert_title: Option<String>,
    alert_status: Option<String>,
    alert_exists: bool,
}

#[derive(sqlx::FromRow)]
struct DeletionRow {
    id: Uuid,
    alert_id: Uuid,
    deleted_by: String,
    reason: Option<String>,
    deleted_at: DateTime<Utc>,
    alert_snapshot: serde_json::Value,
    alert_exists: bool,
}

#[derive(sqlx::FromRow)]
struct ArchivedEventRow {
    alert_id: Uuid,
    alert_snapshot: serde_json::Value,
    event_json: serde_json::Value,
}
