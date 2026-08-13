import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLocale } from "@/contexts/LocaleContext";
import { parseIronSiftError } from "@/lib/ironsiftActivity";
import {
  machineSearchHref,
  promoteIronSiftFindingAlert,
  resolveIngestSourceForMachine,
  saveIronSiftTriage,
  type IronSiftFinding,
  type IronSiftScopeOptions,
  type IronSiftTriageRecord,
  type ScopeFilter,
} from "@/lib/ironsift";
import { parseProcessExamples, processFindingStats } from "@/lib/processFindingDisplay";
import { ProcessFindingReason } from "@/components/ironsift/ProcessFindingReason";

function triageKey(findingId: string, detector: string, reason: string) {
  return `${findingId}|${detector}|${reason}`;
}

function findingIdentity(f: IronSiftFinding): string {
  if (f.id) return `${f.id}|${f.machine_id}|${f.detector}`;
  return `${f.machine_id}|${f.detector}|${f.score}|${f.severity}`;
}

function dedupeFindings(findings: IronSiftFinding[]): IronSiftFinding[] {
  const seen = new Set<string>();
  const out: IronSiftFinding[] = [];
  for (const f of findings) {
    const id = findingIdentity(f);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(f);
  }
  return out;
}

function severityRank(severity: string): number {
  switch (severity.toUpperCase()) {
    case "CRITICAL":
      return 4;
    case "HIGH":
      return 3;
    case "MEDIUM":
      return 2;
    case "LOW":
      return 1;
    default:
      return 0;
  }
}

function severityClass(severity: string): string {
  switch (severity.toUpperCase()) {
    case "CRITICAL":
      return "ironsift-severity ironsift-severity--critical";
    case "HIGH":
      return "ironsift-severity ironsift-severity--high";
    case "MEDIUM":
      return "ironsift-severity ironsift-severity--medium";
    case "LOW":
      return "ironsift-severity ironsift-severity--low";
    default:
      return "ironsift-severity";
  }
}

function severityStripeClass(severity: string): string {
  switch (severity.toUpperCase()) {
    case "CRITICAL":
      return "ironsift-stripe--critical";
    case "HIGH":
      return "ironsift-stripe--high";
    case "MEDIUM":
      return "ironsift-stripe--medium";
    case "LOW":
      return "ironsift-stripe--low";
    default:
      return "";
  }
}

function formatDetector(detector: string): string {
  return detector.replace(/_/g, " ");
}

function isTriagedVerdict(verdict: string): boolean {
  return verdict === "false_positive" || verdict === "malicious";
}

function MachineSearchLink({
  machineId,
  scopeFilter,
  scopeOptions,
}: {
  machineId: string;
  scopeFilter?: ScopeFilter | null;
  scopeOptions?: IronSiftScopeOptions | null;
}) {
  const { t } = useLocale();
  if (!scopeFilter) return null;

  const source = resolveIngestSourceForMachine(scopeOptions ?? null, scopeFilter, machineId);
  if (!source) return null;

  return (
    <Link
      to={machineSearchHref(source, machineId)}
      className="ironsift-machine-search-link"
      title={t("ironsift.searchMachineData", { source, machine: machineId })}
      onClick={(e) => e.stopPropagation()}
    >
      {t("ironsift.searchMachine")}
    </Link>
  );
}

type MachineGroup = {
  machine_id: string;
  findings: IronSiftFinding[];
  maxScore: number;
  topSeverity: string;
};

type FindingRow = {
  rowKey: string;
  finding: IronSiftFinding;
  reason: string;
  reasonIndex: number;
};

type ViewMode = "grouped" | "table";

function FindingReason({ detector, reason }: { detector: string; reason: string }) {
  if (detector === "ironsift-process") {
    return <ProcessFindingReason reason={reason} />;
  }
  return <ReasonText text={reason} />;
}

