import { memo, useDeferredValue, useMemo, useState, useTransition } from "react";
import { Link } from "react-router-dom";
import { Activity, Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_PROCESS_EVENTS_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import {
  formatProcessStarted,
  iosProcessEventParserCounts,
  IOS_PROCESS_EVENT_KIND_COLORS,
  IOS_PROCESS_EVENT_KIND_LABELS,
  IOS_PROCESS_EVENT_KINDS,
  IOS_PROCESS_EVENTS_LIST_PAGE,
  iosProcessEventsFromRows,
  iosProcessEventsQuery,
  iosProcessEventsTimelineBuckets,
  type IosProcessEvent,
  type IosProcessEventKind,
  type IosProcessEventTimelineBucket,
} from "@/lib/processSnapshot";

type ParserFilter = "all" | string;
type KindFilter = "all" | IosProcessEvent["kind"];

const KIND_FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: "all", label: "All kinds" },
  { id: "start", label: "Starts" },
  { id: "running", label: "Spindump" },
  { id: "snapshot", label: "Snapshots" },
  { id: "shutdown", label: "Shutdown" },
  { id: "other", label: "Other" },
];

function kindLabel(kind: IosProcessEvent["kind"]): string {
  switch (kind) {
    case "start":
      return "start";
    case "running":
      return "running";
    case "snapshot":
      return "snapshot";
    case "shutdown":
      return "shutdown";
    default:
      return "event";
  }
}

function kindClass(kind: IosProcessEvent["kind"]): string {
  return `case-ios-procevents__kind case-ios-procevents__kind--${kind}`;
}

function formatWaitSeconds(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 10) return `${n.toFixed(1)}s`;
  return `${Math.round(n)}s`;
}

function TimelineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: IosProcessEventTimelineBucket }>;
}) {
  if (!active || !payload?.length) return null;
  const b = payload[0]?.payload;
  if (!b) return null;
  return (
    <div className="case-ios-procevents__chart-tip">
      <div className="mono">{b.label}</div>
      <div className="muted text-xs">
        {IOS_PROCESS_EVENT_KINDS.filter((k) => b[k] > 0)
          .map((k) => `${IOS_PROCESS_EVENT_KIND_LABELS[k]} ${b[k]}`)
          .join(" · ")}
      </div>
      <div className="muted text-xs">{b.total} total</div>
    </div>
  );
}

