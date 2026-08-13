import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, LayoutDashboard, Save } from "lucide-react";
import { AddToDashboardDialog } from "@/components/dashboard/AddToDashboardDialog";
import { inferViz } from "@/lib/dashboard";
import { Button } from "@/components/ui/button";
import { SearchExamples } from "@/components/search/SearchExamples";
import { SearchQueryInput } from "@/components/search/SearchQueryInput";
import { SearchStatsBar } from "@/components/search/SearchStatsBar";
import {
  appendSearchFilter,
  escapeMplString,
  isAggregationQuery,
  pickerToIso,
  querySkipsWallClockTimeWindow,
  queryWithoutLeadingTime,
  searchRunLimit,
} from "@/lib/mplQuery";
import { defaultCaseSource } from "@/lib/caseSource";
import { compileResultFilter, filterResultRows } from "@/lib/resultFilter";
import { registerDynamicFields } from "@/components/editor/mpl-language";
import { apiFetch, apiPost } from "@/lib/api";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import EventInspector from "../components/EventInspector";
import { FieldsSidebar } from "../components/FieldsSidebar";
import { SectionHeader } from "../components/SectionHeader";
import { EnrichmentToolbar } from "@/components/search/EnrichmentToolbar";
import { ResultsFilterBar } from "@/components/search/ResultsFilterBar";
import { ResultsTable } from "@/components/search/ResultsTable";
import {
  buildEnrichedQuery,
  enrichRowsWithVtLabel,
  enrichmentColumnsIn,
  enrichableLookupFields,
  isEnrichmentColumn,
  loadHiddenEnrichmentColumns,
  orderSearchResultColumns,
  saveHiddenEnrichmentColumns,
} from "@/lib/enrichment";
import {
  clearPreferredSearchColumns,
  defaultSearchVisibleColumns,
  loadPreferredSearchColumns,
  orderedVisibleSearchColumns,
  savePreferredSearchColumns,
} from "@/lib/searchColumns";
import { useEnrichmentProviders } from "@/hooks/useEnrichmentProviders";
import {
  SearchTimeline,
  type ChartType,
  type HistBucket,
} from "@/components/search/SearchTimeline";
import { PrevalenceSlider } from "@/components/search/PrevalenceSlider";
import type { PrevalenceScatterData } from "@/components/search/PrevalenceScatterPlot";
import { DateTimeRangePicker } from "@/components/ui/DateTimeRangePicker";
import {
  artifactFieldForType,
  hasArtifactColumns,
  isAssetSearch,
} from "@/lib/assetSearch";
import { parseTimechartHeader } from "@/lib/mplTimechart";
import { downloadSearchExport } from "@/lib/searchExport";
import { toDatetimeLocal } from "@/lib/timeRange";

type FieldStat = { value: string; count: number };
type SearchRow = Record<string, unknown>;
type SavedQuery = { id: string; name: string; query: string; folder_id?: string | null };
type SavedQueryFolder = { id: string; name: string; parent_id?: string | null };
const CHART_TYPE_KEY = "mobipwn-search-chart-type";
const ENRICHMENTS_KEY = "mobipwn-search-enrichments";

