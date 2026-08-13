import { extField, formatRowTimestamp, parseExt, strField } from "@/lib/rowExt";
import type { CasePlatform } from "@/lib/caseDashboard";
import { formatWallTimestamp } from "@/lib/formatRelative";
import { iosTccServiceLabel, iosTccServiceTooltip } from "@/lib/iosTccServices";

export type PackageRow = {
  bundleId: string;
  label: string;
  version: string;
  installer: string;
  updated: string;
  timestamp: string;
  /** Best-effort first-install / install-event time for display. */
  installedAt: string;
  /** Sortable epoch ms for `installedAt` (null when unknown). */
  installedAtMs: number | null;
  /** Sysdiagnose / parser module that surfaced this bundle (iOS). */
  parser?: string;
  /** Android declared / install / runtime permissions, or iOS TCC services. */
  permissions?: PackagePermission[];
  /** Android package_metadata extras (bugreport dumpsys package). */
  versionCode?: string;
  uid?: string;
  minSdk?: string;
  targetSdk?: string;
  codePath?: string;
  dataDir?: string;
  updatedAt?: string;
  updatedAtMs?: number | null;
  initiatingPackage?: string;
  originatingPackage?: string;
  packageSource?: string;
  apkSigningVersion?: string;
  primaryCpuAbi?: string;
  flags?: string;
  installReason?: string;
  /** True when codePath looks like a system / vendor / product partition APK. */
  isSystemPath?: boolean;
  /** iOS powerlogs App Info / inventory extras. */
  executableName?: string;
  buildVersion?: string;
  deletedDate?: string;
  isDeleted?: boolean;
  appType?: string;
  /** Secondary parsers that also mentioned this bundle. */
  sources?: string[];
  /** Remaining string fields worth showing in the detail drawer. */
  extras?: Array<{ label: string; value: string }>;
};

export type PackagePermission = {
  name: string;
  shortName: string;
  granted?: boolean;
  protection?: string;
  /** declared, install, or runtime */
  permType?: string;
};

const IOS_INSTALL_PARSERS = [
  "mobileinstallation",
  "appinstallation",
  "accessibility_tcc",
  "itunesstore",
  "mobilebackup",
] as const;

const IOS_INSTALL_PARSER_SET = new Set<string>(IOS_INSTALL_PARSERS);

/** Powerlogs inventory rows look like `App Info: app name=…`. */
const IOS_POWERLOG_APP_INFO = "App Info:";

const IOS_APP_INFO_SKIP_KEYS = new Set([
  "apollo_module",
  "event_type",
  "source_db",
  "timestamp_desc",
  "bundle id",
  "bundle_id",
  "app name",
  "app_name",
  "app bundle version",
  "app build version",
  "app executable name",
  "app deleted date",
  "app type",
  "plapplicationagent_eventnone_allapps table id",
]);

