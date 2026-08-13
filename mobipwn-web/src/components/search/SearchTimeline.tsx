import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Filter,
  Fingerprint,
  Grid3x3,
  LineChart as LineChartIcon,
  RotateCcw,
  TrendingUp,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  PrevalenceScatterPlot,
  type PrevalenceScatterData,
} from "@/components/search/PrevalenceScatterPlot";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  parseSpan,
  parseTimechartHeader,
  setSpanInQuery,
  TIMELINE_SPAN_OPTIONS,
} from "@/lib/mplTimechart";
import { getTsFromChartEvent, seriesColorMap } from "@/lib/timelineChart";
import {
  bucketIntervalMs,
  downloadTimelineCsv,
  formatBucketTime,
  formatY,
  parseBucketTimestamp,
} from "@/lib/timelineFormat";

export type ChartType = "bar" | "line" | "area";

export type HistBucket = { bucket: string; count: number };

export type SearchRow = Record<string, unknown>;

const TOP_N = 10;

function LegendSparkline({
  values,
  color,
  dim,
}: {
  values: number[];
  color: string;
  dim: boolean;
}) {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const W = 44;
  const H = 14;
  const d = values
    .map((v, i) => {
      const x = ((i / Math.max(1, values.length - 1)) * W).toFixed(1);
      const y = (H - (v / max) * H).toFixed(1);
      return `${i === 0 ? "M" : "L"} ${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} className="legend-sparkline" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeOpacity={dim ? 0.45 : 1}
      />
    </svg>
  );
}

type TimelinePoint = { timestamp: number; bucket: string; count: number };

function histogramToPoints(buckets: HistBucket[]): TimelinePoint[] {
  return buckets
    .map((b) => {
      const ts = parseBucketTimestamp(b.bucket);
      if (ts == null) return null;
      return { timestamp: ts, bucket: b.bucket, count: b.count };
    })
    .filter((p): p is TimelinePoint => p != null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

type TimechartRow = Record<string, unknown> & { timestamp: number };

const SERVER_OTHER_LABEL = "Other";

function sortSeriesKeys(keys: string[], totals: Map<string, number>): string[] {
  return [...keys].sort((a, b) => {
    if (a === SERVER_OTHER_LABEL) return 1;
    if (b === SERVER_OTHER_LABEL) return -1;
    return (totals.get(b) ?? 0) - (totals.get(a) ?? 0);
  });
}

function transformTimechartRows(
  rows: SearchRow[],
  splitByField?: string | null
): {
  rows: TimechartRow[];
  seriesKeys: string[];
  seriesTotals: Record<string, number>;
} {
  const bucketMap = new Map<number, TimechartRow>();
  const totalsMap = new Map<string, number>();

  for (const row of rows) {
    const ts = parseBucketTimestamp(row.bucket);
    if (ts == null) continue;
    const fromSplit =
      splitByField && row[splitByField] != null && String(row[splitByField]).trim() !== ""
        ? String(row[splitByField])
        : null;
    const series = String(row.series ?? fromSplit ?? "all");
    const count = Number(row.c ?? row.stat ?? 0);
    totalsMap.set(series, (totalsMap.get(series) ?? 0) + count);
    let bucket = bucketMap.get(ts);
    if (!bucket) {
      bucket = { timestamp: ts, bucket: String(row.bucket ?? "") };
      bucketMap.set(ts, bucket);
    }
    bucket[series] = (Number(bucket[series] ?? 0) + count) as unknown as number;
  }

  const serverOther = totalsMap.has(SERVER_OTHER_LABEL);

  const sortedByTotal = [...totalsMap.entries()].sort((a, b) => b[1] - a[1]);
  const topKeys = serverOther
    ? sortedByTotal.map(([k]) => k).filter((k) => k !== SERVER_OTHER_LABEL)
    : sortedByTotal.slice(0, TOP_N).map(([k]) => k);
  const otherKeys = serverOther
    ? []
    : sortedByTotal.slice(TOP_N).map(([k]) => k);
  const seriesKeys = serverOther
    ? sortSeriesKeys([...totalsMap.keys()], totalsMap)
    : otherKeys.length
      ? [...topKeys, SERVER_OTHER_LABEL]
      : topKeys;

  const outRows = [...bucketMap.values()]
    .map((row) => {
      let other = 0;
      if (!serverOther) {
        for (const k of otherKeys) other += Number(row[k] ?? 0);
      }
      for (const k of topKeys) if (row[k] == null) row[k] = 0;
      if (!serverOther && otherKeys.length) row[SERVER_OTHER_LABEL] = other;
      if (serverOther && row[SERVER_OTHER_LABEL] == null) row[SERVER_OTHER_LABEL] = 0;
      return row;
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const seriesTotals: Record<string, number> = {};
  for (const k of seriesKeys) {
    if (k === SERVER_OTHER_LABEL && serverOther) {
      seriesTotals[k] = totalsMap.get(k) ?? 0;
    } else if (k !== SERVER_OTHER_LABEL) {
      seriesTotals[k] = totalsMap.get(k) ?? 0;
    } else {
      seriesTotals[k] = otherKeys.reduce((s, key) => s + (totalsMap.get(key) ?? 0), 0);
    }
  }

  return { rows: outRows, seriesKeys, seriesTotals };
}

type TooltipPayload = Array<{
  name: string;
  value: number;
  color: string;
  dataKey: string;
}>;

function ChartTooltipBody({
  active,
  payload,
  label,
  bucketMs,
  spansDays,
  isStacked,
}: {
  active?: boolean;
  payload?: TooltipPayload;
  label?: string | number;
  bucketMs: number;
  spansDays: boolean;
  isStacked?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const startTs = typeof label === "number" ? label : parseBucketTimestamp(label);
  if (startTs == null) return null;
  const endTs = startTs + bucketMs;
  const entries = [...payload]
    .filter((e) => (e.value ?? 0) > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const total = payload.reduce((s, e) => s + (e.value ?? 0), 0);

  return (
    <div className="search-timeline-tooltip">
      <div className="search-timeline-tooltip-range">
        {formatBucketTime(startTs, spansDays)} — {formatBucketTime(endTs, spansDays)} UTC
      </div>
      {isStacked ? (
        <div className="search-timeline-tooltip-body">
          {entries.map((e) => (
            <div key={e.dataKey} className="search-timeline-tooltip-row">
              <span className="dot" style={{ background: e.color }} />
              <span className="name">{e.name}</span>
              <span className="val">{formatY(e.value)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="search-timeline-tooltip-count">
          {formatY(total)} <span className="muted">events</span>
        </div>
      )}
      {isStacked && (
        <div className="search-timeline-tooltip-total">
          <span>Total</span>
          <span>{formatY(total)}</span>
        </div>
      )}
    </div>
  );
}

function SpanChip({
  current,
  onPick,
}: {
  current: string;
  onPick: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="search-timeline-span-chip">
          <Clock className="icon" />
          <span>span</span>
          <span className="mono accent">{current}</span>
          <ChevronDown className="icon-sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[168px]">
        {TIMELINE_SPAN_OPTIONS.map(({ key, label }) => (
          <DropdownMenuItem
            key={key}
            onClick={() => onPick(key)}
            className={cn("justify-between gap-2", key === current && "bg-foreground/5")}
          >
            <span className="mono accent">{key}</span>
            <span className="muted text-[10px]">{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TimechartLegend({
  seriesKeys,
  seriesTotals,
  rows,
  colors,
  splitByField,
  muted,
  isolated,
  onToggleMute,
  onIsolate,
  onSeriesFilter,
}: {
  seriesKeys: string[];
  seriesTotals: Record<string, number>;
  rows: TimechartRow[];
  colors: Map<string, string>;
  splitByField: string | null;
  muted: Set<string>;
  isolated: string | null;
  onToggleMute: (k: string) => void;
  onIsolate: (k: string) => void;
  onSeriesFilter?: (series: string, exclude: boolean) => void;
}) {
  const [filter, setFilter] = useState("");
  const items = seriesKeys
    .map((k) => ({ k, total: seriesTotals[k] ?? 0 }))
    .filter((x) => !filter || x.k.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="search-timeline-legend">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter series"
        className="search-timeline-legend-filter"
      />
      <div className="search-timeline-legend-list">
        {items.map(({ k, total }) => {
          const visible = isolated ? k === isolated : !muted.has(k);
          const color = colors.get(k) ?? "#71717A";
          const spark = rows.map((r) => Number(r[k] ?? 0));
          return (
            <div
              key={k}
              className={cn("search-timeline-legend-item", !visible && "dim")}
              onClick={() => onToggleMute(k)}
              onDoubleClick={() => onIsolate(k)}
              title={`${k} — click: show/hide · double-click: solo`}
            >
              <span className="dot" style={{ background: color }} />
              <span className="name">{k}</span>
              <LegendSparkline values={spark} color={color} dim={!visible} />
              <span className="total">{formatY(total)}</span>
              {splitByField && onSeriesFilter && k !== "Other" && (
                <button
                  type="button"
                  className="legend-filter-btn"
                  title={`Add ${splitByField}="${k}" (⇧ exclude)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeriesFilter(k, e.shiftKey);
                  }}
                >
                  <Filter className="icon" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="search-timeline-legend-hint">
        click: mute · dbl: isolate
        {splitByField ? ` · filter: ${splitByField} (⇧ exclude)` : ""}
      </div>
    </div>
  );
}

