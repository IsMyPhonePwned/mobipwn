import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  FolderSearch,
  Inbox,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { alertHuntHref, alertStatusBadgeClass, alertStatusLabel, alertDisplayTitle, alertSampleSummary } from "@/lib/alertTriage";
import { apiFetch } from "@/lib/api";
import { formatRelativeCompact } from "@/lib/formatRelative";
import { useDocumentVisible } from "@/lib/useDocumentVisible";
import { useLocale } from "@/contexts/LocaleContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OpsPanel } from "@/components/ui/OpsPanel";
import { PageHeader } from "@/components/ui/PageHeader";

export type CaseRecord = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  user: string;
  tags?: string[];
  ingest_source?: string;
  event_count?: number;
  alert_count: number;
  updated_at: string;
};

type OverviewStats = {
  events_24h: number;
  alerts_new: number;
};

type AlertQueueItem = {
  alert_id: string;
  rule_name: string;
  title: string;
  severity: string;
  facet_label: string;
  status: string;
  event_count: number;
  last_seen: string;
  context?: {
    source?: string;
    platform?: string;
    parser?: string;
    bundle_id?: string;
    process_name?: string;
  };
};

function isIngestedCase(c: CaseRecord): boolean {
  return (c.tags?.includes("ingested") ?? false) || (c.event_count ?? 0) > 0;
}

function caseStatusVariant(status: string): "new" | "triaged" | "resolved" | "default" {
  if (status === "open") return "new";
  if (status === "investigating") return "triaged";
  if (status === "closed") return "resolved";
  return "default";
}

function priorityClass(priority: string): string {
  const p = priority.toLowerCase();
  if (p === "critical" || p === "high") return "badge-critical";
  if (p === "medium") return "badge-triaged";
  return "";
}

function severityBarClass(severity: string) {
  const s = severity.toLowerCase();
  if (s === "critical") return "alerts-sev-bar--critical";
  if (s === "high") return "alerts-sev-bar--high";
  if (s === "medium") return "alerts-sev-bar--medium";
  return "alerts-sev-bar--low";
}

