/** Wall-clock timestamp for audit / timeline entries. */
export function formatWallTimestamp(iso: string): string {
  const d = parseApiTimestamp(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Parse API / ClickHouse timestamps.
 * Naive `YYYY-MM-DD HH:MM:SS` / `YYYY-MM-DDTHH:MM:SS` values are treated as UTC
 * (Mobipwn stores ClickHouse DateTime in UTC). Without this, browsers interpret
 * them as local time and relative labels drift by the timezone offset.
 */
export function parseApiTimestamp(raw: string | Date | number): Date {
  if (raw instanceof Date) return raw;
  if (typeof raw === "number") return new Date(raw);
  const s = String(raw).trim();
  if (!s) return new Date(NaN);

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s);
  }

  const naive = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (naive) {
    return new Date(`${naive[1]}T${naive[2]}Z`);
  }

  return new Date(s);
}

/** Compact relative time for history lists (nano-style). */
export function formatRelativeCompact(d: Date | string, now = Date.now()): string {
  const date = d instanceof Date ? d : parseApiTimestamp(d);
  const sec = Math.floor((now - date.getTime()) / 1000);
  if (Number.isNaN(sec)) return "—";
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Human-readable duration from milliseconds (e.g. "2h 14m", "3d 5h"). */
export function formatDurationMs(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
  const days = Math.floor(hr / 24);
  const remHr = hr % 24;
  return remHr > 0 ? `${days}d ${remHr}h` : `${days}d`;
}

export function formatDurationBetween(startIso: string, endIso: string): string {
  const start = parseApiTimestamp(startIso).getTime();
  const end = parseApiTimestamp(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  return formatDurationMs(end - start);
}
