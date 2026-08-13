//! Live data helpers for the in-app LLM assistant.

use crate::alerts::{status_str, Alert, AlertListFilter, AlertStatus, StatusFilter};
use crate::store::AlertRepository;

const LIST_LIMIT: usize = 30;

/// User is asking about alerts (list, counts, triage, queue, etc.).
pub fn wants_alert_data(user: &str) -> bool {
    let u = user.to_lowercase();
    u.contains("alert") || u.contains("triage") || u.contains("inbox")
}

/// Straightforward “show me alerts” — answer from DB without relying on the LLM.
pub fn is_direct_alert_list_request(user: &str) -> bool {
    if !wants_alert_data(user) {
        return false;
    }
    let u = user.to_lowercase();
    u.contains("list")
        || u.contains("queue")
        || u.contains("show")
        || u.contains("give me")
        || u.contains("what are")
        || u.contains("how many")
        || u.contains("pending")
        || u.contains("inbox")
        || u.contains("any alert")
        || u.contains("current alert")
}

pub fn parse_alert_status_filter(user: &str) -> StatusFilter {
    let u = user.to_lowercase();
    if u.contains("triaged") || u.contains("in progress") {
        return StatusFilter::Exact(AlertStatus::Triaged);
    }
    if u.contains("false positive") {
        return StatusFilter::Exact(AlertStatus::FalsePositive);
    }
    if u.contains("verified") || u.contains("resolved") || u.contains("closed") {
        return StatusFilter::Exact(AlertStatus::Verified);
    }
    if u.contains("open") && !u.contains("queue") && !u.contains("inbox") {
        return StatusFilter::Open;
    }
    if u.contains("queue") || u.contains("inbox") || u.contains("new") || u.contains("pending") {
        return StatusFilter::Exact(AlertStatus::New);
    }
    if is_direct_alert_list_request(user) {
        return StatusFilter::Exact(AlertStatus::New);
    }
    StatusFilter::Open
}

pub fn status_filter_label(filter: StatusFilter) -> &'static str {
    match filter {
        StatusFilter::Open => "open (new + triaged)",
        StatusFilter::Exact(AlertStatus::New) => "new (inbox / queue)",
        StatusFilter::Exact(AlertStatus::Triaged) => "triaged",
        StatusFilter::Exact(AlertStatus::Verified) => "verified (confirmed threat)",
        StatusFilter::Exact(AlertStatus::FalsePositive) => "false positive",
    }
}

pub async fn fetch_alerts_for_assistant(
    repo: &AlertRepository,
    filter: &AlertListFilter,
) -> anyhow::Result<Vec<Alert>> {
    let mut alerts = repo.list_filtered(filter).await?;
    alerts.truncate(LIST_LIMIT);
    Ok(alerts)
}

pub fn format_alert_list_reply(alerts: &[Alert], label: &str) -> String {
    if alerts.is_empty() {
        return format!(
            "No **{label}** alerts right now.\n\n\
             Open **Alerts** (`/alerts`) to change filters or review dismissed items."
        );
    }
    let mut out = format!("**{}** {label} alert(s):\n\n", alerts.len());
    for (i, a) in alerts.iter().enumerate() {
        let assignee = a.assignee.as_deref().unwrap_or("—");
        let case = a
            .case_title
            .as_deref()
            .map(|t| format!(", case: {t}"))
            .unwrap_or_default();
        out.push_str(&format!(
            "{}. **[{}]** {} — *{}* (status: {}, {} hit{}, last {}{}",
            i + 1,
            a.severity,
            a.title,
            a.rule_name,
            status_str(a.status),
            a.event_count,
            if a.event_count == 1 { "" } else { "s" },
            a.last_seen.format("%Y-%m-%d %H:%M UTC"),
            case
        ));
        if assignee != "—" {
            out.push_str(&format!(", assignee: {assignee}"));
        }
        out.push('\n');
    }
    out.push_str("\nOpen an alert in **Alerts** for triage, or use **Hunt** to pivot into Search.");
    out
}

/// Compact JSON-ish summary for LLM context on follow-up questions.
pub fn format_alerts_live_context(alerts: &[Alert], label: &str) -> String {
    if alerts.is_empty() {
        return format!("{label} alerts: none.");
    }
    let mut lines = vec![format!("{label} alerts ({} shown, max {LIST_LIMIT}):", alerts.len())];
    for a in alerts {
        lines.push(format!(
            "- id={} severity={} status={} rule={} title={} events={} last_seen={} assignee={}",
            a.id,
            a.severity,
            status_str(a.status),
            a.rule_name,
            a.title.replace('\n', " "),
            a.event_count,
            a.last_seen.to_rfc3339(),
            a.assignee.as_deref().unwrap_or("-")
        ));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_queue_list_intent() {
        assert!(is_direct_alert_list_request("Give me the list of alerts in the queue"));
        assert!(parse_alert_status_filter("alerts in the queue") == StatusFilter::Exact(AlertStatus::New));
    }

    #[test]
    fn open_vs_new() {
        assert_eq!(parse_alert_status_filter("open alerts"), StatusFilter::Open);
        assert_eq!(
            parse_alert_status_filter("triaged alerts"),
            StatusFilter::Exact(AlertStatus::Triaged)
        );
    }
}
