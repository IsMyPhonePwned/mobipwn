import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Database,
  FolderSearch,
  Inbox,
  Layers,
  RefreshCw,
  Search,
  Shield,
  Store,
  Upload,
} from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentVisible } from "@/lib/useDocumentVisible";
import { useLocale } from "@/contexts/LocaleContext";
import { alertHuntHref, alertStatusBadgeClass, alertStatusLabel, alertDisplayTitle, alertSampleSummary } from "@/lib/alertTriage";
import { apiFetch } from "@/lib/api";
import { formatRelativeCompact } from "@/lib/formatRelative";
import { Button } from "@/components/ui/button";

type Overview = {
  events_24h: number;
  alerts_new: number;
  rules_total: number;
  rules_alerting: number;
  providers_enabled: number;
  mudm_fields_covered: number;
};

type VelocityBucket = { bucket_start: string; count: number };

type FleetHealth = {
  total: number;
  healthy: number;
  slow: number;
  errors: number;
};

type AlertQueueItem = {
  alert_id: string;
  rule_name: string;
  title: string;
  severity: string;
  status: string;
  facet_label: string;
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

type CaseRecord = {
  id: string;
  title: string;
  status: string;
  priority: string;
  alert_count: number;
  updated_at: string;
  tags?: string[];
  event_count?: number;
};

type DataSummary = {
  total_events: number;
  sources: { source: string }[];
};

function severityClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === "critical") return "badge-critical";
  if (s === "high") return "badge-alerting";
  if (s === "medium") return "badge-triaged";
  return "";
}

function isIngestedCase(c: CaseRecord): boolean {
  return (c.tags?.includes("ingested") ?? false) || (c.event_count ?? 0) > 0;
}

function VelocitySpark({ buckets }: { buckets: VelocityBucket[] }) {
  const bars = useMemo(() => {
    if (!buckets.length) return Array(24).fill(0);
    return buckets.map((b) => b.count);
  }, [buckets]);
  const max = Math.max(...bars, 1);
  return (
    <div className="rules-velocity-spark home-velocity-spark" aria-hidden>
      {bars.map((v, i) => (
        <div
          key={i}
          className="rules-velocity-bar"
          style={{
            height: `${Math.max(8, (v / max) * 100)}%`,
            background:
              v >= max * 0.7
                ? "var(--primary)"
                : v > 0
                  ? "color-mix(in srgb, var(--primary) 50%, transparent)"
                  : "color-mix(in srgb, var(--foreground) 10%, transparent)",
          }}
          title={`${v} alert${v === 1 ? "" : "s"}`}
        />
      ))}
    </div>
  );
}

function FleetHealthBar({ fleetHealth }: { fleetHealth: FleetHealth | null }) {
  const total = fleetHealth?.total ?? 0;
  const healthy = fleetHealth?.healthy ?? 0;
  const slow = fleetHealth?.slow ?? 0;
  const errors = fleetHealth?.errors ?? 0;
  const hasData = fleetHealth != null && total > 0;
  const pct = hasData ? Math.round((healthy / total) * 100) : null;
  const healthyPct = hasData ? (healthy / total) * 100 : 0;
  const slowPct = hasData ? (slow / total) * 100 : 0;
  const errorPct = hasData ? (errors / total) * 100 : 0;

  return (
    <div className="home-fleet-block">
      <div className="home-fleet-head">
        <span className="home-fleet-pct">{pct == null ? "—" : `${pct}%`}</span>
        <span className="muted home-fleet-meta">
          {hasData ? `${total} scheduled` : "—"}
        </span>
      </div>
      <div className="rules-fleet-health-bar">
        {healthyPct > 0 && (
          <div className="rules-fleet-health-seg healthy" style={{ width: `${healthyPct}%` }} />
        )}
        {slowPct > 0 && <div className="rules-fleet-health-seg slow" style={{ width: `${slowPct}%` }} />}
        {errorPct > 0 && (
          <div className="rules-fleet-health-seg error" style={{ width: `${errorPct}%` }} />
        )}
      </div>
      <div className="rules-fleet-health-legend home-fleet-legend">
        <span>
          <span className="rules-fleet-health-dot healthy" /> {healthy}
        </span>
        <span>
          <span className="rules-fleet-health-dot slow" /> {slow}
        </span>
        <span>
          <span className="rules-fleet-health-dot error" /> {errors}
        </span>
      </div>
    </div>
  );
}

