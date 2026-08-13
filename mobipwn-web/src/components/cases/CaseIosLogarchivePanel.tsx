import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Archive, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_LOGARCHIVE_PANEL_ID } from "@/lib/caseDashboard";
import {
  formatLogarchiveTimestamp,
  logarchiveDecodeBadgeClass,
  logarchiveRecentLinesFromRows,
  logarchiveSnapshotFromRows,
  logarchiveSubsystemsFromRows,
  truncateLogMessage,
} from "@/lib/iosLogarchive";

function parseStatsCount(rows: Record<string, unknown>[]): number | undefined {
  if (rows.length !== 1) return undefined;
  const row = rows[0];
  for (const key of ["stat", "total", "count", "event_count"]) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

export function CaseIosLogarchivePanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const eventsPanel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_LOGARCHIVE_PANEL_ID,
      title: "Unified logs",
      query: `source="${src}" parser="logarchive" action="logarchive_event" | fields timestamp, message, bundle_id, logarchive_decode, logarchive_tool, file_count, action, ext | sort -timestamp | head 40`,
      viz: "table",
      layout: { i: CASE_IOS_LOGARCHIVE_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const inventoryPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_LOGARCHIVE_PANEL_ID}_inv`,
      title: "Logarchive inventory",
      query: `source="${src}" parser="logarchive" action="logarchive_inventory" | fields timestamp, message, logarchive_decode, logarchive_tool, file_count, event_count, max_lines, reason, ext | head 1`,
      viz: "table",
      layout: { i: `${CASE_IOS_LOGARCHIVE_PANEL_ID}_inv`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [src]
  );
  const statsPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_LOGARCHIVE_PANEL_ID}_stats`,
      title: "Logarchive stats",
      query: `source="${src}" parser="logarchive" action="logarchive_event" | stats count`,
      viz: "table",
      layout: { i: `${CASE_IOS_LOGARCHIVE_PANEL_ID}_stats`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [src]
  );
  const subsystemPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_LOGARCHIVE_PANEL_ID}_subs`,
      title: "Logarchive subsystems",
      query: `source="${src}" parser="logarchive" action="logarchive_event" | stats count by bundle_id | head 8`,
      viz: "table",
      layout: { i: `${CASE_IOS_LOGARCHIVE_PANEL_ID}_subs`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [src]
  );

  const eventsQuery = useDashboardPanel(eventsPanel, "24h", refreshKey, true);
  const inventoryQuery = useDashboardPanel(inventoryPanel, "24h", refreshKey, true);
  const statsQuery = useDashboardPanel(statsPanel, "24h", refreshKey, true);
  const subsystemQuery = useDashboardPanel(subsystemPanel, "24h", refreshKey, true);

  const mergedRows = useMemo(
    () => [...inventoryQuery.rows, ...eventsQuery.rows],
    [inventoryQuery.rows, eventsQuery.rows]
  );
  const totalEvents = useMemo(() => parseStatsCount(statsQuery.rows), [statsQuery.rows]);
  const snapshot = useMemo(
    () => logarchiveSnapshotFromRows(mergedRows, { totalEvents }),
    [mergedRows, totalEvents]
  );
  const subsystems = useMemo(() => {
    const fromStats = subsystemQuery.rows
      .map((row) => {
        const subsystem = String(row.bundle_id ?? "").trim() || "(unknown)";
        const count =
          parseStatsCount([row]) ?? Number(row.stat) ?? Number(row.total) ?? Number(row.count) ?? 0;
        return count > 0 ? { subsystem, count } : null;
      })
      .filter((row): row is { subsystem: string; count: number } => row != null);
    if (fromStats.length > 0) return fromStats;
    return logarchiveSubsystemsFromRows(eventsQuery.rows).slice(0, 8);
  }, [subsystemQuery.rows, eventsQuery.rows]);
  const recentLines = useMemo(() => logarchiveRecentLinesFromRows(eventsQuery.rows, 8), [eventsQuery.rows]);
  const subsystemMax = useMemo(
    () => subsystems.reduce((max, row) => Math.max(max, row.count), 0),
    [subsystems]
  );

  const scope = `source="${src}" parser="logarchive"`;
  const loading = eventsQuery.loading && eventsQuery.rows.length === 0;
  const error = eventsQuery.error || inventoryQuery.error;

  if (loading) {
    return (
      <div className="case-ios-logarchive case-ios-logarchive--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-logarchive case-ios-logarchive--error muted text-xs">{error}</p>;
  }

  if (!snapshot) {
    return (
      <p className="case-ios-logarchive case-ios-logarchive--empty muted text-xs">
        No logarchive inventory or decoded unified logs in this sysdiagnose yet.
      </p>
    );
  }

  const decodedCount = snapshot.eventCount ?? snapshot.logLines;
  const heroTitle =
    snapshot.decode === "success"
      ? `${decodedCount.toLocaleString()} unified log lines`
      : snapshot.decode === "deferred"
        ? `Archive on disk (${snapshot.fileCount ?? "?"} files)`
        : snapshot.decode === "failed"
          ? "Unified log decode failed"
          : `Log archive (${snapshot.fileCount ?? "?"} files)`;

  return (
    <div className="case-ios-logarchive">
      <header className="case-ios-logarchive__hero">
        <Archive size={18} aria-hidden className="case-ios-logarchive__hero-icon" />
        <div className="case-ios-logarchive__hero-body">
          <div className="case-ios-logarchive__hero-row">
            <span className="case-ios-logarchive__hero-title">{heroTitle}</span>
            <span
              className={`case-ios-logarchive__badge ${logarchiveDecodeBadgeClass(snapshot.decode)}`}
            >
              {snapshot.decode}
            </span>
          </div>
          {snapshot.statusHelp ? (
            <p className="case-ios-logarchive__hero-meta muted text-xs">{snapshot.statusHelp}</p>
          ) : null}
        </div>
      </header>

      <dl className="case-ios-logarchive__stats">
        {snapshot.toolLabel ? (
          <div>
            <dt>Decoder</dt>
            <dd>{snapshot.toolLabel}</dd>
          </div>
        ) : null}
        {snapshot.fileCount != null ? (
          <div>
            <dt>Archive files</dt>
            <dd className="mono">{snapshot.fileCount.toLocaleString()}</dd>
          </div>
        ) : null}
        {decodedCount > 0 ? (
          <div>
            <dt>Indexed lines</dt>
            <dd className="mono">{decodedCount.toLocaleString()}</dd>
          </div>
        ) : null}
        {snapshot.maxLines != null && snapshot.decode === "success" ? (
          <div>
            <dt>Decode cap</dt>
            <dd className="mono">
              {snapshot.maxLines.toLocaleString()}
              {snapshot.capped ? " · capped" : ""}
            </dd>
          </div>
        ) : null}
        {subsystems.length > 0 ? (
          <div>
            <dt>Subsystems</dt>
            <dd className="mono">{subsystems.length}</dd>
          </div>
        ) : null}
      </dl>

      {snapshot.reason ? (
        <p className="case-ios-logarchive__reason muted text-xs mono">{snapshot.reason}</p>
      ) : null}

      {subsystems.length > 0 ? (
        <section className="case-ios-logarchive__section">
          <h4 className="case-ios-logarchive__section-title">Top subsystems</h4>
          <ul className="case-ios-logarchive__bars">
            {subsystems.map((row) => {
              const pct = subsystemMax > 0 ? Math.round((row.count / subsystemMax) * 100) : 0;
              return (
                <li key={row.subsystem} className="case-ios-logarchive__bar-row">
                  <div className="case-ios-logarchive__bar-head">
                    <span className="case-ios-logarchive__bar-label mono text-xs" title={row.subsystem}>
                      {row.subsystem}
                    </span>
                    <span className="case-ios-logarchive__bar-count mono text-xs">
                      {row.count.toLocaleString()}
                    </span>
                  </div>
                  <div className="case-ios-logarchive__bar-track" aria-hidden>
                    <span
                      className="case-ios-logarchive__bar-fill"
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {recentLines.length > 0 ? (
        <section className="case-ios-logarchive__section">
          <h4 className="case-ios-logarchive__section-title">Recent lines</h4>
          <ul className="case-ios-logarchive__lines">
            {recentLines.map((line, index) => {
              const ts = formatLogarchiveTimestamp(line.timestamp);
              return (
                <li key={`${line.subsystem}:${line.timestamp ?? index}`} className="case-ios-logarchive__line">
                  <div className="case-ios-logarchive__line-head">
                    {ts ? <time className="case-ios-logarchive__line-time mono text-xs">{ts}</time> : null}
                    <span className="case-ios-logarchive__line-subsystem mono text-xs">{line.subsystem}</span>
                  </div>
                  <p className="case-ios-logarchive__line-message mono text-xs" title={line.message}>
                    {truncateLogMessage(line.message)}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : snapshot.sampleMessage ? (
        <p className="case-ios-logarchive__sample muted text-xs mono">{snapshot.sampleMessage}</p>
      ) : null}

      <p className="case-ios-logarchive__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} action="logarchive_event" | head 50`)}>
          Search decoded logs
        </Link>
        {" · "}
        <Link to={buildSearchHref(`${scope} | head 50`)}>All logarchive rows</Link>
      </p>
    </div>
  );
}
