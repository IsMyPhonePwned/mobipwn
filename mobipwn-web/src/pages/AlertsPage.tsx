import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { User, Search, ClipboardCheck, Ban, RefreshCw } from "lucide-react";
import { ShareShortLink } from "@/components/ShareShortLink";
import { AlertDetailDrawer, type AlertDetail } from "@/components/alerts/AlertDetailDrawer";
import { AlertActionIconButton, AlertActionIconLink } from "@/components/alerts/AlertActionIcon";
import { DetectionRuleHelp } from "@/components/alerts/DetectionRuleHelp";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { CompactDataTable } from "@/components/ui/CompactDataTable";
import { FalsePositiveDialog } from "@/components/alerts/FalsePositiveDialog";
import { useLocale } from "@/contexts/LocaleContext";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { alertHuntHref, alertResolutionLabel, alertStatusBadgeClass, alertStatusLabel, alertStatusNormalized, alertDisplayTitle, alertSampleSummary } from "@/lib/alertTriage";
import { useAuth } from "@/contexts/AuthContext";
import { authHeaders } from "@/lib/auth";
import { deleteAlerts, deleteAlertsByFilter } from "@/lib/alerts";
import { useDocumentVisible } from "@/lib/useDocumentVisible";

type AlertContext = AlertDetail["context"];

type Alert = AlertDetail & {
  rule_id?: string;
  rule_name: string;
  dismissed_at?: string | null;
};

type FacetGroup = {
  alert_id: string;
  rule_id: string;
  rule_name: string;
  dedup_key: string;
  facet_label: string;
  status: string;
  title: string;
  severity: string;
  event_count: number;
  first_seen?: string;
  last_seen: string;
  opened_at?: string;
  resolved_at?: string | null;
  resolution_count?: number;
  sample_event_id?: string | null;
  assignee?: string | null;
  tags?: string[];
  context?: AlertContext;
  dismissed_at?: string | null;
  case_id?: string | null;
  case_title?: string | null;
};

type RuleMeta = {
  name: string;
  lifecycle: string;
  mode: string;
  enabled?: boolean;
};

function statusBadge(status: string) {
  return alertStatusBadgeClass(status);
}

function severityBarClass(severity: string) {
  const s = severity.toLowerCase();
  if (s === "critical") return "alerts-sev-bar--critical";
  if (s === "high") return "alerts-sev-bar--high";
  if (s === "medium") return "alerts-sev-bar--medium";
  return "alerts-sev-bar--low";
}

function deleteReasonPrompt(count: number, defaultReason: string): string | null {
  const reason = window.prompt(
    `Permanently delete ${count} alert(s)?\n\n` +
      "A full snapshot and activity history will be saved to the deletion audit log.\n\n" +
      "Reason (optional):",
    defaultReason
  );
  if (reason === null) return null;
  return reason.trim() || defaultReason;
}

