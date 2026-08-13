/** Recharts mouse event → bucket timestamp (ms). */
export function getTsFromChartEvent(
  e: unknown,
  rows: { timestamp: number }[]
): number | null {
  if (!e || !rows.length) return null;
  const ev = e as {
    activeLabel?: string | number;
    activeTooltipIndex?: number;
    activePayload?: Array<{ payload?: { timestamp?: number } }>;
  };
  const fromPayload = ev.activePayload?.[0]?.payload?.timestamp;
  if (typeof fromPayload === "number" && !Number.isNaN(fromPayload)) {
    return fromPayload;
  }
  if (typeof ev.activeTooltipIndex === "number") {
    const row = rows[ev.activeTooltipIndex];
    if (row) return row.timestamp;
  }
  if (ev.activeLabel !== undefined && ev.activeLabel !== "") {
    const n = Number(ev.activeLabel);
    if (!Number.isNaN(n) && n > 1e11) return n;
  }
  return null;
}

export function seriesColorMap(seriesKeys: string[]): Map<string, string> {
  const palette = [
    "#5EE7F0",
    "#FB7185",
    "#FBBF24",
    "#A78BFA",
    "#34D399",
    "#60A5FA",
    "#FB923C",
    "#F472B6",
    "#22D3EE",
    "#C084FC",
  ];
  const other = "#71717A";
  const m = new Map<string, string>();
  seriesKeys.forEach((k, i) => {
    m.set(k, k === "Other" ? other : palette[i % palette.length]);
  });
  return m;
}
