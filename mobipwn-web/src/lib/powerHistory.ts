import { escapeMplString } from "@/lib/mplQuery";

export type PowerRowKind = "history" | "reset";

export function strField(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (v == null) return "";
  return String(v).trim();
}

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

function extField(row: Record<string, unknown>, key: string): string {
  const v = parseExt(row)[key];
  if (v == null) return "";
  return String(v).trim();
}

/** Android power reset block header: `25/12/08 22:41:50` (YY/MM/DD, Samsung bugreport). */
export function parseEntryTimestamp(value: string): Date | null {
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const d = new Date(year, month, day, hour, minute, second);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatOffsetForIso(offset: string): string {
  return `${offset.slice(0, 3)}:${offset.slice(3)}`;
}

/** Power history line time: `10:00:24+0100` or `2025-02-20 10:07:32+0100` */
export function parsePowerEventTimestamp(value: string, anchor?: Date | null): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const full = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})([+-]\d{4})$/
  );
  if (full) {
    const iso = `${full[1]}-${full[2]}-${full[3]}T${full[4]}:${full[5]}:${full[6]}${formatOffsetForIso(full[7])}`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const timeOnly = trimmed.match(/^(\d{2}):(\d{2}):(\d{2})([+-]\d{4})$/);
  if (timeOnly && anchor) {
    const y = anchor.getFullYear();
    const mo = String(anchor.getMonth() + 1).padStart(2, "0");
    const day = String(anchor.getDate()).padStart(2, "0");
    const iso = `${y}-${mo}-${day}T${timeOnly[1]}:${timeOnly[2]}:${timeOnly[3]}${formatOffsetForIso(timeOnly[4])}`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return tryParseDate(trimmed);
}

function tryParseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isNaN(n) && n > 0) {
    const ms = n > 1e14 ? Math.floor(n / 1000) : n;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

function formatDate(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatPowerTimestamp(value: string): string {
  if (!value.trim()) return "";
  const d =
    parseEntryTimestamp(value) ??
    parsePowerEventTimestamp(value) ??
    tryParseDate(value);
  if (d) return formatDate(d);
  return value.trim();
}

function eventTimeBinding(row: Record<string, unknown>): string {
  return strField(row, "event_time_binding") || extField(row, "event_time_binding");
}

/** Resolve the best Date for a power row (event time preferred over bugreport snapshot time). */
export function parsePowerRowDate(row: Record<string, unknown>): Date | null {
  const ext = parseExt(row);
  const anchor = parseEntryTimestamp(String(ext.entry_timestamp ?? ""));

  const candidates = [
    ext.timestamp,
    ext.entry_timestamp,
    row.datetime,
  ];
  for (const raw of candidates) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s) continue;
    const d =
      parsePowerEventTimestamp(s, anchor) ??
      parseEntryTimestamp(s) ??
      tryParseDate(s);
    if (d) return d;
  }

  const binding = eventTimeBinding(row);
  if (binding === "snapshot_only") return null;

  const ch = strField(row, "timestamp");
  if (ch && binding === "per_record") {
    return tryParseDate(ch);
  }
  return null;
}

function powerEventSortMs(row: Record<string, unknown>): number {
  const pinned = row._powerSortMs;
  if (typeof pinned === "number" && pinned > 0) return pinned;
  return parsePowerRowDate(row)?.getTime() ?? 0;
}

/** Best display timestamp for a power row (event time preferred over ingest/snapshot time). */
export function powerRowTimestamp(row: Record<string, unknown>): string {
  const d = parsePowerRowDate(row);
  if (d) return formatDate(d);

  const raw =
    extField(row, "timestamp") ||
    extField(row, "entry_timestamp") ||
    strField(row, "datetime");
  if (raw) return formatPowerTimestamp(raw);
  return "";
}

export function classifyPowerRow(row: Record<string, unknown>): PowerRowKind {
  const dt = strField(row, "data_type").toLowerCase();
  const desc = extField(row, "event_type") || strField(row, "timestamp_desc");
  if (dt.includes("reset") || desc === "reset_reason") return "reset";
  return "history";
}

export function powerEventType(row: Record<string, unknown>): string {
  return strField(row, "action") || extField(row, "event_type") || "event";
}

export function powerFlags(row: Record<string, unknown>): string {
  return extField(row, "flags");
}

export function powerDetails(row: Record<string, unknown>): string {
  return extField(row, "details") || strField(row, "message");
}

export function powerResetReason(row: Record<string, unknown>): string {
  return strField(row, "action") || extField(row, "reason") || strField(row, "message");
}

