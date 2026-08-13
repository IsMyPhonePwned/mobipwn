import { useCallback, useMemo, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildLockUnlockDensityOverview,
  clampLockUnlockDomain,
  formatLockUnlockAxisTick,
  formatLockUnlockTimestamp,
  LOCK_UNLOCK_SERIES_COLORS,
  LOCK_UNLOCK_SERIES_LABELS,
  nearbyLockUnlockEvents,
  type LockUnlockChartEvent,
  type LockUnlockPreciseTimeline,
  type LockUnlockSeriesKey,
  type LockUnlockStateStep,
} from "@/lib/lockUnlockTimeline";

type StemProps = {
  cx?: number;
  cy?: number;
  fill?: string;
  dense?: boolean;
};

/** Tall thin stems read better than dots when many events share the axis. */
function EventStem({ cx, cy, fill, dense }: StemProps) {
  if (cx == null || cy == null || !fill) return null;
  const halfH = dense ? 9 : 11;
  const strokeW = dense ? 1.5 : 2.25;
  return (
    <g>
      <line
        x1={cx}
        y1={cy - halfH}
        x2={cx}
        y2={cy + halfH}
        stroke={fill}
        strokeWidth={strokeW}
        strokeLinecap="round"
        opacity={dense ? 0.85 : 0.95}
      />
      <circle cx={cx} cy={cy} r={dense ? 2 : 2.75} fill={fill} stroke="var(--card)" strokeWidth={1} />
    </g>
  );
}

function chartActiveTs(e: unknown): number | null {
  if (!e || typeof e !== "object") return null;
  const activeLabel = (e as { activeLabel?: unknown }).activeLabel;
  if (typeof activeLabel === "number" && Number.isFinite(activeLabel)) return activeLabel;
  const payload = (e as { activePayload?: Array<{ payload?: { t?: unknown } }> }).activePayload;
  const t = payload?.[0]?.payload?.t;
  return typeof t === "number" && Number.isFinite(t) ? t : null;
}

