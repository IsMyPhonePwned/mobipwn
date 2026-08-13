import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Ban,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  MessageSquare,
  RotateCcw,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CaseAnalystComment } from "@/components/cases/CaseAnalystComment";
import { CaseTagsEditor } from "@/components/cases/CaseTagsEditor";
import { CaseWall } from "@/components/cases/CaseWall";
import {
  alertStatusLabel,
  alertStatusNormalized,
  alertDisplayTitle,
  alertIsClosed,
  alertSampleSummary,
} from "@/lib/alertTriage";
import { patchAlertStatus } from "@/lib/alerts";
import { formatRelativeCompact } from "@/lib/formatRelative";
import { renameCase, type CaseRecord, type CaseWallEntry } from "@/lib/cases";

export type CaseIngestJob = {
  id: string;
  source: string;
  platform?: string;
  status: string;
  events_count?: number;
  events_ingested?: number;
  created_at: string;
  finished_at?: string | null;
  case_user?: string | null;
};

function ingestJobEventCount(job: CaseIngestJob): number {
  return job.events_count ?? job.events_ingested ?? 0;
}

export type CaseLinkedAlert = {
  id: string;
  rule_id?: string;
  rule_name: string;
  title: string;
  status: string;
  severity: string;
  event_count: number;
  last_seen: string;
  facet_label?: string;
  context?: {
    source?: string;
    platform?: string;
    parser?: string;
    bundle_id?: string;
    process_name?: string;
  };
};

function caseStatusVariant(status: string): "new" | "triaged" | "resolved" | "default" {
  if (status === "open") return "new";
  if (status === "investigating") return "triaged";
  if (status === "closed") return "resolved";
  return "default";
}

function ingestStatusTone(status: string): "ok" | "active" | "error" | "muted" {
  const s = status.toLowerCase();
  if (s === "done" || s === "completed") return "ok";
  if (s === "failed" || s === "error") return "error";
  if (s === "running" || s === "pending" || s === "uploading") return "active";
  return "muted";
}

function severityTone(severity: string): "critical" | "high" | "medium" | "low" {
  const s = severity.toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  return "low";
}

function alertStatusRank(status: string): number {
  const normalized = alertStatusNormalized(status);
  if (normalized === "new") return 0;
  if (normalized === "triaged") return 1;
  if (normalized === "verified") return 2;
  if (normalized === "false_positive") return 3;
  return 4;
}

/** What differs across hits of the same rule (parser · bundle/process). */
function alertHitIdentity(alert: CaseLinkedAlert): string {
  const ctx = alert.context;
  const parts: string[] = [];
  if (ctx?.parser?.trim()) parts.push(ctx.parser.trim());
  if (ctx?.bundle_id?.trim()) parts.push(ctx.bundle_id.trim());
  else if (ctx?.process_name?.trim()) parts.push(ctx.process_name.trim());
  if (parts.length > 0) return parts.join(" · ");

  const facet = alert.facet_label?.trim();
  if (facet && facet !== "—") {
    const bits = facet.split(" · ").map((b) => b.trim()).filter(Boolean);
    if (bits.length >= 3 && bits[0].startsWith("case-")) {
      return bits.slice(2).join(" · ");
    }
    if (bits.length >= 2 && bits[0].startsWith("case-")) {
      return bits.slice(1).join(" · ");
    }
    return facet;
  }

  const sample = alertSampleSummary(alert);
  return sample || "Match";
}

type AlertRuleGroup = {
  key: string;
  title: string;
  severity: string;
  alerts: CaseLinkedAlert[];
  totalHits: number;
  lastSeen: string;
  bestStatusRank: number;
};

function groupAlertsByRule(alerts: CaseLinkedAlert[]): AlertRuleGroup[] {
  const sorted = [...alerts].sort(
    (a, b) =>
      alertStatusRank(a.status) - alertStatusRank(b.status) ||
      new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()
  );

  const map = new Map<string, AlertRuleGroup>();
  const order: string[] = [];

  for (const a of sorted) {
    const key = a.rule_id?.trim() || alertDisplayTitle(a);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        title: alertDisplayTitle(a),
        severity: a.severity,
        alerts: [a],
        totalHits: a.event_count ?? 0,
        lastSeen: a.last_seen,
        bestStatusRank: alertStatusRank(a.status),
      });
      order.push(key);
      continue;
    }
    existing.alerts.push(a);
    existing.totalHits += a.event_count ?? 0;
    existing.bestStatusRank = Math.min(existing.bestStatusRank, alertStatusRank(a.status));
    if (new Date(a.last_seen).getTime() > new Date(existing.lastSeen).getTime()) {
      existing.lastSeen = a.last_seen;
    }
    const sevRank = (s: string) =>
      ({ critical: 0, high: 1, medium: 2, low: 3 }[s.toLowerCase()] ?? 4);
    if (sevRank(a.severity) < sevRank(existing.severity)) {
      existing.severity = a.severity;
    }
  }

  return order
    .map((k) => map.get(k)!)
    .sort(
      (a, b) =>
        a.bestStatusRank - b.bestStatusRank ||
        new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    );
}

