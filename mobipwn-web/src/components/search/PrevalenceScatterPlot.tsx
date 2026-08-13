import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hash, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScatterPoint = {
  artifact: string;
  artifact_type: string;
  first_seen: string;
  last_seen: string;
  total_occurrences: number;
  host_count: number;
  is_rare: boolean;
  prevalence_score: number;
};

export type PrevalenceScatterData = {
  hash_points: ScatterPoint[];
  ip_points: ScatterPoint[];
  rarity_threshold: number;
  max_artifact_host_count?: number;
};

type RarityDot = {
  artifact: string;
  artifactType: "hash" | "ip";
  firstSeen: Date;
  hostCount: number;
  events: number;
  isRare: boolean;
};

type PrevalenceScatterPlotProps = {
  data: PrevalenceScatterData | null;
  loading?: boolean;
  error?: string;
  height?: number;
  defaultMaxHostCount?: number;
  onArtifactClick?: (artifact: string, type: "hash" | "ip") => void;
  onMaxHostCountChange?: (max: number) => void;
  timeRange?: { start: string; end: string };
};

const PL = 56;
const PR = 12;
const PT = 12;
const PB = 28;

function parseTs(s: string): Date {
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function fmtUtc(d: Date) {
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function PrevalenceScatterPlot({
  data,
  loading,
  error,
  height = 200,
  defaultMaxHostCount = 10,
  onArtifactClick,
  onMaxHostCountChange,
  timeRange,
}: PrevalenceScatterPlotProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [maxHostCount, setMaxHostCount] = useState(defaultMaxHostCount);
  const [tip, setTip] = useState<{ d: RarityDot; px: number; py: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    setWidth(Math.max(1, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  const debouncedHostChange = useCallback(
    (v: number) => {
      if (!onMaxHostCountChange) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onMaxHostCountChange(v), 400);
    },
    [onMaxHostCountChange]
  );

  const dots: RarityDot[] = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, RarityDot>();
    const ingest = (p: ScatterPoint, t: "hash" | "ip") => {
      if (p.host_count > maxHostCount) return;
      const key = `${t}::${p.artifact}`;
      const ts = parseTs(p.first_seen);
      const existing = map.get(key);
      if (existing) {
        existing.events += p.total_occurrences;
        if (ts < existing.firstSeen) existing.firstSeen = ts;
      } else {
        map.set(key, {
          artifact: p.artifact,
          artifactType: t,
          firstSeen: ts,
          hostCount: p.host_count,
          events: p.total_occurrences,
          isRare: p.is_rare,
        });
      }
    };
    for (const p of data.hash_points) ingest(p, "hash");
    for (const p of data.ip_points) ingest(p, "ip");
    return [...map.values()];
  }, [data, maxHostCount]);

  const W = width;
  const H = height;
  const plotW = Math.max(1, W - PL - PR);
  const plotH = Math.max(1, H - PT - PB);

  const xDomain = useMemo(() => {
    if (timeRange?.start && timeRange?.end) {
      return { min: parseTs(timeRange.start).getTime(), max: parseTs(timeRange.end).getTime() };
    }
    if (!dots.length) {
      const now = Date.now();
      return { min: now - 86400000, max: now };
    }
    const times = dots.map((d) => d.firstSeen.getTime());
    return { min: Math.min(...times), max: Math.max(...times) };
  }, [dots, timeRange]);

  const maxHosts = Math.max(1, data?.max_artifact_host_count ?? 10, ...dots.map((d) => d.hostCount));

  const xScale = (t: number) => {
    const span = Math.max(1, xDomain.max - xDomain.min);
    return PL + ((t - xDomain.min) / span) * plotW;
  };
  const yScale = (h: number) => PT + plotH - (h / maxHosts) * plotH;

  if (loading) {
    return <p className="muted prevalence-scatter-status">Loading artifact rarity…</p>;
  }
  if (error) {
    return <p className="error prevalence-scatter-status">{error}</p>;
  }
  if (!data || dots.length === 0) {
    return (
      <p className="muted prevalence-scatter-status">
        No file hashes or destination IPs in this search scope. Try a query that returns{" "}
        <code className="mono">file_hash</code> or <code className="mono">dest_ip</code>.
      </p>
    );
  }

  return (
    <div className="prevalence-scatter">
      <div className="prevalence-scatter-toolbar">
        <span className="muted">Max devices</span>
        <input
          type="range"
          min={0}
          max={Math.max(10, maxHosts)}
          value={maxHostCount}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMaxHostCount(v);
            debouncedHostChange(v);
          }}
        />
        <span className="tabular-nums">{maxHostCount}</span>
        <span className="prevalence-scatter-legend">
          <Hash className="icon" /> hash
          <Globe className="icon" /> IP
        </span>
      </div>
      <div ref={plotRef} className="prevalence-scatter-plot" style={{ height: H }}>
        <svg width={W} height={H} className="prevalence-scatter-svg">
          <line x1={PL} y1={PT + plotH} x2={PL + plotW} y2={PT + plotH} stroke="var(--border)" />
          <line x1={PL} y1={PT} x2={PL} y2={PT + plotH} stroke="var(--border)" />
          {dots.map((d) => {
            const cx = xScale(d.firstSeen.getTime());
            const cy = yScale(d.hostCount);
            const fill = d.artifactType === "hash" ? "var(--primary)" : "var(--accent-orange, #e67e22)";
            return (
              <circle
                key={`${d.artifactType}-${d.artifact}`}
                cx={cx}
                cy={cy}
                r={d.isRare ? 5 : 3.5}
                fill={fill}
                fillOpacity={d.isRare ? 0.95 : 0.55}
                stroke={d.isRare ? "var(--destructive, #ef4444)" : "transparent"}
                strokeWidth={1.5}
                className="prevalence-dot"
                onMouseEnter={() => setTip({ d, px: cx, py: cy })}
                onMouseLeave={() => setTip(null)}
                onClick={() => onArtifactClick?.(d.artifact, d.artifactType)}
              />
            );
          })}
        </svg>
        {tip && (
          <div
            className="prevalence-scatter-tip"
            style={{ left: tip.px, top: tip.py - 8 }}
          >
            <div className={cn("tip-type", tip.d.isRare && "rare")}>
              {tip.d.artifactType} {tip.d.isRare ? "· rare" : ""}
            </div>
            <div className="tip-artifact mono">{tip.d.artifact}</div>
            <div>{fmtUtc(tip.d.firstSeen)}</div>
            <div>
              {tip.d.hostCount} device{tip.d.hostCount === 1 ? "" : "s"} · {tip.d.events} hit
              {tip.d.events === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
