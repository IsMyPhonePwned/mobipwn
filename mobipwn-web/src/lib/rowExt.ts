export function parseExt(row: Record<string, unknown>): Record<string, unknown> {
  const raw = row.ext;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function strField(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (v == null) return "";
  return String(v).trim();
}

export function extField(row: Record<string, unknown>, key: string): string {
  const v = parseExt(row)[key];
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim();
}

export function numFromValue(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function numField(row: Record<string, unknown>, key: string): number | null {
  const ext = parseExt(row);
  return numFromValue(row[key] ?? ext[key]);
}

export function formatBytes(n: number | null): string {
  if (n == null || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatRowTimestamp(row: Record<string, unknown>): string {
  const logcat = extField(row, "timestamp");
  const datetime = strField(row, "datetime");
  if (logcat && /^\d{2}-\d{2}\s/.test(logcat) && datetime) {
    const d = new Date(datetime);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${logcat}`;
    }
    return logcat;
  }
  if (logcat) return logcat;
  if (datetime) {
    const d = new Date(datetime);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
    return datetime;
  }
  const ts = strField(row, "timestamp");
  const n = Number(ts);
  if (!Number.isNaN(n) && n > 0) {
    const ms = n > 1e14 ? Math.floor(n / 1000) : n;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
  }
  return "";
}
