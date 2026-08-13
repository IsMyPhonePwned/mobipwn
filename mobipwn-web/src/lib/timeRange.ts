/** Wall-clock range for search API (datetime-local strings, no timezone suffix). */

export type TimeRangeValue = {
  from: string;
  to: string;
};

export const TIME_RANGE_PRESETS = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "4h", minutes: 4 * 60 },
  { label: "12h", minutes: 12 * 60 },
  { label: "24h", minutes: 24 * 60 },
  { label: "7d", minutes: 7 * 24 * 60 },
  { label: "30d", minutes: 30 * 24 * 60 },
] as const;

export function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function rangeFromPresetMinutes(minutes: number): TimeRangeValue {
  const to = new Date();
  const from = new Date(to.getTime() - minutes * 60 * 1000);
  return { from: toDatetimeLocal(from), to: toDatetimeLocal(to) };
}

export function formatRangeTrigger(value: TimeRangeValue): string {
  if (!value.from && !value.to) return "Time range";
  const fmt = (s: string) => {
    if (!s) return "…";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  return `${fmt(value.from)} → ${fmt(value.to)}`;
}

export function parseDatetimeLocal(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