function escapeMplSource(source: string): string {
  return source.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Prefer the ingest-stamped `bundle_id` (sysdiagnose library canonicalize/extract).
 * No client-side false-positive filtering — that lives in sysdiagnose-extractor-library.
 */
function iosBundleIdFromRow(row: Record<string, unknown>): string {
  return (
    strField(row, "bundle_id").trim() ||
    strField(row, "bundleid").trim() ||
    extField(row, "bundle_id").trim() ||
    extField(row, "bundle id").trim() ||
    extField(row, "client").trim() ||
    ""
  );
}

function scrapeKv(message: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}=([^,]*)`, "i");
  return message.match(re)?.[1]?.trim() ?? "";
}

function parsePowerlogAppInfo(message: string, ext: Record<string, unknown>): {
  name: string;
  version: string;
  buildVersion: string;
  executableName: string;
  deletedDate: string;
  appType: string;
} {
  const fromExt = (key: string) => {
    const v = ext[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return "";
  };
  if (!message.includes(IOS_POWERLOG_APP_INFO) && !fromExt("app name") && !fromExt("bundle id")) {
    return { name: "", version: "", buildVersion: "", executableName: "", deletedDate: "", appType: "" };
  }
  const name = fromExt("app name") || scrapeKv(message, "app name");
  const version =
    fromExt("app bundle version") ||
    scrapeKv(message, "app bundle version") ||
    fromExt("app build version") ||
    scrapeKv(message, "app build version");
  const buildVersion =
    fromExt("app build version") || scrapeKv(message, "app build version");
  const executableName =
    fromExt("app executable name") || scrapeKv(message, "app executable name");
  const deletedDate =
    fromExt("app deleted date") || scrapeKv(message, "app deleted date");
  const appType = fromExt("app type") || scrapeKv(message, "app type");
  return { name, version, buildVersion, executableName, deletedDate, appType };
}

function parseMobileInstallVersions(message: string): { version: string; versionCode: string } {
  const pick = (re: RegExp) => {
    const raw = message.match(re)?.[1]?.trim() ?? "";
    const cleaned = raw.replace(/[,;)>]+$/g, "").trim();
    return looksLikeAppVersion(cleaned) ? cleaned : "";
  };
  const short =
    pick(/ShortVersion\s*=\s*([^;>\s,]+)/i) ||
    pick(/CFBundleShortVersionString\s*[=:]\s*([^\s;,>]+)/i) ||
    "";
  const ver =
    pick(/(?:^|[;\s,])Version\s*=\s*([^;>\s,]+)/i) ||
    pick(/CFBundleVersion\s*[=:]\s*([^\s;,>]+)/i) ||
    "";
  return { version: short || ver, versionCode: short && ver && short !== ver ? ver : "" };
}

function looksLikeAppVersion(value: string): boolean {
  const v = value.trim().replace(/[,;)>]+$/g, "").trim();
  if (!v || v.length > 64) return false;
  if (!/\d/.test(v)) return false;
  if (/[\s/\\,]/.test(v)) return false;
  return true;
}

function iosExtrasFromExt(ext: Record<string, unknown>): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(ext)) {
    if (IOS_APP_INFO_SKIP_KEYS.has(key)) continue;
    if (key.toLowerCase().includes("table id")) continue;
    const s =
      typeof value === "string"
        ? value.trim()
        : typeof value === "number" && Number.isFinite(value)
          ? String(value)
          : typeof value === "boolean"
            ? value ? "true" : "false"
            : "";
    if (!s || s === "NOT DELETED") continue;
    if (s.length > 240) continue;
    out.push({
      label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      value: s,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function parseIosTccPermissions(row: Record<string, unknown>, ext: Record<string, unknown>): PackagePermission[] {
  const service =
    (typeof ext.service === "string" && ext.service) ||
    strField(row, "permission") ||
    extField(row, "service") ||
    "";
  if (!service.trim()) return [];
  const allowed =
    (typeof ext.allowed === "string" && ext.allowed) ||
    extField(row, "allowed") ||
    "";
  const a = allowed.trim().toLowerCase();
  let granted: boolean | undefined;
  if (/deny|disallow|restrict|limited/.test(a)) granted = false;
  else if (/allow/.test(a)) granted = true;
  const raw = service.trim();
  return [
    {
      name: raw,
      shortName: iosTccServiceLabel(raw),
      granted,
      permType: "tcc",
      protection: allowed.trim() || undefined,
    },
  ];
}

function mergePackagePermissions(
  a?: PackagePermission[],
  b?: PackagePermission[]
): PackagePermission[] | undefined {
  if (!a?.length && !b?.length) return undefined;
  const map = new Map<string, PackagePermission>();
  for (const p of [...(a ?? []), ...(b ?? [])]) {
    const existing = map.get(p.name);
    if (!existing) {
      map.set(p.name, p);
      continue;
    }
    map.set(p.name, {
      ...existing,
      shortName: existing.shortName || p.shortName,
      granted: existing.granted ?? p.granted,
      protection: existing.protection || p.protection,
      permType: existing.permType || p.permType,
    });
  }
  return [...map.values()].sort(
    (x, y) => x.shortName.localeCompare(y.shortName) || x.name.localeCompare(y.name)
  );
}

function mergeExtras(
  a?: Array<{ label: string; value: string }>,
  b?: Array<{ label: string; value: string }>
): Array<{ label: string; value: string }> | undefined {
  if (!a?.length && !b?.length) return undefined;
  const map = new Map<string, string>();
  for (const item of [...(a ?? []), ...(b ?? [])]) {
    if (!map.has(item.label)) map.set(item.label, item.value);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((x, y) => x.label.localeCompare(y.label));
}

function mergeSources(a?: string[], b?: string[], extra?: string): string[] | undefined {
  const set = new Set<string>();
  for (const s of [...(a ?? []), ...(b ?? [])]) {
    const t = s.trim();
    if (t) set.add(t);
  }
  if (extra?.trim()) set.add(extra.trim());
  return set.size ? [...set].sort() : undefined;
}

function packageRowScore(pkg: PackageRow, row: Record<string, unknown>, platform: CasePlatform): number {
  let score = 0;
  if (pkg.version) score += 6;
  if (pkg.label !== pkg.bundleId) score += 4;
  if (pkg.parser) score += 2;
  if (pkg.installedAtMs != null) score += 5;
  if (pkg.uid) score += 2;
  if (pkg.codePath) score += 2;
  if (pkg.targetSdk) score += 1;
  if ((pkg.permissions?.length ?? 0) > 0) score += 4;
  if (pkg.executableName) score += 2;
  if (pkg.buildVersion) score += 1;
  if ((pkg.extras?.length ?? 0) > 0) score += 1;
  if (platform === "ios") {
    const parser = strField(row, "parser");
    const message = strField(row, "message");
    if (parser === "mobileinstallation" || parser === "appinstallation") score += 20;
    else if (parser === "powerlogs" && message.includes(IOS_POWERLOG_APP_INFO)) score += 18;
    else if (parser === "accessibility_tcc") score += 6;
    else if (IOS_INSTALL_PARSER_SET.has(parser)) score += 8;
    if (parser === "powerlogs" && !message.includes(IOS_POWERLOG_APP_INFO)) score -= 12;
  }
  return score;
}

/** Parse Android / iOS package install timestamps into epoch ms. */
export function parsePackageTimeMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum > 0) {
    const ms = asNum > 1e14 ? Math.floor(asNum / 1000) : asNum < 1e12 ? Math.floor(asNum * 1000) : asNum;
    return isPlausibleInstallMs(ms) ? ms : null;
  }

  // Android dumps use "YYYY-MM-DD HH:MM:SS" (no TZ) — treat as UTC for stable sorting.
  const spaceDate = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (spaceDate) {
    const ms = Date.parse(`${spaceDate[1]}T${spaceDate[2]}Z`);
    return Number.isNaN(ms) || !isPlausibleInstallMs(ms) ? null : ms;
  }

  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) || !isPlausibleInstallMs(ms) ? null : ms;
}

function isPlausibleInstallMs(ms: number): boolean {
  // Skip epoch / Core Data garbage (1970) and absurd future dates (e.g. powerlogs 2082).
  const now = Date.now();
  return ms >= Date.UTC(2008, 0, 1) && ms <= now + 24 * 60 * 60 * 1000;
}

function formatInstallTime(raw: string, ms: number | null): string {
  if (ms != null) return formatWallTimestamp(new Date(ms).toISOString());
  return raw.trim();
}

function androidUserField(ext: Record<string, unknown>, ...keys: string[]): string {
  const users = ext.users;
  if (!Array.isArray(users) || users.length === 0) return "";
  const preferred =
    users.find((u) => {
      if (!u || typeof u !== "object" || Array.isArray(u)) return false;
      const o = u as Record<string, unknown>;
      return o.user_id === 0 || o.user_id === "0";
    }) ?? users[0];
  if (!preferred || typeof preferred !== "object" || Array.isArray(preferred)) return "";
  const o = preferred as Record<string, unknown>;
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function androidSdkFromExt(ext: Record<string, unknown>): { minSdk: string; targetSdk: string } {
  const minSdk =
    (typeof ext.minSdk === "string" && ext.minSdk) ||
    (typeof ext.minSdk === "number" ? String(ext.minSdk) : "") ||
    "";
  const targetSdk =
    (typeof ext.targetSdk === "string" && ext.targetSdk) ||
    (typeof ext.targetSdk === "number" ? String(ext.targetSdk) : "") ||
    (typeof ext.targetSdkVersion === "string" && ext.targetSdkVersion) ||
    (typeof ext.targetSdkVersion === "number" ? String(ext.targetSdkVersion) : "") ||
    "";
  return { minSdk: minSdk.trim(), targetSdk: targetSdk.trim() };
}

function androidFlagsString(ext: Record<string, unknown>): string {
  const raw = ext.flags ?? ext.pkgFlags;
  if (typeof raw === "string") return raw.replace(/^\[|\]$/g, "").trim();
  if (Array.isArray(raw)) return raw.map(String).join(" ");
  return "";
}

function isSystemCodePath(codePath: string): boolean {
  const p = codePath.toLowerCase();
  return (
    p.startsWith("/system/") ||
    p.startsWith("/system_ext/") ||
    p.startsWith("/vendor/") ||
    p.startsWith("/product/") ||
    p.startsWith("/apex/") ||
    p.includes("/system/priv-app/") ||
    p.includes("/system/app/")
  );
}

/** Compact path for table cells (keep last meaningful segments). */
export function shortenPackagePath(path: string): string {
  const p = path.trim();
  if (!p) return "";
  if (p.length <= 48) return p;
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-3).join("/")}`;
}

