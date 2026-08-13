import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface SearchHistoryEntry {
  id: string;
  query: string;
  query_mode: string;
  timestamp: Date;
  time_range_type?: string;
  time_range_preset?: string | null;
}

type ApiEntry = {
  id: string;
  query: string;
  query_mode: string;
  created_at: string;
  time_range_type: string;
  time_range_preset?: string | null;
};

type ListResponse = {
  entries: ApiEntry[];
  history_enabled: boolean;
};

function mapEntry(e: ApiEntry): SearchHistoryEntry {
  return {
    id: e.id,
    query: e.query,
    query_mode: e.query_mode,
    timestamp: new Date(e.created_at),
    time_range_type: e.time_range_type,
    time_range_preset: e.time_range_preset,
  };
}

export function useSearchHistory() {
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<ListResponse>("/v1/search/history");
      setSearchHistory(data.entries.map(mapEntry));
      setHistoryEnabled(data.history_enabled);
    } catch {
      setSearchHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleHistoryEnabled = useCallback(async (enabled: boolean) => {
    await apiFetch("/v1/search/history/settings", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
    setHistoryEnabled(enabled);
  }, []);

  const clearSearchHistory = useCallback(async () => {
    await apiFetch("/v1/search/history", { method: "DELETE" });
    setSearchHistory([]);
  }, []);

  const addToSearchHistory = useCallback(
    async (query: string, opts?: { timeFrom?: string; timeTo?: string }) => {
      if (!historyEnabled || !query.trim()) return;
      try {
        const body: Record<string, string | undefined> = {
          query: query.trim(),
          query_mode: "piped",
        };
        if (opts?.timeFrom && opts?.timeTo) {
          body.time_range_type = "custom";
          body.time_range_start = new Date(opts.timeFrom).toISOString();
          body.time_range_end = new Date(opts.timeTo).toISOString();
        } else {
          body.time_range_type = "preset";
          body.time_range_preset = "Last 24 hours";
        }
        const entry = await apiFetch<ApiEntry>("/v1/search/history", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setSearchHistory((prev) => [mapEntry(entry), ...prev.filter((h) => h.id !== entry.id)].slice(0, 100));
      } catch {
        /* ignore */
      }
    },
    [historyEnabled]
  );

  return {
    searchHistory,
    historyEnabled,
    loading,
    toggleHistoryEnabled,
    clearSearchHistory,
    addToSearchHistory,
    refresh,
  };
}
