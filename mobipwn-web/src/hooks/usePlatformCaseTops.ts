import { useCallback, useEffect, useState } from "react";
import { apiPost } from "@/lib/api";
import {
  PLATFORM_CASE_TOP_SECTIONS,
  queryForSection,
  rowsToTopItems,
  type PlatformCaseTopSectionResult,
} from "@/lib/platformCaseTops";
import { searchRunLimit } from "@/lib/mplQuery";
import type { SearchRow } from "@/lib/dashboardPanelData";

type State = {
  sections: PlatformCaseTopSectionResult[];
  loading: boolean;
};

function emptySections(): PlatformCaseTopSectionResult[] {
  return PLATFORM_CASE_TOP_SECTIONS.map((section) => ({
    section,
    items: [],
    loading: true,
    error: "",
    elapsedMs: null,
  }));
}

export function usePlatformCaseTops(timePreset: string, refreshKey: number) {
  const [state, setState] = useState<State>({
    sections: emptySections(),
    loading: true,
  });

  const run = useCallback(async () => {
    setState((s) => ({
      sections: s.sections.map((sec) => ({ ...sec, loading: true, error: "" })),
      loading: true,
    }));

    const results = await Promise.all(
      PLATFORM_CASE_TOP_SECTIONS.map(async (section) => {
        const query = queryForSection(section, timePreset);
        try {
          const data = await apiPost<{
            rows?: SearchRow[];
            columns?: string[];
            elapsed_ms?: number;
          }>("/v1/search/run", { query, limit: searchRunLimit(query) });
          const rows = data.rows ?? [];
          const columns =
            data.columns?.length ? data.columns : rows[0] ? Object.keys(rows[0]) : [];
          return {
            section,
            items: rowsToTopItems(rows, columns),
            loading: false,
            error: "",
            elapsedMs: data.elapsed_ms ?? null,
          };
        } catch (e) {
          return {
            section,
            items: [],
            loading: false,
            error: String(e),
            elapsedMs: null,
          };
        }
      })
    );

    setState({ sections: results, loading: false });
  }, [timePreset]);

  useEffect(() => {
    void run();
  }, [run, refreshKey]);

  return { ...state, refresh: run };
}