export function packagePermissionSummary(perms: PackagePermission[] | undefined): {
  total: number;
  granted: number;
  denied: number;
} {
  const list = perms ?? [];
  let granted = 0;
  let denied = 0;
  for (const p of list) {
    if (p.granted === true) granted += 1;
    else if (p.granted === false) denied += 1;
  }
  return { total: list.length, granted, denied };
}

function androidFirstInstallRaw(ext: Record<string, unknown>): string {
  const top =
    (typeof ext.firstInstallTime === "string" && ext.firstInstallTime) ||
    (typeof ext.first_install_time === "string" && ext.first_install_time) ||
    "";
  if (top.trim()) return top.trim();

  const users = ext.users;
  if (!Array.isArray(users) || users.length === 0) return "";

  const preferred =
    users.find((u) => {
      if (!u || typeof u !== "object" || Array.isArray(u)) return false;
      const o = u as Record<string, unknown>;
      return o.user_id === 0 || o.user_id === "0";
    }) ?? users[0];

  if (!preferred || typeof preferred !== "object" || Array.isArray(preferred)) return "";
  const o = preferred as Record<string, unknown>;
  const v = o.firstInstallTime ?? o.first_install_time;
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
}

function androidInstallTime(ext: Record<string, unknown>): { raw: string; ms: number | null } {
  const candidates = [
    androidFirstInstallRaw(ext),
    typeof ext.lastUpdateTime === "string" ? ext.lastUpdateTime : "",
    typeof ext.timeStamp === "string" ? ext.timeStamp : "",
  ];
  for (const raw of candidates) {
    const ms = parsePackageTimeMs(raw);
    if (ms != null) return { raw: raw.trim(), ms };
  }
  const raw = candidates.find((c) => c.trim())?.trim() ?? "";
  return { raw, ms: null };
}

