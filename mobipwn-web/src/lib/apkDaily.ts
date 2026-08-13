import { parseExt } from "@/lib/rowExt";
import { escapeMplString } from "@/lib/mplQuery";

export type ApkDailyAction = "downgrade" | "uninstall" | "update";

export type ApkDailyEvent = {
  packageName: string;
  action: ApkDailyAction;
  vers: string;
  previousVers: string;
  from: string;
  to: string;
  message: string;
  timestamp: string;
};

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function classifyAction(raw: string, dataType: string, message: string): ApkDailyAction {
  const a = raw.toLowerCase();
  const dt = dataType.toLowerCase();
  const msg = message.toLowerCase();
  if (a === "downgrade" || dt.includes("downgrade") || msg.includes("apk downgrade")) {
    return "downgrade";
  }
  if (a === "uninstall" || dt.includes("uninstall") || msg.includes("vers=0")) {
    return "uninstall";
  }
  return "update";
}

export function parseApkDailyEvent(row: Record<string, unknown>): ApkDailyEvent | null {
  const ext = parseExt(row);
  const dataType = str(row.data_type);
  if (
    !dataType.includes("battery_daily") &&
    str(row.parser).toLowerCase() !== "battery" &&
    !str(row.message).toLowerCase().includes("battery daily")
  ) {
    // Still allow if action is explicitly set on a Battery row.
    if (str(row.parser).toLowerCase() !== "battery") return null;
  }

  const packageName =
    str(row.bundle_id) ||
    str(ext.package_name) ||
    str(ext.pkg) ||
    "";
  const action = classifyAction(str(row.action) || str(ext.action), dataType, str(row.message));
  const vers = str(ext.vers) || str(row.vers);
  const previousVers = str(ext.previous_vers) || str(ext.previousVers);
  const from = str(ext.daily_from) || str(ext.from);
  const to = str(ext.daily_to) || str(ext.to);
  const message = str(row.message);
  const timestamp = str(row.timestamp) || str(row.datetime) || from;

  if (!packageName && !message) return null;
  if (!dataType.includes("battery_daily") && action === "update" && !vers) {
    // Skip ordinary battery_app_stats / history rows.
    if (!message.toLowerCase().includes("apk ")) return null;
  }

  return {
    packageName: packageName || "—",
    action,
    vers,
    previousVers,
    from,
    to,
    message,
    timestamp,
  };
}

/** Prefer downgrades, then uninstalls, then updates — newest first within each. */
export function apkDailyEvents(
  rows: Record<string, unknown>[],
  limit = 80,
  opts?: { actions?: ApkDailyAction[] }
): ApkDailyEvent[] {
  const allow = new Set(opts?.actions ?? ["downgrade", "uninstall", "update"]);
  const out: ApkDailyEvent[] = [];
  for (const row of rows) {
    const ev = parseApkDailyEvent(row);
    if (!ev || !allow.has(ev.action)) continue;
    out.push(ev);
  }
  const rank = (a: ApkDailyAction) =>
    a === "downgrade" ? 0 : a === "uninstall" ? 1 : 2;
  out.sort((a, b) => {
    const r = rank(a.action) - rank(b.action);
    if (r !== 0) return r;
    return b.from.localeCompare(a.from) || b.timestamp.localeCompare(a.timestamp);
  });
  return limit > 0 ? out.slice(0, limit) : out;
}

export function apkDailyQuery(source: string): string {
  const src = escapeMplString(source);
  return (
    `source="${src}" parser="Battery" ` +
    `(data_type=*battery_daily* OR action="downgrade" OR action="uninstall" OR message=*APK*) ` +
    `| fields timestamp, datetime, bundle_id, action, message, data_type, ext ` +
    `| sort -timestamp | head 200`
  );
}

export function apkDailySearchQuery(scope: string, ev?: ApkDailyEvent): string {
  if (ev?.packageName && ev.packageName !== "—") {
    return `${scope} parser="Battery" bundle_id="${escapeMplString(ev.packageName)}"`;
  }
  return `${scope} parser="Battery" (data_type=*battery_daily_downgrade* OR action="downgrade")`;
}