export default function InboxPage() {
  const { log } = useActivityLog();
  const { t } = useLocale();
  const tabVisible = useDocumentVisible();
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [newAlerts, setNewAlerts] = useState<AlertQueueItem[]>([]);
  const [triagedCount, setTriagedCount] = useState(0);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [casesRes, overviewRes, newGroupsRes, triagedGroupsRes] = await Promise.all([
        apiFetch<CaseRecord[]>("/v1/cases"),
        fetch("/api/v1/overview").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/v1/alerts/groups?status=new&dismissed=active&by=rule_facet").then((r) =>
          r.ok ? r.json() : { groups: [] },
        ),
        fetch("/api/v1/alerts/groups?status=triaged&dismissed=active&by=rule_facet").then((r) =>
          r.ok ? r.json() : { groups: [] },
        ),
      ]);

      const openCases = casesRes
        .filter((c) => c.status !== "closed")
        .filter(isIngestedCase)
        .sort((a, b) => {
          if (b.alert_count !== a.alert_count) return b.alert_count - a.alert_count;
          return b.updated_at.localeCompare(a.updated_at);
        });

      setCases(openCases);
      setStats(overviewRes as OverviewStats | null);
      setNewAlerts((newGroupsRes.groups ?? []).slice(0, 20));
      setTriagedCount((triagedGroupsRes.groups ?? []).length);
      log("info", `Load inbox: ${newGroupsRes.groups?.length ?? 0} new alerts, ${openCases.length} cases`);
    } catch (e) {
      setError(String(e));
      setCases([]);
      setNewAlerts([]);
      setTriagedCount(0);
    } finally {
      setLoading(false);
    }
  }, [log]);

  useEffect(() => {
    void load();
    if (!tabVisible) return;
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [load, tabVisible]);

  const investigatingCount = useMemo(
    () => cases.filter((c) => c.status === "investigating").length,
    [cases],
  );

  return (
    <>
      <PageHeader
        title={t("inboxPage.title")}
        description={
          <>
            {t("inboxPage.subtitlePrefix")}{" "}
            <Link to="/alerts">{t("nav.alerts")}</Link> {t("inboxPage.subtitleSuffix")}
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/cases/search">
                <FolderSearch size={14} aria-hidden />
                {t("inboxPage.caseSearch")}
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/alerts">
                <ShieldAlert size={14} aria-hidden />
                {t("inboxPage.allAlerts")}
              </Link>
            </Button>
          </>
        }
      />

      {error && <p className="error inbox-page-error">{error}</p>}

      <div className="stat-grid ops-stat-grid inbox-stat-grid">
        <Link to="/alerts" className="stat-card inbox-stat-card">
          <div className="stat-value">{stats?.alerts_new ?? newAlerts.length}</div>
          <div className="muted">
            <span className={`badge ${alertStatusBadgeClass("new")}`}>{alertStatusLabel("new")}</span> alerts
          </div>
        </Link>
        <Link to="/alerts" className="stat-card inbox-stat-card">
          <div className="stat-value">{triagedCount}</div>
          <div className="muted">
            <span className={`badge ${alertStatusBadgeClass("triaged")}`}>{alertStatusLabel("triaged")}</span>
          </div>
        </Link>
        <Link to="/cases/search" className="stat-card inbox-stat-card">
          <div className="stat-value">{cases.length}</div>
          <div className="muted">Open cases</div>
        </Link>
        <div className="stat-card">
          <div className="stat-value">{(stats?.events_24h ?? 0).toLocaleString()}</div>
          <div className="muted">Events (24h)</div>
        </div>
      </div>

      <div className="inbox-layout">
        <div className="inbox-main">
          <OpsPanel
            theme="orange"
            icon={AlertTriangle}
            title="Alert queue"
            hint="New detections waiting for triage"
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/alerts">
                  Triage all
                  <ArrowRight size={14} aria-hidden />
                </Link>
              </Button>
            }
          >
            {loading && newAlerts.length === 0 ? (
              <p className="muted inbox-empty">Loading alerts…</p>
            ) : newAlerts.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No new alerts"
                description="Detections are quiet or already triaged."
              >
                <Button variant="secondary" size="sm" asChild>
                  <Link to="/rules">Review rules</Link>
                </Button>
              </EmptyState>
            ) : (
              <div className="inbox-table-wrap">
                <table className="data-table ops-compact-table inbox-compact-table inbox-alert-table">
                  <thead>
                    <tr>
                      <th style={{ width: 4 }} aria-hidden />
                      <th>Rule</th>
                      <th>Status</th>
                      <th className="col-facet">Facet</th>
                      <th>Hits</th>
                      <th>Last seen</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {newAlerts.map((a) => {
                      const hunt = alertHuntHref(a.context);
                      return (
                        <tr key={a.alert_id}>
                          <td
                            className={`alerts-sev-bar ${severityBarClass(a.severity)}`}
                            aria-label={a.severity}
                            title={a.severity}
                          />
                          <td className="inbox-title-cell">
                            <span className="alerts-rule-name">{alertDisplayTitle(a)}</span>
                            {alertSampleSummary(a) && (
                              <span className="muted text-xs alerts-sample-summary" title={alertSampleSummary(a)!}>
                                {alertSampleSummary(a)}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${alertStatusBadgeClass(a.status)}`}>
                              {alertStatusLabel(a.status)}
                            </span>
                          </td>
                          <td className="mono inbox-facet-cell col-facet" title={a.facet_label}>
                            {a.facet_label}
                          </td>
                          <td>{a.event_count}</td>
                          <td className="muted">
                            {formatRelativeCompact(new Date(a.last_seen))}
                          </td>
                          <td className="inbox-row-actions">
                            <Button variant="ghost" size="sm" asChild>
                              <Link to="/alerts">Triage</Link>
                            </Button>
                            {hunt && (
                              <Button variant="ghost" size="sm" asChild>
                                <Link to={hunt}>Hunt</Link>
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </OpsPanel>

          <OpsPanel
            theme="cyan"
            title="Open cases"
            hint={
              investigatingCount > 0
                ? `Ingested investigations · ${investigatingCount} actively investigating`
                : "Ingested investigations"
            }
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/cases/search">
                  Browse all
                  <ArrowRight size={14} aria-hidden />
                </Link>
              </Button>
            }
          >
            {loading && cases.length === 0 ? (
              <p className="muted inbox-empty">Loading cases…</p>
            ) : cases.length === 0 ? (
              <EmptyState title="No open ingested cases yet">
                <Button variant="secondary" size="sm" asChild>
                  <Link to="/ingest">Ingest data</Link>
                </Button>
              </EmptyState>
            ) : (
              <ul className="inbox-case-list">
                {cases.slice(0, 8).map((c) => {
                  const source = c.ingest_source ?? c.title;
                  return (
                    <li key={c.id} className="inbox-case-item">
                      <div className="inbox-case-main">
                        <Link
                          to={`/search?source=${encodeURIComponent(source)}`}
                          className="inbox-case-title"
                          onClick={() => log("info", `Open case in search: ${c.title}`)}
                        >
                          {c.title}
                        </Link>
                        <p className="muted inbox-case-meta">
                          {c.user ? `${c.user} · ` : ""}
                          {c.event_count != null && `${c.event_count.toLocaleString()} events · `}
                          {c.alert_count} alert{c.alert_count === 1 ? "" : "s"} · updated{" "}
                          {c.updated_at.slice(0, 10)}
                        </p>
                      </div>
                      <div className="inbox-case-badges">
                        <Badge variant={caseStatusVariant(c.status)}>{c.status}</Badge>
                        {priorityClass(c.priority) ? (
                          <span className={`badge ${priorityClass(c.priority)}`}>{c.priority}</span>
                        ) : (
                          <span className="badge">{c.priority}</span>
                        )}
                      </div>
                      <div className="inbox-case-actions">
                        <Button variant="secondary" size="sm" asChild>
                          <Link to={`/search?source=${encodeURIComponent(source)}`}>
                            <Search size={12} aria-hidden />
                            Search
                          </Link>
                        </Button>
                        {c.alert_count > 0 && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link
                              to={`/alerts?case_id=${c.id}&case_title=${encodeURIComponent(c.title)}`}
                            >
                              Alerts
                            </Link>
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </OpsPanel>
        </div>

        <aside className="ops-panel ops-panel--purple inbox-sidebar">
          <header className="ops-panel__header">
            <div className="ops-panel__head-main">
              <div className="ops-panel__titles">
                <h2 className="ops-panel__title">Workflow</h2>
              </div>
            </div>
          </header>
          <div className="ops-panel__body">
          <ol className="inbox-workflow">
            <li>
              <strong>Review alerts</strong>
              <span className="muted">Triage or mark false positive from the alert queue.</span>
            </li>
            <li>
              <strong>Hunt context</strong>
              <span className="muted">Open matching events in Search to validate the hit.</span>
            </li>
            <li>
              <strong>Track in cases</strong>
              <span className="muted">Link related alerts to a case for ongoing work.</span>
            </li>
          </ol>
          <div className="inbox-sidebar-links">
            <Link to="/alerts" className="inbox-sidebar-link">
              Alert triage
              <ArrowRight size={14} aria-hidden />
            </Link>
            <Link to="/search" className="inbox-sidebar-link">
              Event search
              <ArrowRight size={14} aria-hidden />
            </Link>
            <Link to="/dashboards" className="inbox-sidebar-link">
              Dashboards
              <ArrowRight size={14} aria-hidden />
            </Link>
            <Link to="/data" className="inbox-sidebar-link">
              Data browser
              <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
          </div>
        </aside>
      </div>
    </>
  );
}