function rowEventInstallTime(row: Record<string, unknown>): { raw: string; ms: number | null } {
  const datetime = strField(row, "datetime");
  if (datetime) {
    const ms = parsePackageTimeMs(datetime);
    if (ms != null) return { raw: datetime, ms };
  }
  const ts = strField(row, "timestamp");
  if (ts) {
    const ms = parsePackageTimeMs(ts);
    if (ms != null) return { raw: ts, ms };
  }
  const display = formatRowTimestamp(row);
  return { raw: display, ms: parsePackageTimeMs(display) };
}

function isAndroidMetadataRow(row: Record<string, unknown>): boolean {
  const dt = strField(row, "data_type").toLowerCase();
  return !dt || dt.includes("package_metadata");
}

export function packagesQuery(source: string, platform: CasePlatform = "android"): string {
  const src = escapeMplSource(source);
  if (platform === "ios") {
    const parsers = IOS_INSTALL_PARSERS.map((p) => `"${p}"`).join(", ");
    // Prefer install / App Info inventory rows. Skip generic `plists` (URL/asset noise);
    // sysdiagnose apps analyser only mines itunesmetadata from plists.
    return (
      `source="${src}" (` +
      `parser IN (${parsers})` +
      ` OR (parser="powerlogs" AND message=*App Info*)` +
      ` OR (parser="plists" AND message=*itunesmetadata*)` +
      `) | fields timestamp, datetime, bundle_id, app_name, parser, message, action, permission, ext | head 8000`
    );
  }
  return `source="${src}" parser="Package" data_type=*package_metadata* bundle_id=* | fields timestamp, datetime, bundle_id, app_name, ext | sort bundle_id | head 2000`;
}

