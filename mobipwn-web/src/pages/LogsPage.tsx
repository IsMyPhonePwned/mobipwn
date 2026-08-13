import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, MonitorSmartphone, Server, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { DevLogViewer } from "@/components/logs/DevLogViewer";
import {
  EnrichmentSyncBanner,
  type EnrichmentSyncStatus,
} from "@/components/logs/EnrichmentSyncBanner";
import { cancelRunningJobs, clearStuckEnrichmentSync } from "@/lib/jobsControl";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ActivityEntry, LogLevel } from "@/lib/activity-log";
import { useDocumentVisible } from "@/lib/useDocumentVisible";
import {
  alertActivityKindLabel,
  listAlertActivity,
  type AlertActivityEntry,
} from "@/lib/alerts";
import { alertDisplayTitle, alertSampleSummary } from "@/lib/alertTriage";
import { formatRelativeCompact, formatWallTimestamp } from "@/lib/formatRelative";

type DevLogFile = "api" | "jobs" | "web";

type DevLogsResponse = {
  service: string;
  path: string;
  lines: string[];
  enabled: boolean;
  source?: "api" | "vite";
  enrichment_sync?: EnrichmentSyncStatus | null;
};

const CLIENT_LEVELS: (LogLevel | "all")[] = ["all", "error", "warn", "info", "debug"];

async function fetchDevLogs(service: DevLogFile, lines = 200): Promise<DevLogsResponse> {
  const q = `service=${service}&lines=${lines}`;
  try {
    const data = await apiFetch<DevLogsResponse>(`/v1/dev/logs?${q}`);
    return { ...data, source: "api" };
  } catch (e) {
    const msg = String(e);
    if (!msg.includes("Not Found")) throw e;
    try {
      const res = await fetch(`/__mobipwn/dev/logs?${q}`);
      if (!res.ok) throw e;
      return (await res.json()) as DevLogsResponse;
    } catch {
      throw e;
    }
  }
}

function formatClientTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function clientLevelClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "log-line--error";
    case "warn":
      return "log-line--warn";
    case "info":
      return "log-line--info";
    default:
      return "";
  }
}

function ClientLogLine({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`log-line logs-page-client-line ${clientLevelClass(entry.level)}`}>
      <button type="button" className="log-line-head" onClick={() => setOpen((v) => !v)}>
        <span className="log-time" title={new Date(entry.ts).toLocaleString()}>
          {formatClientTime(entry.ts)}
        </span>
        <span className={`dev-log-line__level dev-log-line__level--${entry.level}`}>{entry.level}</span>
        <span className={`log-source log-source--${entry.source}`}>{entry.source}</span>
        <span className="log-msg">{entry.message}</span>
        {entry.durationMs != null && <span className="log-meta">{entry.durationMs}ms</span>}
      </button>
      {(entry.level === "error" || open) && entry.detail && (
        <pre className="log-detail mono">{entry.detail.slice(0, 2000)}</pre>
      )}
    </div>
  );
}

