/** Precise lock/unlock timeline — one marker per event at second-level timestamps. */

export type LockUnlockSeriesKey = "unlocked" | "locked" | "failed" | "autolock";

export type LockUnlockTimelinePoint = {
  t: number;
  kind: LockUnlockSeriesKey;
};

/** One plotted event at its exact timestamp (ms). */
export type LockUnlockChartEvent = {
  t: number;
  label: string;
  kind: LockUnlockSeriesKey;
  /** Scatter y-slot (stable lanes). */
  y: number;
  unlocked: number | null;
  locked: number | null;
  failed: number | null;
  autolock: number | null;
};

/** Step sample for device lock state (0 = unlocked, 1 = locked). */
export type LockUnlockStateStep = {
  t: number;
  label: string;
  state: number;
  kind: LockUnlockSeriesKey;
};

export type LockUnlockPreciseTimeline = {
  events: LockUnlockChartEvent[];
  stateSteps: LockUnlockStateStep[];
  series: LockUnlockSeriesKey[];
  spanMs: number;
  minT: number;
  maxT: number;
};

/** @deprecated Prefer {@link buildLockUnlockPreciseTimeline}. Kept for older call sites. */
export type LockUnlockTimelineBucket = {
  t: number;
  label: string;
  unlocked: number;
  locked: number;
  failed: number;
  autolock: number;
};

export const LOCK_UNLOCK_SERIES_COLORS: Record<LockUnlockSeriesKey, string> = {
  unlocked: "var(--chart-2, #22c55e)",
  locked: "var(--muted-foreground)",
  failed: "var(--destructive, #ef4444)",
  autolock: "var(--accent-orange, #f97316)",
};

export const LOCK_UNLOCK_SERIES_LABELS: Record<LockUnlockSeriesKey, string> = {
  unlocked: "Unlocked",
  locked: "Locked",
  failed: "Failed",
  autolock: "Auto-lock",
};

const SERIES_Y: Record<LockUnlockSeriesKey, number> = {
  unlocked: 3,
  locked: 2,
  autolock: 1,
  failed: 0,
};

/** Full datetime with seconds for tooltips / axis when precise. */
export function formatLockUnlockTimestamp(ms: number, opts?: { withDate?: boolean }): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const withDate = opts?.withDate ?? true;
  if (withDate) {
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatLockUnlockAxisTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  // Short spans: show clock with seconds.
  if (spanMs <= 15 * 60_000) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (spanMs <= 24 * 60 * 60_000) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function emptyScatter(kind: LockUnlockSeriesKey): Pick<
  LockUnlockChartEvent,
  "unlocked" | "locked" | "failed" | "autolock"
> {
  return {
    unlocked: kind === "unlocked" ? SERIES_Y.unlocked : null,
    locked: kind === "locked" ? SERIES_Y.locked : null,
    failed: kind === "failed" ? SERIES_Y.failed : null,
    autolock: kind === "autolock" ? SERIES_Y.autolock : null,
  };
}

/**
 * Build a second-precise event series (no coarse bucketing).
 * Lock/unlock/autolock also produce a step state line.
 */
export function buildLockUnlockPreciseTimeline(
  points: LockUnlockTimelinePoint[]
): LockUnlockPreciseTimeline {
  const cleaned = points
    .filter((p) => Number.isFinite(p.t) && p.t > 0)
    .slice()
    .sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind));

  if (!cleaned.length) {
    return { events: [], stateSteps: [], series: [], spanMs: 0, minT: 0, maxT: 0 };
  }

  const minT = cleaned[0]!.t;
  const maxT = cleaned[cleaned.length - 1]!.t;
  const spanMs = Math.max(maxT - minT, 1000);

  const seriesSet = new Set<LockUnlockSeriesKey>();
  const events: LockUnlockChartEvent[] = cleaned.map((p) => {
    seriesSet.add(p.kind);
    return {
      t: p.t,
      label: formatLockUnlockTimestamp(p.t),
      kind: p.kind,
      y: SERIES_Y[p.kind],
      ...emptyScatter(p.kind),
    };
  });

  const stateSteps: LockUnlockStateStep[] = [];
  let state: number | null = null;
  for (const p of cleaned) {
    if (p.kind === "failed") continue;
    let next: number | null = null;
    if (p.kind === "unlocked") next = 0;
    else if (p.kind === "locked" || p.kind === "autolock") next = 1;
    if (next == null) continue;
    // Hold previous state until this transition (stepAfter-friendly duplicate).
    if (state != null && stateSteps.length > 0) {
      stateSteps.push({
        t: p.t,
        label: formatLockUnlockTimestamp(p.t),
        state,
        kind: p.kind,
      });
    }
    state = next;
    stateSteps.push({
      t: p.t,
      label: formatLockUnlockTimestamp(p.t),
      state: next,
      kind: p.kind,
    });
  }

  const order: LockUnlockSeriesKey[] = ["unlocked", "locked", "failed", "autolock"];
  const series = order.filter((k) => seriesSet.has(k));

  return { events, stateSteps, series, spanMs, minT, maxT };
}

