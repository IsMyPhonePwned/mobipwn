export function parseBucketTimestamp(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) {
    // ClickHouse may return unix seconds; JS dates need ms.
    if (value > 0 && value < 1e12) return value * 1000;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isNaN(n)) return n < 1e12 ? n * 1000 : n;
    }
    const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
    const d = new Date(withTz);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return null;
}

export function formatY(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  return Math.round(value).toString();
}

export function formatBucketTime(ts: number, spansDays: boolean): string {
  const d = new Date(ts);
  if (spansDays) {
    return d.toLocaleString("en-US", {
      timeZone: "UTC",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return d.toLocaleString("en-US", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function bucketIntervalMs(points: Array<{ timestamp: number }>): number {
  if (points.length < 2) return 60 * 60 * 1000;
  const intervals: number[] = [];
  for (let i = 1; i < points.length; i++) {
    intervals.push(points[i].timestamp - points[i - 1].timestamp);
  }
  intervals.sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)] || 60 * 60 * 1000;
}

export function downloadTimelineCsv(filename: string, header: string[], rows: string[][]) {
  const lines = [header, ...rows].map((row) =>
    row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
