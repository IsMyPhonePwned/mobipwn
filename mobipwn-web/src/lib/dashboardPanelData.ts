import { parseTimechartHeader } from "@/lib/mplTimechart";
import { parseBucketTimestamp } from "@/lib/timelineFormat";
import type { PanelViz } from "@/lib/dashboard";

export type SearchRow = Record<string, unknown>;

const COUNT_COLS = new Set(["stat", "c", "count", "cnt", "value"]);

export function countColumn(columns: string[]): string | null {
  for (const c of columns) {
    if (COUNT_COLS.has(c.toLowerCase())) return c;
  }
  return columns.length === 1 ? columns[0] : null;
}

export function groupColumn(columns: string[]): string | null {
  return columns.find((c) => !COUNT_COLS.has(c.toLowerCase()) && c !== "bucket" && c !== "series") ?? null;
}

export function numericValue(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function formatCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export type BarPoint = { label: string; value: number; field: string };

export function toBarData(rows: SearchRow[], columns: string[]): BarPoint[] {
  const countCol = countColumn(columns);
  const groupCol = groupColumn(columns);
  if (!countCol || !groupCol) return [];
  return rows.map((r) => ({
    label: formatCell(r[groupCol]),
    value: numericValue(r[countCol]),
    field: groupCol,
  }));
}

export type PiePoint = { name: string; value: number; field: string };

export function toPieData(rows: SearchRow[], columns: string[]): PiePoint[] {
  return toBarData(rows, columns).map((b) => ({
    name: b.label,
    value: b.value,
    field: b.field,
  }));
}

export type TimechartPoint = { timestamp: number; label: string; [series: string]: number | string };

export function toTimechartData(
  rows: SearchRow[],
  columns: string[],
  query: string
): { data: TimechartPoint[]; seriesKeys: string[] } {
  const { by } = parseTimechartHeader(query);
  const seriesField = columns.includes("series") ? "series" : by ?? "series";
  const buckets = new Map<number, TimechartPoint>();
  const seriesSet = new Set<string>();

  for (const row of rows) {
    const bucketRaw = row.bucket;
    const ts = parseBucketTimestamp(bucketRaw);
    if (ts == null) continue;
    const series = formatCell(row.series ?? row[seriesField] ?? "all");
    const count = numericValue(row.c ?? row.stat ?? row.count);
    seriesSet.add(series);
    const existing = buckets.get(ts) ?? { timestamp: ts, label: formatCell(bucketRaw) };
    existing[series] = count;
    buckets.set(ts, existing as TimechartPoint);
  }

  const seriesKeys = [...seriesSet].sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });
  const data = [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
  for (const point of data) {
    for (const key of seriesKeys) {
      if (point[key] == null) point[key] = 0;
    }
  }
  return { data, seriesKeys };
}

export function singleValue(rows: SearchRow[], columns: string[]): number | string | null {
  if (!rows.length) return null;
  const col = countColumn(columns) ?? columns[0];
  if (!col) return null;
  const v = rows[0][col];
  if (typeof v === "number" || typeof v === "string") return v;
  return formatCell(v);
}

export function isTimechartRows(rows: SearchRow[], columns: string[]): boolean {
  const cols = new Set(columns);
  return rows.length > 0 && cols.has("bucket") && (cols.has("c") || cols.has("stat"));
}

export function effectiveViz(requested: PanelViz, rows: SearchRow[], columns: string[], query: string): PanelViz {
  if (requested === "timechart" || isTimechartRows(rows, columns)) return "timechart";
  if (requested === "single_value") return "single_value";
  if (requested === "table") return "table";
  if (requested === "pie") return "pie";
  if (columns.length <= 2 && rows.length <= 1 && requested === "bar") return "single_value";
  if (/\|\s*head\b/i.test(query) && !/\bstats\b/i.test(query)) return "table";
  return requested;
}
