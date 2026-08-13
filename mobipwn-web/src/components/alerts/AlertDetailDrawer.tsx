import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, RefreshCw, Search, X, ClipboardCheck, CheckCircle2, Ban, RotateCcw, EyeOff, Undo2, Trash2, Wrench } from "lucide-react";
import { ShareShortLink } from "@/components/ShareShortLink";
import { AlertActionIconButton, AlertActionIconLink } from "@/components/alerts/AlertActionIcon";
import { AlertEventHighlights } from "@/components/alerts/AlertEventHighlights";
import EventInspector from "@/components/EventInspector";
import { SectionHeader } from "@/components/SectionHeader";
import { alertHuntHref, alertResolutionLabel, alertIsClosed, alertStatusBadgeClass, alertStatusLabel, alertStatusNormalized, eventSearchHref, alertDisplayTitle, alertSampleSummary } from "@/lib/alertTriage";
import { useAuth } from "@/contexts/AuthContext";
import { deleteAlert } from "@/lib/alerts";
import { fetchCases, linkAlertToCase, unlinkAlertFromCase, type CaseRecord } from "@/lib/cases";
import { AssigneePicker } from "@/components/alerts/AssigneePicker";
import { authHeaders, listUserDirectory, type UserDirectoryEntry } from "@/lib/auth";
import { formatRelativeCompact } from "@/lib/formatRelative";

export type AlertDetail = {
  id: string;
  rule_id?: string;
  rule_name: string;
  status: string;
  title: string;
  severity: string;
  event_count: number;
  first_seen?: string;
  last_seen: string;
  opened_at?: string;
  resolved_at?: string | null;
  resolution_count?: number;
  dedup_key?: string;
  facet_label?: string;
  sample_event_id?: string | null;
  assignee?: string | null;
  tags?: string[];
  context?: {
    source?: string;
    platform?: string;
    parser?: string;
    bundle_id?: string;
    process_name?: string;
    timestamp?: string;
  };
  dismissed_at?: string | null;
  case_id?: string | null;
  case_title?: string | null;
};

type AlertEvent = {
  id: string;
  kind: string;
  body: string;
  author: string;
  created_at: string;
};

type Props = {
  alert: AlertDetail;
  showDismissed?: boolean;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
};

function statusBadgeClass(status: string): string {
  return alertStatusBadgeClass(status);
}

function severityBadgeClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === "critical") return "badge-critical";
  if (s === "high") return "badge-alerting";
  if (s === "medium") return "badge-triaged";
  return "";
}