function EventTooltip({
  active,
  payload,
  allEvents,
  viewSpanMs,
  visibleKinds,
}: {
  active?: boolean;
  payload?: Array<{ payload?: LockUnlockChartEvent | (LockUnlockStateStep & { stateY?: number }) }>;
  allEvents: LockUnlockChartEvent[];
  viewSpanMs: number;
  visibleKinds: Set<LockUnlockSeriesKey>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const windowMs = Math.max(viewSpanMs / 60, 1_000);
  const nearby = nearbyLockUnlockEvents(
    allEvents.filter((e) => visibleKinds.has(e.kind)),
    row.t,
    windowMs
  );
  const list = nearby.length ? nearby : "kind" in row && "y" in row ? [row as LockUnlockChartEvent] : [];

  return (
    <div className="case-lock-timeline__tooltip">
      <div className="case-lock-timeline__tooltip-label mono">
        {formatLockUnlockTimestamp(row.t)}
      </div>
      {list.length > 1 && (
        <div className="case-lock-timeline__tooltip-count muted">
          {list.length} events near this second
        </div>
      )}
      <ul>
        {list.map((ev, i) => (
          <li key={`${ev.t}-${ev.kind}-${i}`}>
            <span
              className="case-lock-timeline__swatch"
              style={{ background: LOCK_UNLOCK_SERIES_COLORS[ev.kind] }}
            />
            <span className="mono">{formatLockUnlockTimestamp(ev.t, { withDate: false })}</span>
            <span>{LOCK_UNLOCK_SERIES_LABELS[ev.kind]}</span>
          </li>
        ))}
        {!list.length && "state" in row && (
          <li>
            <span
              className="case-lock-timeline__swatch case-lock-timeline__swatch--line"
              style={{ background: "var(--primary)" }}
            />
            {row.state === 0 ? "State: unlocked" : "State: locked"}
          </li>
        )}
      </ul>
    </div>
  );
}

export function LockUnlockTimelineChart({
  timeline,
  title = "Lock / unlock timeline",
}: {
  timeline: LockUnlockPreciseTimeline;
  title?: string;
}) {
  const { events, stateSteps, series, spanMs, minT, maxT } = timeline;
  const [viewDomain, setViewDomain] = useState<[number, number] | null>(null);
  const [muted, setMuted] = useState<Set<LockUnlockSeriesKey>>(() => new Set());
  const [brushLeft, setBrushLeft] = useState<number | null>(null);
  const [brushRight, setBrushRight] = useState<number | null>(null);
  const brushStartRef = useRef<number | null>(null);
  const brushEndRef = useRef<number | null>(null);
  const brushDraggingRef = useRef(false);

  const fullPad = Math.max(Math.floor(spanMs * 0.02), 1000);
  const fullDomain = useMemo(
    (): [number, number] => [minT - fullPad, maxT + fullPad],
    [minT, maxT, fullPad]
  );

  const xDomain = viewDomain ?? fullDomain;
  const viewSpanMs = Math.max(xDomain[1] - xDomain[0], 1000);
  const zoomed = viewDomain != null;
  const dense = events.length >= 40 || (zoomed ? events.length / (viewSpanMs / spanMs) >= 30 : events.length >= 25);

  const visibleKinds = useMemo(() => {
    const set = new Set<LockUnlockSeriesKey>();
    for (const k of series) if (!muted.has(k)) set.add(k);
    return set;
  }, [series, muted]);

  const visibleEvents = useMemo(
    () =>
      events.filter(
        (e) => visibleKinds.has(e.kind) && e.t >= xDomain[0] && e.t <= xDomain[1]
      ),
    [events, visibleKinds, xDomain]
  );

  /** Sparse track so drag-zoom works in empty gaps between markers. */
  const trackData = useMemo(() => {
    const [a, b] = xDomain;
    const n = 96;
    return Array.from({ length: n }, (_, i) => ({
      t: a + (i / Math.max(n - 1, 1)) * (b - a),
      track: -1,
    }));
  }, [xDomain]);

  const showState = stateSteps.length >= 2 && (visibleKinds.has("unlocked") || visibleKinds.has("locked") || visibleKinds.has("autolock"));
  const stateLine = useMemo(() => {
    if (!showState) return [];
    return stateSteps
      .filter((s) => s.t >= xDomain[0] - viewSpanMs * 0.05 && s.t <= xDomain[1] + viewSpanMs * 0.05)
      .map((s) => ({
        ...s,
        stateY: s.state === 0 ? 3 : 2,
      }));
  }, [showState, stateSteps, xDomain, viewSpanMs]);

  // Keep a leading state sample so step line is correct when zoomed mid-session.
  const stateLinePadded = useMemo(() => {
    if (!showState || stateLine.length === 0) return stateLine;
    const firstVisible = stateLine[0]!;
    if (firstVisible.t <= xDomain[0]) return stateLine;
    let prior: (typeof stateSteps)[number] | null = null;
    for (const s of stateSteps) {
      if (s.t > xDomain[0]) break;
      prior = s;
    }
    if (!prior) return stateLine;
    return [
      { ...prior, t: xDomain[0], stateY: prior.state === 0 ? 3 : 2 },
      ...stateLine,
    ];
  }, [showState, stateLine, stateSteps, xDomain]);

  const density = useMemo(
    () => buildLockUnlockDensityOverview(events, { minT, maxT, buckets: dense ? 64 : 40 }),
    [events, minT, maxT, dense]
  );

  const applyZoom = useCallback(
    (from: number, to: number) => {
      setViewDomain(clampLockUnlockDomain(from, to, minT, maxT));
    },
    [minT, maxT]
  );

  const finishBrush = useCallback(() => {
    const left = brushStartRef.current;
    const right = brushEndRef.current;
    if (left != null && brushDraggingRef.current && right != null && left !== right) {
      applyZoom(left, right);
    }
    brushStartRef.current = null;
    brushEndRef.current = null;
    brushDraggingRef.current = false;
    setBrushLeft(null);
    setBrushRight(null);
  }, [applyZoom]);

  const zoomBy = (factor: number) => {
    const mid = (xDomain[0] + xDomain[1]) / 2;
    const half = (xDomain[1] - xDomain[0]) / 2 / factor;
    applyZoom(mid - half, mid + half);
  };

  const toggleKind = (k: LockUnlockSeriesKey) => {
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      // Keep at least one series visible.
      if (series.every((s) => next.has(s))) next.delete(k);
      return next;
    });
  };

  if (!events.length || !series.length) return null;

  const brushSelection =
    brushLeft != null && brushRight != null
      ? ([Math.min(brushLeft, brushRight), Math.max(brushLeft, brushRight)] as const)
      : null;

  return (
    <section className={`case-lock-timeline${dense ? " case-lock-timeline--dense" : ""}`}>
      <div className="case-lock-timeline__head">
        <h4 className="case-lock-timeline__title">{title}</h4>
        <ul className="case-lock-timeline__legend">
          {series.map((k) => {
            const off = muted.has(k);
            const count = events.filter((e) => e.kind === k).length;
            return (
              <li key={k}>
                <button
                  type="button"
                  className={`case-lock-timeline__legend-btn${off ? " is-off" : ""}`}
                  onClick={() => toggleKind(k)}
                  title={off ? `Show ${LOCK_UNLOCK_SERIES_LABELS[k]}` : `Hide ${LOCK_UNLOCK_SERIES_LABELS[k]}`}
                >
                  <span
                    className="case-lock-timeline__swatch"
                    style={{ background: LOCK_UNLOCK_SERIES_COLORS[k] }}
                  />
                  {LOCK_UNLOCK_SERIES_LABELS[k]}
                  <span className="case-lock-timeline__legend-count mono">{count}</span>
                </button>
              </li>
            );
          })}
          {showState && (
            <li className="case-lock-timeline__legend-static">
              <span
                className="case-lock-timeline__swatch case-lock-timeline__swatch--line"
                style={{ background: "var(--primary)" }}
              />
              Lock state
            </li>
          )}
        </ul>
        <div className="case-lock-timeline__tools">
          <span className="muted text-xs">
            {visibleEvents.length}/{events.length} in view
            {zoomed ? " · zoomed" : " · drag to zoom"}
          </span>
          <div className="case-lock-timeline__zoom">
            <button type="button" title="Zoom in" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
              <Plus size={13} />
            </button>
            <button type="button" title="Zoom out" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
              <Minus size={13} />
            </button>
            <button
              type="button"
              title="Reset zoom"
              className={zoomed ? "is-active" : undefined}
              disabled={!zoomed}
              onClick={() => setViewDomain(null)}
              aria-label="Reset zoom"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="case-lock-timeline__plot case-lock-timeline__plot--precise">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={trackData}
            margin={{ top: 10, right: 12, bottom: 4, left: 4 }}
            style={{ cursor: "crosshair", userSelect: "none" }}
            onMouseDown={(e) => {
              const ts = chartActiveTs(e);
              if (ts == null) return;
              brushStartRef.current = ts;
              brushEndRef.current = null;
              brushDraggingRef.current = false;
              setBrushLeft(ts);
              setBrushRight(null);
            }}
            onMouseMove={(e) => {
              if (brushStartRef.current == null) return;
              const ts = chartActiveTs(e);
              if (ts == null) return;
              if (ts !== brushStartRef.current) brushDraggingRef.current = true;
              brushEndRef.current = ts;
              setBrushRight(ts);
            }}
            onMouseUp={() => finishBrush()}
            onMouseLeave={() => {
              if (brushStartRef.current != null) finishBrush();
            }}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              type="number"
              dataKey="t"
              domain={xDomain}
              allowDataOverflow
              tickFormatter={(v) => formatLockUnlockAxisTick(Number(v), viewSpanMs)}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
              height={32}
            />
            <YAxis
              type="number"
              domain={[-0.55, 3.7]}
              ticks={[0, 1, 2, 3]}
              tickFormatter={(v) => {
                const map: Record<number, string> = {
                  0: "Fail",
                  1: "Auto",
                  2: "Lock",
                  3: "Unlock",
                };
                return map[Number(v)] ?? "";
              }}
              width={52}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
            />
            {/* Invisible track series — enables brush x mapping across empty gaps. */}
            <Line
              dataKey="track"
              stroke="transparent"
              strokeWidth={0}
              dot={false}
              activeDot={false}
              legendType="none"
              isAnimationActive={false}
              tooltipType="none"
            />
            <Tooltip
              cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }}
              content={
                <EventTooltip
                  allEvents={events}
                  viewSpanMs={viewSpanMs}
                  visibleKinds={visibleKinds}
                />
              }
            />
            {showState && (
              <Line
                type="stepAfter"
                data={stateLinePadded}
                dataKey="stateY"
                stroke="var(--primary)"
                strokeWidth={1.75}
                strokeOpacity={0.4}
                dot={false}
                isAnimationActive={false}
                name="Lock state"
              />
            )}
            {series.map((k: LockUnlockSeriesKey) =>
              visibleKinds.has(k) ? (
                <Scatter
                  key={k}
                  data={visibleEvents.filter((e) => e.kind === k)}
                  dataKey="y"
                  fill={LOCK_UNLOCK_SERIES_COLORS[k]}
                  isAnimationActive={false}
                  name={LOCK_UNLOCK_SERIES_LABELS[k]}
                  shape={(props: StemProps) => <EventStem {...props} dense={dense} />}
                />
              ) : null
            )}
            {brushSelection && (
              <ReferenceArea
                x1={brushSelection[0]}
                x2={brushSelection[1]}
                strokeOpacity={0.25}
                fill="var(--primary)"
                fillOpacity={0.12}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {density.length > 0 && (
        <div className="case-lock-timeline__overview" title="Click a dense region to zoom">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={density}
              margin={{ top: 2, right: 12, bottom: 0, left: 56 }}
              onClick={(state) => {
                const t = (state as { activePayload?: Array<{ payload?: { t?: number; end?: number } }> })
                  ?.activePayload?.[0]?.payload;
                if (t?.t == null || t.end == null) return;
                applyZoom(t.t, t.end);
              }}
            >
              <XAxis type="number" dataKey="t" hide domain={[minT, maxT]} />
              <YAxis hide domain={[0, "dataMax"]} />
              {series.map((k) =>
                visibleKinds.has(k) ? (
                  <Bar
                    key={k}
                    dataKey={k}
                    stackId="d"
                    fill={LOCK_UNLOCK_SERIES_COLORS[k]}
                    isAnimationActive={false}
                    maxBarSize={10}
                  />
                ) : null
              )}
              {zoomed && (
                <ReferenceArea
                  x1={xDomain[0]}
                  x2={xDomain[1]}
                  fill="var(--primary)"
                  fillOpacity={0.14}
                  stroke="var(--primary)"
                  strokeOpacity={0.35}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