export function powerStackTrace(row: Record<string, unknown>): string[] {
  const ext = parseExt(row);
  const raw = ext.stack_trace;
  if (Array.isArray(raw)) {
    return raw.map((l) => String(l).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  return [];
}

export type PowerSummary = {
  history: number;
  reset: number;
  shutdown: number;
  reboot: number;
};

export function summarizePowerRows(rows: Record<string, unknown>[]): PowerSummary {
  const summary: PowerSummary = { history: 0, reset: 0, shutdown: 0, reboot: 0 };
  for (const row of rows) {
    const kind = classifyPowerRow(row);
    if (kind === "reset") {
      summary.reset += 1;
      continue;
    }
    summary.history += 1;
    const et = powerEventType(row).toUpperCase();
    if (et.includes("SHUTDOWN")) summary.shutdown += 1;
    if (et.includes("REBOOT")) summary.reboot += 1;
  }
  return summary;
}

type NestedHistoryEvent = {
  event_type?: string;
  timestamp?: string;
  flags?: string;
  details?: string;
};

function expandNestedHistoryEvents(resetRow: Record<string, unknown>): Record<string, unknown>[] {
  const ext = parseExt(resetRow);
  const anchorStr = String(ext.entry_timestamp ?? "").trim();
  const anchor = parseEntryTimestamp(anchorStr);
  const nested = ext.history_events;
  if (!Array.isArray(nested) || nested.length === 0) return [];

  const out: Record<string, unknown>[] = [];
  for (const item of nested) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const ev = item as NestedHistoryEvent;
    const eventTs = String(ev.timestamp ?? "").trim();
    const parsed = eventTs
      ? parsePowerEventTimestamp(eventTs, anchor)
      : anchor;
    out.push({
      ext: {
        event_type: ev.event_type ?? "",
        flags: ev.flags ?? "",
        details: ev.details ?? "",
        timestamp: eventTs,
        entry_timestamp: anchorStr,
      },
      _powerSortMs: parsed?.getTime() ?? 0,
    });
  }
  return out;
}

export function powerResetEvents(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows
    .filter((r) => classifyPowerRow(r) === "reset")
    .slice()
    .sort((a, b) => powerEventSortMs(b) - powerEventSortMs(a));
}

const POWER_SKIP_EXT_KEYS = new Set([
  "event_type",
  "flags",
  "details",
  "timestamp",
  "entry_timestamp",
  "reason",
  "stack_trace",
  "history_events",
  "other_lines",
  "event_time_binding",
]);

function powerStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  return [];
}

function humanizePowerKey(key: string): string {
  const labels: Record<string, string> = {
    entry_timestamp: "Reset block time",
    event_time_binding: "Time binding",
    timestamp_desc: "Timestamp desc",
  };
  return labels[key] ?? key.replace(/_/g, " ");
}

function extraPowerFields(row: Record<string, unknown>, skip = POWER_SKIP_EXT_KEYS): Array<{ key: string; label: string; value: string }> {
  const ext = parseExt(row);
  const out: Array<{ key: string; label: string; value: string }> = [];
  const seen = new Set<string>();

  for (const [key, value] of Object.entries(ext)) {
    if (skip.has(key) || value == null) continue;
    if (typeof value === "object") continue;
    const s = String(value).trim();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: humanizePowerKey(key), value: s });
  }

  for (const key of ["data_type", "event_time_binding", "timestamp_desc"] as const) {
    if (seen.has(key)) continue;
    const s = strField(row, key) || extField(row, key);
    if (s) out.push({ key, label: humanizePowerKey(key), value: s });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export type PowerHistoryEventView = {
  when: string;
  eventType: string;
  flags: string;
  details: string;
  entryTimestamp: string;
  extraFields: Array<{ key: string; label: string; value: string }>;
};

export type PowerResetView = {
  when: string;
  entryTimestamp: string;
  reason: string;
  stackTrace: string[];
  otherLines: string[];
  nestedHistory: PowerHistoryEventView[];
  extraFields: Array<{ key: string; label: string; value: string }>;
};

export type PowerPanelView = {
  summary: PowerSummary;
  history: PowerHistoryEventView[];
  resets: PowerResetView[];
  totalRows: number;
};

function historyEventKey(row: Record<string, unknown>): string {
  const ext = parseExt(row);
  return [
    powerEventType(row),
    String(ext.timestamp ?? extField(row, "timestamp")),
    powerFlags(row),
    extField(row, "details"),
    extField(row, "entry_timestamp"),
  ].join("|");
}

/** Standalone history rows plus nested events embedded in reset blocks. */
export function powerAllHistoryEvents(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (classifyPowerRow(row) === "history") {
      const key = historyEventKey(row);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(row);
      }
    }
  }

  for (const row of rows) {
    if (classifyPowerRow(row) !== "reset") continue;
    for (const nested of expandNestedHistoryEvents(row)) {
      const key = historyEventKey(nested);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(nested);
    }
  }

  return merged.sort((a, b) => powerEventSortMs(b) - powerEventSortMs(a));
}

export function powerHistoryEventView(row: Record<string, unknown>): PowerHistoryEventView {
  const ext = parseExt(row);
  return {
    when: powerRowTimestamp(row),
    eventType: powerEventType(row),
    flags: powerFlags(row),
    details: extField(row, "details") || strField(row, "message"),
    entryTimestamp: extField(row, "entry_timestamp"),
    extraFields: extraPowerFields(row),
  };
}

export function powerResetView(row: Record<string, unknown>): PowerResetView {
  const ext = parseExt(row);
  return {
    when: powerRowTimestamp(row),
    entryTimestamp: extField(row, "entry_timestamp"),
    reason: powerResetReason(row),
    stackTrace: powerStackTrace(row),
    otherLines: powerStringList(ext.other_lines),
    nestedHistory: expandNestedHistoryEvents(row).map(powerHistoryEventView),
    extraFields: extraPowerFields(row),
  };
}

export function powerPanelViewFromRows(rows: Record<string, unknown>[]): PowerPanelView | null {
  if (!rows.length) return null;
  return {
    summary: summarizePowerRows(rows),
    history: powerAllHistoryEvents(rows).map(powerHistoryEventView),
    resets: powerResetEvents(rows).map(powerResetView),
    totalRows: rows.length,
  };
}

export function powerHistoryQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="Power" | fields timestamp, datetime, action, message, data_type, event_time_binding, timestamp_desc, ext | sort -timestamp | head 120`;
}

/** @deprecated Use {@link powerAllHistoryEvents} for merged standalone + nested history. */
export function powerHistoryEvents(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return powerAllHistoryEvents(rows);
}
