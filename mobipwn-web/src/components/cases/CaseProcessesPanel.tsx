import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Cpu, Loader2, Plug } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import {
  CASE_PACKAGES_PANEL_ID,
  CASE_PROCESSES_PANEL_ID,
  CASE_IOS_RUNNING_SERVICES_PANEL_ID,
  type CasePlatform,
} from "@/lib/caseDashboard";
import {
  formatCpuPercent,
  formatProcessStarted,
  isIosRegisteredService,
  processRows,
  processesQuery,
  processSummary,
  type ProcessRow,
  type ProcessSort,
} from "@/lib/processSnapshot";
import {
  packageDisplayLabel,
  packageRows,
  packagesQuery,
  packageSearchQuery,
  resolveAndroidProcessPackage,
  type PackageRow,
} from "@/lib/packageSnapshot";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";

type ViewFilter = "all" | "fg" | "bg" | "linked" | "started" | "path";

function processCopyPayload(proc: ProcessRow): string {
  if (proc.commandLine.trim()) return proc.commandLine.trim();
  const parts = [proc.path, proc.args].map((s) => s.trim()).filter(Boolean);
  if (parts.length) return parts.join(" ");
  return proc.name;
}

function CopyValue({
  value,
  label,
  children,
  className,
}: {
  value: string;
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = value.trim();
  const onCopy = useCallback(
    async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!text || text === "—") return;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } catch {
        /* clipboard may be denied */
      }
    },
    [text]
  );
  if (!text || text === "—") {
    return <>{children ?? (text || "—")}</>;
  }
  return (
    <span className={["case-proc-panel__copyable", className].filter(Boolean).join(" ")}>
      {children ?? <span className="case-proc-panel__copyable-text">{text}</span>}
      <button
        type="button"
        className="case-proc-panel__copy"
        title={copied ? "Copied" : `Copy ${label}`}
        aria-label={copied ? "Copied" : `Copy ${label}`}
        onClick={(e) => void onCopy(e)}
      >
        {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
      </button>
    </span>
  );
}

function policyClass(policy: string): string {
  const p = policy.trim().toLowerCase();
  if (p === "fg" || p === "ta") return "case-proc-panel__pcy case-proc-panel__pcy--fg";
  if (p === "bg" || p === "ts") return "case-proc-panel__pcy case-proc-panel__pcy--bg";
  if (p === "sf") return "case-proc-panel__pcy case-proc-panel__pcy--sys";
  if (p) return "case-proc-panel__pcy";
  return "muted";
}

function cpuClass(cpu: number | null): string {
  if (cpu == null || !Number.isFinite(cpu)) return "case-proc-panel__cpu mono text-xs";
  if (cpu >= 20) return "case-proc-panel__cpu case-proc-panel__cpu--hot mono text-xs";
  if (cpu >= 5) return "case-proc-panel__cpu case-proc-panel__cpu--warm mono text-xs";
  return "case-proc-panel__cpu mono text-xs";
}

function ParentHint({ proc }: { proc: ProcessRow }) {
  if (!proc.parent) return null;
  return (
    <span
      className="case-proc-panel__parent muted text-xs"
      title={
        proc.ppid != null
          ? `Parent ${proc.parent} (ppid ${proc.ppid})`
          : `Parent ${proc.parent}`
      }
    >
      ← {proc.parent}
      {proc.ppid != null ? ` · ${proc.ppid}` : ""}
    </span>
  );
}