export default function AlertsPage() {
  const { log } = useActivityLog();
  const { t } = useLocale();
  const { user } = useAuth();
  const tabVisible = useDocumentVisible();
  const [searchParams, setSearchParams] = useSearchParams();
  const caseIdFilter = searchParams.get("case_id") || "";
  const caseTitleFilter = searchParams.get("case_title") || "";
  const mine = searchParams.get("mine") === "1";
  const deepLinkId = searchParams.get("id") || "";
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [groups, setGroups] = useState<FacetGroup[]>([]);
  const [view, setView] = useState<"grouped" | "list">("grouped");
  const [rulesByName, setRulesByName] = useState<Map<string, RuleMeta>>(new Map());
  const [filter, setFilter] = useState("open");
  const [showDismissed, setShowDismissed] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [fpTarget, setFpTarget] = useState<{
    id: string;
    ruleId?: string | null;
    ruleName?: string;
    facetLabel?: string;
  } | null>(null);

  const [allAlerts, setAllAlerts] = useState<Alert[]>([]);
  const [myCount, setMyCount] = useState(0);

  const setMine = useCallback(
    (on: boolean) => {
      const next = new URLSearchParams(searchParams);
      if (on) next.set("mine", "1");
      else next.delete("mine");
      setSearchParams(next);
    },
    [searchParams, setSearchParams]
  );

  const setDetailIdInUrl = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set("id", id);
      else next.delete("id");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const closeDetail = useCallback(() => {
    setDetail(null);
    setDetailIdInUrl(null);
  }, [setDetailIdInUrl]);

  const counts = useMemo(() => {
    const c = { new: 0, triaged: 0, verified: 0, false_positive: 0, open: 0, total: allAlerts.length };
    for (const a of allAlerts) {
      const status = alertStatusNormalized(a.status);
      if (status === "new") c.new++;
      else if (status === "triaged") c.triaged++;
      else if (status === "verified") c.verified++;
      else if (status === "false_positive") c.false_positive++;
    }
    c.open = c.new + c.triaged;
    return c;
  }, [allAlerts]);

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/rules");
      if (!res.ok) return;
      const list = (await res.json()) as RuleMeta[];
      setRulesByName(new Map(list.map((r) => [r.name, r])));
    } catch {
      setRulesByName(new Map());
    }
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter && filter !== "all") params.set("status", filter);
    params.set("dismissed", showDismissed ? "dismissed" : "active");
    if (caseIdFilter) params.set("case_id", caseIdFilter);
    if (mine && user) params.set("assignee", "me");
    const q = params.toString();
    const suffix = q ? `?${q}` : "";

    const countParams = new URLSearchParams();
    countParams.set("dismissed", showDismissed ? "dismissed" : "active");
    if (caseIdFilter) countParams.set("case_id", caseIdFilter);
    const countSuffix = `?${countParams.toString()}`;

    const myCountParams = new URLSearchParams();
    myCountParams.set("status", "open");
    myCountParams.set("assignee", "me");
    myCountParams.set("dismissed", "active");
    if (caseIdFilter) myCountParams.set("case_id", caseIdFilter);

    const groupsSuffix = `${suffix}${suffix ? "&" : "?"}by=rule_facet`;
    const fetches: Promise<Response>[] = [
      fetch(`/api/v1/alerts${suffix}`),
      fetch(`/api/v1/alerts/groups${groupsSuffix}`),
      fetch(`/api/v1/alerts${countSuffix}`),
    ];
    if (user) {
      fetches.push(fetch(`/api/v1/alerts?${myCountParams.toString()}`));
    }
    const [alertsRes, groupsRes, countsRes, myCountRes] = await Promise.all(fetches);
    const alertsData = await alertsRes.json();
    if (!alertsRes.ok) {
      setError(JSON.stringify(alertsData));
      return;
    }
    setAlerts(alertsData);
    if (countsRes.ok) {
      setAllAlerts(await countsRes.json());
    }
    if (myCountRes?.ok) {
      const mineAlerts = (await myCountRes.json()) as Alert[];
      setMyCount(mineAlerts.length);
    } else if (!user) {
      setMyCount(0);
    }
    if (groupsRes.ok) {
      const g = await groupsRes.json();
      setGroups(g.groups ?? []);
    }
    setError("");
  }, [filter, showDismissed, caseIdFilter, mine, user]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  useEffect(() => {
    if (!deepLinkId || detail?.id === deepLinkId) return;
    let cancelled = false;
    void fetch(`/api/v1/alerts/${deepLinkId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<Alert>;
      })
      .then((a) => {
        if (cancelled) return;
        setDetail({
          id: a.id,
          rule_id: a.rule_id,
          rule_name: a.rule_name,
          status: a.status,
          title: a.title,
          severity: a.severity,
          event_count: a.event_count,
          last_seen: a.last_seen,
          dedup_key: a.dedup_key,
          facet_label: a.facet_label,
          sample_event_id: a.sample_event_id,
          assignee: a.assignee,
          tags: a.tags,
          context: a.context,
          dismissed_at: a.dismissed_at,
          case_id: a.case_id,
          case_title: a.case_title,
        });
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [deepLinkId, detail?.id]);

  useEffect(() => {
    load();
    if (!tabVisible) return;
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load, tabVisible]);

  useEffect(() => {
    if (tabVisible) load();
  }, [tabVisible, load]);

  const patchStatus = async (id: string, status: string, comment?: string) => {
    const res = await fetch(`/api/v1/alerts/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(comment ? { comment } : {}) }),
    });
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    if ((alertStatusNormalized(status) === "verified" || status === "false_positive") && detail?.id === id) {
      closeDetail();
    }
    await load();
  };

  const openFalsePositive = (row: { alert_id?: string; id?: string; rule_id?: string; rule_name?: string; facet_label?: string }) => {
    const id = row.alert_id ?? row.id;
    if (!id) return;
    setFpTarget({
      id,
      ruleId: row.rule_id,
      ruleName: row.rule_name,
      facetLabel: row.facet_label,
    });
  };

  const muteRule = async (ruleId: string, minutes: number) => {
    await fetch(`/api/v1/rules/${ruleId}/mute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes }),
    });
  };

  const bulkStatus = async (status: string) => {
    const ids = [...selected];
    if (!ids.length) return;
    log("info", `Bulk alert ${status}`, `${ids.length} ids`);
    const res = await fetch("/api/v1/alerts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      updated?: number;
      skipped?: number;
      failed?: number;
    };
    if (!res.ok) {
      setError(JSON.stringify(data));
      return;
    }
    const updated = data.updated ?? 0;
    const failed = data.failed ?? 0;
    if (failed > 0) {
      setError(
        `Updated ${updated} of ${ids.length} alert(s) to ${status} (${failed} failed)`
      );
    } else if (updated === 0) {
      setError(`No alerts were updated to ${status}`);
    } else {
      setError(null);
    }
    setSelected(new Set());
    await load();
  };

  const bulkAssignToMe = async () => {
    const ids = [...selected];
    const username = user?.username?.trim();
    if (!ids.length || !username) return;
    log("info", `Assign ${ids.length} alert(s) to me`);
    try {
      for (const id of ids) {
        const res = await fetch(`/api/v1/alerts/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ assignee: username }),
        });
        if (!res.ok) {
          setError(await res.text());
          return;
        }
      }
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const dismissSelected = async () => {
    const ids = [...selected];
    if (!ids.length || !window.confirm(`Dismiss ${ids.length} alert(s)? They can be restored from the dismissed view.`)) return;
    for (const id of ids) {
      const res = await fetch(`/api/v1/alerts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
    }
    setSelected(new Set());
    closeDetail();
    await load();
  };

  const deleteOpts = () => ({
    author: user?.username,
    reason: undefined as string | undefined,
  });

  const deleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const reason = deleteReasonPrompt(ids.length, "bulk delete from alerts page");
    if (reason === null) return;
    try {
      log("info", `Delete ${ids.length} alert(s)`, reason);
      await deleteAlerts(ids, { ...deleteOpts(), reason });
      setSelected(new Set());
      closeDetail();
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteAllFalsePositives = async () => {
    const count = filter === "false_positive" ? filteredCount : counts.false_positive;
    if (count === 0) return;
    const reason = deleteReasonPrompt(count, "false positive cleanup");
    if (reason === null) return;
    try {
      log("info", `Delete all false positive alerts`, `${count} requested`);
      await deleteAlertsByFilter({ status: "false_positive" }, { ...deleteOpts(), reason });
      setSelected(new Set());
      closeDetail();
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const restoreSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    for (const id of ids) {
      const res = await fetch(`/api/v1/alerts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: false }),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
    }
    setSelected(new Set());
    closeDetail();
    await load();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDetail = (row: FacetGroup | Alert) => {
    const id = "alert_id" in row ? row.alert_id : row.id;
    setDetailIdInUrl(id);
    setDetail({
      id,
      rule_id: row.rule_id,
      rule_name: row.rule_name,
      status: row.status,
      title: row.title,
      severity: row.severity,
      event_count: row.event_count,
      last_seen: row.last_seen,
      dedup_key: "dedup_key" in row ? row.dedup_key : undefined,
      facet_label: "facet_label" in row ? row.facet_label : undefined,
      sample_event_id: "alert_id" in row ? row.sample_event_id : row.sample_event_id,
      assignee: row.assignee,
      tags: row.tags,
      context: row.context,
      dismissed_at: "dismissed_at" in row ? row.dismissed_at : undefined,
      case_id: "case_id" in row ? row.case_id : undefined,
      case_title: "case_title" in row ? row.case_title : undefined,
    });
  };

  const rows = view === "grouped" ? groups : alerts;
  const rowIds = rows.map((r) => ("alert_id" in r ? r.alert_id : r.id));
  const filteredCount = rows.length;

  return (
    <>
      <PageHeader
        title={t("alertsPage.title")}
        description={
          <>
            {t("alertsPage.subtitlePrefix")}{" "}
            <Link to="/rules">{t("nav.rules")}</Link> {t("alertsPage.subtitleSuffix")}
          </>
        }
        actions={
          <>
            {user && (
              <Button
                type="button"
                variant={mine ? "default" : "outline"}
                size="sm"
                className={`alerts-mine-btn${mine ? " alerts-mine-btn--active" : ""}`}
                onClick={() => setMine(!mine)}
              >
                <User size={14} aria-hidden />
                My alerts to handle
                {myCount > 0 && <span className="alerts-mine-count">{myCount}</span>}
              </Button>
            )}
            <Button variant="secondary" size="sm" asChild>
              <Link to="/rules">Manage rules</Link>
            </Button>
          </>
        }
      />

      <DetectionRuleHelp />

      {caseIdFilter && (
        <p className="alerts-case-filter">
          Filtering by case: <strong>{caseTitleFilter || caseIdFilter}</strong>{" "}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              searchParams.delete("case_id");
              searchParams.delete("case_title");
              setSearchParams(searchParams);
            }}
          >
            Clear
          </button>
          <Link to={`/cases/${caseIdFilter}`} className="btn btn-ghost btn-sm">
            Open case
          </Link>
        </p>
      )}

      {mine && user && (
        <p className="alerts-mine-banner">
          Showing open alerts assigned to <strong>{user.username}</strong> — your personal triage queue.
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMine(false)}>
            Show all assignees
          </button>
        </p>
      )}

      {showDismissed && (
        <p className="alerts-dismissed-banner muted">
          Viewing dismissed alerts — hidden from the default triage queue. Select alerts and use Restore to bring them back.
        </p>
      )}

      <div className="stat-grid ops-stat-grid alerts-stat-grid">
        {(["open", "new", "triaged", "verified", "false_positive", "all"] as const).map((st) => (
          <button
            key={st}
            type="button"
            className={`stat-card alerts-stat-card${filter === st ? " alerts-stat-card--active" : ""}`}
            onClick={() => setFilter(st)}
          >
            <div className="stat-value">
              {st === "open"
                ? counts.open
                : st === "all"
                  ? counts.total
                  : st === "new"
                    ? counts.new
                    : st === "triaged"
                      ? counts.triaged
                      : st === "verified"
                        ? counts.verified
                        : counts.false_positive}
            </div>
            <div className="muted">
              {st === "open" ? (
                "Triage queue"
              ) : st === "all" ? (
                "All alerts"
              ) : (
                <span className={`badge ${statusBadge(st)}`}>{alertStatusLabel(st)}</span>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className={`alerts-layout${detail ? " alerts-layout--detail" : ""}`}>
        <section className="card alerts-main-panel">
          {error && <p className="error">{error}</p>}
          <div className="toolbar ops-toolbar alerts-toolbar">
            <div className="alerts-view-toggle">
              <button
                type="button"
                className={view === "grouped" ? "active" : ""}
                onClick={() => setView("grouped")}
              >
                Grouped
              </button>
              <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
                List
              </button>
            </div>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status">
              <option value="open">Triage queue (new + triaged)</option>
              <option value="new">new</option>
              <option value="triaged">triaged</option>
              <option value="verified">verified</option>
              <option value="false_positive">false positive</option>
              <option value="all">All statuses</option>
            </select>
            <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
              <RefreshCw size={14} aria-hidden />
              Refresh
            </Button>
            <label className="alerts-dismissed-toggle">
              <input
                type="checkbox"
                checked={showDismissed}
                onChange={(e) => {
                  setShowDismissed(e.target.checked);
                  setSelected(new Set());
                  closeDetail();
                }}
              />
              Show dismissed
            </label>
            {(filter === "false_positive" || counts.false_positive > 0) && !showDismissed && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void deleteAllFalsePositives()}
                title="Permanently remove all false positive alerts (audit log preserved)"
              >
                Delete all FPs ({counts.false_positive})
              </button>
            )}
            {selected.size > 0 && !showDismissed && (
              <>
                {user && (
                  <button
                    type="button"
                    className="btn btn-secondary alerts-bulk-assign-me"
                    onClick={() => void bulkAssignToMe()}
                    title={`Assign ${selected.size} selected alert(s) to ${user.username}`}
                  >
                    <User size={14} aria-hidden />
                    Assign to me ({selected.size})
                  </button>
                )}
                <button type="button" className="btn" onClick={() => void bulkStatus("triaged")}>
                  Triage ({selected.size})
                </button>
                <button type="button" className="btn" onClick={() => void bulkStatus("verified")}>
                  Verify ({selected.size})
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => void bulkStatus("false_positive")}>
                  False positive ({selected.size})
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void dismissSelected()}>
                  Dismiss ({selected.size})
                </button>
                <button
                  type="button"
                  className="btn btn-ghost delete-ingest-btn"
                  onClick={() => void deleteSelected()}
                  title="Permanently delete — full history saved to audit log"
                >
                  Delete ({selected.size})
                </button>
              </>
            )}
            {selected.size > 0 && showDismissed && (
              <>
                <button type="button" className="btn" onClick={() => void restoreSelected()}>
                  Restore ({selected.size})
                </button>
                <button
                  type="button"
                  className="btn btn-ghost delete-ingest-btn"
                  onClick={() => void deleteSelected()}
                >
                  Delete ({selected.size})
                </button>
              </>
            )}
          </div>

          <div className="alerts-table-wrap">
            <CompactDataTable className="alerts-compact-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={rowIds.length > 0 && selected.size === rowIds.length}
                      onChange={(e) => {
                        if (e.target.checked) setSelected(new Set(rowIds));
                        else setSelected(new Set());
                      }}
                    />
                  </th>
                  <th style={{ width: 4 }} aria-hidden />
                  <th>Rule</th>
                  {view === "grouped" && <th className="col-facet">Facet</th>}
                  <th>Status</th>
                  <th>Hits</th>
                  <th className="col-assignee">Assignee</th>
                  <th className="col-resolution">Resolution</th>
                  <th className="col-last-seen">Last seen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {view === "grouped"
                  ? groups.map((g) => {
                      return (
                        <tr
                          key={g.alert_id}
                          className={detail?.id === g.alert_id ? "selected" : ""}
                          onClick={() => openDetail(g)}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected.has(g.alert_id)}
                              onChange={() => toggleSelect(g.alert_id)}
                            />
                          </td>
                          <td
                            className={`alerts-sev-bar ${severityBarClass(g.severity)}`}
                            aria-label={g.severity}
                            title={g.severity}
                          />
                          <td className="alerts-title-cell" title={alertDisplayTitle(g)}>
                            <span className="alerts-rule-name">{alertDisplayTitle(g)}</span>
                            {alertSampleSummary(g) && (
                              <span className="muted text-xs alerts-sample-summary" title={alertSampleSummary(g)!}>
                                {alertSampleSummary(g)}
                              </span>
                            )}
                          </td>
                          {view === "grouped" && (
                          <td className="mono alerts-facet-cell col-facet" title={g.facet_label}>
                            {g.facet_label}
                          </td>
                          )}
                          <td>
                            <span className={`badge ${statusBadge(g.status)}`}>{alertStatusLabel(g.status)}</span>
                          </td>
                          <td>{g.event_count}</td>
                          <td className="muted col-assignee">{g.assignee || "—"}</td>
                          <td className="muted alerts-resolution-cell col-resolution" title={alertResolutionLabel(g)}>
                            {alertResolutionLabel(g)}
                          </td>
                          <td className="muted col-last-seen">{g.last_seen.slice(0, 19)}</td>
                          <td className="alerts-row-actions" onClick={(e) => e.stopPropagation()}>
                            <ShareShortLink id={g.alert_id} kind="alert" variant="icon" />
                            {alertHuntHref(g.context) && (
                              <AlertActionIconLink
                                title="Hunt similar events"
                                to={alertHuntHref(g.context)!}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Search size={15} aria-hidden />
                              </AlertActionIconLink>
                            )}
                            {g.status === "new" && (
                              <AlertActionIconButton
                                title="Triage"
                                variant="primary"
                                onClick={() => void patchStatus(g.alert_id, "triaged")}
                              >
                                <ClipboardCheck size={15} aria-hidden />
                              </AlertActionIconButton>
                            )}
                            {(g.status === "new" || g.status === "triaged") && (
                              <AlertActionIconButton
                                title="False positive"
                                onClick={() => openFalsePositive(g)}
                              >
                                <Ban size={15} aria-hidden />
                              </AlertActionIconButton>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  : alerts.map((a) => {
                      return (
                        <tr
                          key={a.id}
                          className={detail?.id === a.id ? "selected" : ""}
                          onClick={() => openDetail(a)}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} />
                          </td>
                          <td
                            className={`alerts-sev-bar ${severityBarClass(a.severity)}`}
                            aria-label={a.severity}
                            title={a.severity}
                          />
                          <td className="alerts-title-cell" title={alertDisplayTitle(a)}>
                            <span className="alerts-rule-name">{alertDisplayTitle(a)}</span>
                            {alertSampleSummary(a) && (
                              <span className="muted text-xs alerts-sample-summary" title={alertSampleSummary(a)!}>
                                {alertSampleSummary(a)}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${statusBadge(a.status)}`}>{alertStatusLabel(a.status)}</span>
                          </td>
                          <td>{a.event_count}</td>
                          <td className="muted col-assignee">{a.assignee || "—"}</td>
                          <td className="muted alerts-resolution-cell col-resolution" title={alertResolutionLabel(a)}>
                            {alertResolutionLabel(a)}
                          </td>
                          <td className="muted col-last-seen">{a.last_seen.slice(0, 19)}</td>
                          <td className="alerts-row-actions" onClick={(e) => e.stopPropagation()}>
                            <ShareShortLink id={a.id} kind="alert" variant="icon" />
                            {alertHuntHref(a.context) && (
                              <AlertActionIconLink
                                title="Hunt similar events"
                                to={alertHuntHref(a.context)!}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Search size={15} aria-hidden />
                              </AlertActionIconLink>
                            )}
                            {a.status === "new" && (
                              <AlertActionIconButton
                                title="Triage"
                                variant="primary"
                                onClick={() => void patchStatus(a.id, "triaged")}
                              >
                                <ClipboardCheck size={15} aria-hidden />
                              </AlertActionIconButton>
                            )}
                            {(a.status === "new" || a.status === "triaged") && (
                              <AlertActionIconButton
                                title="False positive"
                                onClick={() => openFalsePositive(a)}
                              >
                                <Ban size={15} aria-hidden />
                              </AlertActionIconButton>
                            )}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </CompactDataTable>
          </div>
          {rows.length === 0 && !error && (
            <div className="alerts-empty muted">
              <p>{showDismissed ? "No dismissed alerts." : "No alerts in this view."}</p>
            </div>
          )}
        </section>

        {detail && (
          <AlertDetailDrawer
            alert={detail}
            showDismissed={showDismissed}
            onClose={closeDetail}
            onUpdated={() => void load()}
            onDeleted={() => void load()}
          />
        )}
      </div>

      <FalsePositiveDialog
        open={!!fpTarget}
        ruleId={fpTarget?.ruleId}
        ruleName={fpTarget?.ruleName}
        facetLabel={fpTarget?.facetLabel}
        onClose={() => setFpTarget(null)}
        onConfirm={async ({ comment }) => {
          if (!fpTarget) return;
          await patchStatus(fpTarget.id, "false_positive", comment);
          setFpTarget(null);
        }}
        onMuteRule={fpTarget?.ruleId ? muteRule : undefined}
      />
    </>
  );
}