function loadEnrichmentsEnabled(): boolean {
  try {
    const v = localStorage.getItem(ENRICHMENTS_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

function isTimechartResult(rows: SearchRow[], columns: string[]): boolean {
  const cols = new Set(columns);
  return rows.length > 0 && cols.has("bucket") && cols.has("c");
}

function loadChartType(): ChartType {
  try {
    const v = localStorage.getItem(CHART_TYPE_KEY);
    if (v === "bar" || v === "line" || v === "area") return v;
  } catch {
    /* ignore */
  }
  return "area";
}

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(
    'last 24h platform="android" | timechart span=1h count by parser limit=8'
  );
  /** Last query that was actually run — timeline/histogram/scatter stay in sync with results. */
  const [executedQuery, setExecutedQuery] = useState(query);
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [sql, setSql] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searchAfter, setSearchAfter] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "jsonl" | null>(null);
  const [addToDashboardOpen, setAddToDashboardOpen] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [visibleCols, setVisibleCols] = useState<string[]>([]);
  const [showColPicker, setShowColPicker] = useState(false);
  const [resultFilter, setResultFilter] = useState("");
  const [resultFilterRegex, setResultFilterRegex] = useState(false);
  const [enrichmentsEnabled, setEnrichmentsEnabled] = useState(loadEnrichmentsEnabled);
  const [hiddenEnrichmentCols, setHiddenEnrichmentCols] = useState(loadHiddenEnrichmentColumns);
  const { enabled: enrichmentProviders, coveragePct, loading: providersLoading } =
    useEnrichmentProviders();
  const providersKeyRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<SearchRow | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [resolvedFrom, setResolvedFrom] = useState<string | null>(null);
  const [resolvedTo, setResolvedTo] = useState<string | null>(null);
  const [selectedField, setSelectedField] = useState("platform");
  const [fieldStats, setFieldStats] = useState<FieldStat[]>([]);
  const [fieldStatsLoaded, setFieldStatsLoaded] = useState(false);
  const [fieldStatsError, setFieldStatsError] = useState("");
  const [histogram, setHistogram] = useState<HistBucket[]>([]);
  const [histSpanMinutes, setHistSpanMinutes] = useState(60);
  const [chartType, setChartType] = useState<ChartType>(loadChartType);
  const [wallClockOverride, setWallClockOverride] = useState(false);
  const [prevalenceMax, setPrevalenceMax] = useState(() => {
    const p = searchParams.get("prevalence");
    return p ? Math.min(100, Math.max(0, parseInt(p, 10) || 100)) : 100;
  });
  const [scatterData, setScatterData] = useState<PrevalenceScatterData | null>(null);
  const [scatterLoading, setScatterLoading] = useState(false);
  const [scatterError, setScatterError] = useState("");
  const [assetMaxHostCount, setAssetMaxHostCount] = useState(10);
  const [assetArtifactFilter, setAssetArtifactFilter] = useState<string | null>(null);
  const scatterKeyRef = useRef("");
  const searchAutoRunKeyRef = useRef<string | null>(null);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [savedFolders, setSavedFolders] = useState<SavedQueryFolder[]>([]);
  const [exampleCase, setExampleCase] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const {
    searchHistory,
    historyEnabled,
    toggleHistoryEnabled,
    clearSearchHistory,
    addToSearchHistory,
  } = useSearchHistory();
  const { log } = useActivityLog();
  const { t } = useLocale();

  const lookupFields = useMemo(
    () => enrichableLookupFields(enrichmentProviders),
    [enrichmentProviders]
  );

  const resultColumnKeys = useMemo(() => {
    if (columns.length) return columns;
    return rows[0] ? Object.keys(rows[0]) : [];
  }, [columns, rows]);

  const enrichmentColumns = useMemo(
    () => enrichmentColumnsIn(resultColumnKeys),
    [resultColumnKeys]
  );

  const setEnrichmentColVisible = useCallback(
    (col: string, visible: boolean) => {
      setHiddenEnrichmentCols((prev) => {
        const next = new Set(prev);
        if (visible) next.delete(col);
        else next.add(col);
        saveHiddenEnrichmentColumns(next);
        return next;
      });
      log("info", visible ? `Show enrichment column: ${col}` : `Hide enrichment column: ${col}`);
    },
    [log]
  );

  const toggleEnrichmentColumn = useCallback(
    (col: string) => {
      setEnrichmentColVisible(col, hiddenEnrichmentCols.has(col));
    },
    [hiddenEnrichmentCols, setEnrichmentColVisible]
  );

  const showAllEnrichmentColumns = useCallback(() => {
    setHiddenEnrichmentCols((prev) => {
      const next = new Set(prev);
      for (const c of enrichmentColumns) next.delete(c);
      saveHiddenEnrichmentColumns(next);
      return next;
    });
    log("info", "Show all enrichment columns");
  }, [enrichmentColumns, log]);

  const hideAllEnrichmentColumns = useCallback(() => {
    setHiddenEnrichmentCols((prev) => {
      const next = new Set(prev);
      for (const c of enrichmentColumns) next.add(c);
      saveHiddenEnrichmentColumns(next);
      return next;
    });
    log("info", "Hide all enrichment columns");
  }, [enrichmentColumns, log]);

  const setEnrichments = useCallback(
    (on: boolean) => {
      setEnrichmentsEnabled(on);
      try {
        localStorage.setItem(ENRICHMENTS_KEY, on ? "1" : "0");
      } catch {
        /* ignore */
      }
      log("info", on ? "Enrichments enabled" : "Enrichments disabled");
    },
    [log]
  );

  const skipWallClock = querySkipsWallClockTimeWindow(query);

  const useWallClock = !skipWallClock || wallClockOverride;

  const apiTimeBounds = useCallback(
    (forceWallClock?: boolean) => {
      const wc = forceWallClock ?? useWallClock;
      if (!wc) return { time_from: undefined as string | undefined, time_to: undefined as string | undefined };
      return {
        time_from: pickerToIso(timeFrom),
        time_to: pickerToIso(timeTo),
      };
    },
    [useWallClock, timeFrom, timeTo]
  );

  const body = () => ({
    query,
    ...apiTimeBounds(),
  });

  const displayColumns = useMemo(() => {
    if (!rows.length && !columns.length) return [];
    const base = columns.length ? columns : rows[0] ? Object.keys(rows[0]) : [];
    if (!base.length) return [];
    let cols: string[];
    if (visibleCols.length) {
      cols = visibleCols.filter((c) => base.includes(c));
    } else {
      cols = defaultSearchVisibleColumns(base, loadPreferredSearchColumns());
    }
    if (hiddenEnrichmentCols.size) {
      cols = cols.filter((c) => !isEnrichmentColumn(c) || !hiddenEnrichmentCols.has(c));
    }
    return cols;
  }, [columns, rows, visibleCols, hiddenEnrichmentCols]);

  const resultFilterCompiled = useMemo(
    () => compileResultFilter(resultFilter, resultFilterRegex),
    [resultFilter, resultFilterRegex]
  );

  const filterColumns = useMemo(
    () => (displayColumns.length ? displayColumns : columns),
    [displayColumns, columns]
  );

  const filteredRows = useMemo(
    () => filterResultRows(rows, filterColumns, resultFilterCompiled),
    [rows, filterColumns, resultFilterCompiled]
  );

  const selectedIndexInView = useMemo(() => {
    if (selected == null) return null;
    const idx = filteredRows.indexOf(selected);
    return idx >= 0 ? idx : null;
  }, [selected, filteredRows]);

  const resultsMeta = useMemo(() => {
    if (rowCount === null) return undefined;
    const noun = isAggregationQuery(executedQuery) ? "row" : "event";
    if (rowCount === 0) return `0 ${noun}s found`;
    const loaded = rows.length.toLocaleString();
    const filtering =
      resultFilterCompiled.mode !== "none" &&
      !resultFilterCompiled.error &&
      filteredRows.length !== rows.length;
    if (filtering) {
      return `${filteredRows.length.toLocaleString()} of ${loaded} ${noun}${rows.length === 1 ? "" : "s"}`;
    }
    if (hasMore) return `${loaded} loaded — more available`;
    const headHint =
      isAggregationQuery(executedQuery) && !/\|\s*head\s+\d+/i.test(executedQuery)
        ? " — add | head N for top N"
        : "";
    return `${loaded} ${noun}${rows.length === 1 ? "" : "s"}${headHint}`;
  }, [rowCount, rows.length, hasMore, executedQuery, resultFilterCompiled, filteredRows.length]);

  const isTimechart = isTimechartResult(rows, columns);
  const timechartBy = useMemo(() => parseTimechartHeader(executedQuery).by, [executedQuery]);
  const isAssetMode = useMemo(() => isAssetSearch(executedQuery), [executedQuery]);
  const hasArtifacts = useMemo(
    () => hasArtifactColumns(rows) || isAssetMode,
    [rows, isAssetMode]
  );

  const timeRangeValue = useMemo(
    () => ({ from: timeFrom, to: timeTo }),
    [timeFrom, timeTo]
  );

  const timelineViewDomain = useMemo(() => {
    if (!wallClockOverride || !timeFrom || !timeTo) return undefined;
    const from = pickerToIso(timeFrom);
    const to = pickerToIso(timeTo);
    if (!from || !to) return undefined;
    return { from: new Date(from).getTime(), to: new Date(to).getTime() };
  }, [wallClockOverride, timeFrom, timeTo]);

  const persistChartType = (t: ChartType) => {
    setChartType(t);
    try {
      localStorage.setItem(CHART_TYPE_KEY, t);
    } catch {
      /* ignore */
    }
  };

  type SearchRunOpts = {
    query?: string;
    time_from?: string;
    time_to?: string;
    forceWallClock?: boolean;
    enrichments?: boolean;
  };

  const fetchHistogram = useCallback(
    async (spanMinutes: number, opts?: SearchRunOpts) => {
      const q = opts?.query ?? executedQuery;
      const times = opts?.forceWallClock
        ? { time_from: opts.time_from, time_to: opts.time_to }
        : opts?.time_from || opts?.time_to
          ? { time_from: opts.time_from, time_to: opts.time_to }
          : apiTimeBounds(opts?.forceWallClock);
      try {
        const hdata = await apiPost<{ buckets?: HistBucket[] }>("/v1/search/histogram", {
          query: buildEnrichedQuery(q, enrichmentProviders, enrichmentsEnabled),
          ...times,
          span_minutes: spanMinutes,
        });
        setHistogram(hdata.buckets || []);
      } catch (he) {
        setHistogram([]);
        log("warn", "Histogram skipped", String(he));
      }
    },
    [executedQuery, apiTimeBounds, log, enrichmentsEnabled, enrichmentProviders]
  );

  const getTimeRangeMs = useCallback((): { start: number; end: number } => {
    const parseIso = (s: string | null | undefined) => {
      if (!s) return null;
      const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    };
    const from =
      parseIso(pickerToIso(timeFrom)) ??
      parseIso(resolvedFrom) ??
      Date.now() - 24 * 60 * 60 * 1000;
    const to = parseIso(pickerToIso(timeTo)) ?? parseIso(resolvedTo) ?? Date.now();
    return { start: from, end: Math.max(to, from + 60_000) };
  }, [timeFrom, timeTo, resolvedFrom, resolvedTo]);

  const loadSaved = useCallback(() => {
    apiFetch<{ folders?: SavedQueryFolder[]; queries?: SavedQuery[] }>("/v1/saved-queries")
      .then((data) => {
        setSavedFolders(data.folders ?? []);
        setSaved(data.queries ?? []);
      })
      .catch(() => {
        setSaved([]);
        setSavedFolders([]);
      });
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  useEffect(() => {
    const source = searchParams.get("source")?.trim();
    const q = searchParams.get("q");
    if (q) {
      setQuery(q);
      if (source) setExampleCase(source);
      return;
    }
    searchAutoRunKeyRef.current = null;
    if (source) {
      setExampleCase(source);
      setQuery(`source="${escapeMplString(source)}" | sort -timestamp | head 200`);
      return;
    }
    apiFetch<{ sources: { source: string }[] }>("/v1/data/summary")
      .then((summary) => {
        setExampleCase(defaultCaseSource(summary.sources.map((s) => s.source)));
      })
      .catch(() => setExampleCase(defaultCaseSource([])));
  }, [searchParams]);

  const loadFieldStats = async (field: string) => {
    setSelectedField(field);
    setFieldStatsLoaded(false);
    setFieldStatsError("");
    log("info", `Field stats: ${field}`, query.slice(0, 80));
    try {
      const data = await apiPost<{ values?: FieldStat[] }>("/v1/search/field-stats", {
        field,
        ...body(),
        limit: 15,
      });
      setFieldStats(data.values || []);
      if (!(data.values?.length)) {
        setFieldStatsError(
          "No values in this scope — widen time, simplify query, or run Search first."
        );
      }
    } catch (e) {
      const msg = String(e);
      log("warn", `Field stats failed: ${field}`, msg);
      setFieldStats([]);
      setFieldStatsError(msg);
    } finally {
      setFieldStatsLoaded(true);
    }
  };

  const appendFilter = (field: string, value: string, exclude: boolean) => {
    const next = appendSearchFilter(query, field, value, exclude);
    setQuery(next);
    log("info", `Filter ${exclude ? "exclude" : "add"}: ${field}="${value}"`, next);
  };

  const toggleColumn = (col: string) => {
    if (isEnrichmentColumn(col)) {
      setEnrichmentColVisible(col, hiddenEnrichmentCols.has(col));
      return;
    }
    let logMsg = "";
    setVisibleCols((prev) => {
      const base =
        prev.length > 0
          ? prev
          : defaultSearchVisibleColumns(columns, loadPreferredSearchColumns());
      const hiding = base.includes(col);
      logMsg = hiding ? `Hide column: ${col}` : `Show column: ${col}`;
      let next: string[];
      if (hiding) {
        next = base.filter((c) => c !== col);
        if (!next.length) next = base;
      } else {
        next = orderedVisibleSearchColumns(columns, [...base, col]);
      }
      savePreferredSearchColumns(next);
      return next;
    });
    if (logMsg) log("info", logMsg);
  };

  const showAllColumns = () => {
    const next = orderSearchResultColumns(columns);
    setVisibleCols(next);
    savePreferredSearchColumns(next);
    log("info", "Show all columns");
  };

  const resetDefaultColumns = () => {
    clearPreferredSearchColumns();
    const next = defaultSearchVisibleColumns(columns, null);
    setVisibleCols(next);
    log("info", "Reset columns to defaults");
  };

  const runSearch = useCallback(
    async (opts?: string | SearchRunOpts) => {
      const o: SearchRunOpts =
        typeof opts === "string" ? { query: opts } : opts ?? {};
      const q = o.query ?? query;
      const enrichOn = o.enrichments ?? enrichmentsEnabled;
      const runQ = buildEnrichedQuery(q, enrichmentProviders, enrichOn);
      const wc = o.forceWallClock ?? useWallClock;
      const time_from = o.time_from ?? (wc ? pickerToIso(timeFrom) : undefined);
      const time_to = o.time_to ?? (wc ? pickerToIso(timeTo) : undefined);
      setLoading(true);
      setError("");
      setSelected(null);
      setResultFilter("");
      setResultFilterRegex(false);
      setHasMore(false);
      setSearchAfter(null);
      log(
        "info",
        `Search: ${runQ.slice(0, 120)}${runQ.length > 120 ? "…" : ""}`,
        runQ !== q ? `(enriched from bar query)` : undefined
      );
      try {
        const data = await apiPost<{
          sql: string;
          rows?: SearchRow[];
          row_count?: number;
          columns?: string[];
          elapsed_ms?: number;
          time_from?: string | null;
          time_to?: string | null;
          has_more?: boolean;
          search_after?: string | null;
        }>("/v1/search/run", {
          query: runQ,
          time_from,
          time_to,
          limit: searchRunLimit(runQ),
        });

      const resultRows = enrichRowsWithVtLabel(data.rows || []);
      const apiCols = data.columns || [];
      const rowKeys = resultRows[0] ? Object.keys(resultRows[0]) : [];
      const colKeys =
        apiCols.length > 0
          ? [...apiCols, ...rowKeys.filter((k) => !apiCols.includes(k))]
          : rowKeys;
      const count = data.row_count ?? resultRows.length;
      setSql(data.sql);
      setRows(resultRows);
      setRowCount(count);
      setHasMore(!!data.has_more);
      setSearchAfter(data.search_after ?? null);
      setHasSearched(true);
      setColumns(colKeys);
      if (resultRows.length === 0) {
        setVisibleCols([]);
      } else if (colKeys.length) {
        setVisibleCols(defaultSearchVisibleColumns(colKeys, loadPreferredSearchColumns()));
      }
      setElapsed(data.elapsed_ms ?? null);
      setResolvedFrom(data.time_from ?? null);
      setResolvedTo(data.time_to ?? null);
      setExecutedQuery(q);
      if (!o.query) setQuery(q);
      addToSearchHistory(q, { timeFrom, timeTo });
      log(
        "info",
        `Search OK — ${count} event${count === 1 ? "" : "s"} found, ${data.elapsed_ms ?? "?"} ms`
      );
      if (colKeys.length) registerDynamicFields(colKeys);

      if (!isTimechartResult(resultRows, colKeys)) {
        await fetchHistogram(histSpanMinutes, {
          query: q,
          time_from,
          time_to,
          forceWallClock: wc,
        });
      } else {
        setHistogram([]);
      }
    } catch (e) {
      const msg = String(e);
      setError(msg);
      log("error", "Search failed", msg);
    } finally {
      setLoading(false);
    }
  },
    [
      query,
      timeFrom,
      timeTo,
      useWallClock,
      addToSearchHistory,
      log,
      histSpanMinutes,
      fetchHistogram,
      enrichmentsEnabled,
      enrichmentProviders,
    ]
  );

  useEffect(() => {
    const q = searchParams.get("q")?.trim();
    if (!q || searchParams.get("run") !== "1") return;
    const autoKey = q;
    if (searchAutoRunKeyRef.current === autoKey) return;
    searchAutoRunKeyRef.current = autoKey;
    void runSearch({ query: q });
  }, [searchParams, runSearch]);

  /** Re-run search when marketplace providers finish loading (lookups need provider list). */
  useEffect(() => {
    if (providersLoading) return;
    const key = enrichmentProviders
      .map((p) => `${p.id}:${p.enabled}`)
      .sort()
      .join("|");
    const prev = providersKeyRef.current;
    providersKeyRef.current = key;
    if (prev === null) {
      if (enrichmentsEnabled && hasSearched && enrichmentProviders.length > 0) {
        void runSearch({ enrichments: true });
      }
      return;
    }
    if (prev !== key && enrichmentsEnabled && hasSearched) {
      void runSearch({ enrichments: true });
    }
  }, [providersLoading, enrichmentProviders, enrichmentsEnabled, hasSearched, runSearch]);

  const loadMore = useCallback(async () => {
    if (!searchAfter || loadingMore || loading) return;
    const { time_from, time_to } = apiTimeBounds();
    setLoadingMore(true);
    setError("");
    log("info", "Search: load more");
    try {
      const data = await apiPost<{
        rows?: SearchRow[];
        columns?: string[];
        has_more?: boolean;
        search_after?: string | null;
        elapsed_ms?: number;
      }>("/v1/search/run", {
        query: buildEnrichedQuery(executedQuery, enrichmentProviders, enrichmentsEnabled),
        time_from,
        time_to,
        limit: 500,
        search_after: searchAfter,
      });
      const resultRows = enrichRowsWithVtLabel(data.rows || []);
      setRows((prev) => [...prev, ...resultRows]);
      setRowCount((prev) => (prev ?? 0) + resultRows.length);
      setHasMore(!!data.has_more);
      setSearchAfter(data.search_after ?? null);
      if (data.columns?.length) {
        setColumns((prev) => {
          const merged = new Set([...prev, ...data.columns!]);
          return [...merged];
        });
      }
      log("info", `Search OK — loaded ${resultRows.length} more rows`);
    } catch (e) {
      const msg = String(e);
      setError(msg);
      log("error", "Load more failed", msg);
    } finally {
      setLoadingMore(false);
    }
  }, [searchAfter, loadingMore, loading, executedQuery, apiTimeBounds, log, enrichmentsEnabled, enrichmentProviders]);

  const handleExport = useCallback(
    async (format: "csv" | "jsonl") => {
      if (!hasSearched) return;
      const { time_from, time_to } = apiTimeBounds();
      setExporting(format);
      setError("");
      log("info", `Export search results (${format})`);
      try {
        await downloadSearchExport({
          query: buildEnrichedQuery(executedQuery, enrichmentProviders, enrichmentsEnabled),
          time_from,
          time_to,
          format,
        });
        log("info", `Export OK (${format})`);
      } catch (e) {
        const msg = String(e);
        setError(msg);
        log("error", `Export failed (${format})`, msg);
      } finally {
        setExporting(null);
      }
    },
    [hasSearched, executedQuery, apiTimeBounds, log, enrichmentsEnabled, enrichmentProviders]
  );

  const applyTimelineZoom = useCallback(
    async (fromMs: number, toMs: number) => {
      const fromIso = new Date(fromMs).toISOString();
      const toIso = new Date(toMs).toISOString();
      const nextQuery = queryWithoutLeadingTime(query);
      setWallClockOverride(true);
      setTimeFrom(toDatetimeLocal(new Date(fromMs)));
      setTimeTo(toDatetimeLocal(new Date(toMs)));
      setQuery(nextQuery);
      log("info", "Timeline zoom", `${fromIso} → ${toIso}`);
      const opts: SearchRunOpts = {
        query: nextQuery,
        time_from: fromIso,
        time_to: toIso,
        forceWallClock: true,
      };
      await runSearch(opts);
    },
    [query, log, runSearch]
  );

  const handleZoomIn = useCallback(() => {
    const { start, end } = getTimeRangeMs();
    const center = start + (end - start) / 2;
    const half = (end - start) / 4;
    void applyTimelineZoom(center - half, center + half);
  }, [getTimeRangeMs, applyTimelineZoom]);

  const handleZoomOut = useCallback(() => {
    const { start, end } = getTimeRangeMs();
    const center = start + (end - start) / 2;
    const half = end - start;
    void applyTimelineZoom(
      Math.max(center - half, Date.now() - 365 * 24 * 60 * 60 * 1000),
      Math.min(center + half, Date.now())
    );
  }, [getTimeRangeMs, applyTimelineZoom]);

  const handleResetZoom = useCallback(() => {
    setWallClockOverride(false);
    setTimeFrom("");
    setTimeTo("");
    log("info", "Timeline zoom reset");
    void runSearch({ forceWallClock: false });
  }, [log, runSearch]);

  const addSeriesFilter = useCallback(
    (value: string, exclude: boolean) => {
      if (!timechartBy) return;
      const next = appendSearchFilter(executedQuery, timechartBy, value, exclude);
      setQuery(next);
      log(
        "info",
        `Series filter ${exclude ? "exclude" : "add"}: ${timechartBy}="${value}"`,
        next.slice(0, 120)
      );
      void runSearch({ query: next });
    },
    [executedQuery, timechartBy, log, runSearch]
  );

  const fetchScatter = useCallback(
    async (maxDevice?: number) => {
      if (!hasSearched) return;
      const wc = useWallClock;
      const time_from = wc ? pickerToIso(timeFrom) : undefined;
      const time_to = wc ? pickerToIso(timeTo) : undefined;
      setScatterLoading(true);
      setScatterError("");
      try {
        const maxDevices =
          maxDevice ??
          (isAssetMode || prevalenceMax < 100
            ? Math.max(1, Math.round((prevalenceMax / 100) * 50))
            : undefined);
        const data = await apiPost<PrevalenceScatterData & { elapsed_ms?: number }>(
          "/v1/prevalence/scatter",
          {
            query: executedQuery,
            time_from,
            time_to,
            max_device_count: maxDevices,
            rarity_threshold: 1 - prevalenceMax / 100,
          }
        );
        setScatterData({
          hash_points: data.hash_points ?? [],
          ip_points: data.ip_points ?? [],
          rarity_threshold: data.rarity_threshold ?? 0.7,
          max_artifact_host_count: data.max_artifact_host_count,
        });
      } catch (e) {
        setScatterData(null);
        setScatterError(String(e));
      } finally {
        setScatterLoading(false);
      }
    },
    [
      hasSearched,
      executedQuery,
      timeFrom,
      timeTo,
      useWallClock,
      assetMaxHostCount,
      prevalenceMax,
      isAssetMode,
    ]
  );

  useEffect(() => {
    if (!hasSearched || isTimechart) return;
    scatterKeyRef.current = "";
    void fetchScatter();
  }, [prevalenceMax, hasSearched, isTimechart, executedQuery, timeFrom, timeTo, fetchScatter]);

  const handleArtifactClick = useCallback(
    (artifact: string, type: "hash" | "ip") => {
      const field = artifactFieldForType(type);
      const next = appendSearchFilter(query, field, artifact, false);
      setQuery(next);
      setAssetArtifactFilter(artifact);
      log("info", `${isAssetMode ? "Asset" : "Rarity"} filter: ${field}="${artifact}"`);
      void runSearch({ query: next });
    },
    [isAssetMode, log, query, runSearch]
  );

  const applyTimeRange = useCallback(
    (range: { from: string; to: string }) => {
      const from = range.from ? new Date(range.from) : null;
      const to = range.to ? new Date(range.to) : null;
      if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return;
      const nextQuery = queryWithoutLeadingTime(query);
      setWallClockOverride(true);
      setTimeFrom(range.from);
      setTimeTo(range.to);
      void runSearch({
        query: nextQuery,
        time_from: from.toISOString(),
        time_to: to.toISOString(),
        forceWallClock: true,
      });
    },
    [query, runSearch]
  );

  const applyPreset = useCallback(
    (minutes: number) => {
      const to = new Date();
      const from = new Date(to.getTime() - minutes * 60 * 1000);
      const nextQuery = queryWithoutLeadingTime(query);
      setQuery(nextQuery);
      setWallClockOverride(true);
      setTimeFrom(toDatetimeLocal(from));
      setTimeTo(toDatetimeLocal(to));
      log("info", `Time preset: last ${minutes}m`);
      void runSearch({
        query: nextQuery,
        time_from: from.toISOString(),
        time_to: to.toISOString(),
        forceWallClock: true,
      });
    },
    [query, log, runSearch]
  );

  useEffect(() => {
    if (!hasSearched || isTimechart) return;
    void fetchHistogram(histSpanMinutes);
  }, [histSpanMinutes, hasSearched, isTimechart, executedQuery, fetchHistogram]);

  const applyHistoryQuery = useCallback(
    (q: string) => {
      setQuery(q);
      void runSearch({ query: q });
    },
    [runSearch]
  );

  const saveQuery = async () => {
    const name = prompt("Saved search name");
    if (!name) {
      log("info", "Save search cancelled");
      return;
    }
    log("info", `Save search: ${name}`, query.slice(0, 200));
    try {
      await fetch("/api/v1/saved-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, query }),
      });
      loadSaved();
    } catch (e) {
      log("error", `Save search failed: ${name}`, String(e));
    }
  };

  const showTimeline =
    hasSearched &&
    (isTimechart ? rows.length > 0 : histogram.length > 0 || hasArtifacts);

  const scatterTimeRange = useMemo(() => {
    const from = pickerToIso(timeFrom) ?? resolvedFrom ?? undefined;
    const to = pickerToIso(timeTo) ?? resolvedTo ?? undefined;
    if (!from || !to) return undefined;
    return { start: from, end: to };
  }, [timeFrom, timeTo, resolvedFrom, resolvedTo]);

  return (
    <div className="search-workspace">
      <FieldsSidebar
        saved={saved}
        folders={savedFolders}
        scope={body()}
        fieldStats={fieldStats}
        fieldStatsError={fieldStatsError}
        selectedField={selectedField}
        statsLoaded={fieldStatsLoaded}
        onSelectField={loadFieldStats}
        onLoadQuery={setQuery}
        onFilter={appendFilter}
      />

      <div className="search-workspace-main">
        <div className="search-command-card">
          <SearchQueryInput
            query={query}
            onQueryChange={setQuery}
            onSearch={() => void runSearch()}
            searchHistory={searchHistory}
            savedSearches={saved}
            historyEnabled={historyEnabled}
            onToggleHistoryEnabled={toggleHistoryEnabled}
            onClearAllHistory={clearSearchHistory}
            onHistorySelect={applyHistoryQuery}
          />
        </div>

        <div className="search-controls">
          <DateTimeRangePicker
            value={timeRangeValue}
            onChange={(r) => {
              setTimeFrom(r.from);
              setTimeTo(r.to);
              setWallClockOverride(!!(r.from || r.to));
            }}
            onPreset={applyPreset}
            disabled={loading}
          />
          <Button
            className="search-run-btn"
            onClick={() => void runSearch()}
            disabled={loading}
          >
            {loading ? "Running…" : "Run"}
          </Button>
          <PrevalenceSlider
            value={prevalenceMax}
            onChange={setPrevalenceMax}
            disabled={loading || !hasSearched}
          />
          {isAssetMode && assetArtifactFilter && (
            <button
              type="button"
              className="asset-artifact-chip"
              onClick={() => setAssetArtifactFilter(null)}
              title="Clear asset artifact filter"
            >
              {assetArtifactFilter.slice(0, 24)}
              {assetArtifactFilter.length > 24 ? "…" : ""} ×
            </button>
          )}
          <div className="search-controls-actions">
            <Button variant="secondary" size="sm" onClick={saveQuery}>
              <Save size={14} />
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowColPicker((v) => {
                  log("info", v ? "Close column picker" : "Open column picker");
                  return !v;
                });
              }}
            >
              Columns
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasSearched || loading || !!exporting}
              onClick={() => void handleExport("csv")}
            >
              <Download size={14} />
              {exporting === "csv" ? "Exporting…" : "CSV"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasSearched || loading || !!exporting}
              onClick={() => void handleExport("jsonl")}
            >
              <Download size={14} />
              {exporting === "jsonl" ? "Exporting…" : "JSONL"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasSearched || loading}
              onClick={() => setAddToDashboardOpen(true)}
            >
              <LayoutDashboard size={14} />
              {t("dashboards.addToDashboard")}
            </Button>
          </div>
        </div>

        <SearchStatsBar
          isSearching={loading}
          hasSearched={hasSearched}
          totalCount={rowCount}
          elapsedMs={elapsed}
        />

        <details className="search-examples-details">
          <summary>
            Example queries ·{" "}
            <Link to="/search/guide" onClick={(e) => e.stopPropagation()}>
              {t("searchGuide.examplesLink")}
            </Link>
            {" · "}
            <Link to="/search/mpl" onClick={(e) => e.stopPropagation()}>
              {t("mplGuide.link")}
            </Link>
          </summary>
          <SearchExamples
            caseSource={searchParams.get("source")?.trim() || exampleCase || "case-001"}
            onPick={(q) => {
              setQuery(q);
              setHasSearched(false);
            }}
          />
        </details>

        {(resolvedFrom || resolvedTo) && !timeFrom && (
          <p className="search-context-line muted">
            Resolved window: {resolvedFrom?.slice(0, 19)} → {resolvedTo?.slice(0, 19)}
          </p>
        )}
        {skipWallClock && !wallClockOverride && (
          <p className="search-context-line muted">
            Case/field hunts use event time until you zoom the timeline or set From/To.
          </p>
        )}
        {wallClockOverride && (timeFrom || timeTo) && (
          <p className="search-context-line muted">
            Wall clock: {timeFrom || "…"} → {timeTo || "…"} (overrides{" "}
            <code className="mono">last …</code> in the query bar)
          </p>
        )}
        {error && <p className="error">{error}</p>}

        {showTimeline && (
          <SearchTimeline
            mode={isTimechart ? "timechart" : "histogram"}
            histogram={histogram}
            histSpanMinutes={histSpanMinutes}
            onHistSpanChange={setHistSpanMinutes}
            timechartRows={isTimechart ? rows : []}
            query={executedQuery}
            onApplyQuery={(q) => {
              log("info", "Timechart span changed", q.slice(0, 120));
              void runSearch(q);
            }}
            chartType={chartType}
            onChartTypeChange={persistChartType}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetZoom={handleResetZoom}
            onBrushRange={(from, to) => void applyTimelineZoom(from, to)}
            onSeriesFilter={timechartBy ? addSeriesFilter : undefined}
            histogramTotal={histogram.reduce((n, b) => n + b.count, 0)}
            zoomActive={wallClockOverride && !!(timeFrom || timeTo)}
            viewDomain={timelineViewDomain}
            zoomLabel={
              wallClockOverride && timeFrom && timeTo
                ? `${timeFrom.replace("T", " ")} → ${timeTo.replace("T", " ")}`
                : undefined
            }
            eventCount={rowCount ?? undefined}
            rarityEnabled={hasArtifacts}
            scatterData={scatterData}
            scatterLoading={scatterLoading}
            scatterError={scatterError}
            scatterTimeRange={scatterTimeRange}
            onRarityTabOpen={() => void fetchScatter()}
            onArtifactClick={handleArtifactClick}
            onMaxHostCountChange={(n) => {
              setAssetMaxHostCount(n);
              scatterKeyRef.current = "";
              void fetchScatter(n);
            }}
            isAssetMode={isAssetMode}
          />
        )}

        {showColPicker && columns.length > 0 && (
          <div className="column-picker search-column-picker">
            <div className="search-column-picker__toolbar">
              <span className="muted text-xs">
                {displayColumns.length} / {columns.length} columns
              </span>
              <div className="search-column-picker__actions">
                <Button type="button" variant="ghost" size="sm" onClick={showAllColumns}>
                  Show all
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={resetDefaultColumns}>
                  Defaults
                </Button>
              </div>
            </div>
            {columns.map((c) => (
              <label key={c}>
                <input
                  type="checkbox"
                  checked={
                    isEnrichmentColumn(c)
                      ? !hiddenEnrichmentCols.has(c) && resultColumnKeys.includes(c)
                      : displayColumns.includes(c)
                  }
                  onChange={() => toggleColumn(c)}
                />
                {c}
              </label>
            ))}
          </div>
        )}

        {sql && (
          <details className="search-sql-details">
            <summary>Generated SQL</summary>
            <pre className="mono search-sql-preview">
              {sql}
            </pre>
          </details>
        )}

        <div className={`results-split${selected ? " results-split--inspector" : ""}`}>
          <div className="results-table-wrap search-results-panel">
            <SectionHeader label="Results" meta={resultsMeta} />
            {hasSearched && (lookupFields.length > 0 || enrichmentColumns.length > 0) && (
              <EnrichmentToolbar
                enabled={enrichmentsEnabled}
                onEnabledChange={(on) => {
                  setEnrichments(on);
                  if (hasSearched) void runSearch({ enrichments: on });
                }}
                providers={enrichmentProviders}
                lookupFields={lookupFields}
                enrichmentColumns={enrichmentColumns}
                hiddenEnrichmentColumns={hiddenEnrichmentCols}
                onToggleEnrichmentColumn={toggleEnrichmentColumn}
                onShowAllEnrichmentColumns={showAllEnrichmentColumns}
                onHideAllEnrichmentColumns={hideAllEnrichmentColumns}
                coveragePct={coveragePct}
                enriching={loading || providersLoading}
              />
            )}
            {hasSearched && rows.length > 0 && (
              <ResultsFilterBar
                value={resultFilter}
                regexMode={resultFilterRegex}
                onChange={setResultFilter}
                onRegexModeChange={setResultFilterRegex}
                error={resultFilterCompiled.error}
                matchCount={filteredRows.length}
                totalCount={rows.length}
              />
            )}
            {hasSearched && rowCount === 0 && (
              <p className="search-empty-hint muted">
                No events matched this query and time range. If{" "}
                <Link to="/data">Data</Link> lists your source with events, remove or widen{" "}
                <code className="mono">last …</code> — search filters on{" "}
                <strong>event time</strong>, not ingest time (bugreports are often months or years
                old). Try{" "}
                <code className="mono">source="case-001" | head 200</code>. If Data is empty,{" "}
                <Link to="/ingest">Ingest</Link> with the same source label as in your query.
              </p>
            )}
            {displayColumns.length > 0 && rows.length > 0 && filteredRows.length === 0 && resultFilter.trim() && (
              <p className="search-filter-empty muted">{t("searchResults.filterNoMatch")}</p>
            )}
            {displayColumns.length > 0 && filteredRows.length > 0 && (
              <ResultsTable
                columns={displayColumns}
                rows={filteredRows}
                selectedIndex={selectedIndexInView}
                onSelectRow={(row) => setSelected(row)}
              />
            )}
            {hasMore && (
              <div className="search-load-more">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={loadingMore || loading}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </div>
          {selected && (
            <aside className="inspector-panel search-inspector-panel">
              <SectionHeader label="Event" />
              <EventInspector row={selected} />
            </aside>
          )}
        </div>
      </div>

      <AddToDashboardDialog
        open={addToDashboardOpen}
        onClose={() => setAddToDashboardOpen(false)}
        query={executedQuery}
        columns={columns}
        suggestedViz={hasSearched ? inferViz(executedQuery, columns) : undefined}
      />
    </div>
  );
}
