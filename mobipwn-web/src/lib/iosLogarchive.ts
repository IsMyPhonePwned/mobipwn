import { parseHeaderExt } from "@/lib/bugreportHeader";

export type LogarchiveSnapshot = {
  decode: string;
  fileCount?: number;
  eventCount?: number;
  maxLines?: number;
  logLines: number;
  tool?: string;
  toolLabel?: string;
  reason?: string;
  sampleMessage?: string;
  statusHelp?: string;
  capped?: boolean;
};

export type LogarchiveSubsystemRow = {
  subsystem: string;
  count: number;
};

export type LogarchiveRecentLine = {
  timestamp?: string;
  subsystem: string;
  message: string;
};

export function logarchiveDecodeBadgeClass(decode: string): string {
  switch (decode) {
    case "success":
      return "case-ios-logarchive__badge--success";
    case "deferred":
      return "case-ios-logarchive__badge--deferred";
    case "failed":
      return "case-ios-logarchive__badge--failed";
    case "skipped":
      return "case-ios-logarchive__badge--skipped";
    default:
      return "case-ios-logarchive__badge--unknown";
  }
}

export function formatLogarchiveTimestamp(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const s = raw.trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (s.length >= 19) return s.slice(0, 19).replace("T", " ");
  return s;
}

export function truncateLogMessage(message: string, max = 140): string {
  const m = message.trim();
  if (m.length <= max) return m;
  return `${m.slice(0, max - 1)}…`;
}

const LOGARCHIVE_TOOL_LABELS: Record<string, string> = {
  "macos-unifiedlogs": "Mandiant macos-unifiedlogs (in-process)",
};

const DECODE_STATUS_HELP: Record<string, string> = {
  success:
    "Decoded in-process with Mandiant macos-unifiedlogs (no Apple log CLI or unifiedlog_iterator).",
  deferred:
    "Decode not run — rebuild mobipwn-api with ./dev.sh --logarchive-decode (or cargo build -p mobipwn-api --features logarchive-decode).",
  skipped: "No system_logs.logarchive/ tree found in this archive.",
  failed: "macos-unifiedlogs decode failed — see reason below.",
};

export function logarchiveToolLabel(tool: string): string {
  return LOGARCHIVE_TOOL_LABELS[tool] ?? tool;
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const ext = parseHeaderExt(row);
  for (const key of keys) {
    const v = ext[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  const ext = parseHeaderExt(row);
  for (const key of keys) {
    const v = ext[key];
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function rowEventType(row: Record<string, unknown>): string {
  return pickString(row, ["event_type", "action"]);
}

function isLogarchiveEventRow(row: Record<string, unknown>): boolean {
  const et = rowEventType(row);
  return et === "logarchive_event" || (et !== "logarchive_inventory" && et !== "" && et !== "logarchive_event");
}

function inventoryRow(rows: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return rows.find((r) => rowEventType(r) === "logarchive_inventory");
}

function metadataRow(rows: Record<string, unknown>[]): Record<string, unknown> {
  const inv = inventoryRow(rows);
  if (inv) return inv;
  return (
    rows.find((r) => pickString(r, ["logarchive_decode", "decode"])) ??
    rows.find((r) => isLogarchiveEventRow(r)) ??
    rows[0] ??
    {}
  );
}

function countLogarchiveEvents(rows: Record<string, unknown>[]): number {
  return rows.filter((r) => {
    const et = rowEventType(r);
    return et === "logarchive_event" || (et !== "logarchive_inventory" && et !== "");
  }).length;
}

function parseStatsTotal(rows: Record<string, unknown>[]): number | undefined {
  if (rows.length !== 1) return undefined;
  const row = rows[0];
  for (const key of ["stat", "total", "count", "event_count", "eventCount"]) {
    const n = pickNumber(row, [key]);
    if (n != null) return n;
  }
  return undefined;
}

export function logarchiveSubsystemsFromRows(rows: Record<string, unknown>[]): LogarchiveSubsystemRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const subsystem = pickString(row, ["bundle_id", "subsystem"]);
    const label = subsystem || "(unknown)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([subsystem, count]) => ({ subsystem, count }))
    .sort((a, b) => b.count - a.count);
}

export function logarchiveRecentLinesFromRows(
  rows: Record<string, unknown>[],
  limit = 8
): LogarchiveRecentLine[] {
  const out: LogarchiveRecentLine[] = [];
  for (const row of rows) {
    if (!isLogarchiveEventRow(row)) continue;
    const message = pickString(row, ["message", "eventMessage"]);
    if (!message || message.startsWith("Unified log archive:")) continue;
    out.push({
      timestamp: pickString(row, ["timestamp"]) || undefined,
      subsystem: pickString(row, ["bundle_id", "subsystem"]) || "(unknown)",
      message,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function logarchiveSnapshotFromRows(
  rows: Record<string, unknown>[],
  options?: { totalEvents?: number; subsystemRows?: Record<string, unknown>[] }
): LogarchiveSnapshot | null {
  if (!rows.length && !options?.totalEvents) return null;

  const inventory = metadataRow(rows);
  let decode = pickString(inventory, ["logarchive_decode", "decode"]);
  const eventRows = rows.filter((r) => rowEventType(r) === "logarchive_event");
  if (!decode && eventRows.length > 0) decode = "success";
  if (!decode && (options?.totalEvents ?? 0) > 0) decode = "success";
  if (!decode) decode = "unknown";

  const fileCount = pickNumber(inventory, ["file_count"]);
  const maxLines = pickNumber(inventory, ["max_lines"]);
  const tool = pickString(inventory, ["logarchive_tool", "tool"]);
  const reason = pickString(inventory, ["reason"]);
  const sampledEvents = countLogarchiveEvents(rows);
  const statsTotal = options?.totalEvents ?? parseStatsTotal(rows);
  const eventCount = pickNumber(inventory, ["event_count"]) ?? statsTotal ?? (sampledEvents > 0 ? sampledEvents : undefined);
  const logLines = statsTotal ?? sampledEvents;
  const capped =
    maxLines != null && eventCount != null ? eventCount >= maxLines : maxLines != null && logLines >= maxLines;

  const sampleMessage = logarchiveRecentLinesFromRows(rows, 1)[0]?.message;

  return {
    decode,
    fileCount,
    eventCount,
    maxLines,
    logLines,
    tool: tool || undefined,
    toolLabel: tool ? logarchiveToolLabel(tool) : decode === "success" ? logarchiveToolLabel("macos-unifiedlogs") : undefined,
    reason: reason || undefined,
    statusHelp: DECODE_STATUS_HELP[decode],
    sampleMessage,
    capped,
  };
}