export function packagesListSearchQuery(
  scope: string,
  platform: CasePlatform = "android"
): string {
  if (platform === "ios") {
    const parsers = IOS_INSTALL_PARSERS.map((p) => `"${p}"`).join(", ");
    return (
      `${scope} (parser IN (${parsers}) OR (parser="powerlogs" AND message=*App Info*) OR (parser="plists" AND message=*itunesmetadata*) OR bundle_id=*)` +
      ` | stats count by bundle_id | sort bundle_id | head 500`
    );
  }
  return `${scope} parser="Package" data_type=*package_metadata* | stats count by bundle_id | head 500`;
}

function shortenPermissionName(name: string): string {
  return name
    .replace(/^android\.permission\./, "")
    .replace(/^com\.android\.voicemail\.permission\./, "")
    .replace(/^com\.google\.android\.apps\.maps\.permission\./, "");
}

/** Parse Android package `permissions` map from bugreport package_metadata ext. */
export function parsePackagePermissions(ext: Record<string, unknown>): PackagePermission[] {
  const raw = ext.permissions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];

  const out: PackagePermission[] = [];
  for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!name.trim()) continue;
    let granted: boolean | undefined;
    let protection: string | undefined;
    let permType: string | undefined;

    if (val && typeof val === "object" && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      if (typeof o.granted === "boolean") {
        granted = o.granted;
      } else if (o.granted === "true" || o.granted === "false") {
        granted = o.granted === "true";
      }
      if (typeof o.protection === "string") protection = o.protection;
      else if (typeof o.prot === "string") protection = o.prot;
      if (typeof o.type === "string") permType = o.type;
    }

    out.push({
      name,
      shortName: shortenPermissionName(name),
      granted,
      protection,
      permType,
    });
  }

  return out.sort(
    (a, b) =>
      a.shortName.localeCompare(b.shortName) || a.name.localeCompare(b.name)
  );
}

export function permissionChipTitle(perm: PackagePermission): string {
  if (perm.permType === "tcc") {
    const parts = [iosTccServiceTooltip(perm.name)];
    if (perm.granted != null) parts.push(perm.granted ? "granted" : "denied");
    else if (perm.protection) parts.push(`status: ${perm.protection}`);
    return parts.join(" · ");
  }
  const parts = [perm.name];
  if (perm.permType) parts.push(`type: ${perm.permType}`);
  if (perm.granted != null) parts.push(perm.granted ? "granted" : "denied");
  if (perm.protection) parts.push(`protection: ${perm.protection}`);
  return parts.join(" · ");
}