export function presentLockUnlockSeriesFromPoints(
  points: LockUnlockTimelinePoint[]
): LockUnlockSeriesKey[] {
  return buildLockUnlockPreciseTimeline(points).series;
}

/** @deprecated Use {@link buildLockUnlockPreciseTimeline}. */
export function lockUnlockTimelineBuckets(
  points: LockUnlockTimelinePoint[]
): LockUnlockTimelineBucket[] {
  // Compatibility shim: 1s buckets so callers still get second precision.
  const map = new Map<number, LockUnlockTimelineBucket>();
  for (const p of points) {
    if (!Number.isFinite(p.t) || p.t <= 0) continue;
    const key = Math.floor(p.t / 1000) * 1000;
    let b = map.get(key);
    if (!b) {
      b = {
        t: key,
        label: formatLockUnlockTimestamp(key),
        unlocked: 0,
        locked: 0,
        failed: 0,
        autolock: 0,
      };
      map.set(key, b);
    }
    b[p.kind] += 1;
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export function presentLockUnlockSeries(
  buckets: LockUnlockTimelineBucket[]
): LockUnlockSeriesKey[] {
  const keys: LockUnlockSeriesKey[] = ["unlocked", "locked", "failed", "autolock"];
  return keys.filter((k) => buckets.some((b) => b[k] > 0));
}

export type LockUnlockDensityBucket = {
  t: number;
  end: number;
  label: string;
  count: number;
  unlocked: number;
  locked: number;
  failed: number;
  autolock: number;
};

/** Coarse density strip for overview / brush navigation (not the precise plot). */
export function buildLockUnlockDensityOverview(
  events: LockUnlockChartEvent[],
  opts?: { minT?: number; maxT?: number; buckets?: number }
): LockUnlockDensityBucket[] {
  if (!events.length) return [];
  const minT = opts?.minT ?? events[0]!.t;
  const maxT = opts?.maxT ?? events[events.length - 1]!.t;
  const span = Math.max(maxT - minT, 1000);
  const requested = opts?.buckets;
  const n =
    requested != null
      ? Math.max(4, Math.min(requested, 128))
      : Math.max(12, Math.min(48, 96));
  const width = span / n;
  const out: LockUnlockDensityBucket[] = Array.from({ length: n }, (_, i) => {
    const t = minT + i * width;
    return {
      t,
      end: t + width,
      label: formatLockUnlockTimestamp(t, { withDate: false }),
      count: 0,
      unlocked: 0,
      locked: 0,
      failed: 0,
      autolock: 0,
    };
  });
  for (const e of events) {
    let idx = Math.floor((e.t - minT) / width);
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    const b = out[idx]!;
    b.count += 1;
    b[e.kind] += 1;
  }
  return out;
}

/** Events near a hover time — helps when markers overlap. */
export function nearbyLockUnlockEvents(
  events: LockUnlockChartEvent[],
  t: number,
  windowMs: number,
  limit = 12
): LockUnlockChartEvent[] {
  const half = Math.max(windowMs / 2, 500);
  const hits = events.filter((e) => Math.abs(e.t - t) <= half);
  hits.sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t) || a.t - b.t);
  return hits.slice(0, limit);
}

export function clampLockUnlockDomain(
  from: number,
  to: number,
  minT: number,
  maxT: number,
  minSpanMs = 5_000
): [number, number] {
  let a = Math.min(from, to);
  let b = Math.max(from, to);
  if (b - a < minSpanMs) {
    const mid = (a + b) / 2;
    a = mid - minSpanMs / 2;
    b = mid + minSpanMs / 2;
  }
  if (a < minT) {
    b += minT - a;
    a = minT;
  }
  if (b > maxT) {
    a -= b - maxT;
    b = maxT;
  }
  a = Math.max(a, minT);
  b = Math.min(b, maxT);
  if (b - a < minSpanMs && maxT - minT >= minSpanMs) {
    return [minT, Math.min(maxT, minT + minSpanMs)];
  }
  return [a, b];
}
