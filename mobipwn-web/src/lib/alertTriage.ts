import { formatDurationBetween, formatDurationMs } from "./formatRelative";

export type AlertContextFields = {
  source?: string;
  platform?: string;
  parser?: string;
  bundle_id?: string;
  process_name?: string;
  device_id?: string;
  timestamp?: string;
};

function escMpl(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  return s;
}

/** Legacy API responses may still use "resolved" before migration. */
export function alertStatusNormalized(status: string): string {
  return status === "resolved" ? "verified" : status;
}

/** Hunt similar events in the same case / facet. */
export function alertHuntHref(ctx: AlertContextFields | undefined): string | null {
  if (!ctx?.source) return null;
  const params = new URLSearchParams({ source: ctx.source });
  let q = `source="${escMpl(ctx.source)}"`;
  if (ctx.parser) q += ` parser="${escMpl(ctx.parser)}"`;
  if (ctx.process_name) q += ` process_name="${escMpl(ctx.process_name)}"`;
  else if (ctx.bundle_id) q += ` bundle_id="${escMpl(ctx.bundle_id)}"`;
  q += " | fields timestamp, source, platform, parser, process_name, bundle_id, action, message, src_ip, dest_ip | sort -timestamp | head 50";
  params.set("q", q);
  return `/search?${params.toString()}`;
}

/** Open search narrowed to this exact event when possible. */
export function eventSearchHref(row: Record<string, unknown>): string | null {
  const source = str(row.source);
  if (!source) return null;
  const params = new URLSearchParams({ source });
  let q = `source="${escMpl(source)}"`;
  const timestamp = str(row.timestamp);
  const id = str(row.id);
  if (timestamp) q += ` timestamp="${escMpl(timestamp)}"`;
  else if (id) q += ` id="${escMpl(id)}"`;
  else {
    const process = str(row.process_name);
    const bundle = str(row.bundle_id);
    if (process) q += ` process_name="${escMpl(process)}"`;
    else if (bundle) q += ` bundle_id="${escMpl(bundle)}"`;
  }
  q += " | head 20";
  params.set("q", q);
  return `/search?${params.toString()}`;
}

export type AlertHighlight = {
  key: string;
  label: string;
  value: string;
};

const HIGHLIGHT_FIELDS: { key: string; label: string }[] = [
  { key: "timestamp", label: "Time" },
  { key: "source", label: "Case" },
  { key: "platform", label: "Platform" },
  { key: "parser", label: "Parser" },
  { key: "process_name", label: "Process" },
  { key: "bundle_id", label: "Bundle" },
  { key: "action", label: "Action" },
  { key: "dest_ip", label: "Dest IP" },
  { key: "src_ip", label: "Src IP" },
  { key: "severity", label: "Severity" },
];

function extField(row: Record<string, unknown>, key: string): string {
  const raw = row.ext;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return str(parsed[key]);
    } catch {
      return "";
    }
  }
  if (raw && typeof raw === "object") return str((raw as Record<string, unknown>)[key]);
  return "";
}

export function alertEventHighlights(row: Record<string, unknown>): AlertHighlight[] {
  const out: AlertHighlight[] = [];
  for (const { key, label } of HIGHLIGHT_FIELDS) {
    const value = str(row[key]);
    if (value) out.push({ key, label, value });
  }
  for (const key of ["destination_domain", "installer", "event_type"] as const) {
    const value = extField(row, key);
    if (value) out.push({ key, label: key.replace(/_/g, " "), value });
  }
  return out;
}

export function alertEventMessage(row: Record<string, unknown>): string {
  return str(row.message);
}

/** Primary alert headline — always the detection rule name when available. */
export function alertDisplayTitle(alert: { rule_name?: string | null; title?: string | null }): string {
  const name = alert.rule_name?.trim();
  if (name) return name;
  return alert.title?.trim() || "Alert";
}

/** Optional sample-event text when it differs from the rule name (legacy titles). */
export function alertSampleSummary(alert: {
  rule_name?: string | null;
  title?: string | null;
}): string | null {
  const name = alert.rule_name?.trim() ?? "";
  const title = alert.title?.trim() ?? "";
  if (!title || title === name) return null;
  return title;
}

export function alertStatusBadgeClass(status: string): string {
  const normalized = alertStatusNormalized(status);
  if (normalized === "verified") return "badge-verified";
  if (normalized === "triaged") return "badge-triaged";
  if (normalized === "false_positive") return "badge-false-positive";
  return "badge-new";
}

export function alertStatusLabel(status: string): string {
  const normalized = alertStatusNormalized(status);
  if (normalized === "false_positive") return "false positive";
  return normalized;
}

export type AlertResolutionFields = {
  status: string;
  opened_at?: string;
  first_seen?: string;
  resolved_at?: string | null;
  resolution_count?: number;
};

export function alertIsClosed(status: string): boolean {
  const normalized = alertStatusNormalized(status);
  return normalized === "verified" || normalized === "false_positive";
}

export function alertResolutionDuration(
  alert: AlertResolutionFields,
  now = Date.now()
): string {
  const opened = alert.opened_at ?? alert.first_seen;
  if (!opened) return "—";
  if (alertIsClosed(alert.status) && alert.resolved_at) {
    return formatDurationBetween(opened, alert.resolved_at);
  }
  return formatDurationMs(now - new Date(opened).getTime());
}

/** Short label for list rows and detail headers. */
export function alertResolutionLabel(alert: AlertResolutionFields, now = Date.now()): string {
  const normalized = alertStatusNormalized(alert.status);
  if (alertIsClosed(alert.status)) {
    const duration = alertResolutionDuration(alert, now);
    const count = alert.resolution_count ?? 0;
    const prefix = normalized === "verified" ? "Verified in" : "Closed in";
    if (count > 1) return `${prefix} ${duration} (${count}×)`;
    return `${prefix} ${duration}`;
  }
  return `Open for ${alertResolutionDuration(alert, now)}`;
}
