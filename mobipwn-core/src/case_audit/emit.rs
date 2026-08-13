use chrono::{DateTime, Utc};
use clickhouse::Client;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::ch::EventRow;
use crate::mudm::MudmEvent;
use crate::store::CaseRecord;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaseAuditAction {
    Created,
    AlertAdded,
    AlertRemoved,
    StatusChanged,
    Closed,
    Reopened,
    SeverityChanged,
    Comment,
}

impl CaseAuditAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::AlertAdded => "alert_added",
            Self::AlertRemoved => "alert_removed",
            Self::StatusChanged => "status_changed",
            Self::Closed => "closed",
            Self::Reopened => "reopened",
            Self::SeverityChanged => "severity_changed",
            Self::Comment => "comment",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CaseAuditActor {
    pub id: Option<Uuid>,
    pub name: String,
}

impl CaseAuditActor {
    pub fn system() -> Self {
        Self {
            id: None,
            name: "system".into(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct CaseAuditExtras {
    pub previous_status: Option<String>,
    pub disposition: Option<String>,
    pub alert_id: Option<Uuid>,
    pub entity_type: Option<String>,
    pub entity_value: Option<String>,
    pub related_case_id: Option<Uuid>,
    pub notes: Option<String>,
    pub grouping_type: Option<String>,
    pub time_to_detect_seconds: Option<i64>,
    pub entity_count: Option<i64>,
    /// Analyst note importance: `information`, `important`, `alert`, `warning`.
    pub note_type: Option<String>,
}

/// Normalize analyst note type from API/UI input.
pub fn normalize_note_type(raw: Option<&str>) -> &'static str {
    let key = raw
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match key.as_str() {
        "important" => "important",
        "alert" => "alert",
        "warning" => "warning",
        _ => "information",
    }
}

/// Analyst comment on a case — stored in the case audit wall (`action=comment`).
pub async fn emit_case_comment(
    client: &Client,
    case: &CaseRecord,
    actor: &CaseAuditActor,
    comment: &str,
    note_type: Option<&str>,
) -> anyhow::Result<Uuid> {
    let text = truncate_notes(comment.trim());
    if text.is_empty() {
        anyhow::bail!("comment cannot be empty");
    }
    let note_type = normalize_note_type(note_type).to_string();
    emit_case_audit(
        client,
        case,
        CaseAuditAction::Comment,
        actor,
        CaseAuditExtras {
            notes: Some(text),
            note_type: Some(note_type),
            ..Default::default()
        },
    )
    .await
}

/// Insert a searchable case audit event (`source_type=audit`, `source=case`).
pub async fn emit_case_audit(
    client: &Client,
    case: &CaseRecord,
    action: CaseAuditAction,
    actor: &CaseAuditActor,
    extras: CaseAuditExtras,
) -> anyhow::Result<Uuid> {
    let now = Utc::now();
    let time_since_creation = (now - case.created_at).num_seconds().max(0);
    let time_to_resolve = if matches!(action, CaseAuditAction::Closed) {
        Some((now - case.created_at).num_seconds().max(0))
    } else {
        None
    };

    let notes = extras
        .notes
        .as_deref()
        .map(|n| truncate_notes(n))
        .filter(|n| !n.is_empty());

    let ext = json!({
        "case_id": case.id.to_string(),
        "case_title": case.title,
        "action": action.as_str(),
        "actor_id": actor.id.map(|id| id.to_string()),
        "actor_name": actor.name,
        "severity": case.priority,
        "status": case.status,
        "previous_status": extras.previous_status,
        "disposition": extras.disposition,
        "assigned_to": Value::Null,
        "assigned_to_name": Value::Null,
        "alert_count": case.alert_count,
        "entity_count": extras.entity_count.unwrap_or(0),
        "grouping_type": extras.grouping_type,
        "time_since_creation_seconds": time_since_creation,
        "time_to_assign_seconds": Value::Null,
        "time_to_resolve_seconds": time_to_resolve,
        "time_to_detect_seconds": extras.time_to_detect_seconds,
        "time_in_status_seconds": Value::Null,
        "alert_id": extras.alert_id.map(|id| id.to_string()),
        "entity_value": extras.entity_value,
        "entity_type": extras.entity_type,
        "related_case_id": extras.related_case_id.map(|id| id.to_string()),
        "notes": notes,
        "note_type": extras.note_type,
    });

    let message = audit_message(case, action, actor, &extras);
    let mut ev = MudmEvent::new(now, message);
    ev.source_type = "audit".into();
    ev.source = "case".into();
    ev.platform = "mobipwn".into();
    ev.parser = "case_audit".into();
    ev.data_type = "case_audit".into();
    ev.severity = case.priority.clone();
    ev.action = action.as_str().into();
    ev.ext = ext;

    insert_audit_events(client, std::slice::from_ref(&ev)).await?;
    Ok(ev.id)
}

fn audit_message(case: &CaseRecord, action: CaseAuditAction, actor: &CaseAuditActor, extras: &CaseAuditExtras) -> String {
    match action {
        CaseAuditAction::Created => format!("Case created: {} by {}", case.title, actor.name),
        CaseAuditAction::AlertAdded => format!(
            "Alert added to case {} by {}",
            case.title,
            actor.name
        ),
        CaseAuditAction::AlertRemoved => format!(
            "Alert removed from case {} by {}",
            case.title,
            actor.name
        ),
        CaseAuditAction::StatusChanged => format!(
            "Case {} status changed from {} to {} by {}",
            case.title,
            extras.previous_status.as_deref().unwrap_or("?"),
            case.status,
            actor.name
        ),
        CaseAuditAction::Closed => format!("Case closed: {} by {}", case.title, actor.name),
        CaseAuditAction::Reopened => format!("Case reopened: {} by {}", case.title, actor.name),
        CaseAuditAction::SeverityChanged => format!(
            "Case {} severity changed to {} by {}",
            case.title,
            case.priority,
            actor.name
        ),
        CaseAuditAction::Comment => extras.notes.as_deref().unwrap_or("").to_string(),
    }
}

fn truncate_notes(notes: &str) -> String {
    const MAX: usize = 500;
    if notes.chars().count() <= MAX {
        return notes.to_string();
    }
    notes.chars().take(MAX).collect()
}

async fn insert_audit_events(client: &Client, events: &[MudmEvent]) -> anyhow::Result<()> {
    if events.is_empty() {
        return Ok(());
    }
    let ingest_time = Utc::now();
    let mut insert = client.insert::<EventRow>("events").await?;
    for ev in events {
        insert.write(&to_event_row(ev, ingest_time)).await?;
    }
    insert.end().await?;
    Ok(())
}

fn to_event_row(ev: &MudmEvent, ingest_time: DateTime<Utc>) -> EventRow {
    EventRow {
        id: ev.id,
        timestamp: ev.timestamp,
        message: ev.message.clone(),
        source_type: ev.source_type.clone(),
        source: ev.source.clone(),
        ingest_time,
        platform: ev.platform.clone(),
        device_id: ev.device_id.clone(),
        device_model: ev.device_model.clone(),
        os_version: ev.os_version.clone(),
        bundle_id: ev.bundle_id.clone(),
        app_name: ev.app_name.clone(),
        parser: ev.parser.clone(),
        data_type: ev.data_type.clone(),
        event_time_binding: ev.event_time_binding.clone(),
        process_name: ev.process_name.clone(),
        process_id: ev.process_id,
        user: ev.user.clone(),
        src_ip: ev.src_ip.clone(),
        dest_ip: ev.dest_ip.clone(),
        ssid: ev.ssid.clone(),
        permission: ev.permission.clone(),
        file_hash: ev.file_hash.clone(),
        severity: ev.severity.clone(),
        action: ev.action.clone(),
        ext: ev.ext.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_strings_match_nano_schema() {
        assert_eq!(CaseAuditAction::Created.as_str(), "created");
        assert_eq!(CaseAuditAction::AlertAdded.as_str(), "alert_added");
        assert_eq!(CaseAuditAction::Closed.as_str(), "closed");
        assert_eq!(CaseAuditAction::Comment.as_str(), "comment");
    }

    #[test]
    fn notes_truncated_to_500_chars() {
        let long = "x".repeat(600);
        assert_eq!(truncate_notes(&long).chars().count(), 500);
    }

    #[test]
    fn note_type_defaults_to_information() {
        assert_eq!(normalize_note_type(None), "information");
        assert_eq!(normalize_note_type(Some("")), "information");
        assert_eq!(normalize_note_type(Some("INFO")), "information");
    }

    #[test]
    fn note_type_normalizes_known_values() {
        assert_eq!(normalize_note_type(Some("important")), "important");
        assert_eq!(normalize_note_type(Some("Alert")), "alert");
        assert_eq!(normalize_note_type(Some("warning")), "warning");
    }
}
