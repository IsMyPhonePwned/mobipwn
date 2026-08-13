export type Span = { n: number; unit: "s" | "m" | "h" | "d" };

export function parseSpan(query: string | undefined): Span {
  const m = query?.match(/\|\s*timechart[^|]*?\bspan\s*=\s*(\d+)([smhd])/i);
  if (m) return { n: parseInt(m[1], 10), unit: m[2].toLowerCase() as Span["unit"] };
  return { n: 1, unit: "h" };
}

export function setSpanInQuery(query: string, span: string): string {
  if (/\|\s*timechart[^|]*?\bspan\s*=\s*\d+[smhd]/i.test(query)) {
    return query.replace(/(\|\s*timechart[^|]*?\bspan\s*=\s*)\d+[smhd]/i, `$1${span}`);
  }
  return query.replace(/\|\s*timechart\s+/i, `| timechart span=${span} `);
}

export function parseTimechartHeader(query: string | undefined): {
  aggLabel: string;
  by: string | null;
} {
  if (!query) return { aggLabel: "count", by: null };
  const m = query.match(/\|\s*timechart\b[^|]*/i);
  if (!m) return { aggLabel: "count", by: null };
  const clause = m[0];
  const aggM = clause.match(/\b(?!span\b)(\w+)\s*(?:\(\s*([^)]*)\s*\))?(?=\s*(?:by\b|$|,))/i);
  const byM = clause.match(/\bby\s+([A-Za-z_][\w.]*)/i);
  const agg = aggM ? aggM[1] : "count";
  const aggField = aggM?.[2]?.trim();
  const aggLabel = aggField ? `${agg}(${aggField})` : agg;
  return { aggLabel, by: byM?.[1] ?? null };
}

export const TIMELINE_SPAN_OPTIONS: Array<{ key: string; label: string; minutes: number }> = [
  { key: "1m", label: "1 minute", minutes: 1 },
  { key: "5m", label: "5 minutes", minutes: 5 },
  { key: "15m", label: "15 minutes", minutes: 15 },
  { key: "1h", label: "1 hour", minutes: 60 },
  { key: "6h", label: "6 hours", minutes: 360 },
  { key: "1d", label: "1 day", minutes: 1440 },
];
