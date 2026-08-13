/**
 * True when search should not use the wall-clock From/To picker (matches backend
 * `skips_default_time_window` for case / IoC / platform hunts).
 */
export function querySkipsWallClockTimeWindow(query: string): boolean {
  const { search } = splitSearchAndPipeline(query);
  if (/\blast\s+\d/i.test(search) || /\bnow-\d/i.test(search)) {
    return false;
  }
  if (/source\s*=\s*["'][^"']+["']/i.test(search)) {
    return true;
  }
  const iocFields = [
    "bundle_id",
    "destination_domain",
    "dest_ip",
    "file_hash",
    "file_path",
    "email",
    "function",
    "process_name",
    "event_type",
    "data_type",
  ];
  for (const f of iocFields) {
    const re = new RegExp(`${f}\\s*=`, "i");
    if (re.test(search)) return true;
    if (new RegExp(`${f}\\s*[=!]=\\s*["']?\\*`, "i").test(search)) return true;
  }
  if (/\b(platform|parser|device_id|source_type)\s*=/i.test(search)) {
    return true;
  }
  return false;
}

/** Escape a value for double-quoted mPL strings. */
export function escapeMplString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Remove leading `last 24h` / `now-7d` so timeline zoom can drive the window via From/To. */
export function stripLeadingTimeModifiers(search: string): string {
  let s = search.trim();
  for (;;) {
    const next = s
      .replace(/^\s*last\s+\d+\s*[smhdw]\s+/i, "")
      .replace(/^\s*now\s*-\s*\d+\s*[smhdw]\s+/i, "")
      .trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/** datetime-local input value → ISO UTC for the search API. */
export function pickerToIso(local: string): string | undefined {
  if (!local.trim()) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Split search clause (before first `|`) from pipeline commands. */
export function splitSearchAndPipeline(query: string): { search: string; pipeline: string } {
  let inQuote = false;
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && c === "|") {
      return {
        search: query.slice(0, i).trim(),
        pipeline: query.slice(i).trim(),
      };
    }
  }
  return { search: query.trim(), pipeline: "" };
}

/** Add a field predicate to the search clause only (not after `| head`, etc.). */
export function appendSearchFilter(
  query: string,
  field: string,
  value: string,
  exclude: boolean
): string {
  const escaped = escapeMplString(value);
  const clause = exclude ? `${field}!="${escaped}"` : `${field}="${escaped}"`;
  const { search, pipeline } = splitSearchAndPipeline(query);
  const nextSearch = search ? `${search} ${clause}` : clause;
  return pipeline ? `${nextSearch} ${pipeline}` : nextSearch;
}

/** Query with leading time modifiers removed (after timeline zoom). */
export function queryWithoutLeadingTime(query: string): string {
  const { search, pipeline } = splitSearchAndPipeline(query);
  const stripped = stripLeadingTimeModifiers(search);
  return pipeline ? `${stripped} ${pipeline}` : stripped;
}

const HEAD_LIMIT_RE = /\|\s*head\s+(\d+)\b/i;
const AGG_PIPELINE_RE = /\|\s*(stats|timechart)\b/i;

/** True when the query returns aggregated rows (no cursor pagination). */
export function isAggregationQuery(query: string): boolean {
  return AGG_PIPELINE_RE.test(query);
}

/** Row cap for `/v1/search/run` — aggregations need a higher default than raw events. */
export function searchRunLimit(query: string): number {
  const head = query.match(HEAD_LIMIT_RE);
  if (head) return Math.min(parseInt(head[1], 10), 10_000);
  if (isAggregationQuery(query)) return 2000;
  return 500;
}

/** Deep link to Search with query pre-filled; `run=1` auto-runs on load. */
export function buildSearchHref(
  query: string,
  opts?: { run?: boolean; source?: string },
): string {
  const params = new URLSearchParams({ q: query.trim() });
  if (opts?.run !== false) params.set("run", "1");
  const source =
    opts?.source?.trim() ||
    query.match(/source\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
  if (source) params.set("source", source);
  return `/search?${params.toString()}`;
}