function TimechartPivotTable({
  rows,
  seriesKeys,
  visibleKeys,
}: {
  rows: TimechartRow[];
  seriesKeys: string[];
  visibleKeys: string[];
}) {
  const cols = seriesKeys.filter((k) => visibleKeys.includes(k));
  return (
    <div className="search-timeline-pivot">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            {cols.map((k) => (
              <th key={k}>{k}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const total = cols.reduce((s, k) => s + Number(row[k] ?? 0), 0);
            return (
              <tr key={i}>
                <td>{formatBucketTime(row.timestamp, true)}</td>
                {cols.map((k) => (
                  <td key={k}>{Number(row[k] ?? 0) || ""}</td>
                ))}
                <td className="strong">{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SearchTimeline({
  mode,
  histogram = [],
  histSpanMinutes,
  onHistSpanChange,
  timechartRows = [],
  query,
  onApplyQuery,
  chartType,
  onChartTypeChange,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onBrushRange,
  onSeriesFilter,
  eventCount,
  histogramTotal,
  zoomLabel,
  zoomActive = false,
  viewDomain,
  rarityEnabled = false,
  scatterData = null,
  scatterLoading = false,
  scatterError,
  scatterTimeRange,
  onRarityTabOpen,
  onArtifactClick,
  onMaxHostCountChange,
  isAssetMode = false,
  embedded = false,
}: {
  mode: "histogram" | "timechart";
  histogram?: HistBucket[];
  histSpanMinutes: number;
  onHistSpanChange: (minutes: number) => void;
  timechartRows?: SearchRow[];
  query?: string;
  onApplyQuery?: (nextQuery: string) => void;
  chartType: ChartType;
  onChartTypeChange: (t: ChartType) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onBrushRange: (fromMs: number, toMs: number) => void;
  /** Add split-by field filter from legend (⇧ = exclude). */
  onSeriesFilter?: (series: string, exclude: boolean) => void;
  eventCount?: number;
  /** Sum of histogram bucket counts (event stream total). */
  histogramTotal?: number;
  zoomLabel?: string;
  zoomActive?: boolean;
  /** Optional X-axis domain when zoomed (ms). */
  viewDomain?: { from: number; to: number };
  rarityEnabled?: boolean;
  scatterData?: PrevalenceScatterData | null;
  scatterLoading?: boolean;
  scatterError?: string;
  scatterTimeRange?: { start: string; end: string };
  onRarityTabOpen?: () => void;
  onArtifactClick?: (artifact: string, type: "hash" | "ip") => void;
  onMaxHostCountChange?: (max: number) => void;
  isAssetMode?: boolean;
  /** Compact toolbar + chart for case dashboard panels (no outer card / collapse). */
  embedded?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [vizTab, setVizTab] = useState<"stream" | "rarity">(isAssetMode ? "rarity" : "stream");

  useEffect(() => {
    if (isAssetMode) setVizTab("rarity");
  }, [isAssetMode]);

  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);
  const brushStartRef = useRef<number | null>(null);
  const brushEndRef = useRef<number | null>(null);
  const brushDraggingRef = useRef(false);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [isolated, setIsolated] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(!embedded);

  const { aggLabel, by } = parseTimechartHeader(query);
  const histPoints = useMemo(() => histogramToPoints(histogram), [histogram]);
  const timechart = useMemo(
    () => transformTimechartRows(timechartRows, by),
    [timechartRows, by]
  );

  const chartRows = mode === "timechart" ? timechart.rows : histPoints;
  const bucketMs = useMemo(() => bucketIntervalMs(chartRows), [chartRows]);
  const spansDays = useMemo(() => {
    if (chartRows.length < 2) return false;
    const start = chartRows[0].timestamp;
    const end = chartRows[chartRows.length - 1].timestamp;
    return end - start > 24 * 60 * 60 * 1000;
  }, [chartRows]);

  const spanKey =
    mode === "timechart"
      ? `${parseSpan(query).n}${parseSpan(query).unit}`
      : TIMELINE_SPAN_OPTIONS.find((o) => o.minutes === histSpanMinutes)?.key ?? "1h";

  const seriesColors = useMemo(
    () => seriesColorMap(timechart.seriesKeys),
    [timechart.seriesKeys]
  );
  const isVisible = useCallback(
    (k: string) => (isolated ? k === isolated : !muted.has(k)),
    [muted, isolated]
  );
  const visibleSeries = timechart.seriesKeys.filter(isVisible);

  const xDomain: [number, number] | ["dataMin", "dataMax"] = useMemo(() => {
    if (viewDomain) return [viewDomain.from, viewDomain.to];
    return ["dataMin", "dataMax"];
  }, [viewDomain]);

  const finishBrush = useCallback(() => {
    const left = brushStartRef.current;
    const right = brushEndRef.current;
    if (left != null) {
      if (brushDraggingRef.current && right != null && left !== right) {
        const startTs = Math.min(left, right);
        const endTs = Math.max(left, right);
        onBrushRange(startTs, endTs + bucketMs);
      } else {
        onBrushRange(left, left + bucketMs);
      }
    }
    brushStartRef.current = null;
    brushEndRef.current = null;
    brushDraggingRef.current = false;
    setRefAreaLeft(null);
    setRefAreaRight(null);
  }, [bucketMs, onBrushRange]);

  const chartMouseHandlers = {
    onMouseDown: (e: unknown) => {
      const ts = getTsFromChartEvent(e, chartRows);
      if (ts == null) return;
      brushStartRef.current = ts;
      brushEndRef.current = null;
      brushDraggingRef.current = false;
      setRefAreaLeft(ts);
      setRefAreaRight(null);
    },
    onMouseMove: (e: unknown) => {
      if (brushStartRef.current == null) return;
      const ts = getTsFromChartEvent(e, chartRows);
      if (ts == null) return;
      if (ts !== brushStartRef.current) brushDraggingRef.current = true;
      brushEndRef.current = ts;
      setRefAreaRight(ts);
    },
    onMouseUp: () => finishBrush(),
    onMouseLeave: () => {
      if (brushStartRef.current != null) finishBrush();
    },
  };

  const chartStyle = { cursor: "crosshair", userSelect: "none" as const };

  const handleSpanPick = (key: string) => {
    if (mode === "timechart") {
      if (!query || !onApplyQuery) return;
      onApplyQuery(setSpanInQuery(query, key));
      return;
    }
    const opt = TIMELINE_SPAN_OPTIONS.find((o) => o.key === key);
    if (opt) onHistSpanChange(opt.minutes);
  };

  const handleExport = () => {
    if (mode === "timechart") {
      const cols = timechart.seriesKeys;
      downloadTimelineCsv(
        "timechart.csv",
        ["time", ...cols, "total"],
        timechart.rows.map((row) => {
          const vals = cols.map((k) => String(row[k] ?? 0));
          const total = cols.reduce((s, k) => s + Number(row[k] ?? 0), 0);
          return [formatBucketTime(row.timestamp, true), ...vals, String(total)];
        })
      );
    } else {
      downloadTimelineCsv(
        "timeline.csv",
        ["time", "count"],
        histPoints.map((p) => [formatBucketTime(p.timestamp, spansDays), String(p.count)])
      );
    }
  };

  const toggleMute = (k: string) => {
    if (isolated) {
      setIsolated(null);
      return;
    }
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const handleIsolate = (k: string) => {
    setIsolated((cur) => (cur === k ? null : k));
    setMuted(new Set());
  };

  const showRarityTab = mode === "histogram" && rarityEnabled;
  const showTimechart = mode === "timechart" && chartRows.length > 0;
  const showStream = mode === "histogram" && vizTab === "stream" && chartRows.length > 0;
  const showRarity = vizTab === "rarity" && showRarityTab;
  const showChart = showTimechart || showStream;

  if (mode === "timechart" && !chartRows.length && !embedded) return null;
  if (mode === "histogram" && !showStream && !showRarity) return null;

  const title =
    mode === "timechart"
      ? "Timechart"
      : vizTab === "rarity"
        ? "Artifact rarity"
        : "Event stream";
  const bucketLabel = spanKey;
  const streamTotal = histogramTotal ?? eventCount;
  const subtitle =
    mode === "timechart"
      ? `${aggLabel} by ${by ?? "(none)"}`
      : [
          streamTotal != null ? `${streamTotal.toLocaleString()} events` : null,
          `bucket ${bucketLabel}`,
          zoomActive ? "zoomed" : "drag to zoom",
        ]
          .filter(Boolean)
          .join(" · ");

  const renderSeries = (Chart: typeof AreaChart | typeof LineChart | typeof BarChart) => {
    const common = {
      data: chartRows,
      margin: { top: 8, right: 8, left: 0, bottom: 4 },
      style: chartStyle,
      ...chartMouseHandlers,
    };

    const xAxis = (
      <XAxis
        dataKey="timestamp"
        type="number"
        scale="time"
        domain={xDomain}
        allowDataOverflow
        tickFormatter={(v) => formatBucketTime(v as number, spansDays)}
        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
        axisLine={{ stroke: "var(--border)" }}
        tickLine={false}
        minTickGap={40}
      />
    );

    const refArea =
      refAreaLeft != null && refAreaRight != null ? (
        <ReferenceArea
          x1={Math.min(refAreaLeft, refAreaRight)}
          x2={Math.max(refAreaLeft, refAreaRight)}
          strokeOpacity={0.35}
          stroke="var(--primary)"
          fill="var(--primary)"
          fillOpacity={0.18}
        />
      ) : null;

    if (mode === "timechart") {
      return (
        <Chart {...common}>
          <CartesianGrid strokeDasharray="2 3" stroke="var(--border)" vertical={false} />
          {xAxis}
          <YAxis
            tickFormatter={(v) => formatY(v as number)}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            content={(props) => (
              <ChartTooltipBody
                active={props.active}
                payload={props.payload as TooltipPayload}
                label={props.label}
                bucketMs={bucketMs}
                spansDays={spansDays}
                isStacked
              />
            )}
          />
          {refArea}
          {timechart.seriesKeys.map((k) => {
            const color = seriesColors.get(k) ?? "#71717A";
            const visible = isVisible(k);
            if (chartType === "bar") {
              return (
                <Bar
                  key={k}
                  dataKey={k}
                  name={k}
                  stackId="a"
                  hide={!visible}
                  fill={color}
                  fillOpacity={0.85}
                  isAnimationActive={false}
                />
              );
            }
            if (chartType === "line") {
              return (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  name={k}
                  hide={!visible}
                  stroke={color}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              );
            }
            return (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                name={k}
                hide={!visible}
                stackId="a"
                stroke={color}
                fill={color}
                fillOpacity={0.22}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            );
          })}
        </Chart>
      );
    }

    const dataKey = "count";
    const histExtra =
      chartType === "bar" ? { barCategoryGap: 0 as const } : {};
    return (
      <Chart {...common} {...histExtra}>
        <CartesianGrid strokeDasharray="2 3" stroke="var(--border)" vertical={false} />
        {xAxis}
        <YAxis
          tickFormatter={(v) => formatY(v as number)}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          content={(props) => (
            <ChartTooltipBody
              active={props.active}
              payload={props.payload as TooltipPayload}
              label={props.label}
              bucketMs={bucketMs}
              spansDays={spansDays}
            />
          )}
        />
        {refArea}
        {chartType === "bar" ? (
          <Bar
            dataKey={dataKey}
            fill="var(--primary)"
            fillOpacity={0.85}
            minPointSize={2}
            radius={[0, 0, 0, 0]}
            isAnimationActive={false}
          />
        ) : chartType === "line" ? (
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke="var(--primary)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ) : (
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke="var(--primary)"
            fill="var(--primary)"
            fillOpacity={0.22}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        )}
      </Chart>
    );
  };

  const ChartComponent =
    chartType === "bar" ? BarChart : chartType === "line" ? LineChart : AreaChart;

  return (
    <div
      className={cn(
        embedded ? "search-timeline search-timeline--embedded" : "card search-timeline",
        !embedded && collapsed && "search-timeline-collapsed"
      )}
    >
      <div className="search-timeline-header">
        {embedded ? (
          <div className="search-timeline-title search-timeline-title--embedded">
            <Activity className="icon accent" />
            <span className="subtitle">{subtitle}</span>
            {zoomLabel && (
              <>
                <span className="muted">·</span>
                <span className="subtitle zoom-range">{zoomLabel}</span>
              </>
            )}
          </div>
        ) : (
        <button
          type="button"
          className="search-timeline-title search-timeline-title-btn"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? (
            <ChevronRight className="icon accent" />
          ) : (
            <ChevronDown className="icon accent" />
          )}
          {vizTab === "rarity" ? (
            <Fingerprint className="icon accent" />
          ) : (
            <Activity className="icon accent" />
          )}
          {title}
          <span className="muted">·</span>
          <span className="subtitle">
            {vizTab === "rarity" && scatterData
              ? `${(scatterData.hash_points.length + scatterData.ip_points.length).toLocaleString()} artifacts`
              : subtitle}
          </span>
          {zoomLabel && (
            <>
              <span className="muted">·</span>
              <span className="subtitle zoom-range">{zoomLabel}</span>
            </>
          )}
        </button>
        )}
        {(!collapsed || embedded) && showChart && <SpanChip current={spanKey} onPick={handleSpanPick} />}
        {showRarityTab && (!collapsed || embedded) && (
          <div className="search-timeline-viz-tabs">
            <button
              type="button"
              className={cn(vizTab === "stream" && "active")}
              onClick={() => setVizTab("stream")}
            >
              <Activity className="icon" />
              Stream
            </button>
            <button
              type="button"
              className={cn(vizTab === "rarity" && "active")}
              disabled={!rarityEnabled}
              title={rarityEnabled ? "Artifact rarity" : "No artifacts in results"}
              onClick={() => {
                setVizTab("rarity");
                onRarityTabOpen?.();
              }}
            >
              <Fingerprint className="icon" />
              Rarity
            </button>
          </div>
        )}
        <span className="flex-1" />
        {(!collapsed || embedded) && showChart && (
          <>
            <div className="search-timeline-chart-types">
              <button
                type="button"
                title="Bar"
                className={cn(chartType === "bar" && "active")}
                onClick={() => onChartTypeChange("bar")}
              >
                <BarChart3 className="icon" />
              </button>
              <button
                type="button"
                title="Line"
                className={cn(chartType === "line" && "active")}
                onClick={() => onChartTypeChange("line")}
              >
                <LineChartIcon className="icon" />
              </button>
              <button
                type="button"
                title="Area"
                className={cn(chartType === "area" && "active")}
                onClick={() => onChartTypeChange("area")}
              >
                <TrendingUp className="icon" />
              </button>
            </div>
            {(mode === "histogram" || mode === "timechart") && (
              <div className="search-timeline-zoom">
                <button type="button" title="Zoom in" onClick={onZoomIn}>
                  <ZoomIn className="icon" />
                </button>
                <button type="button" title="Zoom out" onClick={onZoomOut}>
                  <ZoomOut className="icon" />
                </button>
                <button
                  type="button"
                  title="Reset zoom"
                  onClick={onResetZoom}
                  className={cn(zoomActive && "active")}
                >
                  <RotateCcw className="icon" />
                </button>
              </div>
            )}
            {mode === "timechart" && (
              <button
                type="button"
                className="search-timeline-table-toggle"
                onClick={() => setTableOpen((v) => !v)}
              >
                <Grid3x3 className="icon" />
                {tableOpen ? "Hide table" : "Show table"}
              </button>
            )}
            <button
              type="button"
              title="Export CSV"
              className="search-timeline-export"
              onClick={handleExport}
            >
              <Download className="icon" />
            </button>
          </>
        )}
      </div>

      {(!collapsed || embedded) && showRarity && (
        <PrevalenceScatterPlot
          data={scatterData}
          loading={scatterLoading}
          error={scatterError}
          timeRange={scatterTimeRange}
          onArtifactClick={onArtifactClick}
          onMaxHostCountChange={isAssetMode ? onMaxHostCountChange : undefined}
        />
      )}

      {(!collapsed || embedded) && showChart && (
        <>
          <div
            className={cn(
              "search-timeline-body",
              mode === "timechart" && "with-legend",
              embedded && "search-timeline-body--embedded"
            )}
          >
            <div className="search-timeline-chart">
              <ResponsiveContainer
                width="100%"
                height={embedded ? 220 : "100%"}
                minHeight={embedded ? 220 : 280}
              >
                {renderSeries(ChartComponent)}
              </ResponsiveContainer>
            </div>
            {mode === "timechart" && (
              <TimechartLegend
                seriesKeys={timechart.seriesKeys}
                seriesTotals={timechart.seriesTotals}
                rows={timechart.rows}
                colors={seriesColors}
                splitByField={by}
                muted={muted}
                isolated={isolated}
                onToggleMute={toggleMute}
                onIsolate={handleIsolate}
                onSeriesFilter={onSeriesFilter}
              />
            )}
          </div>

          {mode === "timechart" && tableOpen && (
            <TimechartPivotTable
              rows={timechart.rows}
              seriesKeys={timechart.seriesKeys}
              visibleKeys={visibleSeries}
            />
          )}
          {!embedded && (
          <p className="muted search-timeline-hint">
            {mode === "histogram"
              ? "Drag or click buckets to zoom · +/- buttons · reset clears range"
              : "Colored series = split-by field · legend: mute / isolate / filter icon adds to query"}
          </p>
          )}
        </>
      )}
      {(!collapsed || embedded) && showRarity && (
        <p className="muted search-timeline-hint">
          X = first seen in scope · Y = devices (7d rollup) · click dot to filter query
          {isAssetMode ? " · asset mode keeps rarity view" : ""}
        </p>
      )}
    </div>
  );
}