export function parsePackageRow(
  row: Record<string, unknown>,
  platform: CasePlatform = "android"
): PackageRow | null {
  if (platform === "ios") {
    const bundleId = iosBundleIdFromRow(row);
    if (!bundleId) return null;

    const ext = parseExt(row);
    const message = strField(row, "message");
    const parser = strField(row, "parser");
    const appInfo = parsePowerlogAppInfo(message, ext);
    const miVersions = parseMobileInstallVersions(message);
    const stampedShort =
      extField(row, "short_version") ||
      extField(row, "CFBundleShortVersionString") ||
      "";
    const stampedBuild =
      extField(row, "version") || extField(row, "CFBundleVersion") || "";
    const tccPerms =
      parser === "accessibility_tcc" ? parseIosTccPermissions(row, ext) : undefined;

    const label =
      strField(row, "app_name") ||
      appInfo.name ||
      extField(row, "label") ||
      extField(row, "CFBundleName") ||
      extField(row, "CFBundleDisplayName") ||
      extField(row, "zbundlename") ||
      bundleId.split(".").pop() ||
      bundleId;
    const version =
      (looksLikeAppVersion(stampedShort) ? stampedShort : "") ||
      (looksLikeAppVersion(stampedBuild) ? stampedBuild : "") ||
      (looksLikeAppVersion(extField(row, "versionName"))
        ? extField(row, "versionName")
        : "") ||
      appInfo.version ||
      miVersions.version ||
      "";
    const versionCode =
      (looksLikeAppVersion(stampedBuild) && stampedBuild !== version
        ? stampedBuild
        : "") ||
      miVersions.versionCode ||
      undefined;
    const install = rowEventInstallTime(row);
    // Powerlogs App Info often has bogus timestamps — keep the row, drop the time.
    const installedAtMs =
      parser === "powerlogs" && message.includes(IOS_POWERLOG_APP_INFO) && install.ms == null
        ? null
        : parser === "accessibility_tcc"
          ? null
          : install.ms;
    const installedAt =
      installedAtMs != null ? formatInstallTime(install.raw, installedAtMs) : "";

    const deletedRaw = appInfo.deletedDate;
    const isDeleted =
      Boolean(deletedRaw) &&
      !/^not\s+deleted$/i.test(deletedRaw) &&
      deletedRaw.toLowerCase() !== "0";

    const extras = iosExtrasFromExt(ext);
    if (message && parser === "mobileinstallation" && message.length < 220) {
      extras.unshift({ label: "Install event", value: message });
    }

    return {
      bundleId,
      label: label === bundleId ? bundleId.split(".").slice(-2).join(".") : label,
      version,
      versionCode: versionCode || undefined,
      installer: extField(row, "installer") || extField(row, "provenance") || "",
      updated: extField(row, "lastUpdateTime") || extField(row, "timeStamp") || "",
      timestamp: formatRowTimestamp(row) || "",
      installedAt,
      installedAtMs,
      parser: parser || undefined,
      sources: parser ? [parser] : undefined,
      executableName: appInfo.executableName || undefined,
      buildVersion: appInfo.buildVersion || undefined,
      deletedDate: deletedRaw && !/^not\s+deleted$/i.test(deletedRaw) ? deletedRaw : undefined,
      isDeleted: isDeleted || undefined,
      appType: appInfo.appType || undefined,
      permissions: tccPerms,
      extras: extras.length ? extras : undefined,
    };
  }

  if (!isAndroidMetadataRow(row)) return null;
  const bundleId = strField(row, "bundle_id") || extField(row, "package_name");
  if (!bundleId) return null;

  const ext = parseExt(row);
  const label =
    extField(row, "label") ||
    strField(row, "app_name") ||
    bundleId.split(".").pop() ||
    bundleId;
  const versionName = extField(row, "versionName");
  const versionCode =
    ext.versionCode != null && String(ext.versionCode).trim()
      ? String(ext.versionCode).trim()
      : "";
  const version =
    versionName ||
    (versionCode ? `vc${versionCode}` : "");
  const installer =
    extField(row, "installer") ||
    extField(row, "installerPackageName") ||
    extField(row, "initiatingPackageName") ||
    extField(row, "originatingPackageName");
  const updatedRaw =
    extField(row, "lastUpdateTime") ||
    extField(row, "timeStamp") ||
    androidFirstInstallRaw(ext);
  const updatedMs = parsePackageTimeMs(updatedRaw);
  const install = androidInstallTime(ext);
  const fallback = install.ms == null ? rowEventInstallTime(row) : null;
  const installedAtMs = install.ms ?? fallback?.ms ?? null;
  const installedRaw = install.ms != null ? install.raw : fallback?.raw || install.raw;
  const { minSdk, targetSdk } = androidSdkFromExt(ext);
  const codePath = extField(row, "codePath") || extField(row, "resourcePath");
  const dataDir = extField(row, "dataDir");
  const uid =
    (ext.appId != null ? String(ext.appId) : "") ||
    (ext.uid != null ? String(ext.uid) : "") ||
    extField(row, "appId") ||
    extField(row, "uid");
  const initiatingPackage = extField(row, "initiatingPackageName");
  const originatingPackage = extField(row, "originatingPackageName");
  const packageSource = extField(row, "packageSource");
  const apkSigningVersion = extField(row, "apkSigningVersion");
  const primaryCpuAbi = extField(row, "primaryCpuAbi");
  const flags = androidFlagsString(ext);
  const installReason = androidUserField(ext, "installReason", "install_reason");

  return {
    bundleId,
    label: label === bundleId ? bundleId.split(".").slice(-2).join(".") : label,
    version: version && version !== label ? version : "",
    versionCode,
    installer,
    updated: updatedRaw,
    updatedAt: formatInstallTime(updatedRaw, updatedMs),
    updatedAtMs: updatedMs,
    timestamp: formatRowTimestamp(row) || updatedRaw,
    installedAt: formatInstallTime(installedRaw, installedAtMs),
    installedAtMs,
    permissions: parsePackagePermissions(ext),
    uid,
    minSdk,
    targetSdk,
    codePath,
    dataDir,
    initiatingPackage,
    originatingPackage,
    packageSource,
    apkSigningVersion,
    primaryCpuAbi,
    flags,
    installReason,
    isSystemPath: codePath ? isSystemCodePath(codePath) : false,
  };
}

