import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Cpu, Database, HardDrive, KeyRound, OctagonX, Plug, RefreshCw, Timer, Users } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLocale } from "@/contexts/LocaleContext";
import { cancelRunningJobs, clearStuckEnrichmentSync } from "@/lib/jobsControl";
import { apiFetch, apiPost } from "@/lib/api";
import { useDocumentVisible } from "@/lib/useDocumentVisible";

type ComponentHealth = {
  status: string;
  detail?: string | null;
};

type ProcessStats = {
  pid: number;
  name: string;
  memory_bytes: number;
  cpu_percent: number;
  uptime_secs: number;
};

type CrateProcessStats = {
  crate_name: string;
  pid: number | null;
  running: boolean;
  embedded?: boolean;
  memory_bytes: number;
  cpu_percent: number;
  uptime_secs: number;
};

type DockerContainerStats = {
  container: string;
  service: string;
  running: boolean;
  cpu_percent: number;
  memory_bytes: number;
  memory_limit_bytes?: number | null;
};

type CpuBreakdownRow = {
  id: string;
  label: string;
  kind: "docker" | "process";
  cpu_percent: number;
  memory_bytes: number;
  detail?: string;
};

type TableStorageStats = {
  name: string;
  bytes: number;
  rows: number;
};

type PostgresStorageStats = {
  status: string;
  database_bytes: number;
  tables: TableStorageStats[];
};

type ClickHouseStorageStats = {
  status: string;
  database: string;
  database_bytes: number;
  total_rows: number;
  tables: TableStorageStats[];
};

type DatabaseStorageStats = {
  postgres: PostgresStorageStats;
  clickhouse: ClickHouseStorageStats;
};

type ActiveSession = {
  username: string;
  role: string;
  session_started: string;
  last_seen_at: string | null;
  expires_at: string;
};

type RecentLogin = {
  username: string;
  role: string;
  last_login_at: string;
};

type AuthActivity = {
  password_storage: string;
  total_users: number;
  active_sessions: number;
  connected: ActiveSession[];
  recent_logins: RecentLogin[];
};

type ApiKeyUserUsage = {
  user_id: string | null;
  username: string;
  active_keys: number;
  suspended_keys: number;
  request_count: number;
  response_bytes: number;
  last_used_at: string | null;
};

type IntegrationsHealth = {
  llm: {
    status: string;
    configured: boolean;
    model: string;
    api_url: string;
    local: boolean;
    api_key_set: boolean;
  };
  mcp: {
    status: string;
    running: boolean;
    pid: number | null;
    auto_start: boolean;
    binary_found: boolean;
    api_url: string;
    api_key_set: boolean;
    started_at: string | null;
    last_error: string | null;
  };
  api_keys: {
    active_keys: number;
    suspended_keys: number;
    total_requests: number;
    total_response_bytes: number;
    by_user?: ApiKeyUserUsage[] | null;
  };
};

type HealthDetail = {
  postgres: ComponentHealth;
  clickhouse: ComponentHealth;
  alerting_rules: number;
  failed_rules_24h: number;
  pending_ingest_jobs: number;
  process: ProcessStats;
  crates: CrateProcessStats[];
  docker_containers?: DockerContainerStats[];
  storage: DatabaseStorageStats;
  integrations: IntegrationsHealth;
  auth?: AuthActivity | null;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return `${d}d ${h}h`;
}

function statusClass(status: string): string {
  if (status === "up") return "health-status--up";
  if (status === "degraded" || status === "disabled") return "health-status--warn";
  return "health-status--down";
}

function meterClass(percent: number, kind: "cpu" | "mem"): string {
  const p = kind === "cpu" ? Math.min(percent, 100) : percent;
  if (p >= 85) return "health-meter-fill--high";
  if (p >= 60) return "health-meter-fill--mid";
  return "health-meter-fill--ok";
}

function memBarPct(bytes: number): number {
  const memMb = bytes / (1024 * 1024);
  return Math.min(100, (memMb / 512) * 100);
}