export function AlertDetailDrawer({ alert, showDismissed = false, onClose, onUpdated, onDeleted }: Props) {
  const { user } = useAuth();
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [comment, setComment] = useState("");
  const [assignee, setAssignee] = useState(alert.assignee ?? "");
  const [tagsText, setTagsText] = useState((alert.tags ?? []).join(", "));
  const [inspectRow, setInspectRow] = useState<Record<string, unknown> | null>(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(alert.status);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [caseId, setCaseId] = useState(alert.case_id ?? "");
  const [caseBusy, setCaseBusy] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<UserDirectoryEntry[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);

  const huntHref = alertHuntHref(alert.context);
  const eventHref = inspectRow ? eventSearchHref(inspectRow) : null;

  const loadEvents = useCallback(async () => {
    const res = await fetch(`/api/v1/alerts/${alert.id}/events`);
    if (res.ok) setEvents(await res.json());
  }, [alert.id]);

  const loadSampleEvent = useCallback(async () => {
    if (!alert.sample_event_id) {
      setInspectRow(null);
      setEventError("");
      return;
    }
    setEventLoading(true);
    setEventError("");
    try {
      const res = await fetch(`/api/v1/events/${alert.sample_event_id}`);
      if (!res.ok) {
        setInspectRow(null);
        setEventError(res.status === 404 ? "Sample event not found in ClickHouse." : await res.text());
        return;
      }
      setInspectRow((await res.json()) as Record<string, unknown>);
    } catch (e) {
      setInspectRow(null);
      setEventError(String(e));
    } finally {
      setEventLoading(false);
    }
  }, [alert.sample_event_id]);

  useEffect(() => {
    void loadEvents();
    setAssignee(alert.assignee ?? "");
    setTagsText((alert.tags ?? []).join(", "));
    setStatus(alert.status);
  }, [alert.id, alert.assignee, alert.status, alert.tags, loadEvents]);

  useEffect(() => {
    void loadSampleEvent();
  }, [alert.id, loadSampleEvent]);

  useEffect(() => {
    void fetchCases({ status: "open" })
      .then(setCases)
      .catch(() => setCases([]));
  }, []);

  useEffect(() => {
    setDirectoryLoading(true);
    void listUserDirectory()
      .then(setDirectoryUsers)
      .catch(() => setDirectoryUsers([]))
      .finally(() => setDirectoryLoading(false));
  }, []);

  useEffect(() => {
    setCaseId(alert.case_id ?? "");
  }, [alert.case_id, alert.id]);

  useEffect(() => {
    if (!caseId && alert.context?.source) {
      const match = cases.find((c) => c.ingest_source === alert.context?.source);
      if (match) setCaseId(match.id);
    }
  }, [alert.context?.source, caseId, cases]);

  const attachCase = async () => {
    if (!caseId) return;
    setCaseBusy(true);
    setError("");
    try {
      await linkAlertToCase(caseId, alert.id);
      onUpdated();
    } catch (e) {
      setError(String(e));
    } finally {
      setCaseBusy(false);
    }
  };

  const detachCase = async () => {
    if (!alert.case_id) return;
    setCaseBusy(true);
    setError("");
    try {
      await unlinkAlertFromCase(alert.case_id, alert.id);
      setCaseId("");
      onUpdated();
    } catch (e) {
      setError(String(e));
    } finally {
      setCaseBusy(false);
    }
  };

  const patch = async (body: Record<string, unknown>) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/alerts/${alert.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      if (typeof body.status === "string") {
        setStatus(body.status);
        if (body.status === "verified" || body.status === "false_positive") {
          onUpdated();
          onClose();
          return;
        }
      }
      if (body.dismissed === true) {
        onUpdated();
        onClose();
        return;
      }
      if (body.dismissed === false) {
        onUpdated();
        onClose();
        return;
      }
      setComment("");
      await loadEvents();
      onUpdated();
    } finally {
      setLoading(false);
    }
  };

  const facet = alert.facet_label ?? alert.context?.source ?? "—";
  const sevClass = severityBadgeClass(alert.severity);
  const ruleHref = alert.rule_id ? `/rules?edit=${alert.rule_id}` : null;

  return (
    <aside className="alert-triage-panel" role="dialog" aria-label="Alert triage">
      <header className="alert-triage-header">
        <div className="alert-triage-header__main">
          <h2 className="alert-triage-title" title={alertDisplayTitle(alert)}>
            {ruleHref ? (
              <a
                href={ruleHref}
                target="_blank"
                rel="noopener noreferrer"
                className="alert-triage-rule-link"
                title="Open detection rule in new tab"
              >
                <span>{alertDisplayTitle(alert)}</span>
                <ExternalLink className="icon" size={16} aria-hidden />
              </a>
            ) : (
              alertDisplayTitle(alert)
            )}
          </h2>
          {alertSampleSummary(alert) && (
            <p className="alert-triage-sample muted text-sm">{alertSampleSummary(alert)}</p>
          )}
          <p className="alert-triage-meta muted">
            <span className={`badge ${statusBadgeClass(status)}`}>{alertStatusLabel(status)}</span>
            {sevClass ? (
              <>
                {" "}
                <span className={`badge ${sevClass}`}>{alert.severity}</span>
              </>
            ) : (
              <> · {alert.severity}</>
            )}
            · {alert.event_count} hit{alert.event_count === 1 ? "" : "s"} · {facet}
            · {alertResolutionLabel({ ...alert, status })}
          </p>
          <ShareShortLink id={alert.id} kind="alert" variant="bar" className="alert-triage-share-bar" />
        </div>
        <div className="alert-triage-header__tools">
          <button type="button" className="alert-triage-close" onClick={onClose} aria-label="Close">
            <X className="icon" />
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="alert-triage-actions">
        <div className="alert-triage-actions__group">
          {status === "new" && (
            <AlertActionIconButton
              title="Triage"
              variant="primary"
              disabled={loading}
              onClick={() => void patch({ status: "triaged" })}
            >
              <ClipboardCheck size={16} aria-hidden />
            </AlertActionIconButton>
          )}
          {!alertIsClosed(status) && (
            <AlertActionIconButton
              title="Verify threat"
              variant="secondary"
              disabled={loading}
              onClick={() => void patch({ status: "verified" })}
            >
              <CheckCircle2 size={16} aria-hidden />
            </AlertActionIconButton>
          )}
          {(status === "new" || status === "triaged") && (
            <AlertActionIconButton
              title="False positive"
              variant="secondary"
              disabled={loading}
              onClick={() => void patch({ status: "false_positive" })}
            >
              <Ban size={16} aria-hidden />
            </AlertActionIconButton>
          )}
          {(alertStatusNormalized(status) === "verified" || status === "triaged" || status === "false_positive") && (
            <AlertActionIconButton
              title="Reopen as new"
              disabled={loading}
              onClick={() => void patch({ status: "new" })}
            >
              <RotateCcw size={16} aria-hidden />
            </AlertActionIconButton>
          )}
        </div>

        {(huntHref || eventHref || ruleHref) && (
          <>
            <span className="alert-triage-actions__sep" aria-hidden />
            <div className="alert-triage-actions__group">
              {ruleHref && (
                <a
                  href={ruleHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="alert-action-icon-btn alert-action-icon-btn--ghost"
                  title="Open detection rule"
                  aria-label="Open detection rule"
                >
                  <Wrench size={16} aria-hidden />
                </a>
              )}
              {huntHref && (
                <AlertActionIconLink title="Hunt similar events" to={huntHref}>
                  <Search size={16} aria-hidden />
                </AlertActionIconLink>
              )}
              {eventHref && (
                <AlertActionIconLink title="Open in search" to={eventHref}>
                  <ExternalLink size={16} aria-hidden />
                </AlertActionIconLink>
              )}
            </div>
          </>
        )}

        <span className="alert-triage-actions__sep" aria-hidden />
        <div className="alert-triage-actions__group">
          {showDismissed ? (
            <AlertActionIconButton
              title="Restore"
              variant="secondary"
              disabled={loading}
              onClick={() => void patch({ dismissed: false })}
            >
              <Undo2 size={16} aria-hidden />
            </AlertActionIconButton>
          ) : (
            <AlertActionIconButton
              title="Dismiss"
              disabled={loading}
              onClick={() => {
                if (window.confirm("Dismiss this alert? It can be restored from the dismissed view.")) {
                  void patch({ dismissed: true });
                }
              }}
            >
              <EyeOff size={16} aria-hidden />
            </AlertActionIconButton>
          )}
          <AlertActionIconButton
            title="Delete"
            variant="danger"
            disabled={loading}
            onClick={() => {
              const reason = window.prompt(
                "Permanently delete this alert?\n\nA full snapshot and activity history will be saved to the deletion audit log.\n\nReason (optional):",
                alert.status === "false_positive" ? "false positive cleanup" : "manual delete"
              );
              if (reason === null) return;
              setLoading(true);
              void deleteAlert(alert.id, {
                author: user?.username,
                reason: reason.trim() || "manual delete",
              })
                .then(() => {
                  onDeleted?.();
                  onClose();
                })
                .catch((e) => setError(String(e)))
                .finally(() => setLoading(false));
            }}
          >
            <Trash2 size={16} aria-hidden />
          </AlertActionIconButton>
        </div>
      </div>

      <section className="alert-triage-event">
        <div className="alert-triage-event__toolbar">
          <SectionHeader
            label="Matching event"
            meta={
              alert.event_count > 1 ? (
                <span className="muted">{alert.event_count} hits in this group</span>
              ) : undefined
            }
          />
          {alert.sample_event_id && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={eventLoading}
              onClick={() => void loadSampleEvent()}
              title="Reload event"
            >
              <RefreshCw size={12} className={eventLoading ? "animate-spin" : ""} aria-hidden />
            </button>
          )}
        </div>

        {!alert.sample_event_id && (
          <div className="alert-triage-event__empty muted">
            <p>No sample event is stored for this alert.</p>
            {huntHref && (
              <Link to={huntHref} className="btn btn-secondary btn-sm">
                Hunt related events
              </Link>
            )}
          </div>
        )}

        {alert.sample_event_id && eventLoading && !inspectRow && (
          <div className="alert-triage-event__loading">
            <Loader2 size={18} className="animate-spin" aria-hidden />
            <span className="muted">Loading event…</span>
          </div>
        )}

        {eventError && (
          <div className="alert-triage-event__error">
            <p className="error">{eventError}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadSampleEvent()}>
              Retry
            </button>
          </div>
        )}

        {inspectRow && (
          <>
            <AlertEventHighlights row={inspectRow} />
            <div className="inspector-panel alert-triage-inspector">
              <EventInspector row={inspectRow} />
            </div>
          </>
        )}
      </section>

      <details className="alert-triage-details">
        <summary>Investigation case</summary>
        <div className="alert-triage-details__body">
          {alert.case_id ? (
            <p>
              Linked to{" "}
              <Link to={`/cases/${alert.case_id}`}>{alert.case_title || alert.case_id}</Link>
            </p>
          ) : (
            <p className="muted">Attach this alert to an open case for triage tracking.</p>
          )}
          <div className="alert-detail-form-row">
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="alert-detail-input">
              <option value="">Select case…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.ingest_source ? ` (${c.ingest_source})` : ""}
                </option>
              ))}
            </select>
            {!alert.case_id ? (
              <button type="button" className="btn btn-secondary" disabled={caseBusy || !caseId} onClick={() => void attachCase()}>
                Attach
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" disabled={caseBusy} onClick={() => void detachCase()}>
                Remove
              </button>
            )}
          </div>
        </div>
      </details>

      <details className="alert-triage-details">
        <summary>Assignment & tags</summary>
        <div className="alert-triage-details__body">
          <div className="alert-detail-form-row">
            <AssigneePicker
              value={assignee}
              onChange={setAssignee}
              users={directoryUsers}
              loading={directoryLoading}
              placeholder="Search users…"
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || directoryLoading}
              onClick={() => void patch({ assignee: assignee.trim() || null })}
            >
              Save
            </button>
          </div>
          {user && assignee !== user.username && (
            <div className="alert-detail-form-row">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={loading}
                onClick={() => setAssignee(user.username)}
              >
                Assign to me
              </button>
            </div>
          )}
          <div className="alert-detail-form-row">
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="Tags (comma-separated)"
              className="alert-detail-input"
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() =>
                void patch({
                  tags: tagsText
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
            >
              Save
            </button>
          </div>
        </div>
      </details>

      <details className="alert-triage-details">
        <summary>Activity ({events.length})</summary>
        <div className="alert-triage-details__body">
          <ul className="alert-activity-list">
            {events.length === 0 && <li className="muted">No activity yet.</li>}
            {events.map((e) => (
              <li key={e.id} className="alert-activity-item">
                <span className="alert-activity-kind">{e.kind}</span>
                <span className="alert-activity-body">{e.body}</span>
                <span className="alert-activity-meta muted">
                  {e.author} · {formatRelativeCompact(new Date(e.created_at))}
                </span>
              </li>
            ))}
          </ul>
          <div className="alert-detail-comment">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment…"
              rows={3}
              className="alert-detail-textarea"
            />
            <button
              type="button"
              className="btn"
              disabled={loading || !comment.trim()}
              onClick={() => void patch({ comment: comment.trim() })}
            >
              Comment
            </button>
          </div>
        </div>
      </details>
    </aside>
  );
}
