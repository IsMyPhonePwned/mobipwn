import { useCallback, useEffect, useState } from "react";
import { apiPost } from "@/lib/api";
import { applyTimePresetToQuery, type DashboardPanel } from "@/lib/dashboard";
import { searchRunLimit } from "@/lib/mplQuery";
import type { SearchRow } from "@/lib/dashboardPanelData";

type PanelState = {
  rows: SearchRow[];
  columns: string[];
  loading: boolean;
  error: string;
  elapsedMs: number | null;
  lastRun: Date | null;
};

export function useDashboardPanel(
  panel: DashboardPanel,
  timePreset: string,
  refreshKey: number,
  enabled = true
) {
  const [state, setState] = useState<PanelState>({
    rows: [],
    columns: [],
    loading: false,
    error: "",
    elapsedMs: null,
    lastRun: null,
  });

  const run = useCallback(async () => {
    if (!enabled || !panel.query.trim()) return;
    const query = applyTimePresetToQuery(panel.query, timePreset);
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await apiPost<{
        rows?: SearchRow[];
        columns?: string[];
        elapsed_ms?: number;
      }>("/v1/search/run", { query, limit: searchRunLimit(query) });
      const rows = data.rows ?? [];
      const columns =
        data.columns?.length
          ? data.columns
          : rows[0]
            ? Object.keys(rows[0])
            : [];
      setState({
        rows,
        columns,
        loading: false,
        error: "",
        elapsedMs: data.elapsed_ms ?? null,
        lastRun: new Date(),
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: String(e),
        lastRun: new Date(),
      }));
    }
  }, [enabled, panel.query, timePreset]);

  useEffect(() => {
    void run();
  }, [run, refreshKey]);

  return { ...state, refresh: run };
}
