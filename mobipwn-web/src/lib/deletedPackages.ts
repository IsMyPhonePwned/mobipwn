import { extField, formatRowTimestamp, parseExt, strField } from "@/lib/rowExt";

export type DeletedPackageEntry = {
  bundleId: string;
  label: string;
  lastDeleted: string;
  deleteCount: number;
  caller: string;
  user: string;
  flags: string;
  observer: string;
};

function rowSortKey(row: Record<string, unknown>): number {
  const datetime = strField(row, "datetime");
  if (datetime) {
    const t = new Date(datetime).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const ts = strField(row, "timestamp");
  const parsed = Date.parse(ts.replace(" ", "T") + "Z");
  if (!Number.isNaN(parsed)) return parsed;
  const n = Number(ts);
  if (!Number.isNaN(n) && n > 0) return n > 1e14 ? Math.floor(n / 1000) : n;
  return 0;
}

function isDeleteRow(row: Record<string, unknown>): boolean {
  const parser = strField(row, "parser");
  if (parser && parser !== "Package") return false;
  const dataType = strField(row, "data_type").toLowerCase();
  if (dataType && !dataType.includes("package_install")) return false;

  const eventType = extField(row, "event_type").toUpperCase();
  if (eventType === "START_DELETE" || eventType === "DELETE_RESULT") return true;

  const message = strField(row, "message").toUpperCase();
  return message.includes("DELETE");
}

function packageId(row: Record<string, unknown>): string {
  return (
    strField(row, "bundle_id") ||
    extField(row, "pkg") ||
    extField(row, "package_name")
  );
}

function packageLabel(bundleId: string): string {
  if (!bundleId) return "Unknown package";
  const parts = bundleId.split(".");
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return bundleId;
}

function formatUid(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return `UID ${trimmed}`;
  return trimmed;
}

function parseDeleteRow(row: Record<string, unknown>): DeletedPackageEntry | null {
  if (!isDeleteRow(row)) return null;

  const eventType = extField(row, "event_type").toUpperCase();
  const bundleId = packageId(row);

  // DELETE_RESULT rows usually lack a package id — skip unless we have one.
  if (!bundleId && eventType === "DELETE_RESULT") return null;
  if (!bundleId) return null;

  const ext = parseExt(row);
  const caller = formatUid(String(ext.caller ?? extField(row, "caller") ?? ""));
  const user = ext.user != null ? formatUid(String(ext.user)) : "";
  const flags = ext.flags != null ? String(ext.flags) : "";
  const observer = extField(row, "observer");

  return {
    bundleId,
    label: packageLabel(bundleId),
    lastDeleted: formatRowTimestamp(row),
    deleteCount: 1,
    caller,
    user,
    flags,
    observer,
  };
}

export function deletedPackageEntries(rows: Record<string, unknown>[], limit = 20): DeletedPackageEntry[] {
  const byBundle = new Map<string, { entry: DeletedPackageEntry; sortKey: number }>();

  for (const row of rows) {
    const parsed = parseDeleteRow(row);
    if (!parsed) continue;
    const sortKey = rowSortKey(row);
    const prev = byBundle.get(parsed.bundleId);
    if (!prev) {
      byBundle.set(parsed.bundleId, { entry: parsed, sortKey });
      continue;
    }
    byBundle.set(parsed.bundleId, {
      entry: {
        ...prev.entry,
        deleteCount: prev.entry.deleteCount + 1,
        lastDeleted: sortKey >= prev.sortKey ? parsed.lastDeleted || prev.entry.lastDeleted : prev.entry.lastDeleted,
        caller: sortKey >= prev.sortKey && parsed.caller ? parsed.caller : prev.entry.caller,
        user: sortKey >= prev.sortKey && parsed.user ? parsed.user : prev.entry.user,
        flags: sortKey >= prev.sortKey && parsed.flags ? parsed.flags : prev.entry.flags,
        observer: sortKey >= prev.sortKey && parsed.observer ? parsed.observer : prev.entry.observer,
      },
      sortKey: Math.max(prev.sortKey, sortKey),
    });
  }

  return [...byBundle.values()]
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((item) => item.entry)
    .slice(0, limit);
}

export function deletedPackagesSearchQuery(bundleId: string, scope?: string): string {
  const pkg = bundleId.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const base = scope ? `${scope} ` : "";
  return `${base}parser="Package" data_type=*package_install* bundle_id="${pkg}" message=*DELETE* | sort -timestamp | head 20`;
}