function pickInstallTime(
  base: Pick<PackageRow, "installedAt" | "installedAtMs">,
  other: Pick<PackageRow, "installedAt" | "installedAtMs">,
  platform: CasePlatform
): Pick<PackageRow, "installedAt" | "installedAtMs"> {
  if (platform === "android") {
    // Prefer the earliest plausible firstInstallTime across user/package fields.
    if (base.installedAtMs == null) return other.installedAtMs == null ? base : other;
    if (other.installedAtMs == null) return base;
    return base.installedAtMs <= other.installedAtMs ? base : other;
  }
  // iOS: keep the higher-score row's event time; only fill gaps from the other row.
  if (base.installedAtMs != null) return base;
  return other.installedAtMs == null ? base : other;
}

export function packageRows(
  rows: Record<string, unknown>[],
  limit = 12,
  platform: CasePlatform = "android"
): PackageRow[] {
  const byBundle = new Map<string, { pkg: PackageRow; score: number }>();
  for (const row of rows) {
    const pkg = parsePackageRow(row, platform);
    if (!pkg) continue;
    const score = packageRowScore(pkg, row, platform);
    const existing = byBundle.get(pkg.bundleId);
    if (!existing) {
      byBundle.set(pkg.bundleId, { pkg, score });
      continue;
    }
    const preferIncoming = score > existing.score;
    const base = preferIncoming ? pkg : existing.pkg;
    const other = preferIncoming ? existing.pkg : pkg;
    const install = pickInstallTime(base, other, platform);
    const permissions = mergePackagePermissions(base.permissions, other.permissions);
    const pick = <K extends keyof PackageRow>(key: K): PackageRow[K] =>
      (base[key] as string | undefined)?.toString().trim()
        ? base[key]
        : other[key];
    byBundle.set(pkg.bundleId, {
      score: Math.max(score, existing.score),
      pkg: {
        ...base,
        installedAt: install.installedAt,
        installedAtMs: install.installedAtMs,
        permissions,
        version: base.version || other.version,
        versionCode: pick("versionCode"),
        installer: base.installer || other.installer,
        parser: base.parser || other.parser,
        uid: pick("uid"),
        minSdk: pick("minSdk"),
        targetSdk: pick("targetSdk"),
        codePath: pick("codePath"),
        dataDir: pick("dataDir"),
        updatedAt: pick("updatedAt"),
        updatedAtMs: base.updatedAtMs ?? other.updatedAtMs ?? null,
        initiatingPackage: pick("initiatingPackage"),
        originatingPackage: pick("originatingPackage"),
        packageSource: pick("packageSource"),
        apkSigningVersion: pick("apkSigningVersion"),
        primaryCpuAbi: pick("primaryCpuAbi"),
        flags: pick("flags"),
        installReason: pick("installReason"),
        isSystemPath: Boolean(base.isSystemPath || other.isSystemPath),
        executableName: pick("executableName"),
        buildVersion: pick("buildVersion"),
        deletedDate: pick("deletedDate"),
        isDeleted: Boolean(base.isDeleted || other.isDeleted) || undefined,
        appType: pick("appType"),
        sources: mergeSources(base.sources, other.sources),
        extras: mergeExtras(base.extras, other.extras),
        label:
          base.label && base.label !== base.bundleId
            ? base.label
            : other.label && other.label !== other.bundleId
              ? other.label
              : base.label,
      },
    });
  }
  const sorted = [...byBundle.values()]
    .map(({ pkg }) => pkg)
    .sort((a, b) => comparePackageRows(a, b));
  if (limit <= 0) return sorted;
  return sorted.slice(0, limit);
}