function StartedCell({ proc }: { proc: ProcessRow }) {
  if (!proc.startedAt && !proc.uptime) {
    return <td className="muted text-xs case-proc-panel__num">—</td>;
  }
  const startedLabel = formatProcessStarted(proc.startedAt);
  const title = [
    proc.startedEstimated ? "Estimated from run time / time since fork" : "",
    proc.startedAt && proc.startedAt !== startedLabel ? proc.startedAt : "",
    proc.uptime ? `uptime ${proc.uptime}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <td className="case-proc-panel__started text-xs" title={title || undefined}>
      {startedLabel ? <span className="mono">{startedLabel}</span> : null}
      {proc.uptime ? (
        <span className="case-proc-panel__uptime muted">
          {startedLabel ? " · " : ""}
          {proc.uptime}
          {proc.startedEstimated ? " ≈" : ""}
        </span>
      ) : proc.startedEstimated && startedLabel ? (
        <span className="case-proc-panel__uptime muted"> ≈</span>
      ) : null}
    </td>
  );
}

function splitAndroidProcessName(name: string): {
  prefix: string;
  short: string;
  service: string;
} {
  const trimmed = name.trim();
  if (!trimmed) return { prefix: "", short: "", service: "" };

  const colon = trimmed.indexOf(":");
  const base = colon > 0 ? trimmed.slice(0, colon) : trimmed;
  const service = colon > 0 ? trimmed.slice(colon + 1) : "";

  // Kernel / bracketed threads stay as-is.
  if (base.startsWith("[") || !base.includes(".")) {
    return { prefix: "", short: base, service };
  }

  const parts = base.split(".").filter(Boolean);
  if (parts.length >= 3) {
    return {
      prefix: `${parts.slice(0, -2).join(".")}.`,
      short: parts.slice(-2).join("."),
      service,
    };
  }
  if (parts.length === 2) {
    return { prefix: `${parts[0]}.`, short: parts[1], service };
  }
  return { prefix: "", short: base, service };
}

function AndroidProcessRowView({
  proc,
  scope,
  pkg,
}: {
  proc: ProcessRow;
  scope: string;
  pkg: PackageRow | null;
}) {
  const scopeName = proc.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const appLabel = pkg ? packageDisplayLabel(pkg) : "";
  const showAppLine = Boolean(pkg);
  const showDistinctLabel = Boolean(appLabel && appLabel !== proc.name && appLabel !== pkg?.bundleId);
  const nameParts = splitAndroidProcessName(proc.name);
  const memTitle = [
    proc.rss ? `RSS ${proc.rss}` : "",
    proc.virt ? `VIRT ${proc.virt}` : "",
    proc.threads > 0 ? `${proc.threads} threads` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <tr className={proc.cpuPercent != null && proc.cpuPercent >= 5 ? "case-proc-panel__row--active" : undefined}>
      <td
        className="case-proc-panel__name case-proc-panel__name--android"
        title={
          [
            proc.message || proc.name,
            pkg ? `package ${pkg.bundleId}` : "",
            pkg?.version ? `v${pkg.version}` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        }
      >
        <span className="case-proc-panel__icon" aria-hidden>
          <Cpu size={14} />
        </span>
        <span className="case-proc-panel__identity">
          <span className="case-proc-panel__title-row case-proc-panel__title-row--stack">
            <CopyValue
              value={processCopyPayload(proc)}
              label="process"
              className="case-proc-panel__copyable--name"
            >
              <Link
                to={buildSearchHref(`${scope} process_name="${scopeName}" | head 30`, { run: true })}
                className="case-proc-panel__proc-link case-proc-panel__proc-link--android mono"
              >
                {nameParts.prefix ? (
                  <span className="case-proc-panel__name-prefix muted">{nameParts.prefix}</span>
                ) : null}
                <span className="case-proc-panel__name-short">{nameParts.short || proc.name}</span>
                {nameParts.service ? (
                  <span className="case-proc-panel__name-service">:{nameParts.service}</span>
                ) : null}
              </Link>
            </CopyValue>
            {(proc.status || proc.policy) && (
              <span className="case-proc-panel__badges">
                {proc.status ? (
                  <span className="case-proc-panel__status" title="Thread state">
                    {proc.status}
                  </span>
                ) : null}
                {proc.policy ? (
                  <span className={policyClass(proc.policy)} title={proc.policyLabel || proc.policy}>
                    {proc.policyLabel || proc.policy}
                  </span>
                ) : null}
              </span>
            )}
          </span>

          {showAppLine && pkg ? (
            <div className="case-proc-panel__meta-line case-proc-panel__meta-line--pkg">
              <span className="case-proc-panel__meta-label">pkg</span>
              <span className="case-proc-panel__app">
                <Link
                  to={buildSearchHref(packageSearchQuery(pkg.bundleId, scope, "android"), {
                    run: true,
                  })}
                  className="case-proc-panel__app-link"
                >
                  {showDistinctLabel ? appLabel : "Package"}
                </Link>
                {(showDistinctLabel || pkg.bundleId !== proc.name) && (
                  <CopyValue value={pkg.bundleId} label="package">
                    <span className="case-proc-panel__app-pkg muted mono text-xs" title={pkg.bundleId}>
                      {pkg.bundleId}
                    </span>
                  </CopyValue>
                )}
                {pkg.version && !looksLikeDupVersion(pkg.version, appLabel) ? (
                  <span className="muted text-xs">v{pkg.version}</span>
                ) : null}
              </span>
            </div>
          ) : null}

          {proc.commandLine &&
          proc.commandLine !== proc.name &&
          !proc.commandLine.startsWith(proc.name) ? (
            <ProcMetaLine
              label="cmd"
              value={proc.commandLine}
              copyLabel="command"
              className="case-proc-panel__meta-line--args"
            >
              <span className="case-proc-panel__args-text mono" title={proc.commandLine}>
                {proc.commandLine}
              </span>
            </ProcMetaLine>
          ) : null}

          <ParentHint proc={proc} />
        </span>
      </td>
      <td className="mono text-xs case-proc-panel__num">
        {proc.pid ? <CopyValue value={String(proc.pid)} label="pid" /> : "—"}
      </td>
      <td className="mono text-xs case-proc-panel__num">
        {proc.ppid != null ? <CopyValue value={String(proc.ppid)} label="ppid" /> : "—"}
      </td>
      <td className="text-xs" title={proc.uid ? `uid ${proc.uid}` : undefined}>
        {proc.user}
      </td>
      <td className={cpuClass(proc.cpuPercent)}>{formatCpuPercent(proc.cpuPercent)}</td>
      <td className="mono text-xs case-proc-panel__num case-proc-panel__mem" title={memTitle || undefined}>
        <span>{proc.rss || "—"}</span>
        {proc.threads > 0 ? (
          <span className="case-proc-panel__thr muted">{proc.threads} thr</span>
        ) : null}
      </td>
    </tr>
  );
}

function looksLikeDupVersion(version: string, label: string): boolean {
  return version.trim() === label.trim();
}

function splitDisplayPath(path: string): { dir: string; base: string } {
  const trimmed = path.trim();
  if (!trimmed) return { dir: "", base: "" };
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slash < 0) return { dir: "", base: trimmed };
  return { dir: trimmed.slice(0, slash + 1), base: trimmed.slice(slash + 1) };
}

function ProcMetaLine({
  label,
  value,
  copyLabel,
  className,
  children,
}: {
  label: string;
  value: string;
  copyLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["case-proc-panel__meta-line", className].filter(Boolean).join(" ")}>
      <span className="case-proc-panel__meta-label">{label}</span>
      <CopyValue value={value} label={copyLabel} className="case-proc-panel__meta-copy">
        {children}
      </CopyValue>
    </div>
  );
}

function IosProcessRowView({
  proc,
  scope,
}: {
  proc: ProcessRow;
  scope: string;
}) {
  const scopeName = proc.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const pathParts = splitDisplayPath(proc.path);
  const showPath = Boolean(proc.path && proc.path !== proc.name);
  const showArgs = Boolean(proc.args.trim());
  const cmdTitle = proc.commandLine || [proc.path, proc.args].filter(Boolean).join(" ") || proc.name;
  const memTitle = [
    proc.footprint ? `memory ${proc.footprint}` : "",
    proc.threads > 0 ? `${proc.threads} threads` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <tr>
      <td className="case-proc-panel__name case-proc-panel__name--ios" title={cmdTitle}>
        <span className="case-proc-panel__icon" aria-hidden>
          <Cpu size={14} />
        </span>
        <span className="case-proc-panel__identity">
          <span className="case-proc-panel__title-row">
            <CopyValue
              value={processCopyPayload(proc)}
              label="process"
              className="case-proc-panel__copyable--name"
            >
              <Link
                to={buildSearchHref(`${scope} process_name="${scopeName}" | head 30`, { run: true })}
                className="case-proc-panel__proc-link mono"
              >
                {proc.name}
              </Link>
            </CopyValue>
            {proc.parser ? (
              <span className="case-proc-panel__parser" title="Source parser">
                {proc.parser}
              </span>
            ) : null}
            {proc.serviceHint ? (
              <span className="case-proc-panel__status" title={proc.serviceHint}>
                <Plug size={10} aria-hidden />
                service
              </span>
            ) : null}
          </span>

          {showPath ? (
            <ProcMetaLine label="path" value={proc.path} copyLabel="path" className="case-proc-panel__meta-line--path">
              <span className="case-proc-panel__path-text mono" title={proc.path}>
                {pathParts.dir ? (
                  <span className="case-proc-panel__path-dir muted">{pathParts.dir}</span>
                ) : null}
                <span className="case-proc-panel__path-base">{pathParts.base || proc.path}</span>
              </span>
            </ProcMetaLine>
          ) : null}

          {showArgs ? (
            <ProcMetaLine label="args" value={proc.args} copyLabel="args" className="case-proc-panel__meta-line--args">
              <span className="case-proc-panel__args-text mono" title={proc.commandLine || proc.args}>
                {proc.args}
              </span>
            </ProcMetaLine>
          ) : null}

          {!showArgs && proc.commandLine && proc.commandLine !== proc.name && proc.commandLine !== proc.path ? (
            <ProcMetaLine
              label="cmd"
              value={proc.commandLine}
              copyLabel="command"
              className="case-proc-panel__meta-line--args"
            >
              <span className="case-proc-panel__args-text mono" title={proc.commandLine}>
                {proc.commandLine}
              </span>
            </ProcMetaLine>
          ) : null}

          <ParentHint proc={proc} />
        </span>
      </td>
      <td className="mono text-xs case-proc-panel__num">
        {proc.pid ? <CopyValue value={String(proc.pid)} label="pid" /> : "—"}
      </td>
      <td className="mono text-xs case-proc-panel__num">
        {proc.ppid != null ? <CopyValue value={String(proc.ppid)} label="ppid" /> : "—"}
      </td>
      <td
        className="text-xs mono"
        title={
          [
            proc.user && proc.user !== "—" ? `user ${proc.user}` : "",
            proc.parent ? `parent ${proc.parent}` : "",
            proc.serviceHint || "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      >
        {proc.uid || (proc.user !== "—" ? proc.user : "") || "—"}
      </td>
      <StartedCell proc={proc} />
      <td className="mono text-xs case-proc-panel__num case-proc-panel__mem" title={memTitle || undefined}>
        <span>{proc.footprint || "—"}</span>
        {proc.threads > 0 ? (
          <span className="case-proc-panel__thr muted">{proc.threads} thr</span>
        ) : null}
      </td>
    </tr>
  );
}

function IosServiceRowView({
  proc,
  scope,
}: {
  proc: ProcessRow;
  scope: string;
}) {
  const scopeName = proc.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return (
    <tr>
      <td
        className="case-proc-panel__name case-proc-panel__name--ios"
        title={proc.serviceHint || proc.message || proc.name}
      >
        <span className="case-proc-panel__icon case-proc-panel__icon--service" aria-hidden>
          <Plug size={14} />
        </span>
        <span className="case-proc-panel__identity">
          <span className="case-proc-panel__title-row">
            <CopyValue value={proc.name} label="service" className="case-proc-panel__copyable--name">
              <Link
                to={buildSearchHref(`${scope} process_name="${scopeName}" | head 30`, { run: true })}
                className="case-proc-panel__proc-link mono"
              >
                {proc.name}
              </Link>
            </CopyValue>
            <span
              className="case-proc-panel__status case-proc-panel__status--service"
              title={proc.serviceHint || "Registered service"}
            >
              registered
            </span>
          </span>
        </span>
      </td>
      <td className="text-xs">
        {proc.parser ? <span className="case-proc-panel__parser">{proc.parser}</span> : "—"}
      </td>
      <td className="text-xs muted" title={proc.message || undefined}>
        {proc.serviceHint
          ? "Remotectl registered service (no live PID)"
          : proc.message || "—"}
      </td>
    </tr>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`case-proc-panel__chip${active ? " is-active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CaseProcessesPanel({
  ingestSource,
  refreshKey,
  platform = "android",
  variant = "processes",
}: {
  ingestSource: string;
  refreshKey: number;
  platform?: CasePlatform;
  /** iOS only: split remotectl registered services out of the process list. */
  variant?: "processes" | "services";
}) {
  const isIos = platform === "ios";
  const isServices = isIos && variant === "services";
  const [filter, setFilter] = useState("");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [sortBy, setSortBy] = useState<ProcessSort>(isIos ? "pid" : "cpu");
  const panelId = isServices ? CASE_IOS_RUNNING_SERVICES_PANEL_ID : CASE_PROCESSES_PANEL_ID;
  const panel = useMemo(
    (): DashboardPanel => ({
      id: panelId,
      title: isServices ? "Running services" : "Running processes",
      query: processesQuery(ingestSource, platform),
      viz: "table",
      layout: { i: panelId, x: 0, y: 0, w: 12, h: 10, minW: 4, minH: 6 },
    }),
    [ingestSource, platform, panelId, isServices]
  );

  const packagesPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_PACKAGES_PANEL_ID}_for_processes`,
      title: "Packages for process link",
      query: !isIos ? packagesQuery(ingestSource, "android") : "",
      viz: "table",
      layout: { i: "pkg-proc", x: 0, y: 0, w: 12, h: 4, minW: 4, minH: 2 },
    }),
    [ingestSource, isIos]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const { rows: packageRawRows } = useDashboardPanel(
    packagesPanel,
    "24h",
    refreshKey,
    !isIos
  );
  const packages = useMemo(
    () => (!isIos ? packageRows(packageRawRows, 0, "android") : []),
    [isIos, packageRawRows]
  );
  const allProcesses = useMemo(
    () => processRows(rows, 0, isServices ? "pid" : sortBy),
    [rows, isServices, sortBy]
  );
  const processes = useMemo(() => {
    if (!isIos) return allProcesses;
    return allProcesses.filter((p) =>
      isServices ? isIosRegisteredService(p) : !isIosRegisteredService(p)
    );
  }, [allProcesses, isIos, isServices]);
  const summary = useMemo(() => processSummary(processes), [processes]);
  const packageByProcess = useMemo(() => {
    const map = new Map<string, PackageRow | null>();
    if (isIos || packages.length === 0) return map;
    for (const proc of processes) {
      if (!map.has(proc.name)) {
        map.set(proc.name, resolveAndroidProcessPackage(proc.name, packages));
      }
    }
    return map;
  }, [isIos, packages, processes]);
  const linkedCount = useMemo(() => {
    let n = 0;
    for (const pkg of packageByProcess.values()) {
      if (pkg) n += 1;
    }
    return n;
  }, [packageByProcess]);
  const withStart = useMemo(
    () => processes.filter((p) => p.startedAt || p.uptime).length,
    [processes]
  );
  const withPath = useMemo(() => processes.filter((p) => p.path.trim()).length, [processes]);

  const viewFiltered = useMemo(() => {
    if (viewFilter === "all") return processes;
    return processes.filter((proc) => {
      const pol = proc.policy.trim().toLowerCase();
      if (viewFilter === "fg") return pol === "fg" || pol === "ta";
      if (viewFilter === "bg") return pol === "bg" || pol === "ts";
      if (viewFilter === "linked") return Boolean(packageByProcess.get(proc.name));
      if (viewFilter === "started") return Boolean(proc.startedAt || proc.uptime);
      if (viewFilter === "path") return Boolean(proc.path.trim());
      return true;
    });
  }, [processes, viewFilter, packageByProcess]);

  const visible = useMemo(
    () =>
      viewFiltered.filter((proc) => {
        const pkg = packageByProcess.get(proc.name) ?? null;
        return panelSearchMatch(
          filter,
          proc.name,
          proc.pid,
          proc.ppid,
          proc.user,
          proc.uid,
          proc.policy,
          proc.policyLabel,
          proc.parser,
          proc.footprint,
          proc.rss,
          proc.virt,
          proc.path,
          proc.args,
          proc.commandLine,
          proc.parent,
          proc.status,
          proc.startedAt,
          proc.uptime,
          proc.serviceHint,
          pkg?.bundleId,
          pkg ? packageDisplayLabel(pkg) : "",
          pkg?.version
        );
      }),
    [viewFiltered, filter, packageByProcess]
  );
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-proc-panel case-proc-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-proc-panel case-proc-panel--error muted text-xs">{error}</p>;
  }

  if (!processes.length) {
    return (
      <p className="case-proc-panel case-proc-panel--empty muted text-xs">
        {isServices
          ? "No remotectl registered services in this sysdiagnose."
          : isIos
            ? "No running process inventory for this sysdiagnose case."
            : "No process list in this bugreport."}
      </p>
    );
  }

  const rowsForTable = isServices
    ? [...visible].sort((a, b) => a.name.localeCompare(b.name))
    : visible;

  const heroTitle = isServices
    ? `${processes.length} registered service${processes.length === 1 ? "" : "s"}`
    : `${visible.length}${visible.length !== processes.length ? ` / ${processes.length}` : ""} process${
        visible.length === 1 ? "" : "es"
      }`;

  const heroMeta = isServices
    ? "From remotectl / ps_everywhere · no live PID"
    : isIos
      ? [
          withStart > 0 ? `${withStart} with start/uptime` : "",
          withPath > 0 ? `${withPath} with path` : "",
          "≈ estimated when marked",
          sortBy === "pid" ? "sorted by PID" : "sorted by CPU",
        ]
          .filter(Boolean)
          .join(" · ")
      : [
          summary.withCpu > 0 ? `${summary.withCpu} with CPU` : "",
          summary.topCpu != null ? `peak ${formatCpuPercent(summary.topCpu)}` : "",
          linkedCount > 0 ? `${linkedCount} linked to packages` : "",
          sortBy === "cpu" ? "sorted by CPU" : "sorted by PID",
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div
      className={[
        "case-proc-panel",
        isServices ? "case-proc-panel--services" : "",
        isIos ? "case-proc-panel--ios" : "case-proc-panel--android",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="case-proc-panel__hero">
        {isServices ? <Plug size={18} aria-hidden /> : <Cpu size={18} aria-hidden />}
        <div>
          <span className="case-proc-panel__hero-title">{heroTitle}</span>
          <span className="case-proc-panel__hero-meta muted text-xs">{heroMeta}</span>
        </div>
      </header>

      {!isServices ? (
        <div className="case-proc-panel__toolbar">
          <div className="case-proc-panel__chips" role="group" aria-label="Process filters">
            <Chip active={viewFilter === "all"} onClick={() => setViewFilter("all")}>
              All ({processes.length})
            </Chip>
            {!isIos && summary.foreground > 0 ? (
              <Chip active={viewFilter === "fg"} onClick={() => setViewFilter("fg")}>
                Foreground ({summary.foreground})
              </Chip>
            ) : null}
            {!isIos && summary.background > 0 ? (
              <Chip active={viewFilter === "bg"} onClick={() => setViewFilter("bg")}>
                Background ({summary.background})
              </Chip>
            ) : null}
            {!isIos && linkedCount > 0 ? (
              <Chip active={viewFilter === "linked"} onClick={() => setViewFilter("linked")}>
                Linked package ({linkedCount})
              </Chip>
            ) : null}
            {isIos && withStart > 0 ? (
              <Chip active={viewFilter === "started"} onClick={() => setViewFilter("started")}>
                With start ({withStart})
              </Chip>
            ) : null}
            {isIos && withPath > 0 ? (
              <Chip active={viewFilter === "path"} onClick={() => setViewFilter("path")}>
                With path ({withPath})
              </Chip>
            ) : null}
          </div>
          <div className="case-proc-panel__chips" role="group" aria-label="Sort order">
            {!isIos ? (
              <Chip active={sortBy === "cpu"} onClick={() => setSortBy("cpu")}>
                Sort: CPU
              </Chip>
            ) : null}
            <Chip active={sortBy === "pid"} onClick={() => setSortBy("pid")}>
              Sort: PID
            </Chip>
          </div>
        </div>
      ) : null}

      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder={
          isServices
            ? "Filter service name or parser…"
            : isIos
              ? "Filter process, PID, UID, path, or started…"
              : "Filter process, package, app, PID, user, or policy…"
        }
      />

      <div className="case-proc-panel__table-wrap">
        {visible.length === 0 ? (
          <p className="muted text-xs">
            No {isServices ? "services" : "processes"} match
            {filter.trim() ? ` “${filter.trim()}”` : " this filter"}.
          </p>
        ) : (
          <table className="case-proc-panel__table">
            <thead>
              <tr>
                {isServices ? (
                  <>
                    <th>Service</th>
                    <th>Parser</th>
                    <th>Note</th>
                  </>
                ) : (
                  <>
                    <th>Process</th>
                    <th className="case-proc-panel__num">PID</th>
                    {isIos ? (
                      <>
                        <th className="case-proc-panel__num">PPID</th>
                        <th>UID</th>
                        <th>Started</th>
                        <th className="case-proc-panel__num">Memory</th>
                      </>
                    ) : (
                      <>
                        <th className="case-proc-panel__num">PPID</th>
                        <th>User</th>
                        <th className="case-proc-panel__num">CPU</th>
                        <th className="case-proc-panel__num">Memory</th>
                      </>
                    )}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rowsForTable.map((proc) =>
                isServices ? (
                  <IosServiceRowView
                    key={`svc-${proc.parser ?? "ios"}-${proc.name}`}
                    proc={proc}
                    scope={scope}
                  />
                ) : isIos ? (
                  <IosProcessRowView
                    key={`${proc.parser ?? "ios"}-${proc.pid}-${proc.name}`}
                    proc={proc}
                    scope={scope}
                  />
                ) : (
                  <AndroidProcessRowView
                    key={`${proc.pid}-${proc.name}`}
                    proc={proc}
                    scope={scope}
                    pkg={packageByProcess.get(proc.name) ?? null}
                  />
                )
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="case-proc-panel__footer">
        <Link
          to={buildSearchHref(
            isIos
              ? `${scope} process_name=* | stats count by process_name | head 40`
              : `${scope} parser="Process" | head 60`,
            { run: true }
          )}
          className="case-proc-panel__link text-xs"
        >
          {isServices ? "Search service names →" : "Search all processes →"}
        </Link>
      </div>
    </div>
  );
}