function ProcessFindingMeta({ rawJson }: { rawJson?: Record<string, unknown> | null }) {
  const { t } = useLocale();
  const stats = processFindingStats(rawJson);
  const examples = parseProcessExamples(rawJson);
  const parts: string[] = [];

  if (stats.processCount != null) {
    parts.push(t("ironsift.processFindingProcesses", { count: stats.processCount }));
  }
  if (stats.suspiciousCount != null) {
    parts.push(t("ironsift.processFindingSuspicious", { count: stats.suspiciousCount }));
  }
  if (stats.clusterId != null) {
    parts.push(t("ironsift.processFindingCluster", { id: String(stats.clusterId) }));
  }
  if (stats.distanceScore != null) {
    parts.push(t("ironsift.processFindingDistance", { score: stats.distanceScore.toFixed(2) }));
  }
  if (parts.length === 0 && examples.length === 0) return null;

  return (
    <div className="ironsift-finding__process-meta">
      {parts.length > 0 && <span className="muted text-xs">{parts.join(" · ")}</span>}
      {examples.length > 0 && (
        <ul className="ironsift-process-examples">
          {examples.map((ex, i) => (
            <li key={`${ex.pid}-${ex.name}-${i}`} className="ironsift-process-examples__item">
              <span className="mono">PID {ex.pid}</span>
              {ex.ppid > 0 && <span className="mono muted">PPID {ex.ppid}</span>}
              {ex.uid > 0 && <span className="mono muted">UID {ex.uid}</span>}
              <span className="ironsift-process-examples__name">{ex.name}</span>
              {ex.path && <span className="mono ironsift-process-examples__path">{ex.path}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReasonText({ text }: { text: string }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const limit = 180;
  const long = text.length > limit;

  if (!long) {
    return <p className="ironsift-reason-text">{text}</p>;
  }

  return (
    <div>
      <p className="ironsift-reason-text">{expanded ? text : `${text.slice(0, limit)}…`}</p>
      <button
        type="button"
        className="ironsift-inline-link ironsift-reason-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? t("ironsift.findingsReasonCollapse") : t("ironsift.findingsReasonExpand")}
      </button>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  if (verdict === "false_positive") {
    return <span className="ironsift-verdict ironsift-verdict--fp">FP</span>;
  }
  if (verdict === "malicious") {
    return <span className="ironsift-verdict ironsift-verdict--mal">Mal</span>;
  }
  return null;
}

function TriageSegment({
  verdict,
  disabled,
  onFp,
  onMal,
  onClear,
}: {
  verdict: string;
  disabled: boolean;
  onFp: () => void;
  onMal: () => void;
  onClear: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="ironsift-triage-segment" role="group">
      <button
        type="button"
        className={verdict === "false_positive" ? "active" : ""}
        disabled={disabled}
        title={t("ironsift.findingsVerdictFp")}
        onClick={onFp}
      >
        FP
      </button>
      <button
        type="button"
        className={verdict === "malicious" ? "active" : ""}
        disabled={disabled}
        title={t("ironsift.findingsVerdictMal")}
        onClick={onMal}
      >
        Mal
      </button>
      <button
        type="button"
        className="ironsift-triage-segment__clear"
        disabled={disabled || verdict === "unset"}
        title={t("ironsift.findingsVerdictClear")}
        onClick={onClear}
      >
        ×
      </button>
    </div>
  );
}

export function FindingsTable({
  runId,
  findings,
  triage,
  scopeFilter,
  scopeOptions,
  canWrite,
  focusRequest,
  onTriageSaved,
  onTriageMessage,
  onTriageError,
}: {
  runId: string;
  findings: IronSiftFinding[];
  triage: IronSiftTriageRecord[];
  scopeFilter?: ScopeFilter | null;
  scopeOptions?: IronSiftScopeOptions | null;
  canWrite: boolean;
  focusRequest?: { machineId: string; at: number } | null;
  onTriageSaved?: () => void;
  onTriageMessage?: (message: string) => void;
  onTriageError?: (message: string) => void;
}) {
  const { t } = useLocale();
  const normalizedFindings = useMemo(() => dedupeFindings(findings), [findings]);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [hideAlerted, setHideAlerted] = useState(false);
  const [hideTriaged, setHideTriaged] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    findings.length > 35 ? "table" : "grouped"
  );
  const [highlightMachineId, setHighlightMachineId] = useState<string | null>(null);
  const hostRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    setCollapsed({});
    setQuery("");
    setSeverityFilter("");
    setHideAlerted(false);
    setHideTriaged(true);
    setHighlightMachineId(null);
  }, [runId]);

  useEffect(() => {
    const focusMachineId = focusRequest?.machineId;
    if (!focusMachineId) return;
    if (!normalizedFindings.some((f) => f.machine_id === focusMachineId)) return;

    setViewMode("grouped");
    setQuery("");
    setSeverityFilter("");
    setHideAlerted(false);
    setHighlightMachineId(focusMachineId);

    const hostIds = [...new Set(normalizedFindings.map((f) => f.machine_id))];
    const next: Record<string, boolean> = {};
    for (const id of hostIds) {
      next[id] = id !== focusMachineId;
    }
    setCollapsed(next);
  }, [focusRequest, normalizedFindings]);

  useEffect(() => {
    if (!highlightMachineId) return;
    const timer = window.setTimeout(() => {
      hostRefs.current.get(highlightMachineId)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }, 80);
    const clearTimer = window.setTimeout(() => setHighlightMachineId(null), 2800);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightMachineId, collapsed, viewMode]);

  const verdictMap = useMemo(
    () =>
      new Map(
        triage.map((tr) => [triageKey(tr.finding_id, tr.detector, tr.reason), tr.verdict])
      ),
    [triage]
  );

  const visibleReasons = useCallback(
    (finding: IronSiftFinding): string[] => {
      if (!hideTriaged) return finding.reasons;
      return finding.reasons.filter((reason) => {
        const verdict = verdictMap.get(triageKey(finding.id, finding.detector, reason)) ?? "unset";
        return !isTriagedVerdict(verdict);
      });
    },
    [hideTriaged, verdictMap]
  );

  const triageAlertMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const tr of triage) {
      if (tr.alert_id) {
        map.set(triageKey(tr.finding_id, tr.detector, tr.reason), tr.alert_id);
      }
    }
    return map;
  }, [triage]);

  function resolveReasonAlertId(finding: IronSiftFinding, reason: string): string | undefined {
    const perReason = triageAlertMap.get(triageKey(finding.id, finding.detector, reason));
    if (perReason) return perReason;
    if (finding.alert_id) return finding.alert_id;
    return undefined;
  }

  function findingHasAlert(finding: IronSiftFinding): boolean {
    if (finding.alert_id) return true;
    return finding.reasons.some((reason) =>
      triageAlertMap.has(triageKey(finding.id, finding.detector, reason))
    );
  }

  function findingFullyAlerted(finding: IronSiftFinding): boolean {
    if (finding.alert_id) return true;
    if (finding.reasons.length === 0) return false;
    return finding.reasons.every((reason) =>
      triageAlertMap.has(triageKey(finding.id, finding.detector, reason))
    );
  }

  const filteredFindings = useMemo(() => {
    return normalizedFindings.filter((f) => {
      if (hideAlerted && findingFullyAlerted(f)) return false;
      if (hideTriaged && f.reasons.length > 0) {
        const visible = f.reasons.filter((reason) => {
          const verdict = verdictMap.get(triageKey(f.id, f.detector, reason)) ?? "unset";
          return !isTriagedVerdict(verdict);
        });
        if (visible.length === 0) return false;
      }
      if (severityFilter && f.severity.toUpperCase() !== severityFilter) return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (
        f.machine_id.toLowerCase().includes(q) ||
        f.detector.toLowerCase().includes(q) ||
        f.reasons.some((r) => r.toLowerCase().includes(q))
      );
    });
  }, [normalizedFindings, query, severityFilter, hideAlerted, hideTriaged, triageAlertMap, verdictMap]);

  const stats = useMemo(() => {
    const hosts = new Set(normalizedFindings.map((f) => f.machine_id));
    const alerted = normalizedFindings.filter((f) => findingHasAlert(f)).length;
    const severities = normalizedFindings.reduce(
      (acc, f) => {
        const key = f.severity.toUpperCase();
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    return { hosts: hosts.size, alerted, severities };
  }, [normalizedFindings, triageAlertMap]);

  const groups = useMemo(() => {
    const byMachine = new Map<string, IronSiftFinding[]>();
    for (const f of filteredFindings) {
      const list = byMachine.get(f.machine_id) ?? [];
      list.push(f);
      byMachine.set(f.machine_id, list);
    }

    const out: MachineGroup[] = [];
    for (const [machine_id, list] of byMachine) {
      const sorted = [...list].sort((a, b) => b.score - a.score);
      const topSeverity = sorted.reduce(
        (best, f) => (severityRank(f.severity) > severityRank(best) ? f.severity : best),
        sorted[0]?.severity ?? "LOW"
      );
      out.push({
        machine_id,
        findings: sorted,
        maxScore: sorted[0]?.score ?? 0,
        topSeverity,
      });
    }
    return out.sort((a, b) => b.maxScore - a.maxScore);
  }, [filteredFindings]);

  const tableRows = useMemo(() => {
    const rows: FindingRow[] = [];
    let rowSeq = 0;
    const keyPrefix = runId;
    const sorted = [...filteredFindings].sort((a, b) => {
      const sev = severityRank(b.severity) - severityRank(a.severity);
      if (sev !== 0) return sev;
      return b.score - a.score;
    });
    for (const finding of sorted) {
      const reasons = visibleReasons(finding);
      if (reasons.length === 0) {
        rows.push({
          rowKey: `${keyPrefix}-row-${rowSeq++}`,
          finding,
          reason: "",
          reasonIndex: 0,
        });
        continue;
      }
      reasons.forEach((reason, reasonIndex) => {
        rows.push({
          rowKey: `${keyPrefix}-row-${rowSeq++}`,
          finding,
          reason,
          reasonIndex,
        });
      });
    }
    return rows;
  }, [filteredFindings, runId, visibleReasons]);

  if (normalizedFindings.length === 0) {
    return <p className="muted">{t("ironsift.findingsEmpty")}</p>;
  }

  async function setVerdict(
    finding: IronSiftFinding,
    reason: string,
    verdict: "false_positive" | "malicious" | "unset"
  ) {
    const key = triageKey(finding.id, finding.detector, reason);
    setBusy(key);
    try {
      await saveIronSiftTriage(runId, [
        { finding_id: finding.id, detector: finding.detector, reason, verdict },
      ]);
      onTriageSaved?.();
      onTriageMessage?.(
        verdict === "unset" ? t("ironsift.triageCleared") : t("ironsift.triageSaved")
      );
    } catch (e) {
      onTriageError?.(parseIronSiftError(e));
    } finally {
      setBusy("");
    }
  }

  async function promoteAlert(finding: IronSiftFinding, reason: string, rowKey: string) {
    setBusy(`alert-${rowKey}`);
    try {
      await promoteIronSiftFindingAlert(runId, finding.id, reason);
      onTriageSaved?.();
      onTriageMessage?.(t("ironsift.findingPromoted"));
    } catch (e) {
      onTriageError?.(parseIronSiftError(e));
    } finally {
      setBusy("");
    }
  }

  const defaultCollapsed = filteredFindings.length > 12;

  function isGroupCollapsed(machineId: string) {
    return collapsed[machineId] ?? defaultCollapsed;
  }

  function toggleGroup(machineId: string) {
    setCollapsed((prev) => {
      const currentlyCollapsed = prev[machineId] ?? defaultCollapsed;
      if (currentlyCollapsed) {
        const next: Record<string, boolean> = {};
        for (const g of groups) {
          next[g.machine_id] = g.machine_id !== machineId;
        }
        return next;
      }
      return { ...prev, [machineId]: true };
    });
  }

  function expandAll() {
    const next: Record<string, boolean> = {};
    for (const g of groups) next[g.machine_id] = false;
    setCollapsed(next);
  }

  function collapseAll() {
    const next: Record<string, boolean> = {};
    for (const g of groups) next[g.machine_id] = true;
    setCollapsed(next);
  }
  const shownCount = filteredFindings.length;

  function renderReasonAlertAction(f: IronSiftFinding, reason: string, rowKey: string) {
    const alertId = resolveReasonAlertId(f, reason);
    if (alertId) {
      return (
        <Link className="ironsift-alert-link" to={`/alerts?highlight=${alertId}`}>
          {t("ironsift.viewAlert")}
        </Link>
      );
    }
    if (canWrite) {
      return (
        <button
          type="button"
          className="ironsift-alert-link ironsift-alert-link--action"
          disabled={busy === `alert-${rowKey}`}
          onClick={() => void promoteAlert(f, reason, rowKey)}
        >
          {t("ironsift.promoteFindingAlert")}
        </button>
      );
    }
    return null;
  }

  return (
    <div className="ironsift-findings">
      <div className="ironsift-findings-bar">
        <input
          className="ironsift-findings-search"
          type="search"
          placeholder={t("ironsift.findingsSearchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="ironsift-findings-bar__chips">
          {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((level) =>
            stats.severities[level] ? (
              <button
                key={level}
                type="button"
                className={`ironsift-findings-sev-chip ${severityClass(level)}${
                  severityFilter === level ? " ironsift-findings-sev-chip--active" : ""
                }`}
                onClick={() => setSeverityFilter((cur) => (cur === level ? "" : level))}
              >
                {level} <span className="ironsift-findings-sev-chip__n">{stats.severities[level]}</span>
              </button>
            ) : null
          )}
        </div>
        <label className="ironsift-findings-bar__check">
          <input
            type="checkbox"
            checked={hideAlerted}
            onChange={(e) => setHideAlerted(e.target.checked)}
          />
          <span>{t("ironsift.findingsHideAlerted")}</span>
        </label>
        <label className="ironsift-findings-bar__check">
          <input
            type="checkbox"
            checked={hideTriaged}
            onChange={(e) => setHideTriaged(e.target.checked)}
          />
          <span>{t("ironsift.findingsHideTriaged")}</span>
        </label>
        <div className="ironsift-findings-bar__views">
          <button
            type="button"
            className={viewMode === "grouped" ? "active" : ""}
            onClick={() => setViewMode("grouped")}
          >
            {t("ironsift.findingsViewGrouped")}
          </button>
          <button
            type="button"
            className={viewMode === "table" ? "active" : ""}
            onClick={() => setViewMode("table")}
          >
            {t("ironsift.findingsViewTable")}
          </button>
          {viewMode === "grouped" && groups.length > 1 && (
            <>
              <span className="ironsift-findings-bar__sep" aria-hidden />
              <button type="button" className="ironsift-findings-aux" onClick={expandAll}>
                {t("ironsift.findingsExpandAll")}
              </button>
              <button type="button" className="ironsift-findings-aux" onClick={collapseAll}>
                {t("ironsift.findingsCollapseAll")}
              </button>
            </>
          )}
        </div>
      </div>

      <p className="ironsift-findings-summary muted text-xs">
        {t("ironsift.findingsShowing", { shown: shownCount, total: normalizedFindings.length })}
        {" · "}
        {t("ironsift.findingsStatHosts", { count: stats.hosts })}
        {" · "}
        {t("ironsift.findingsStatAlerted", { count: stats.alerted })}
      </p>

      <div className="ironsift-findings-body">
        {shownCount === 0 ? (
          <p className="muted">{t("ironsift.findingsFilterEmpty")}</p>
        ) : viewMode === "table" ? (
          <div className="ironsift-findings-table-wrap">
            <table className="data-table ironsift-findings-table">
              <thead>
                <tr>
                  <th>{t("ironsift.colSeverity")}</th>
                  <th>{t("ironsift.colMachine")}</th>
                  <th>{t("ironsift.colDetector")}</th>
                  <th>{t("ironsift.colScore")}</th>
                  <th>{t("ironsift.colReasons")}</th>
                  <th>{t("ironsift.colTriage")}</th>
                  <th>{t("ironsift.colAlert")}</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map(({ rowKey, finding: f, reason, reasonIndex }) => {
                  const triageId = reason
                    ? triageKey(f.id, f.detector, reason)
                    : `noreason|${rowKey}`;
                  const verdict = reason ? verdictMap.get(triageId) ?? "unset" : "unset";
                  return (
                    <tr key={rowKey} className={severityStripeClass(f.severity)}>
                      <td>
                        <span className={severityClass(f.severity)}>{f.severity}</span>
                      </td>
                      <td className="mono ironsift-findings-table__host">
                        <span>{f.machine_id}</span>
                        <MachineSearchLink
                          machineId={f.machine_id}
                          scopeFilter={scopeFilter}
                          scopeOptions={scopeOptions}
                        />
                      </td>
                      <td>
                        <span className="ironsift-detector" title={f.detector}>
                          {formatDetector(f.detector)}
                        </span>
                      </td>
                      <td className="mono ironsift-findings-table__score">{f.score.toFixed(2)}</td>
                      <td className="ironsift-findings-table__reason">
                        {reason ? (
                          <FindingReason detector={f.detector} reason={reason} />
                        ) : (
                          <span className="muted text-xs">{t("ironsift.findingsNoReason")}</span>
                        )}
                      </td>
                      <td>
                        {reason &&
                          (canWrite ? (
                            <TriageSegment
                              verdict={verdict}
                              disabled={busy === triageId}
                              onFp={() => void setVerdict(f, reason, "false_positive")}
                              onMal={() => void setVerdict(f, reason, "malicious")}
                              onClear={() => void setVerdict(f, reason, "unset")}
                            />
                          ) : (
                            <VerdictBadge verdict={verdict} />
                          ))}
                      </td>
                      <td>{reason ? renderReasonAlertAction(f, reason, rowKey) : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          groups.map((group, groupIndex) => {
            const isCollapsed = isGroupCollapsed(group.machine_id);
            const isExpanded = !isCollapsed;
            const groupKey = `${runId}-group-${groupIndex}`;
            return (
              <section
                key={groupKey}
                ref={(el) => {
                  if (el) hostRefs.current.set(group.machine_id, el);
                  else hostRefs.current.delete(group.machine_id);
                }}
                className={`ironsift-host-group ${severityStripeClass(group.topSeverity)}${
                  isExpanded ? " ironsift-host-group--open" : ""
                }${highlightMachineId === group.machine_id ? " ironsift-host-group--focus" : ""}`}
              >
                <div className="ironsift-host-group__header">
                  <button
                    type="button"
                    className="ironsift-host-row"
                    onClick={() => toggleGroup(group.machine_id)}
                  >
                    <span className="ironsift-host-row__chev" aria-hidden>
                      {isCollapsed ? "▸" : "▾"}
                    </span>
                    <span className="mono ironsift-host-row__name">{group.machine_id}</span>
                    <span className={severityClass(group.topSeverity)}>{group.topSeverity}</span>
                    <span className="ironsift-host-row__count">
                      {t("ironsift.findingsHostCount", { count: group.findings.length })}
                    </span>
                    <span className="mono ironsift-host-row__score">{group.maxScore.toFixed(2)}</span>
                  </button>
                  <MachineSearchLink
                    machineId={group.machine_id}
                    scopeFilter={scopeFilter}
                    scopeOptions={scopeOptions}
                  />
                </div>
                {!isCollapsed && (
                  <div className="ironsift-host-group__body">
                    {group.findings.map((f, findingIndex) => {
                      const findingKey = `${groupKey}-finding-${findingIndex}`;
                      return (
                      <article
                        key={findingKey}
                        className={`ironsift-finding${findingHasAlert(f) ? " ironsift-finding--alerted" : ""}`}
                      >
                        <header className="ironsift-finding__head">
                          <span className={severityClass(f.severity)}>{f.severity}</span>
                          <span className="ironsift-detector" title={f.detector}>
                            {formatDetector(f.detector)}
                          </span>
                          <span className="mono ironsift-finding__score">{f.score.toFixed(2)}</span>
                        </header>
                        {f.detector === "ironsift-process" && (
                          <ProcessFindingMeta rawJson={f.raw_json} />
                        )}
                        <ul className="ironsift-finding__reasons">
                          {f.reasons.length === 0 ? (
                            <li key={`${findingKey}-noreason`} className="ironsift-finding__reason">
                              <span className="muted text-xs">{t("ironsift.findingsNoReason")}</span>
                            </li>
                          ) : (
                          visibleReasons(f).map((reason, reasonIndex) => {
                            const triageId = triageKey(f.id, f.detector, reason);
                            const rowKey = `${findingKey}-reason-${reasonIndex}`;
                            const verdict = verdictMap.get(triageId) ?? "unset";
                            return (
                              <li key={rowKey} className="ironsift-finding__reason">
                                <div className="ironsift-finding__reason-main">
                                  <FindingReason detector={f.detector} reason={reason} />
                                  {!canWrite && <VerdictBadge verdict={verdict} />}
                                </div>
                                <div className="ironsift-finding__reason-actions">
                                  {canWrite ? (
                                    <TriageSegment
                                      verdict={verdict}
                                      disabled={busy === triageId}
                                      onFp={() => void setVerdict(f, reason, "false_positive")}
                                      onMal={() => void setVerdict(f, reason, "malicious")}
                                      onClear={() => void setVerdict(f, reason, "unset")}
                                    />
                                  ) : (
                                    verdict !== "unset" && (
                                      <span className="muted text-xs">{verdict}</span>
                                    )
                                  )}
                                  {renderReasonAlertAction(f, reason, rowKey)}
                                </div>
                              </li>
                            );
                          }))}
                        </ul>
                      </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