function ClientActivityPanel({
  entries,
  onClear,
}: {
  entries: readonly ActivityEntry[];
  onClear: () => void;
}) {
  const [filter, setFilter] = useState<LogLevel | "all">("all");

  const filtered = useMemo(() => {
    const list = filter === "all" ? [...entries] : entries.filter((e) => e.level === filter);
    return list; // ActivityLogContext already keeps newest first
  }, [entries, filter]);

  const errorCount = entries.filter((e) => e.level === "error").length;

  return (
    <div className="logs-page-client">
      <div className="dev-log-controls dev-log-controls--compact">
        <div className="dev-log-levels" role="group" aria-label="Client log level">
          {CLIENT_LEVELS.map((lv) => (
            <button
              key={lv}
              type="button"
              className={`dev-log-level-chip${filter === lv ? " dev-log-level-chip--active" : ""}`}
              onClick={() => setFilter(lv)}
            >
              {lv === "all" ? "All" : lv}
            </button>
          ))}
        </div>
        <div className="dev-log-controls__actions">
          <span className="dev-log-count muted">
            {filtered.length}/{entries.length}
            {errorCount > 0 ? ` · ${errorCount} error${errorCount === 1 ? "" : "s"}` : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={entries.length === 0}>
            <Trash2 size={14} />
            Clear
          </Button>
        </div>
      </div>
      <div className="logs-page-client-colhead" aria-hidden>
        <span>Time</span>
        <span>Level</span>
        <span>Source</span>
        <span>Message</span>
      </div>
      <ScrollArea className="dev-log-scroll dev-log-scroll--client">
        {filtered.length === 0 ? (
          <p className="dev-log-empty muted">
            {entries.length === 0
              ? "No activity yet — Search, Ingest, or Marketplace actions appear here."
              : "No entries match this level filter."}
          </p>
        ) : (
          <div className="log-page-list">
            {filtered.slice(0, 120).map((e) => (
              <ClientLogLine key={e.id} entry={e} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export default function LogsPage() {
  const { entries, clear, log } = useActivityLog();
  const tabVisible = useDocumentVisible();
  const [service, setService] = useState<DevLogFile>("api");
  const [serverLines, setServerLines] = useState<string[]>([]);
  const [serverPath, setServerPath] = useState("");
  const [serverEnabled, setServerEnabled] = useState(true);
  const [serverError, setServerError] = useState("");
  const [enrichmentSync, setEnrichmentSync] = useState<EnrichmentSyncStatus | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [alertActivity, setAlertActivity] = useState<AlertActivityEntry[]>([]);
  const [alertActivityError, setAlertActivityError] = useState("");
  const [activityKind, setActivityKind] = useState<string>("all");
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const [jobsControlBusy, setJobsControlBusy] = useState(false);

  const loadServer = useCallback(async () => {
    try {
      const data = await fetchDevLogs(service);
      setServerEnabled(data.enabled);
      setServerLines(data.lines);
      setServerPath(data.path);
      setEnrichmentSync(data.enrichment_sync ?? null);
      setLastRefresh(new Date());
      setServerError(
        data.source === "vite"
          ? "Using Vite dev tail — restart ./dev.sh to use API /v1/dev/logs."
          : ""
      );
    } catch (e) {
      setServerError(String(e));
      setServerLines([]);
    }
  }, [service]);

  const loadAlertActivity = useCallback(async () => {
    try {
      setAlertActivity(
        await listAlertActivity({
          limit: 200,
          kind: activityKind === "all" ? undefined : activityKind,
        })
      );
      setAlertActivityError("");
    } catch (e) {
      setAlertActivityError(String(e));
      setAlertActivity([]);
    }
  }, [activityKind]);

  const ACTIVITY_KIND_FILTERS = [
    "all",
    "status",
    "comment",
    "assignee",
    "tags",
    "dismissed",
    "restored",
    "deleted",
  ] as const;

  useEffect(() => {
    void loadAlertActivity();
  }, [loadAlertActivity]);

  useEffect(() => {
    void loadServer();
    void loadAlertActivity();
    if (!autoRefresh || !tabVisible) return;
    const t = setInterval(() => {
      void loadServer();
      void loadAlertActivity();
    }, 4000);
    return () => clearInterval(t);
  }, [loadServer, loadAlertActivity, autoRefresh, tabVisible]);

  const handleCancelJobs = useCallback(async () => {
    if (
      !window.confirm(
        "Cancel all running background jobs? This stops enrichment sync, marks in-flight ingest and IronSift runs as failed, and clears the sync banner."
      )
    ) {
      return;
    }
    setJobsControlBusy(true);
    try {
      const summary = await cancelRunningJobs();
      log(
        "info",
        `Jobs cancelled — ingest: ${summary.ingest_jobs_failed}, IronSift: ${summary.ironsift_runs_failed}`
      );
      setEnrichmentSync(null);
      await loadServer();
    } catch (e) {
      log("error", "Cancel jobs failed", String(e));
    } finally {
      setJobsControlBusy(false);
    }
  }, [loadServer, log]);

  const handleDismissSync = useCallback(async () => {
    setJobsControlBusy(true);
    try {
      await clearStuckEnrichmentSync();
      log("info", "Dismissed stuck enrichment sync status");
      setEnrichmentSync(null);
      await loadServer();
    } catch (e) {
      log("error", "Dismiss sync status failed", String(e));
    } finally {
      setJobsControlBusy(false);
    }
  }, [loadServer, log]);

  return (
    <>
      <PageHeader
        title="Logs"
        description="Three streams: this browser session, server process tails, and alert triage history."
        meta={
          lastRefresh ? (
            <span className="muted">
              Updated {lastRefresh.toLocaleTimeString()}
              {autoRefresh ? " · live" : " · paused"}
            </span>
          ) : undefined
        }
      />

      <nav className="logs-page-jump" aria-label="Log sections">
        <a href="#logs-client" className="logs-page-jump__link">
          <MonitorSmartphone size={14} aria-hidden />
          Client
          <span className="logs-page-jump__count">{entries.length}</span>
        </a>
        <a href="#logs-server" className="logs-page-jump__link">
          <Server size={14} aria-hidden />
          Server
          <span className="logs-page-jump__count">{service}</span>
        </a>
        <a href="#logs-alerts" className="logs-page-jump__link">
          <Bell size={14} aria-hidden />
          Alert activity
          <span className="logs-page-jump__count">{alertActivity.length}</span>
        </a>
      </nav>

      {enrichmentSync?.running && (
        <EnrichmentSyncBanner
          status={enrichmentSync}
          onCancel={handleCancelJobs}
          onDismiss={handleDismissSync}
          busy={jobsControlBusy}
        />
      )}

      <div className="logs-page-grid">
        <Card id="logs-client" className="logs-page-card">
          <CardHeader className="logs-page-card-header">
            <div className="logs-page-card-titleblock">
              <span className="logs-page-card-icon" aria-hidden>
                <MonitorSmartphone size={16} />
              </span>
              <div>
                <CardTitle>Client activity</CardTitle>
                <p className="muted text-xs">
                  API calls and UI actions in this browser tab (session only).
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="logs-page-card-body">
            <ClientActivityPanel
              entries={entries}
              onClear={() => {
                log("info", "Clear client activity log");
                clear();
              }}
            />
          </CardContent>
        </Card>

        <Card id="logs-server" className="logs-page-card logs-page-card--server">
          <CardHeader className="logs-page-card-header">
            <div className="logs-page-card-titleblock">
              <span className="logs-page-card-icon" aria-hidden>
                <Server size={16} />
              </span>
              <div>
                <CardTitle>Server logs</CardTitle>
                <p className="muted text-xs">
                  Live tail of <code className="mono">.dev/{service}.log</code> — newest first; expand a
                  line for structured fields.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="logs-page-card-body">
            {!serverEnabled && (
              <p className="logs-page-alert muted">
                Set <code className="mono">MOBIPWN_EXPOSE_DEV_LOGS=1</code> on mobipwn-api and restart.
              </p>
            )}
            {serverError && (
              <p
                className={
                  serverError.startsWith("Using Vite")
                    ? "logs-page-alert muted"
                    : "logs-page-alert logs-page-alert--error"
                }
              >
                {serverError}
              </p>
            )}
            <DevLogViewer
              service={service}
              lines={serverLines}
              onServiceChange={(s) => {
                log("info", `Server log tab: ${s}`);
                setService(s);
              }}
              autoRefresh={autoRefresh}
              onAutoRefreshChange={setAutoRefresh}
              onRefresh={() => {
                log("info", `Refresh server logs: ${service}`);
                void loadServer();
              }}
            />
            <footer className="logs-page-footer muted">
              <span>
                File <code className="mono">{serverPath || `.dev/${service}.log`}</code>
              </span>
              <span aria-hidden>·</span>
              <Link to="/health">Health</Link>
            </footer>
          </CardContent>
        </Card>
      </div>

      <Card id="logs-alerts" className="logs-page-card logs-page-card--alerts mt-3">
        <CardHeader className="logs-page-card-header">
          <div className="logs-page-card-titleblock">
            <span className="logs-page-card-icon" aria-hidden>
              <Bell size={16} />
            </span>
            <div>
              <CardTitle>Alert activity</CardTitle>
              <p className="muted text-xs">
                Triage history — status, comments, dismiss/restore, deletions. Click a row for full detail.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadAlertActivity()}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="logs-page-card-body">
          <div className="dev-log-controls dev-log-controls--compact mb-3">
            <div className="dev-log-levels" role="group" aria-label="Filter by action type">
              {ACTIVITY_KIND_FILTERS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`dev-log-level-chip${activityKind === kind ? " dev-log-level-chip--active" : ""}`}
                  onClick={() => setActivityKind(kind)}
                >
                  {kind === "all" ? "All" : alertActivityKindLabel(kind)}
                </button>
              ))}
            </div>
            <span className="dev-log-count muted">{alertActivity.length} entries</span>
          </div>
          {alertActivityError && <p className="error text-sm">{alertActivityError}</p>}
          {alertActivity.length === 0 && !alertActivityError ? (
            <p className="muted text-sm">No alert triage actions recorded yet.</p>
          ) : (
            <div className="results-table-wrap logs-alert-table-wrap">
              <table className="data-table logs-alert-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>By</th>
                    <th>Alert</th>
                    <th>Detail</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {alertActivity.map((row) => {
                    const sample = alertSampleSummary({
                      rule_name: row.rule_name,
                      title: row.alert_title,
                    });
                    const whenAbs = formatWallTimestamp(row.created_at);
                    const whenRel = formatRelativeCompact(new Date(row.created_at));
                    return (
                      <Fragment key={row.id}>
                        <tr
                          className={expandedActivityId === row.id ? "selected" : ""}
                          onClick={() =>
                            setExpandedActivityId((v) => (v === row.id ? null : row.id))
                          }
                        >
                          <td className="logs-alert-when" title={whenAbs}>
                            <span className="logs-alert-when__rel">{whenRel}</span>
                            <span className="logs-alert-when__abs muted mono">{whenAbs}</span>
                          </td>
                          <td>
                            <span className={`badge logs-alert-kind logs-alert-kind--${row.kind}`}>
                              {alertActivityKindLabel(row.kind)}
                            </span>
                            {row.source === "archived" && (
                              <span className="muted text-xs ml-1">archived</span>
                            )}
                          </td>
                          <td>{row.author}</td>
                          <td className="inbox-title-cell">
                            <span className="alerts-rule-name">
                              {alertDisplayTitle({
                                rule_name: row.rule_name,
                                title: row.alert_title,
                              })}
                            </span>
                            {sample && (
                              <span className="muted text-xs alerts-sample-summary" title={sample}>
                                {sample}
                              </span>
                            )}
                          </td>
                          <td className="muted logs-alert-detail-cell">{row.body}</td>
                          <td>
                            {row.alert_exists ? (
                              <Link
                                to="/alerts"
                                className="btn btn-ghost btn-sm"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Open
                              </Link>
                            ) : (
                              <span className="muted text-xs">removed</span>
                            )}
                          </td>
                        </tr>
                        {expandedActivityId === row.id && (
                          <tr className="logs-alert-activity-detail">
                            <td colSpan={6}>
                              <dl className="logs-alert-activity-meta">
                                <div>
                                  <dt>Alert ID</dt>
                                  <dd className="mono">{row.alert_id}</dd>
                                </div>
                                <div>
                                  <dt>Status</dt>
                                  <dd>{row.alert_status || "—"}</dd>
                                </div>
                                <div>
                                  <dt>Source</dt>
                                  <dd>{row.source}</dd>
                                </div>
                                <div className="logs-alert-activity-meta--wide">
                                  <dt>Full message</dt>
                                  <dd>{row.body}</dd>
                                </div>
                              </dl>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