function LinkedAlertRowActions({
  alert,
  busy,
  canWriteAlerts,
  onSetStatus,
}: {
  alert: CaseLinkedAlert;
  busy: boolean;
  canWriteAlerts: boolean;
  onSetStatus: (alertId: string, status: string, comment?: string) => void;
}) {
  if (!canWriteAlerts) return null;
  const status = alertStatusNormalized(alert.status);

  return (
    <div className="case-hub-alert-row__actions">
      {status === "new" ? (
        <button
          type="button"
          className="case-hub-alert-card__btn case-hub-alert-card__btn--primary"
          title="Triage"
          disabled={busy}
          onClick={() => onSetStatus(alert.id, "triaged")}
        >
          <ClipboardCheck size={15} aria-hidden />
          <span>Triage</span>
        </button>
      ) : null}
      {status === "triaged" ? (
        <>
          <button
            type="button"
            className="case-hub-alert-card__btn case-hub-alert-card__btn--ok"
            title="Mark verified"
            disabled={busy}
            onClick={() => onSetStatus(alert.id, "verified")}
          >
            <CheckCircle2 size={15} aria-hidden />
            <span>Verify</span>
          </button>
          <button
            type="button"
            className="case-hub-alert-card__btn case-hub-alert-card__btn--fp"
            title="False positive"
            disabled={busy}
            onClick={() => {
              const comment = window.prompt(
                "Optional note for false positive (leave empty to skip):"
              );
              if (comment === null) return;
              onSetStatus(alert.id, "false_positive", comment);
            }}
          >
            <Ban size={15} aria-hidden />
            <span>FP</span>
          </button>
        </>
      ) : null}
      {alertIsClosed(alert.status) ? (
        <button
          type="button"
          className="case-hub-alert-card__btn"
          title="Reopen as triaged"
          disabled={busy}
          onClick={() => onSetStatus(alert.id, "triaged")}
        >
          <RotateCcw size={15} aria-hidden />
          <span>Reopen</span>
        </button>
      ) : null}
    </div>
  );
}