const QUICK_LINKS = [
  { to: "/search", icon: Search, labelKey: "nav.search" as const, descKey: "overview.quickSearch" as const },
  { to: "/ingest", icon: Upload, labelKey: "nav.ingest" as const, descKey: "overview.quickIngest" as const },
  { to: "/inbox", icon: Inbox, labelKey: "nav.investigate" as const, descKey: "overview.quickInvestigate" as const },
  { to: "/rules", icon: Shield, labelKey: "nav.rules" as const, descKey: "overview.quickRules" as const },
  { to: "/marketplace", icon: Store, labelKey: "nav.marketplace" as const, descKey: "overview.quickMarketplace" as const },
  { to: "/search/guide", icon: BookOpen, labelKey: "nav.searchGuide" as const, descKey: "overview.quickGuide" as const },
  { to: "/guide/architecture", icon: Layers, labelKey: "nav.archGuide" as const, descKey: "overview.quickArch" as const },
] as const;

export default function OverviewPage() {
  const { log } = useActivityLog();
  const { user } = useAuth();
  const tabVisible = useDocumentVisible();
  const { t } = useLocale();
  const [stats, setStats] = useState<Overview | null>(null);
  const [velocity, setVelocity] = useState<VelocityBucket[]>([]);
  const [fleetHealth, setFleetHealth] = useState<FleetHealth | null>(null);
  const [newAlerts, setNewAlerts] = useState<AlertQueueItem[]>([]);
  const [myAlerts, setMyAlerts] = useState<AlertQueueItem[]>([]);
  const [myAlertCount, setMyAlertCount] = useState(0);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [openCaseCount, setOpenCaseCount] = useState(0);
  const [sourceCount, setSourceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const myAlertsUrl =
        "/api/v1/alerts/groups?status=open&assignee=me&dismissed=active&by=rule_facet";
      const [overviewRes, velocityRes, fleetRes, alertsRes, myAlertsRes, casesRes, dataRes] =
        await Promise.all([
          fetch("/api/v1/overview").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/v1/alerts/velocity?hours=24").then((r) =>
            r.ok ? r.json() : [],
          ),
          fetch("/api/v1/rules/fleet-health").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/v1/alerts/groups?status=new&dismissed=active&by=rule_facet").then((r) =>
            r.ok ? r.json() : { groups: [] },
          ),
          user
            ? fetch(myAlertsUrl).then((r) => (r.ok ? r.json() : { groups: [] }))
            : Promise.resolve({ groups: [] }),
          apiFetch<CaseRecord[]>("/v1/cases"),
          apiFetch<DataSummary>("/v1/data/summary").catch(() => null),
        ]);

      setStats(overviewRes as Overview | null);
      setVelocity(Array.isArray(velocityRes) ? velocityRes : []);
      setFleetHealth(fleetRes as FleetHealth | null);
      setNewAlerts((alertsRes.groups ?? []).slice(0, 6));
      const mineGroups = (myAlertsRes.groups ?? []) as AlertQueueItem[];
      setMyAlertCount(mineGroups.length);
      setMyAlerts(mineGroups.slice(0, 6));

      const openCases = casesRes
        .filter((c) => c.status !== "closed")
        .filter(isIngestedCase)
        .sort((a, b) => {
          if (b.alert_count !== a.alert_count) return b.alert_count - a.alert_count;
          return b.updated_at.localeCompare(a.updated_at);
        });
      setOpenCaseCount(openCases.length);
      setCases(openCases.slice(0, 4));
      setSourceCount(dataRes?.sources?.length ?? 0);

      log("info", "Load home dashboard");
    } catch (e) {
      setError(String(e));
      setStats(null);
      setNewAlerts([]);
      setMyAlerts([]);
      setMyAlertCount(0);
      setCases([]);
      setOpenCaseCount(0);
    } finally {
      setLoading(false);
    }
  }, [log, user]);

  useEffect(() => {
    void load();
    if (!tabVisible) return;
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [load, tabVisible]);

  const alerts24h = useMemo(() => velocity.reduce((n, b) => n + b.count, 0), [velocity]);

  return (
    <>
      <header className="page-header page-header--brand home-page-header">
        <img src="/logo.png" alt="" className="home-brand-logo" aria-hidden />
        <div className="home-page-header-text">
          <h1>{t("overview.title")}</h1>
          <p>{t("overview.subtitle")}</p>
        </div>
        <div className="home-page-actions">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : undefined} aria-hidden />
            {t("common.refresh")}
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link to="/search">
              <Search size={14} aria-hidden />
              {t("nav.search")}
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link to="/inbox">
              <Inbox size={14} aria-hidden />
              {t("nav.investigate")}
            </Link>
          </Button>
        </div>
      </header>

      {error && <p className="error home-page-error">{error}</p>}

      <div className="stat-grid inbox-stat-grid home-stat-grid">
        <Link to="/alerts" className="stat-card inbox-stat-card home-stat-card home-stat-card--alerts">
          <div className="stat-value">{stats?.alerts_new ?? "—"}</div>
          <div className="muted">
            <span className={`badge ${alertStatusBadgeClass("new")}`}>
              {alertStatusLabel("new")}
            </span>{" "}
            {t("overview.newAlerts")}
          </div>
        </Link>
        {user && (
          <Link
            to="/alerts?mine=1"
            className="stat-card inbox-stat-card home-stat-card home-stat-card--mine"
          >
            <div className="stat-value">{myAlertCount > 0 ? myAlertCount : "—"}</div>
            <div className="muted">{t("overview.myAlerts")}</div>
          </Link>
        )}
        <Link to="/rules" className="stat-card inbox-stat-card home-stat-card">
          <div className="stat-value">{stats?.rules_alerting ?? "—"}</div>
          <div className="muted">{t("overview.alertingRules")}</div>
        </Link>
        <Link to="/data" className="stat-card inbox-stat-card home-stat-card">
          <div className="stat-value">{sourceCount || "—"}</div>
          <div className="muted">{t("overview.dataSources")}</div>
        </Link>
        <Link to="/cases/search" className="stat-card inbox-stat-card home-stat-card">
          <div className="stat-value">{openCaseCount > 0 ? openCaseCount : "—"}</div>
          <div className="muted">{t("overview.openCases")}</div>
        </Link>
        <div className="stat-card home-stat-card">
          <div className="stat-value">
            {stats ? stats.events_24h.toLocaleString() : "—"}
          </div>
          <div className="muted">{t("overview.events24h")}</div>
        </div>
        <Link to="/marketplace" className="stat-card inbox-stat-card home-stat-card">
          <div className="stat-value">{stats?.providers_enabled ?? "—"}</div>
          <div className="muted">{t("overview.providersEnabled")}</div>
        </Link>
      </div>

      <div className="home-layout">
        <div className="home-main">
          {user && myAlerts.length > 0 && (
            <section className="card inbox-panel home-panel home-panel--mine">
              <header className="inbox-panel-header">
                <div>
                  <h2 className="inbox-panel-title">{t("overview.myAlerts")}</h2>
                  <p className="muted inbox-panel-sub">{t("overview.myAlertsSub")}</p>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/alerts?mine=1">
                    {t("overview.viewMyAlerts")}
                    <ArrowRight size={14} aria-hidden />
                  </Link>
                </Button>
              </header>
              <div className="home-alert-list">
                {myAlerts.map((a) => {
                  const hunt = alertHuntHref(a.context);
                  return (
                    <div key={a.alert_id} className="home-alert-row home-alert-row--mine">
                      <div className="home-alert-main">
                        <div className="home-alert-title">{alertDisplayTitle(a)}</div>
                        <div className="muted home-alert-meta">
                          {alertSampleSummary(a) && (
                            <>
                              <span className="home-alert-facet" title={alertSampleSummary(a)!}>
                                {alertSampleSummary(a)}
                              </span>
                              <span aria-hidden>·</span>
                            </>
                          )}
                          <span className={`badge ${alertStatusBadgeClass(a.status)}`}>
                            {alertStatusLabel(a.status)}
                          </span>
                        </div>
                      </div>
                      <div className="home-alert-actions">
                        <Button variant="secondary" size="sm" asChild>
                          <Link to="/alerts?mine=1">{t("overview.triage")}</Link>
                        </Button>
                        {hunt && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={hunt}>{t("overview.hunt")}</Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="card inbox-panel home-panel">
            <header className="inbox-panel-header">
              <div>
                <h2 className="inbox-panel-title">
                  <AlertTriangle size={16} aria-hidden />
                  {t("overview.alertQueue")}
                </h2>
                <p className="muted inbox-panel-sub">{t("overview.alertQueueSub")}</p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/alerts">
                  {t("overview.triageAll")}
                  <ArrowRight size={14} aria-hidden />
                </Link>
              </Button>
            </header>

            {loading && newAlerts.length === 0 ? (
              <p className="muted inbox-empty">{t("overview.loadingAlerts")}</p>
            ) : newAlerts.length === 0 ? (
              <div className="inbox-empty">
                <Inbox size={28} className="inbox-empty-icon" aria-hidden />
                <p>{t("overview.noNewAlerts")}</p>
                <Button variant="secondary" size="sm" asChild>
                  <Link to="/rules">{t("overview.reviewRules")}</Link>
                </Button>
              </div>
            ) : (
              <div className="home-alert-list">
                {newAlerts.map((a) => {
                  const hunt = alertHuntHref(a.context);
                  const sev = severityClass(a.severity);
                  return (
                    <div key={a.alert_id} className="home-alert-row">
                      <div className="home-alert-main">
                        <div className="home-alert-title">{alertDisplayTitle(a)}</div>
                        <div className="muted home-alert-meta">
                          {alertSampleSummary(a) && (
                            <>
                              <span className="home-alert-facet" title={alertSampleSummary(a)!}>
                                {alertSampleSummary(a)}
                              </span>
                              <span aria-hidden>·</span>
                            </>
                          )}
                          <span className="mono home-alert-facet" title={a.facet_label}>
                            {a.facet_label}
                          </span>
                          <span aria-hidden>·</span>
                          <span>{a.event_count} hits</span>
                          <span aria-hidden>·</span>
                          <span>{formatRelativeCompact(new Date(a.last_seen))}</span>
                        </div>
                      </div>
                      <div className="home-alert-side">
                        {sev ? (
                          <span className={`badge ${sev}`}>{a.severity}</span>
                        ) : (
                          <span className="muted">{a.severity}</span>
                        )}
                        <div className="home-alert-actions">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to="/alerts">{t("overview.triage")}</Link>
                          </Button>
                          {hunt && (
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={hunt}>{t("overview.hunt")}</Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card inbox-panel home-panel">
            <header className="inbox-panel-header">
              <div>
                <h2 className="inbox-panel-title">
                  <FolderSearch size={16} aria-hidden />
                  {t("overview.openCases")}
                </h2>
                <p className="muted inbox-panel-sub">{t("overview.openCasesSub")}</p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/cases/search">
                  {t("overview.browseCases")}
                  <ArrowRight size={14} aria-hidden />
                </Link>
              </Button>
            </header>

            {loading && cases.length === 0 ? (
              <p className="muted inbox-empty">{t("overview.loadingCases")}</p>
            ) : cases.length === 0 ? (
              <div className="inbox-empty">
                <p>{t("overview.noOpenCases")}</p>
                <Button variant="secondary" size="sm" asChild>
                  <Link to="/ingest">{t("overview.ingestData")}</Link>
                </Button>
              </div>
            ) : (
              <div className="home-case-list">
                {cases.map((c) => (
                  <Link key={c.id} to={`/cases/${c.id}`} className="home-case-row">
                    <div>
                      <div className="home-case-title">{c.title}</div>
                      <div className="muted home-case-meta">
                        {c.status}
                        {c.alert_count > 0 && ` · ${c.alert_count} alerts`}
                      </div>
                    </div>
                    <span className="muted home-case-time">
                      {formatRelativeCompact(new Date(c.updated_at))}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="home-aside">
          <section className="card home-panel home-pulse-panel">
            <header className="home-aside-header">
              <h2 className="home-aside-title">{t("overview.detectionPulse")}</h2>
            </header>
            <div className="home-pulse-body">
              <div className="home-pulse-metric">
                <span className="home-pulse-label">{t("overview.alerts24h")}</span>
                <span className="home-pulse-value">{alerts24h.toLocaleString()}</span>
              </div>
              <VelocitySpark buckets={velocity} />
              <div className="home-pulse-grid">
                <div className="home-pulse-stat">
                  <span className="muted">{t("overview.detectionRules")}</span>
                  <strong>{stats?.rules_total ?? "—"}</strong>
                </div>
                <div className="home-pulse-stat">
                  <span className="muted">{t("overview.mudmFields")}</span>
                  <strong>{stats?.mudm_fields_covered ?? "—"}</strong>
                </div>
              </div>
              <div className="home-pulse-fleet">
                <div className="home-pulse-fleet-label">{t("overview.fleetHealth")}</div>
                <FleetHealthBar fleetHealth={fleetHealth} />
                <p className="muted home-pulse-footnote">{t("overview.fleetHealthFootnote")}</p>
              </div>
              {!stats && !loading && (
                <p className="muted home-start-hint">{t("overview.startHint")}</p>
              )}
            </div>
          </section>

          <section className="card home-panel">
            <header className="home-aside-header">
              <h2 className="home-aside-title">{t("overview.quickStart")}</h2>
              <p className="muted home-aside-sub">{t("overview.quickStartSub")}</p>
            </header>
            <div className="home-quick-grid">
              {QUICK_LINKS.map(({ to, icon: Icon, labelKey, descKey }) => (
                <Link key={to} to={to} className="home-quick-card">
                  <Icon size={18} className="home-quick-icon" aria-hidden />
                  <span className="home-quick-label">{t(labelKey)}</span>
                  <span className="muted home-quick-desc">{t(descKey)}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="card home-panel home-data-panel">
            <header className="home-aside-header">
              <h2 className="home-aside-title">
                <Database size={15} aria-hidden />
                {t("overview.platformHealth")}
              </h2>
            </header>
            <div className="home-data-links">
              <Link to="/data" className="home-data-link">
                {t("nav.data")}
                <ArrowRight size={14} aria-hidden />
              </Link>
              <Link to="/dashboards" className="home-data-link">
                {t("nav.dashboards")}
                <ArrowRight size={14} aria-hidden />
              </Link>
              <Link to="/logs" className="home-data-link">
                {t("nav.logs")}
                <ArrowRight size={14} aria-hidden />
              </Link>
              <Link to="/health" className="home-data-link">
                {t("nav.health")}
                <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