function comparePackageRows(a: PackageRow, b: PackageRow): number {
  const aMs = a.installedAtMs;
  const bMs = b.installedAtMs;
  if (aMs != null && bMs != null && aMs !== bMs) return bMs - aMs;
  if (aMs != null && bMs == null) return -1;
  if (aMs == null && bMs != null) return 1;
  return a.label.localeCompare(b.label) || a.bundleId.localeCompare(b.bundleId);
}

export function installerLabel(installer: string): string {
  if (!installer) return "—";
  if (installer === "com.android.vending") return "Play Store";
  if (installer.includes("packageinstaller")) return "Package installer";
  return installer;
}

export function packageSearchQuery(
  bundleId: string,
  scope?: string,
  platform: CasePlatform = "android"
): string {
  const pkg = bundleId.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const base = scope ? `${scope} ` : "";
  if (platform === "ios") {
    return `${base}bundle_id="${pkg}" | sort -timestamp | head 30`;
  }
  return `${base}parser="Package" data_type=*package_metadata* bundle_id="${pkg}" | head 20`;
}

/** True when a string looks like a versionName (not a human app label). */
export function looksLikeVersionName(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  return /^\d+(\.\d+){0,4}([._+-][A-Za-z0-9]+)*$/.test(s);
}

/** Best display label for a package (avoid versionName mistaken for app_name). */
export function packageDisplayLabel(pkg: Pick<PackageRow, "bundleId" | "label">): string {
  const label = pkg.label.trim();
  if (label && label !== pkg.bundleId && !looksLikeVersionName(label)) {
    return label;
  }
  const parts = pkg.bundleId.split(".").filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return parts[0] || pkg.bundleId;
}

/**
 * Map an Android process/cmd name to an installed package when the name is the
 * package id or a `package:suffix` process (common for app services).
 */
export function resolveAndroidProcessPackage(
  processName: string,
  packages: PackageRow[]
): PackageRow | null {
  const name = processName.trim();
  if (!name || name.startsWith("[") || packages.length === 0) return null;

  const byId = new Map(packages.map((p) => [p.bundleId, p]));
  const exact = byId.get(name);
  if (exact) return exact;

  const colon = name.indexOf(":");
  if (colon > 0) {
    const base = name.slice(0, colon);
    const hit = byId.get(base);
    if (hit) return hit;
  }

  // Prefer longest package prefix match for unusual process naming.
  let best: PackageRow | null = null;
  for (const pkg of packages) {
    const id = pkg.bundleId;
    if (!id || id.length < 3) continue;
    if (name === id || name.startsWith(`${id}:`) || name.startsWith(`${id}/`)) {
      if (!best || id.length > best.bundleId.length) best = pkg;
    }
  }
  return best;
}