function LinkedAlertsBlock({
  caseRec,
  alerts,
  canWriteAlerts,
  statusBusyId,
  onSetStatus,
}: {
  caseRec: CaseRecord;
  alerts: CaseLinkedAlert[];
  canWriteAlerts: boolean;
  statusBusyId: string | null;
  onSetStatus: (alertId: string, status: string, comment?: string) => void;
}) {
  const groups = useMemo(() => groupAlertsByRule(alerts), [alerts]);

  const counts = useMemo(() => {
    let open = 0;
    let triaged = 0;
    let closed = 0;
    for (const a of alerts) {
      const s = alertStatusNormalized(a.status);
      if (s === "new") open += 1;
      else if (s === "triaged") triaged += 1;
      else closed += 1;
    }
    return { open, triaged, closed };
  }, [alerts]);

  const alertsHref = `/alerts?case_id=${caseRec.id}&case_title=${encodeURIComponent(caseRec.title)}`;

  if (alerts.length === 0) {
    return (
      <section className="case-hub-alerts case-hub-alerts--band case-hub-alerts--empty">
        <div className="case-hub-alerts__header">
          <h3 className="case-hub-alerts__title">
            <Bell size={18} aria-hidden />
            Linked alerts
            <span className="case-hub-alerts__title-count">0</span>
          </h3>
        </div>
        <div className="case-hub-alerts__empty">
          <p>No alerts linked to this case yet.</p>
          <Button variant="secondary" size="sm" asChild>
            <Link to="/alerts">
              Open alerts
              <ArrowRight size={14} aria-hidden />
            </Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`case-hub-alerts case-hub-alerts--band${counts.open > 0 ? " case-hub-alerts--has-new" : ""}`}
    >
      <div className="case-hub-alerts__header">
        <h3 className="case-hub-alerts__title">
          <Bell size={18} aria-hidden />
          Linked alerts
          <span className="case-hub-alerts__title-count">{alerts.length}</span>
        </h3>
        <div className="case-hub-alerts__summary" aria-label="Alert status breakdown">
          {counts.open > 0 ? (
            <span className="case-hub-alerts__stat case-hub-alerts__stat--new">
              {counts.open} new
            </span>
          ) : null}
          {counts.triaged > 0 ? (
            <span className="case-hub-alerts__stat case-hub-alerts__stat--triaged">
              {counts.triaged} triaged
            </span>
          ) : null}
          {counts.closed > 0 ? (
            <span className="case-hub-alerts__stat case-hub-alerts__stat--closed">
              {counts.closed} closed
            </span>
          ) : null}
        </div>
        <Link to={alertsHref} className="case-hub-alerts__all">
          View all
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>

      <ul className="case-hub-alerts__groups">
        {groups.map((group) => {
          const tone = severityTone(group.severity);
          const multi = group.alerts.length > 1;

          return (
            <li
              key={group.key}
              className={`case-hub-alert-group case-hub-alert-group--${tone}${multi ? " case-hub-alert-group--multi" : ""}`}
            >
              <div className="case-hub-alert-group__head">
                <div className="case-hub-alert-group__head-main">
                  <p className="case-hub-alert-group__title" title={group.title}>
                    {group.title}
                  </p>
                  <p className="case-hub-alert-group__meta">
                    <span className={`case-hub-alert-card__sev case-hub-alert-card__sev--${tone}`}>
                      {group.severity}
                    </span>
                    <span>
                      {group.alerts.length} alert{group.alerts.length === 1 ? "" : "s"}
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      {group.totalHits} hit{group.totalHits === 1 ? "" : "s"}
                    </span>
                    {group.lastSeen ? (
                      <>
                        <span aria-hidden>·</span>
                        <time dateTime={group.lastSeen} title={group.lastSeen}>
                          {formatRelativeCompact(new Date(group.lastSeen))}
                        </time>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>

              <ul className="case-hub-alert-group__hits">
                {group.alerts.map((a) => {
                  const status = alertStatusNormalized(a.status);
                  const busy = statusBusyId === a.id;
                  const identity = alertHitIdentity(a);
                  const alertHref = `/alerts?id=${encodeURIComponent(a.id)}&case_id=${caseRec.id}&case_title=${encodeURIComponent(caseRec.title)}`;

                  return (
                    <li
                      key={a.id}
                      className={`case-hub-alert-row case-hub-alert-row--${status}${busy ? " case-hub-alert-row--busy" : ""}`}
                    >
                      <Link to={alertHref} className="case-hub-alert-row__main">
                        <span className={`case-hub-alert-card__status case-hub-alert-card__status--${status}`}>
                          {alertStatusLabel(a.status)}
                        </span>
                        <span className="case-hub-alert-row__identity mono" title={identity}>
                          {identity}
                        </span>
                        <span className="case-hub-alert-row__stats">
                          <span>
                            {a.event_count ?? 0} hit{(a.event_count ?? 0) === 1 ? "" : "s"}
                          </span>
                          {a.last_seen ? (
                            <>
                              <span aria-hidden>·</span>
                              <time dateTime={a.last_seen} title={a.last_seen}>
                                {formatRelativeCompact(new Date(a.last_seen))}
                              </time>
                            </>
                          ) : null}
                        </span>
                      </Link>
                      <LinkedAlertRowActions
                        alert={a}
                        busy={busy}
                        canWriteAlerts={canWriteAlerts}
                        onSetStatus={onSetStatus}
                      />
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function totalIngestEvents(jobs: CaseIngestJob[]): number {
  return jobs.reduce((sum, j) => sum + ingestJobEventCount(j), 0);
}

function CaseHubSectionTitle({
  icon: Icon,
  children,
  count,
}: {
  icon: ComponentType<{ size?: number }>;
  children: ReactNode;
  count?: number;
}) {
  return (
    <h3 className="case-hub-section-title">
      <Icon size={15} aria-hidden />
      <span>{children}</span>
      {count != null && <span className="case-hub-section-title__count">{count}</span>}
    </h3>
  );
}

export function CaseInvestigationPanel({
  caseRec,
  wall,
  jobs,
  alerts,
  canWrite,
  canWriteAlerts = false,
  onCommentAdded,
  onCaseUpdated,
  onAlertStatusChanged,
  onError,
}: {
  caseRec: CaseRecord;
  wall: CaseWallEntry[];
  jobs: CaseIngestJob[];
  alerts: CaseLinkedAlert[];
  canWrite: boolean;
  canWriteAlerts?: boolean;
  onCommentAdded: (entry: CaseWallEntry) => void;
  onCaseUpdated: (updated: CaseRecord) => void;
  /** Called after a linked alert status is patched (refresh list + wall). */
  onAlertStatusChanged?: (alertId: string, status: string) => void | Promise<void>;
  onError?: (message: string) => void;
}) {
  const [editTitle, setEditTitle] = useState(caseRec.title);
  const [renameSource, setRenameSource] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!renaming) {
      setEditTitle(caseRec.title);
    }
  }, [caseRec.title, renaming]);

  const eventTotal = caseRec.event_count ?? totalIngestEvents(jobs);

  const setAlertStatus = async (alertId: string, status: string, comment?: string) => {
    if (!canWriteAlerts || statusBusyId) return;
    setStatusBusyId(alertId);
    try {
      await patchAlertStatus(alertId, status, comment);
      await onAlertStatusChanged?.(alertId, status);
    } catch (e) {
      onError?.(String(e));
    } finally {
      setStatusBusyId(null);
    }
  };

  return (
    <section className="case-hub card">
      <header className="case-hub__header">
        <div className="case-hub__header-main">
          <h2 className="case-hub__title">Investigation</h2>
          <div className="case-hub__chips">
            <Badge variant={caseStatusVariant(caseRec.status)}>{caseRec.status}</Badge>
            <span className="case-hub-chip">{caseRec.priority} priority</span>
            <span className="case-hub-chip mono">{eventTotal.toLocaleString()} events</span>
            <span className="case-hub-chip mono">
              {alerts.length} alert{alerts.length === 1 ? "" : "s"}
            </span>
            <span className="case-hub-chip mono">
              {wall.length} activit{wall.length === 1 ? "y" : "ies"}
            </span>
          </div>
        </div>
      </header>

      <div className="case-hub__setup">
        <div className="case-hub-setup__field">
          <span className="case-hub-setup__label">Case title</span>
          <div className="case-hub-rename-row">
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="case-hub-rename__input mono"
              disabled={!canWrite || renaming}
              aria-label="Case title"
            />
            {canWrite && (
              <Button
                variant="secondary"
                size="sm"
                disabled={renaming || !editTitle.trim() || editTitle.trim() === caseRec.title}
                onClick={() => {
                  setRenaming(true);
                  void renameCase(caseRec.id, editTitle, renameSource)
                    .then((updated) => {
                      onCaseUpdated(updated);
                      setEditTitle(updated.title);
                      setRenameSource(false);
                    })
                    .catch((e) => onError?.(String(e)))
                    .finally(() => setRenaming(false));
                }}
              >
                {renaming ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
          {caseRec.ingest_source && (
            <div className="case-hub-rename__foot muted text-xs">
              {canWrite && (
                <label className="case-hub-rename__checkbox">
                  <input
                    type="checkbox"
                    checked={renameSource}
                    onChange={(e) => setRenameSource(e.target.checked)}
                  />
                  Rename ingest source too
                </label>
              )}
              {caseRec.ingest_source !== caseRec.title && (
                <span>
                  Source <code>{caseRec.ingest_source}</code>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="case-hub-setup__field case-hub-setup__field--tags">
          <span className="case-hub-setup__label">Tags</span>
          <CaseTagsEditor
            caseId={caseRec.id}
            tags={caseRec.tags}
            canWrite={canWrite}
            compact
            onUpdated={(tags) => onCaseUpdated({ ...caseRec, tags })}
            onError={onError}
          />
        </div>
      </div>

      <LinkedAlertsBlock
        caseRec={caseRec}
        alerts={alerts}
        canWriteAlerts={canWriteAlerts}
        statusBusyId={statusBusyId}
        onSetStatus={(alertId, status, comment) => {
          void setAlertStatus(alertId, status, comment);
        }}
      />

      <div className="case-hub__workspace">
        <div className="case-hub__main">
          {canWrite && (
            <div className="case-hub__note">
              <CaseHubSectionTitle icon={MessageSquare}>Analyst note</CaseHubSectionTitle>
              <CaseAnalystComment caseId={caseRec.id} onCommentAdded={onCommentAdded} />
            </div>
          )}

          <div className="case-hub__timeline">
            <CaseHubSectionTitle icon={Activity} count={wall.length}>
              Activity
            </CaseHubSectionTitle>
            <CaseWall entries={wall} variant="timeline" />
          </div>
        </div>

        <aside className="case-hub__context">
          <div className="case-hub-context-block">
            <CaseHubSectionTitle icon={Upload} count={jobs.length}>
              Ingest
            </CaseHubSectionTitle>
            {jobs.length === 0 ? (
              <div className="case-hub-empty case-hub-empty--compact">
                <p>No ingest jobs yet.</p>
                <Button variant="secondary" size="sm" asChild>
                  <Link to="/ingest">Ingest data</Link>
                </Button>
              </div>
            ) : (
              <ul className="case-hub-list">
                {jobs.map((j) => (
                  <li key={j.id} className="case-hub-list-item">
                    <div className="case-hub-list-item__head">
                      <span className={`case-hub-pill case-hub-pill--${ingestStatusTone(j.status)}`}>
                        {j.status}
                      </span>
                      <time className="mono muted text-xs" title={j.created_at}>
                        {formatRelativeCompact(new Date(j.created_at))}
                      </time>
                    </div>
                    <p className="case-hub-list-item__title mono">
                      {ingestJobEventCount(j).toLocaleString()} events
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
