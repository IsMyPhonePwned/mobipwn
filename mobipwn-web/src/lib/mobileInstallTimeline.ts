import { strField } from "@/lib/rowExt";
import { formatWallTimestamp } from "@/lib/formatRelative";

export type MobileInstallKind = "installed" | "deleted" | "other";

export type MobileInstallEvent = {
  key: string;
  kind: MobileInstallKind;
  bundleId: string;
  label: string;
  version: string;
  timestamp: string;
  timestampMs: number;
  message: string;
  parser: string;
};

const DELETE_RE =
  /\b(uninstall(?:ed|ing)?|remov(?:e|ed|ing)|destroy(?:ed|ing)?|delet(?:e|ed|ing)|purged?|wipe[sd]?)\b/i;
const INSTALL_RE =
  /\b(staging|miinstallable|installable|install(?:ed|ing)?|created?\s+staging|successfully\s+installed)\b/i;

function rowTimeMs(row: Record<string, unknown>): number {
  const datetime = strField(row, "datetime");
  if (datetime) {
    const t = Date.parse(datetime);
    if (!Number.isNaN(t)) return t;
  }
  const ts = strField(row, "timestamp");
  if (!ts) return 0;
  const asDate = Date.parse(ts.includes("T") ? ts : ts.replace(" ", "T") + (ts.endsWith("Z") ? "" : "Z"));
  if (!Number.isNaN(asDate)) return asDate;
  const n = Number(ts);
  if (!Number.isNaN(n) && n > 0) return n > 1e14 ? Math.floor(n / 1000) : n;
  return 0;
}

function parseMiVersions(message: string): { version: string; versionCode: string } {
  const pick = (re: RegExp) => {
    const raw = message.match(re)?.[1]?.trim() ?? "";
    const cleaned = raw.replace(/[,;)>]+$/g, "").trim();
    return looksLikeAppVersion(cleaned) ? cleaned : "";
  };
  // Require = or : so prose like "version does not…" never becomes a version.
  const version =
    pick(/ShortVersion\s*=\s*([^;>\s,]+)/i) ||
    pick(/CFBundleShortVersionString\s*[=:]\s*([^\s;,>]+)/i) ||
    "";
  const versionCode =
    pick(/(?:^|[;\s,])Version\s*=\s*([^;>\s,]+)/i) ||
    pick(/CFBundleVersion\s*[=:]\s*([^\s;,>]+)/i) ||
    "";
  return { version, versionCode };
}

/** True for values that look like app versions (must contain a digit). */
export function looksLikeAppVersion(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 64) return false;
  if (!/\d/.test(v)) return false;
  if (/[\s/\\]/.test(v)) return false;
  return true;
}

function classifyMessage(message: string, action: string): MobileInstallKind {
  const hay = `${action} ${message}`;
  if (DELETE_RE.test(hay)) return "deleted";
  if (INSTALL_RE.test(hay)) return "installed";
  return "other";
}

function bundleLabel(bundleId: string): string {
  if (!bundleId) return "Unknown app";
  const parts = bundleId.split(".");
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return bundleId;
}

/** Build install/delete timeline from mobileinstallation (+ optional powerlogs App Info) rows. */
export function mobileInstallEvents(
  rows: Record<string, unknown>[],
  limit = 200
): MobileInstallEvent[] {
  const out: MobileInstallEvent[] = [];

  for (const row of rows) {
    const parser = strField(row, "parser");
    const message = strField(row, "message");
    const action = strField(row, "action") || strField(row, "event_type");
    const bundleId = strField(row, "bundle_id");
    if (!bundleId) continue;

    let kind: MobileInstallKind = "other";
    let version = "";

    if (parser === "mobileinstallation") {
      kind = classifyMessage(message, action);
      // Prefer library-stamped fields; scrape message only as fallback.
      const stamped =
        strField(row, "short_version") ||
        strField(row, "CFBundleShortVersionString") ||
        "";
      const stampedCode =
        strField(row, "version") || strField(row, "CFBundleVersion") || "";
      const mi = parseMiVersions(message);
      version =
        (looksLikeAppVersion(stamped) ? stamped : "") ||
        mi.version ||
        (looksLikeAppVersion(stampedCode) ? stampedCode : "") ||
        mi.versionCode;
    } else if (parser === "powerlogs" && /app\s*info/i.test(message)) {
      const deletedHint =
        /\bdeleted\b/i.test(message) && !/not\s+deleted/i.test(message);
      if (!deletedHint) continue;
      kind = "deleted";
    } else {
      continue;
    }

    if (kind === "other") continue;

    const timestampMs = rowTimeMs(row);
    out.push({
      key: `${kind}|${bundleId}|${timestampMs}|${message.slice(0, 48)}`,
      kind,
      bundleId,
      label: bundleLabel(bundleId),
      version,
      timestamp: timestampMs > 0 ? formatWallTimestamp(new Date(timestampMs).toISOString()) : "",
      timestampMs,
      message,
      parser: parser || "mobileinstallation",
    });
  }

  out.sort((a, b) => b.timestampMs - a.timestampMs || a.bundleId.localeCompare(b.bundleId));
  return out.slice(0, limit);
}

export function mobileInstallSearchQuery(bundleId: string, scope: string): string {
  const id = bundleId.replace(/"/g, '\\"');
  return `${scope} parser="mobileinstallation" bundle_id="${id}" | sort -timestamp | head 40`;
}