function ProcessEventsTimelineChart({
  buckets,
  presentKinds,
}: {
  buckets: IosProcessEventTimelineBucket[];
  presentKinds: IosProcessEventKind[];
}) {
  if (!buckets.length || !presentKinds.length) {
    return <p className="muted text-xs">No dated events to plot on the timeline.</p>;
  }

  return (
    <section className="case-ios-procevents__chart" aria-label="Process events timeline">
      <div className="case-ios-procevents__chart-head">
        <span className="case-ios-procevents__chart-title">Timeline</span>
        <ul className="case-ios-procevents__chart-legend">
          {presentKinds.map((k) => {
            const count = buckets.reduce((n, b) => n + b[k], 0);
            return (
              <li key={k}>
                <span
                  className="case-ios-procevents__chart-swatch"
                  style={{ background: IOS_PROCESS_EVENT_KIND_COLORS[k] }}
                  aria-hidden
                />
                {IOS_PROCESS_EVENT_KIND_LABELS[k]} ({count})
              </li>
            );
          })}
        </ul>
      </div>
      <div className="case-ios-procevents__chart-plot">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={buckets} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              minTickGap={48}
              interval="preserveStartEnd"
            />
            <YAxis
              allowDecimals={false}
              width={36}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "color-mix(in srgb, var(--muted-foreground) 8%, transparent)" }}
              content={<TimelineTooltip />}
            />
            {presentKinds.map((k) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="events"
                fill={IOS_PROCESS_EVENT_KIND_COLORS[k]}
                isAnimationActive={false}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const EventRow = memo(function EventRow({
  event,
  scope,
}: {
  event: IosProcessEvent;
  scope: string;
}) {
  const nameEsc = event.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const waitLabel = formatWaitSeconds(event.waitSeconds);
  const details = [
    event.executablePath && event.executablePath !== event.name ? event.executablePath : "",
    !event.executablePath && event.path && event.path !== event.name ? event.path : "",
    event.args ? `args ${event.args}` : "",
    !event.args && event.commandLine && event.commandLine !== event.name
      ? `cmdline ${event.commandLine}`
      : "",
    event.parent ? `parent ${event.parent}` : "",
    waitLabel ? `waited ${waitLabel}` : "",
    event.uptime ? `up ${event.uptime}${event.startedEstimated ? "≈" : ""}` : "",
    event.uuid ? `uuid ${event.uuid}` : "",
    event.sourcePath ? event.sourcePath.replace(/^.*\//, "") : "",
  ].filter(Boolean);

  return (
    <li className="case-ios-procevents__item">
      <div className="case-ios-procevents__row">
        <span className={kindClass(event.kind)}>{kindLabel(event.kind)}</span>
        <Link
          to={buildSearchHref(`${scope} process_name="${nameEsc}" | head 40`, { run: true })}
          className="case-ios-procevents__name mono"
          title={event.message || event.name}
        >
          {event.name || "—"}
        </Link>
        <span className="case-ios-procevents__pid mono muted text-xs" title="PID">
          {event.pid || "—"}
        </span>
        <span className="case-ios-procevents__parser muted text-xs">{event.parser || "—"}</span>
        <time
          className="case-ios-procevents__when muted text-xs mono"
          title={
            event.startedEstimated
              ? `Estimated start ${event.whenRaw || event.startedAt}`
              : event.whenRaw || undefined
          }
        >
          {event.when || formatProcessStarted(event.startedAt) || "—"}
          {event.startedEstimated ? " ≈" : ""}
        </time>
      </div>
      {details.length > 0 && (
        <p className="case-ios-procevents__meta muted text-xs mono">{details.join(" · ")}</p>
      )}
    </li>
  );
});

export function CaseIosProcessEventsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const [parserFilter, setParserFilter] = useState<ParserFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [listLimit, setListLimit] = useState(IOS_PROCESS_EVENTS_LIST_PAGE);
  const [, startFilterTransition] = useTransition();
  const deferredFilter = useDeferredValue(filter);

  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_PROCESS_EVENTS_PANEL_ID,
      title: "Process events",
      query: iosProcessEventsQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_IOS_PROCESS_EVENTS_PANEL_ID, x: 0, y: 0, w: 12, h: 18, minW: 6, minH: 10 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const events = useMemo(() => iosProcessEventsFromRows(rows), [rows]);
  const parserCounts = useMemo(() => iosProcessEventParserCounts(events), [events]);
  const kindCounts = useMemo(() => {
    const map = new Map<IosProcessEvent["kind"], number>();
    for (const e of events) map.set(e.kind, (map.get(e.kind) ?? 0) + 1);
    return map;
  }, [events]);

  const visible = useMemo(() => {
    return events.filter((e) => {
      if (parserFilter !== "all" && e.parser !== parserFilter) return false;
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      return panelSearchMatch(
        deferredFilter,
        e.name,
        e.pid,
        e.parser,
        e.message,
        e.path,
        e.executablePath,
        e.parent,
        e.when,
        e.uptime,
        e.timestampDesc,
        e.kind,
        e.uuid,
        e.sourcePath,
        e.waitSeconds
      );
    });
  }, [events, deferredFilter, parserFilter, kindFilter]);

  const timelineBuckets = useMemo(
    () => iosProcessEventsTimelineBuckets(visible),
    [visible]
  );
  const presentKinds = useMemo(
    () =>
      IOS_PROCESS_EVENT_KINDS.filter((k) =>
        timelineBuckets.some((b) => b[k] > 0)
      ),
    [timelineBuckets]
  );

  const listRows = useMemo(
    () => visible.slice(0, listLimit),
    [visible, listLimit]
  );

  const scope = `source="${src}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-procevents case-ios-procevents--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-procevents case-ios-procevents--error muted text-xs">{error}</p>;
  }

  if (!events.length) {
    return (
      <p className="case-ios-procevents case-ios-procevents--empty muted text-xs">
        No taskinfo / spindump / ps / shutdown process events for this case yet.
      </p>
    );
  }

  const startCount = kindCounts.get("start") ?? 0;
  const runningCount = kindCounts.get("running") ?? 0;
  const snapshotCount = kindCounts.get("snapshot") ?? 0;
  const shutdownCount = kindCounts.get("shutdown") ?? 0;
  const filterPending = filter !== deferredFilter;

  return (
    <div className="case-ios-procevents case-ios-procevents--tab">
      <CasePanelSearchBar
        value={filter}
        onChange={(value) => {
          setFilter(value);
          startFilterTransition(() => setListLimit(IOS_PROCESS_EVENTS_LIST_PAGE));
        }}
        placeholder="Filter process, PID, parser, path, uuid…"
      />

      <header className="case-ios-procevents__hero">
        <Activity size={18} aria-hidden />
        <div>
          <span className="case-ios-procevents__hero-title">
            {visible.length}
            {visible.length !== events.length ? ` / ${events.length}` : ""} process events
            {filterPending ? "…" : ""}
          </span>
          <span className="case-ios-procevents__hero-meta muted text-xs">
            {[
              startCount > 0 ? `${startCount} starts` : "",
              runningCount > 0 ? `${runningCount} spindump` : "",
              snapshotCount > 0 ? `${snapshotCount} snapshots` : "",
              shutdownCount > 0 ? `${shutdownCount} still at shutdown` : "",
              "≈ times estimated from run time / fork age",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </header>

      <div className="case-ios-procevents__filters">
        <div className="case-ios-procevents__chips" role="group" aria-label="Kind filter">
          {KIND_FILTERS.map((k) => {
            const count = k.id === "all" ? events.length : (kindCounts.get(k.id) ?? 0);
            if (k.id !== "all" && count === 0) return null;
            return (
              <button
                key={k.id}
                type="button"
                className={`case-ios-procevents__chip${kindFilter === k.id ? " is-active" : ""}`}
                onClick={() => {
                  setKindFilter(k.id);
                  setListLimit(IOS_PROCESS_EVENTS_LIST_PAGE);
                }}
              >
                {k.label} ({count})
              </button>
            );
          })}
        </div>

        {parserCounts.length > 1 && (
          <div className="case-ios-procevents__chips" role="group" aria-label="Parser filter">
            <button
              type="button"
              className={`case-ios-procevents__chip${parserFilter === "all" ? " is-active" : ""}`}
              onClick={() => {
                setParserFilter("all");
                setListLimit(IOS_PROCESS_EVENTS_LIST_PAGE);
              }}
            >
              All parsers ({events.length})
            </button>
            {parserCounts.map((c) => (
              <button
                key={c.parser}
                type="button"
                className={`case-ios-procevents__chip${parserFilter === c.parser ? " is-active" : ""}`}
                onClick={() => {
                  setParserFilter(c.parser);
                  setListLimit(IOS_PROCESS_EVENTS_LIST_PAGE);
                }}
              >
                {c.parser} ({c.count})
              </button>
            ))}
          </div>
        )}
      </div>

      <ProcessEventsTimelineChart buckets={timelineBuckets} presentKinds={presentKinds} />

      {visible.length === 0 ? (
        <p className="muted text-xs">No events match the filter.</p>
      ) : (
        <div className="case-ios-procevents__table">
          <div className="case-ios-procevents__cols" aria-hidden>
            <span>Kind</span>
            <span>Process</span>
            <span>PID</span>
            <span>Parser</span>
            <span>When</span>
          </div>
          <ul className="case-ios-procevents__list">
            {listRows.map((e, i) => (
              <EventRow
                key={`${e.parser}-${e.pid}-${e.name}-${e.whenRaw}-${i}`}
                event={e}
                scope={scope}
              />
            ))}
          </ul>
          {visible.length > listRows.length ? (
            <div className="case-ios-procevents__more">
              <button
                type="button"
                className="case-ios-procevents__more-btn"
                onClick={() =>
                  setListLimit((n) => Math.min(n + IOS_PROCESS_EVENTS_LIST_PAGE, visible.length))
                }
              >
                Show more ({listRows.length} / {visible.length})
              </button>
            </div>
          ) : null}
        </div>
      )}

      <p className="case-ios-procevents__footer muted text-xs">
        <Link
          to={buildSearchHref(
            `${scope} (parser="taskinfo" OR parser="spindumpnosymbols" OR parser="ps" OR parser="psthread" OR parser="shutdownlogs") process_name=* | head 10000`,
            { run: true }
          )}
        >
          Search process events
        </Link>
        {" · "}
        <Link
          to={buildSearchHref(
            `${scope} parser="taskinfo" timestamp_desc="process start time" | head 200`,
            { run: true }
          )}
        >
          Hunt starts
        </Link>
        {" · "}
        <Link
          to={buildSearchHref(`${scope} parser="shutdownlogs" | head 200`, { run: true })}
        >
          Shutdown clients
        </Link>
      </p>
    </div>
  );
}
