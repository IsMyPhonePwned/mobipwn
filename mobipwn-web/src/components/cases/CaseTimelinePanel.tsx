import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  SearchTimeline,
  type ChartType,
  type SearchRow,
} from "@/components/search/SearchTimeline";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import {
  CASE_TIMELINE_PANEL_ID,
  caseTimelineQuery,
} from "@/lib/caseDashboard";
import type { DashboardPanel } from "@/lib/dashboard";
import { toTimechartData } from "@/lib/dashboardPanelData";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import { setSpanInQuery } from "@/lib/mplTimechart";

function chartTimeRangeMs(rows: { timestamp: number }[]): { start: number; end: number } {
  if (!rows.length) {
    const now = Date.now();
    return { start: now - 86_400_000, end: now };
  }
  return {
    start: rows[0].timestamp,
    end: rows[rows.length - 1].timestamp,
  };
}

function timechartTotal(rows: SearchRow[], columns: string[], query: string): number {
  const tc = toTimechartData(rows, columns, query);
  return tc.data.reduce(
    (sum, row) => sum + tc.seriesKeys.reduce((s, k) => s + Number(row[k] ?? 0), 0),
    0
  );
}

export function CaseTimelinePanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const navigate = useNavigate();
  const scope = `source="${escapeMplString(ingestSource)}"`;
  const [query, setQuery] = useState(() => caseTimelineQuery(ingestSource, "1d"));
  const [chartType, setChartType] = useState<ChartType>("area");
  const [viewDomain, setViewDomain] = useState<{ from: number; to: number } | undefined>();
  const [zoomActive, setZoomActive] = useState(false);

  useEffect(() => {
    setQuery(caseTimelineQuery(ingestSource, "1d"));
    setViewDomain(undefined);
    setZoomActive(false);
  }, [ingestSource]);

  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_TIMELINE_PANEL_ID,
      title: "Event timeline",
      query,
      viz: "timechart",
      layout: { i: CASE_TIMELINE_PANEL_ID, x: 0, y: 0, w: 12, h: 5, minW: 6, minH: 4 },
    }),
    [query]
  );

  const { rows, columns, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);

  const timechart = useMemo(
    () => toTimechartData(rows, columns, query),
    [rows, columns, query]
  );

  const eventCount = useMemo(
    () => timechartTotal(rows, columns, query),
    [rows, columns, query]
  );

  const zoomLabel = useMemo(() => {
    if (!viewDomain) return undefined;
    const fmt = (ms: number) =>
      new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    return `${fmt(viewDomain.from)} → ${fmt(viewDomain.to)}`;
  }, [viewDomain]);

  const applyViewZoom = useCallback((fromMs: number, toMs: number) => {
    if (toMs - fromMs < 60_000) return;
    setViewDomain({ from: fromMs, to: toMs });
    setZoomActive(true);
  }, []);

  const handleZoomIn = useCallback(() => {
    const range = viewDomain ?? chartTimeRangeMs(timechart.data);
    const start = "start" in range ? range.start : range.from;
    const end = "end" in range ? range.end : range.to;
    const center = start + (end - start) / 2;
    const half = (end - start) / 4;
    applyViewZoom(center - half, center + half);
  }, [viewDomain, timechart.data, applyViewZoom]);

  const handleZoomOut = useCallback(() => {
    const range = viewDomain ?? chartTimeRangeMs(timechart.data);
    const start = "start" in range ? range.start : range.from;
    const end = "end" in range ? range.end : range.to;
    const center = start + (end - start) / 2;
    const half = end - start;
    applyViewZoom(start - half * 0.5, end + half * 0.5);
  }, [viewDomain, timechart.data, applyViewZoom]);

  const handleResetZoom = useCallback(() => {
    setViewDomain(undefined);
    setZoomActive(false);
  }, []);

  const handleSeriesFilter = useCallback(
    (series: string, exclude: boolean) => {
      const splitBy = "parser";
      const filter = exclude
        ? `${splitBy}!="${escapeMplString(series)}"`
        : `${splitBy}="${escapeMplString(series)}"`;
      navigate(buildSearchHref(`${scope} ${filter} | sort -timestamp | head 80`));
    },
    [navigate, scope]
  );

  if (loading && rows.length === 0) {
    return (
      <div className="case-timeline-panel case-timeline-panel--loading">
        <Loader2 size={18} className="animate-spin" aria-hidden />
        <span className="muted text-xs">Loading timeline…</span>
      </div>
    );
  }

  if (error) {
    return <p className="case-timeline-panel case-timeline-panel--error muted text-xs">{error}</p>;
  }

  if (!rows.length) {
    return (
      <p className="case-timeline-panel case-timeline-panel--empty muted text-xs">
        No events in this case yet. Upload or re-ingest a bugreport / sysdiagnose archive to populate
        the timeline.
      </p>
    );
  }

  if (!timechart.data.length) {
    return (
      <p className="case-timeline-panel case-timeline-panel--empty muted text-xs">
        Events are indexed but the timeline could not be charted. Try{" "}
        <button
          type="button"
          className="case-timeline-panel__span-btn"
          onClick={() => setQuery((q) => setSpanInQuery(q, "1d"))}
        >
          daily buckets
        </button>{" "}
        or open Search for a full timechart.
      </p>
    );
  }

  return (
    <div className="case-timeline-panel">
      <div className="case-timeline-panel__scroll">
        <SearchTimeline
          embedded
          mode="timechart"
          timechartRows={rows}
          query={query}
          onApplyQuery={setQuery}
          chartType={chartType}
          onChartTypeChange={setChartType}
          histSpanMinutes={360}
          onHistSpanChange={() => {}}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
          onBrushRange={applyViewZoom}
          onSeriesFilter={handleSeriesFilter}
          eventCount={eventCount}
          zoomLabel={zoomLabel}
          zoomActive={zoomActive}
          viewDomain={viewDomain}
        />
      </div>
      <div className="case-timeline-panel__footer">
        <Link
          to={buildSearchHref(`${scope} | timechart span=6h count by parser limit=10`)}
          className="case-timeline-panel__link text-xs"
        >
          Open full timeline in Search →
        </Link>
        <button
          type="button"
          className="case-timeline-panel__span-btn text-xs muted"
          onClick={() => setQuery((q) => setSpanInQuery(q, "1d"))}
        >
          Daily buckets
        </button>
        <button
          type="button"
          className="case-timeline-panel__span-btn text-xs muted"
          onClick={() => setQuery((q) => setSpanInQuery(q, "1h"))}
        >
          Hourly buckets
        </button>
      </div>
    </div>
  );
}
