import {
  isEnrichmentColumn,
  orderSearchResultColumns,
} from "@/lib/enrichment";

const VISIBLE_COLS_KEY = "mobipwn-search-visible-cols";

/** Lean defaults for /search results; user can add more via the Columns picker. */
export const DEFAULT_SEARCH_VISIBLE_COLUMNS = [
  "timestamp",
  "platform",
  "parser",
  "severity",
  "process_name",
  "bundle_id",
  "message",
] as const;

/** Noise / bulky fields kept out of the default table (still available in the picker / inspector). */
export const DEFAULT_SEARCH_HIDDEN_COLUMNS = new Set([
  "ext",
  "id",
  "ingest_time",
  "source",
]);

/** Max core columns when falling back without a preferred match. */
export const DEFAULT_SEARCH_MAX_CORE = 7;

export function loadPreferredSearchColumns(): string[] | null {
  try {
    const raw = localStorage.getItem(VISIBLE_COLS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const cols = parsed.filter((c): c is string => typeof c === "string" && c.trim() !== "");
    return cols.length ? cols : null;
  } catch {
    return null;
  }
}

export function savePreferredSearchColumns(cols: string[]): void {
  try {
    const core = cols.filter((c) => !isEnrichmentColumn(c));
    if (!core.length) {
      localStorage.removeItem(VISIBLE_COLS_KEY);
      return;
    }
    localStorage.setItem(VISIBLE_COLS_KEY, JSON.stringify(core));
  } catch {
    /* ignore */
  }
}

export function clearPreferredSearchColumns(): void {
  try {
    localStorage.removeItem(VISIBLE_COLS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Pick which result columns to show after a search.
 * Uses saved user preferences when they intersect the result set; otherwise a small preferred set.
 * Enrichment columns are appended (visibility also gated by enrichment hide prefs).
 */
export function defaultSearchVisibleColumns(
  colKeys: string[],
  preferred: string[] | null = null
): string[] {
  if (!colKeys.length) return [];
  const ordered = orderSearchResultColumns(colKeys);
  const have = new Set(colKeys);
  const enrichment = ordered.filter(isEnrichmentColumn);
  const coreOrdered = ordered.filter((c) => !isEnrichmentColumn(c));

  // Aggregations / `| fields …` with a small set: show everything useful.
  if (coreOrdered.length <= DEFAULT_SEARCH_MAX_CORE) {
    return [
      ...coreOrdered.filter((c) => !DEFAULT_SEARCH_HIDDEN_COLUMNS.has(c)),
      ...enrichment,
    ];
  }

  if (preferred?.length) {
    const fromUser = preferred.filter((c) => have.has(c) && !isEnrichmentColumn(c));
    if (fromUser.length > 0) {
      return orderedVisibleSearchColumns(colKeys, [...fromUser, ...enrichment]);
    }
  }

  const fromDefault = DEFAULT_SEARCH_VISIBLE_COLUMNS.filter((c) => have.has(c));
  if (fromDefault.length >= 3) {
    return orderedVisibleSearchColumns(colKeys, [...fromDefault, ...enrichment]);
  }

  return orderedVisibleSearchColumns(colKeys, [
    ...coreOrdered
      .filter((c) => !DEFAULT_SEARCH_HIDDEN_COLUMNS.has(c))
      .slice(0, DEFAULT_SEARCH_MAX_CORE),
    ...enrichment,
  ]);
}

/** Keep chosen columns in the table's natural result order (message last when present). */
export function orderedVisibleSearchColumns(colKeys: string[], chosen: string[]): string[] {
  if (!colKeys.length || !chosen.length) return [];
  const selected = new Set(chosen);
  const ordered = orderSearchResultColumns(colKeys).filter((c) => selected.has(c));
  if (!ordered.includes("message")) return ordered;
  return [...ordered.filter((c) => c !== "message"), "message"];
}