function formatRows(rows: number): string {
  return rows.toLocaleString();
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function StorageTable({ tables }: { tables: TableStorageStats[] }) {
  if (!tables.length) {
    return <p className="muted inbox-empty">No table stats available.</p>;
  }
  return (
    <div className="health-table-wrap">
      <table className="data-table ops-compact-table health-storage-table">
        <thead>
          <tr>
            <th>Table</th>
            <th>Size</th>
            <th>Rows</th>
          </tr>
        </thead>
        <tbody>
          {tables.map((t) => (
            <tr key={t.name}>
              <td className="mono health-crate-name">{t.name}</td>
              <td>
                <div className="health-inline-metric">
                  <span>{formatBytes(t.bytes)}</span>
                  <div className="health-meter health-meter--inline" aria-hidden>
                    <div
                      className={`health-meter-fill ${meterClass(memBarPct(t.bytes), "mem")}`}
                      style={{ width: `${memBarPct(t.bytes)}%` }}
                    />
                  </div>
                </div>
              </td>
              <td className="muted">{formatRows(t.rows)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type FailedDetectionRun = {
  id: string;
  rule_id: string;
  rule_name: string;
  started_at: string;
  error: string;
};

export default function HealthPage() {
  const { log } = useActivityLog();
  const { t } = useLocale();
  const tabVisible = useDocumentVisible();
  const [data, setData] = useState<HealthDetail | null>(null);
  const [failedRuns, setFailedRuns] = useState<FailedDetectionRun[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [jobsBusy, setJobsBusy] = useState(false);
  const [jobsMsg, setJobsMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const [res, failed] = await Promise.all([
        fetch("/api/v1/health/detail"),
        apiFetch<FailedDetectionRun[]>("/v1/detection-runs/failed?hours=24&limit=15").catch(() => []),
      ]);
      const d = (await res.json()) as HealthDetail & { message?: string };
      if (!res.ok || d.message) throw new Error(d.message ?? `HTTP ${res.status}`);
      setData(d);
      setFailedRuns(failed);
      setError("");
      log("info", "Load health detail");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [log]);

  useEffect(() => {
    void load();
    if (!tabVisible) return;
    const interval = setInterval(() => void load(), 10_000);
    return () => clearInterval(interval);
  }, [load, tabVisible]);

  const handleCancelJobs = useCallback(async () => {
    if (
      !window.confirm(
        "Cancel all running background jobs? Enrichment sync will stop, and in-flight ingest runs will be marked failed."
      )
    ) {
      return;
    }
    setJobsBusy(true);
    setJobsMsg("");
    try {
      const summary = await cancelRunningJobs();
      setJobsMsg(
        `Cancelled — ingest: ${summary.ingest_jobs_failed}, enrichment status cleared.`
      );
      log("info", "Cancel all jobs from Health");
      await load();
    } catch (e) {
      setJobsMsg(String(e));
      log("error", "Cancel jobs failed", String(e));
    } finally {
      setJobsBusy(false);
    }
  }, [load, log]);

  const handleClearEnrichment = useCallback(async () => {
    setJobsBusy(true);
    setJobsMsg("");
    try {
      await clearStuckEnrichmentSync();
      setJobsMsg(t("healthPage.clearEnrichment") + " — OK");
      log("info", "Clear enrichment sync from Health");
      await load();
    } catch (e) {
      setJobsMsg(String(e));
    } finally {
      setJobsBusy(false);
    }
  }, [load, log, t]);

  const handleRestartEnrichment = useCallback(async () => {
    setJobsBusy(true);
    setJobsMsg("");
    try {
      await apiPost("/v1/marketplace/sync", {});
      setJobsMsg(t("healthPage.restartEnrichment") + " — started");
      log("info", "Marketplace sync from Health");
    } catch (e) {
      setJobsMsg(String(e));
    } finally {
      setJobsBusy(false);
    }
  }, [log, t]);

  const totals = useMemo(() => {
    const running = data?.crates.filter((c) => c.running) ?? [];
    return {
      count: running.length,
      memory: running.reduce((n, c) => n + c.memory_bytes, 0),
      cpu: running.reduce((n, c) => n + c.cpu_percent, 0),
    };
  }, [data?.crates]);

  const cpuBreakdown = useMemo((): CpuBreakdownRow[] => {
    if (!data) return [];
    const rows: CpuBreakdownRow[] = [];

    for (const d of data.docker_containers ?? []) {
      rows.push({
        id: `docker-${d.container}`,
        label: d.service,
        kind: "docker",
        cpu_percent: d.cpu_percent,
        memory_bytes: d.memory_bytes,
        detail: d.container,
      });
    }

    for (const c of data.crates) {
      if (!c.running || c.embedded) continue;
      rows.push({
        id: `crate-${c.crate_name}`,
        label: c.crate_name,
        kind: "process",
        cpu_percent: c.cpu_percent,
        memory_bytes: c.memory_bytes,
        detail: c.pid != null ? `PID ${c.pid}` : undefined,
      });
    }

    return rows.sort((a, b) => b.cpu_percent - a.cpu_percent);
  }, [data]);

  const cpuBreakdownTotal = useMemo(
    () => cpuBreakdown.reduce((n, r) => n + r.cpu_percent, 0),
    [cpuBreakdown],
  );

  const cpu = data?.process.cpu_percent ?? 0;
  const memBar = memBarPct(data?.process.memory_bytes ?? 0);

  return (
    <>
      <PageHeader
        title={t("healthPage.title")}
        description={t("healthPage.subtitle")}
      />

      {error && <p className="error">{error}</p>}
      {loading && !data && !error && <p className="muted">{t("healthPage.loading")}</p>}

      {data && (
        <>
          <div className="health-actions-panel">
            <h2 className="health-actions-panel__title">{t("healthPage.actionsTitle")}</h2>
            <div className="health-actions-panel__row">
              <Button type="button" variant="secondary" size="sm" disabled={jobsBusy} onClick={() => void handleCancelJobs()}>
                <OctagonX size={14} aria-hidden />
                {t("healthPage.cancelJobs")}
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={jobsBusy} onClick={() => void handleClearEnrichment()}>
                {t("healthPage.clearEnrichment")}
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={jobsBusy} onClick={() => void handleRestartEnrichment()}>
                <RefreshCw size={14} aria-hidden />
                {t("healthPage.restartEnrichment")}
              </Button>
            </div>
            {jobsMsg && <p className="muted text-sm">{jobsMsg}</p>}
            <h3 className="health-actions-panel__title">{t("healthPage.failedRunsTitle")}</h3>
            {failedRuns.length === 0 ? (
              <p className="muted text-sm">{t("healthPage.noFailedRuns")}</p>
            ) : (
              <ul className="health-failed-runs">
                {failedRuns.map((run) => (
                  <li key={run.id} className="health-failed-runs__item">
                    <div>
                      <strong>{run.rule_name}</strong>
                      <span className="muted"> · {run.started_at.slice(0, 16)}</span>
                      <div className="health-failed-runs__error">{run.error}</div>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/rules?edit=${run.rule_id}`}>{t("healthPage.openRule")}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="health-summary-strip" role="group" aria-label="Platform summary">
            <div className={`health-summary-card health-summary-card--${data.postgres.status === "ok" ? "ok" : "warn"}`}>
              <p className="health-summary-card__label">{t("healthPage.postgres")}</p>
              <p className="health-summary-card__value">{data.postgres.status}</p>
            </div>
            <div className={`health-summary-card health-summary-card--${data.clickhouse.status === "ok" ? "ok" : "warn"}`}>
              <p className="health-summary-card__label">{t("healthPage.clickhouse")}</p>
              <p className="health-summary-card__value">{data.clickhouse.status}</p>
            </div>
            <div className="health-summary-card">
              <p className="health-summary-card__label">{t("healthPage.apiCpu")}</p>
              <p className="health-summary-card__value">{cpu.toFixed(1)}%</p>
            </div>
            <div className="health-summary-card">
              <p className="health-summary-card__label">{t("healthPage.cratesRunning")}</p>
              <p className="health-summary-card__value">{totals.count}</p>
            </div>
            <div className="health-summary-card">
              <p className="health-summary-card__label">{t("healthPage.pendingIngest")}</p>
              <p className="health-summary-card__value">{data.pending_ingest_jobs}</p>
            </div>
            <div className="health-summary-card">
              <p className="health-summary-card__label">{t("healthPage.failedRules24h")}</p>
              <p className="health-summary-card__value">{data.failed_rules_24h}</p>
            </div>
          </div>

          {cpuBreakdown.length > 0 && (
            <section className="card health-section">
              <header className="health-section-header">
                <div>
                  <h2 className="health-section-title">
                    <Cpu size={16} aria-hidden />
                    CPU by component
                  </h2>
                  <p className="muted health-panel-sub">
                    Docker services (ClickHouse, Postgres) and mobipwn processes on this host ·{" "}
                    {cpuBreakdownTotal.toFixed(1)}% combined
                  </p>
                </div>
              </header>
              <ul className="health-cpu-breakdown">
                {cpuBreakdown.map((row) => (
                  <li key={row.id} className="health-cpu-breakdown__row">
                    <div className="health-cpu-breakdown__head">
                      <span className="health-cpu-breakdown__label">
                        {row.label}
                        <span className={`badge health-cpu-breakdown__kind badge-${row.kind === "docker" ? "live" : ""}`}>
                          {row.kind === "docker" ? "docker" : "process"}
                        </span>
                      </span>
                      <span className="health-cpu-breakdown__stats mono">
                        {row.cpu_percent.toFixed(1)}% · {formatBytes(row.memory_bytes)}
                      </span>
                    </div>
                    <div className="health-meter health-meter--breakdown" aria-hidden>
                      <div
                        className={`health-meter-fill ${meterClass(row.cpu_percent, "cpu")}`}
                        style={{ width: `${Math.min(row.cpu_percent, 100)}%` }}
                      />
                    </div>
                    {row.detail && <span className="muted health-cpu-breakdown__detail mono">{row.detail}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card health-process-panel">
            <header className="health-section-header">
              <h2>API process (this request)</h2>
              <span className="muted health-process-meta">
                {data.process.name} · PID {data.process.pid}
              </span>
            </header>

            <div className="health-process-grid">
              <div className="health-metric">
                <div className="health-metric-label">
                  <Cpu size={14} aria-hidden />
                  CPU
                </div>
                <div className="health-metric-value">{cpu.toFixed(1)}%</div>
                <div className="health-meter" aria-hidden>
                  <div
                    className={`health-meter-fill ${meterClass(cpu, "cpu")}`}
                    style={{ width: `${Math.min(cpu, 100)}%` }}
                  />
                </div>
              </div>

              <div className="health-metric">
                <div className="health-metric-label">
                  <HardDrive size={14} aria-hidden />
                  Memory (RSS)
                </div>
                <div className="health-metric-value">{formatBytes(data.process.memory_bytes)}</div>
                <div className="health-meter" aria-hidden>
                  <div
                    className={`health-meter-fill ${meterClass(memBar, "mem")}`}
                    style={{ width: `${memBar}%` }}
                  />
                </div>
              </div>

              <div className="health-metric">
                <div className="health-metric-label">
                  <Timer size={14} aria-hidden />
                  Uptime
                </div>
                <div className="health-metric-value">{formatUptime(data.process.uptime_secs)}</div>
              </div>
            </div>
          </section>

          <section className="card health-section">
            <header className="health-section-header">
              <div>
                <h2 className="health-section-title">Mobipwn crates</h2>
                <p className="muted health-panel-sub">
                  {totals.count} running · {formatBytes(totals.memory)} RSS total ·{" "}
                  {totals.cpu.toFixed(1)}% CPU combined
                </p>
              </div>
            </header>

            <div className="health-table-wrap">
              <table className="data-table ops-compact-table health-crate-table">
                <thead>
                  <tr>
                    <th>Crate</th>
                    <th>Status</th>
                    <th>PID</th>
                    <th>CPU</th>
                    <th>Memory</th>
                    <th>Uptime</th>
                  </tr>
                </thead>
                <tbody>
                  {data.crates.map((c) => (
                    <tr key={c.crate_name} className={c.running ? "" : "health-crate-row--stopped"}>
                      <td className="mono health-crate-name">{c.crate_name}</td>
                      <td>
                        <span className={`badge ${c.running ? "badge-live" : ""}`}>
                          {c.embedded && c.running
                            ? "embedded"
                            : c.running
                              ? "running"
                              : "stopped"}
                        </span>
                      </td>
                      <td className="mono muted">{c.pid ?? "—"}</td>
                      <td>
                        {c.running && !c.embedded ? (
                          <div className="health-inline-metric">
                            <span>{c.cpu_percent.toFixed(1)}%</span>
                            <div className="health-meter health-meter--inline" aria-hidden>
                              <div
                                className={`health-meter-fill ${meterClass(c.cpu_percent, "cpu")}`}
                                style={{ width: `${Math.min(c.cpu_percent, 100)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {c.running && !c.embedded ? (
                          <div className="health-inline-metric">
                            <span>{formatBytes(c.memory_bytes)}</span>
                            <div className="health-meter health-meter--inline" aria-hidden>
                              <div
                                className={`health-meter-fill ${meterClass(memBarPct(c.memory_bytes), "mem")}`}
                                style={{ width: `${memBarPct(c.memory_bytes)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="muted">
                        {c.running ? formatUptime(c.uptime_secs) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card health-section">
            <header className="health-section-header">
              <div>
                <h2 className="health-section-title">
                  <Database size={16} aria-hidden />
                  Database storage
                </h2>
                <p className="muted health-panel-sub">
                  On-disk size from Postgres catalog and ClickHouse <code className="mono">system.parts</code>
                </p>
              </div>
            </header>

            <div className="health-db-grid">
              <div className="health-db-panel">
                <header className="health-db-panel-header">
                  <h3>Postgres</h3>
                  <span className={`badge ${data.storage.postgres.status === "up" ? "badge-live" : ""}`}>
                    {data.storage.postgres.status}
                  </span>
                </header>
                <div className="health-db-total">
                  <span className="muted">Database total</span>
                  <span className="health-db-total-value">
                    {formatBytes(data.storage.postgres.database_bytes)}
                  </span>
                </div>
                <StorageTable tables={data.storage.postgres.tables} />
              </div>

              <div className="health-db-panel">
                <header className="health-db-panel-header">
                  <h3>
                    ClickHouse · <span className="mono">{data.storage.clickhouse.database}</span>
                  </h3>
                  <span
                    className={`badge ${
                      data.storage.clickhouse.status === "up" ? "badge-live" : ""
                    }`}
                  >
                    {data.storage.clickhouse.status}
                  </span>
                </header>
                <div className="health-db-total">
                  <span className="muted">Database total</span>
                  <span className="health-db-total-value">
                    {formatBytes(data.storage.clickhouse.database_bytes)}
                  </span>
                </div>
                {data.storage.clickhouse.status === "up" && (
                  <p className="muted health-db-rows-total">
                    {formatRows(data.storage.clickhouse.total_rows)} rows across all tables
                  </p>
                )}
                <StorageTable tables={data.storage.clickhouse.tables} />
              </div>
            </div>
          </section>

          {data.auth && (
            <section className="card health-section">
              <header className="health-section-header">
                <div>
                  <h2 className="health-section-title">
                    <Users size={16} aria-hidden />
                    Authentication
                  </h2>
                  <p className="muted health-panel-sub">
                    Passwords stored as {data.auth.password_storage.toUpperCase()} hashes ·{" "}
                    {data.auth.total_users} local users · {data.auth.active_sessions} active session
                    {data.auth.active_sessions === 1 ? "" : "s"}
                  </p>
                </div>
              </header>

              <div className="stat-grid" style={{ marginBottom: 16 }}>
                <div className="stat-card">
                  <div className="muted">Connected now</div>
                  <div className="stat-value">{data.auth.connected.length}</div>
                </div>
                <div className="stat-card">
                  <div className="muted">Last login</div>
                  <div className="stat-value text-sm">
                    {data.auth.recent_logins[0]
                      ? formatWhen(data.auth.recent_logins[0].last_login_at)
                      : "—"}
                  </div>
                  {data.auth.recent_logins[0] && (
                    <p className="muted health-service-detail">
                      {data.auth.recent_logins[0].username}
                    </p>
                  )}
                </div>
              </div>

              <h3 className="text-sm font-medium" style={{ margin: "0 0 8px" }}>
                Active sessions
              </h3>
              {data.auth.connected.length === 0 ? (
                <p className="muted inbox-empty">No users currently signed in.</p>
              ) : (
                <div className="health-table-wrap">
                  <table className="data-table ops-compact-table health-crate-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th>Signed in</th>
                        <th>Last seen</th>
                        <th>Expires</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.auth.connected.map((s) => (
                        <tr key={`${s.username}-${s.session_started}`}>
                          <td className="mono">{s.username}</td>
                          <td>{s.role}</td>
                          <td className="muted">{formatWhen(s.session_started)}</td>
                          <td className="muted">{formatWhen(s.last_seen_at)}</td>
                          <td className="muted">{formatWhen(s.expires_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 className="text-sm font-medium" style={{ margin: "16px 0 8px" }}>
                Recent logins
              </h3>
              {data.auth.recent_logins.length === 0 ? (
                <p className="muted inbox-empty">No login activity recorded yet.</p>
              ) : (
                <div className="health-table-wrap">
                  <table className="data-table ops-compact-table health-crate-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th>Last login</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.auth.recent_logins.map((u) => (
                        <tr key={`${u.username}-${u.last_login_at}`}>
                          <td className="mono">{u.username}</td>
                          <td>{u.role}</td>
                          <td className="muted">{formatWhen(u.last_login_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section className="card health-section">
            <header className="health-section-header">
              <div>
                <h2 className="health-section-title">LLM & MCP</h2>
                <p className="muted health-panel-sub">
                  In-app assistant (LLM), Cursor MCP server, and API-key traffic from MCP clients and scripts.
                </p>
              </div>
            </header>

            <div className="health-integrations-grid">
              <div className="health-integration-panel">
                <header className="health-integration-panel__head">
                  <Bot size={16} aria-hidden />
                  <h3>LLM assistant</h3>
                  <span
                    className={`badge ${
                      data.integrations.llm.configured ? "badge-live" : ""
                    }`}
                  >
                    {data.integrations.llm.configured ? "configured" : "not configured"}
                  </span>
                </header>
                <dl className="health-integration-meta">
                  <div>
                    <dt>Model</dt>
                    <dd className="mono">{data.integrations.llm.model || "—"}</dd>
                  </div>
                  <div>
                    <dt>API URL</dt>
                    <dd className="mono health-integration-url" title={data.integrations.llm.api_url}>
                      {data.integrations.llm.api_url || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>API key</dt>
                    <dd>{data.integrations.llm.api_key_set ? "set" : "not set"}</dd>
                  </div>
                  <div>
                    <dt>Local</dt>
                    <dd>{data.integrations.llm.local ? "yes" : "no"}</dd>
                  </div>
                </dl>
              </div>

              <div className="health-integration-panel">
                <header className="health-integration-panel__head">
                  <Plug size={16} aria-hidden />
                  <h3>MCP server</h3>
                  <span
                    className={`badge ${
                      data.integrations.mcp.running
                        ? "badge-live"
                        : data.integrations.mcp.status === "error"
                          ? "badge-critical"
                          : ""
                    }`}
                  >
                    {data.integrations.mcp.status}
                  </span>
                </header>
                <dl className="health-integration-meta">
                  <div>
                    <dt>PID</dt>
                    <dd className="mono">{data.integrations.mcp.pid ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Auto-start</dt>
                    <dd>{data.integrations.mcp.auto_start ? "on" : "off"}</dd>
                  </div>
                  <div>
                    <dt>Binary</dt>
                    <dd>{data.integrations.mcp.binary_found ? "found" : "missing"}</dd>
                  </div>
                  <div>
                    <dt>API URL</dt>
                    <dd className="mono health-integration-url" title={data.integrations.mcp.api_url}>
                      {data.integrations.mcp.api_url || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>API key</dt>
                    <dd>{data.integrations.mcp.api_key_set ? "set" : "not set"}</dd>
                  </div>
                  {data.integrations.mcp.started_at && (
                    <div>
                      <dt>Started</dt>
                      <dd className="muted">{formatWhen(data.integrations.mcp.started_at)}</dd>
                    </div>
                  )}
                </dl>
                {data.integrations.mcp.last_error && (
                  <p className="muted health-integration-error">{data.integrations.mcp.last_error}</p>
                )}
              </div>
            </div>

            <div className="health-api-keys-usage">
              <header className="health-integration-panel__head">
                <KeyRound size={16} aria-hidden />
                <h3>API key traffic</h3>
              </header>
              <p className="muted health-panel-sub" style={{ margin: "0 0 12px" }}>
                MCP and script clients authenticate with per-user API keys — each request updates these counters.
              </p>
              <div className="stat-grid" style={{ marginBottom: 16 }}>
                <div className="stat-card">
                  <div className="muted">Active keys</div>
                  <div className="stat-value">{data.integrations.api_keys.active_keys}</div>
                </div>
                <div className="stat-card">
                  <div className="muted">Suspended</div>
                  <div className="stat-value">{data.integrations.api_keys.suspended_keys}</div>
                </div>
                <div className="stat-card">
                  <div className="muted">Total requests</div>
                  <div className="stat-value">
                    {data.integrations.api_keys.total_requests.toLocaleString()}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="muted">Response data</div>
                  <div className="stat-value">
                    {formatBytes(data.integrations.api_keys.total_response_bytes)}
                  </div>
                </div>
              </div>

              {data.integrations.api_keys.by_user && data.integrations.api_keys.by_user.length > 0 ? (
                <div className="health-table-wrap">
                  <table className="data-table ops-compact-table health-crate-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Keys</th>
                        <th>Requests</th>
                        <th>Data out</th>
                        <th>Last used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.integrations.api_keys.by_user.map((row) => (
                        <tr key={row.user_id ?? row.username}>
                          <td className="mono">{row.username}</td>
                          <td className="mono">{row.active_keys}</td>
                          <td className="mono">{row.request_count.toLocaleString()}</td>
                          <td className="mono">{formatBytes(row.response_bytes)}</td>
                          <td className="muted">{formatWhen(row.last_used_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted inbox-empty">
                  {data.integrations.api_keys.total_requests > 0
                    ? "Per-user breakdown requires admin access."
                    : "No API key traffic recorded yet."}
                </p>
              )}
            </div>
          </section>

          <section className="health-section">
            <h2 className="health-section-title">Services</h2>
            <div className="stat-grid">
              <div className="stat-card health-service-card">
                <div className="muted">Postgres</div>
                <div className={`health-status ${statusClass(data.postgres.status)}`}>
                  {data.postgres.status}
                </div>
                {data.postgres.detail && (
                  <p className="muted health-service-detail">{data.postgres.detail}</p>
                )}
              </div>
              <div className="stat-card health-service-card">
                <div className="muted">ClickHouse</div>
                <div className={`health-status ${statusClass(data.clickhouse.status)}`}>
                  {data.clickhouse.status}
                </div>
                {data.clickhouse.detail && (
                  <p className="muted health-service-detail">{data.clickhouse.detail}</p>
                )}
              </div>
            </div>
          </section>

          <section className="health-section">
            <h2 className="health-section-title">Operations</h2>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="muted">Alerting rules</div>
                <div className="stat-value">{data.alerting_rules}</div>
              </div>
              <div className="stat-card">
                <div className="muted">Failed runs (24h)</div>
                <div className={`stat-value${data.failed_rules_24h > 0 ? " health-stat-warn" : ""}`}>
                  {data.failed_rules_24h}
                </div>
              </div>
              <div className="stat-card">
                <div className="muted">Pending ingest jobs</div>
                <div className={`stat-value${data.pending_ingest_jobs > 0 ? " health-stat-warn" : ""}`}>
                  {data.pending_ingest_jobs}
                </div>
              </div>
            </div>
            <div className="health-jobs-control">
              <p className="muted health-jobs-control-hint">
                Stuck enrichment sync banner or runaway background work? Cancel signals mobipwn-jobs
                to stop the current enrichment sync and marks in-flight ingest DB jobs as
                failed. Restart <code className="mono">mobipwn-jobs</code> from your shell if the
                process itself needs a fresh start.
              </p>
              <Button variant="secondary" size="sm" onClick={() => void handleCancelJobs()} disabled={jobsBusy}>
                <OctagonX size={14} aria-hidden />
                {jobsBusy ? "Cancelling…" : "Cancel all running jobs"}
              </Button>
              {jobsMsg && <p className="muted health-jobs-control-msg">{jobsMsg}</p>}
            </div>
          </section>
        </>
      )}
    </>
  );
}
