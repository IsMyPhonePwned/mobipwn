import { parseRowExt, parseRowExtObject } from "@/lib/iosDeviceSnapshot";
import { iosTccServiceLabel, iosTccServiceTooltip } from "@/lib/iosTccServices";
import { strField } from "@/lib/rowExt";

export type IosSecurityDevice = {
  name: string;
  section: string;
  service: string;
  added: string;
};

export type IosTccPermission = {
  client: string;
  /** Human label (e.g. CloudKit from kTCCServiceLiverpool). */
  service: string;
  /** Raw TCC service id from sysdiagnose (e.g. kTCCServiceLiverpool). */
  serviceRaw: string;
  allowed: string;
  modified: string;
  granted?: boolean;
};

export type IosWifiSecurityKind = "open" | "wep" | "wpa" | "enterprise" | "unknown";

export type IosWifiNetwork = {
  /** Display SSID (or &lt;HIDDEN&gt; / unknown). */
  ssid: string;
  /** Full message label kept for search pivots. */
  label: string;
  bssid: string;
  ssidHex: string;
  security: string;
  securityKind: IosWifiSecurityKind;
  channel: string;
  band: string;
  /** Numeric RSSI when parseable (dBm). */
  rssiDbm: number | null;
  rssi: string;
  country: string;
  phy: string;
  age: string;
  connectedInSleep: boolean;
  hidden: boolean;
};

export type IosWifiScanSummary = {
  total: number;
  open: number;
  hidden: number;
  sleep: number;
  strong: number;
};

export type IosWifiSavedNetwork = {
  ssid: string;
  file: string;
  networkKey: string;
  addedAt: string;
  bssid: string;
  channel: string;
};

export type IosWifiKnownLocation = {
  ssid: string;
  bssid: string;
  latitude: string;
  longitude: string;
  accuracy: string;
  channel: string;
  addedAt: string;
};

export type IosWifiSecurityEntry = {
  label: string;
  account: string;
  description: string;
  created: string;
  modified: string;
};

function rowSsid(row: Record<string, unknown>): string {
  return strField(row, "ssid") || parseRowExt(row).ssid || "";
}

function extCoord(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(5);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

export function tccAllowedStatus(allowed: string): boolean | undefined {
  const a = allowed.trim().toLowerCase();
  if (!a || a === "—") return undefined;
  if (/deny|disallow|restrict|limited/.test(a)) return false;
  if (/allow/.test(a)) return true;
  return undefined;
}

export function tccPermissionTitle(perm: IosTccPermission): string {
  const raw = perm.serviceRaw || perm.service;
  const parts = [iosTccServiceTooltip(raw), `status: ${perm.allowed}`];
  if (perm.modified) parts.push(`modified: ${perm.modified}`);
  return parts.join(" · ");
}

export function securityDevicesFromRows(rows: Record<string, unknown>[]): IosSecurityDevice[] {
  const byKey = new Map<string, IosSecurityDevice>();

  for (const row of rows) {
    const ext = parseRowExtObject(row);
    const section = typeof ext.section === "string" ? ext.section : "";
    const attrs = ext.attributes;
    if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) continue;

    const a = attrs as Record<string, unknown>;
    const name = typeof a.labl === "string" ? a.labl.trim() : "";
    if (!name) continue;

    const service = typeof a.svce === "string" ? a.svce : typeof a.agrp === "string" ? a.agrp : "";
    const added = typeof a.cdat === "string" ? a.cdat : "";
    const key = `${section}:${name}:${service}`;
    if (byKey.has(key)) continue;

    byKey.set(key, {
      name,
      section: section || "keychain",
      service: service || "—",
      added,
    });
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function securitySectionCounts(devices: IosSecurityDevice[]): { section: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of devices) {
    counts.set(d.section, (counts.get(d.section) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([section, count]) => ({ section, count }))
    .sort((a, b) => b.count - a.count);
}

export function tccPermissionsFromRows(rows: Record<string, unknown>[]): IosTccPermission[] {
  const out: IosTccPermission[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const ext = parseRowExt(row);
    const client = ext.client ?? "";
    const serviceRaw = ext.service ?? "";
    if (!client || !serviceRaw) continue;

    const key = `${client}:${serviceRaw}:${ext.allowed ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const allowed = ext.allowed ?? "—";
    out.push({
      client,
      service: iosTccServiceLabel(serviceRaw),
      serviceRaw,
      allowed,
      modified: ext["last modified"] ?? ext.last_modified ?? "",
      granted: tccAllowedStatus(allowed),
    });
  }

  return out.sort((a, b) => a.client.localeCompare(b.client) || a.service.localeCompare(b.service));
}

export function tccTopServices(permissions: IosTccPermission[], limit = 6): { service: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of permissions) {
    counts.set(p.service, (counts.get(p.service) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function parseRssiDbm(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/-?\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n <= 0 && n >= -120 ? n : null;
}

function wifiSecurityKind(security: string): IosWifiSecurityKind {
  const s = security.trim().toLowerCase();
  if (!s || s === "—" || s === "-") return "unknown";
  if (/\b(none|open|os)\b/.test(s) || s === "0") return "open";
  if (/\bwep\b/.test(s)) return "wep";
  if (/\b(eap|enterprise|802\.1x|wpa3.?enterprise|wpa2.?enterprise)\b/.test(s)) return "enterprise";
  if (/\b(wpa|rsn|sae|owe|psk)\b/.test(s)) return "wpa";
  return "unknown";
}

/** Infer band from Apple wifi_scan channel strings (e.g. `6`, `36`, `6g5`, `149,+1`). */
export function wifiScanBand(channel: string): string {
  const ch = channel.trim().toLowerCase();
  if (!ch || ch === "—") return "";
  if (ch.startsWith("6g") || /\b6\s*ghz\b/.test(ch)) return "6 GHz";
  const primary = Number.parseInt(ch.replace(/^\+/, "").split(/[,+\s]/)[0] ?? "", 10);
  if (!Number.isFinite(primary)) return "";
  if (primary >= 1 && primary <= 14) return "2.4 GHz";
  if (primary >= 32 && primary <= 177) return "5 GHz";
  return "";
}

export function wifiScanRssiTone(rssiDbm: number | null): "strong" | "fair" | "weak" | "unknown" {
  if (rssiDbm == null) return "unknown";
  if (rssiDbm >= -55) return "strong";
  if (rssiDbm >= -70) return "fair";
  return "weak";
}

export function wifiScanSummary(networks: IosWifiNetwork[]): IosWifiScanSummary {
  let open = 0;
  let hidden = 0;
  let sleep = 0;
  let strong = 0;
  for (const n of networks) {
    if (n.securityKind === "open") open += 1;
    if (n.hidden) hidden += 1;
    if (n.connectedInSleep) sleep += 1;
    if (wifiScanRssiTone(n.rssiDbm) === "strong") strong += 1;
  }
  return { total: networks.length, open, hidden, sleep, strong };
}

export function wifiNetworksFromRows(rows: Record<string, unknown>[]): IosWifiNetwork[] {
  const out: IosWifiNetwork[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const ext = parseRowExt(row);
    const message = typeof row.message === "string" ? row.message.trim() : "";

    // Skip scan summary counters (`total=…`).
    if (!ext.ssid && (ext.total != null || /^Wifi scan:\s*total=/i.test(message) || message.startsWith("total="))) {
      continue;
    }

    const ssid =
      strField(row, "ssid") ||
      ext.ssid ||
      (message.match(/^(\S+)/)?.[1] ?? "");
    if (!ssid || ssid === "<unknown>") {
      // Keep unknown only when we still have RF metadata.
      if (!ext.channel && !ext.rssi && !ext.security) continue;
    }

    const channel = ext.channel || ext.ch || "—";
    const rssiDbm = parseRssiDbm(ext.rssi || ext.RSSI);
    const security = ext.security || "—";
    const bssid = ext.bssid || ext.BSSID || "";
    const displaySsid = ssid || "<unknown>";
    const hidden = /hidden/i.test(displaySsid);

    const key = `${displaySsid}:${bssid}:${channel}:${rssiDbm ?? ext.rssi ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ssid: displaySsid,
      label: message || displaySsid,
      bssid,
      ssidHex: ext.ssid_hex || "",
      security,
      securityKind: wifiSecurityKind(security),
      channel,
      band: wifiScanBand(channel),
      rssiDbm,
      rssi: rssiDbm != null ? `${rssiDbm} dBm` : ext.rssi ? `${ext.rssi} dBm` : "—",
      country: ext.cc || ext.country || "—",
      phy: ext.phy || ext.PHYMode || "—",
      age: ext.age || "",
      connectedInSleep:
        ext.wasConnectedDuringSleep === "1" ||
        ext.wasConnectedDuringSleep?.toLowerCase() === "true" ||
        ext.wasConnectedDuringSleep?.toLowerCase() === "yes",
      hidden,
    });
  }

  return out.sort((a, b) => {
    if (a.rssiDbm != null && b.rssiDbm != null && a.rssiDbm !== b.rssiDbm) {
      return b.rssiDbm - a.rssiDbm;
    }
    if (a.rssiDbm != null && b.rssiDbm == null) return -1;
    if (a.rssiDbm == null && b.rssiDbm != null) return 1;
    return a.ssid.localeCompare(b.ssid);
  });
}

export function wifiSavedNetworksFromRows(rows: Record<string, unknown>[]): IosWifiSavedNetwork[] {
  const out: IosWifiSavedNetwork[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const message = strField(row, "message");
    if (/BSS location/i.test(message)) continue;

    const ext = parseRowExtObject(row);
    if (ext.latitude != null || ext.longitude != null) continue;

    const ssid = rowSsid(row);
    if (!ssid) continue;

    const file = typeof ext.file === "string" ? ext.file : "";
    const networkKey = typeof ext.network_key === "string" ? ext.network_key : "";
    const key = `${ssid}:${file}:${networkKey}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const network =
      ext.network && typeof ext.network === "object" && !Array.isArray(ext.network)
        ? (ext.network as Record<string, unknown>)
        : null;
    const oss = network?.["__OSSpecific__"];
    const ossObj =
      oss && typeof oss === "object" && !Array.isArray(oss) ? (oss as Record<string, unknown>) : null;

    out.push({
      ssid,
      file,
      networkKey,
      addedAt:
        (typeof ext.timestamp_raw === "string" ? ext.timestamp_raw : "") ||
        (typeof network?.AddedAt === "string" ? network.AddedAt : "") ||
        (typeof network?.JoinedByUserAt === "string" ? network.JoinedByUserAt : ""),
      bssid: typeof ext.bssid === "string" ? ext.bssid : typeof ossObj?.BSSID === "string" ? ossObj.BSSID : "",
      channel:
        typeof ext.channel === "string"
          ? ext.channel
          : ossObj?.CHANNEL != null
            ? String(ossObj.CHANNEL)
            : "",
    });
  }

  return out.sort((a, b) => a.ssid.localeCompare(b.ssid));
}

export function wifiKnownLocationsFromRows(rows: Record<string, unknown>[]): IosWifiKnownLocation[] {
  const out: IosWifiKnownLocation[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const ext = parseRowExtObject(row);
    const lat = extCoord(ext.latitude ?? row.latitude);
    const lon = extCoord(ext.longitude ?? row.longitude);
    if (!lat || !lon) continue;

    const ssid = rowSsid(row) || "—";
    const bssid = typeof ext.bssid === "string" ? ext.bssid : "";
    const key = `${ssid}:${bssid}:${lat}:${lon}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const bss =
      ext.bss && typeof ext.bss === "object" && !Array.isArray(ext.bss)
        ? (ext.bss as Record<string, unknown>)
        : null;

    out.push({
      ssid,
      bssid,
      latitude: lat,
      longitude: lon,
      accuracy: bss?.LocationAccuracy != null ? String(bss.LocationAccuracy) : "",
      channel: typeof ext.channel === "string" ? ext.channel : "",
      addedAt: typeof ext.timestamp_raw === "string" ? ext.timestamp_raw : "",
    });
  }

  return out.sort((a, b) => a.ssid.localeCompare(b.ssid));
}

export function wifiSecurityEntriesFromRows(rows: Record<string, unknown>[]): IosWifiSecurityEntry[] {
  const out: IosWifiSecurityEntry[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const ext = parseRowExt(row);
    const label = ext.labl ?? ext.label ?? "";
    const account = ext.acct ?? ext.account ?? "";
    if (!label && !account) continue;

    const key = `${label}:${account}:${ext.cdat ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      label: label || account,
      account,
      description: ext.desc ?? ext.description ?? "",
      created: ext.cdat ?? "",
      modified: ext.mdat ?? ext.cdat ?? "",
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function activationSummaryFromRows(
  rows: Record<string, unknown>[]
): { state: string; socGeneration: string; hasBaseband: string; buildVersion: string } | null {
  let startup: Record<string, string> | null = null;
  let state = "";

  for (const row of rows) {
    const ext = parseRowExt(row);
    const message = typeof row.message === "string" ? row.message : "";
    if (!startup && ext.hardware_model) startup = ext;
    if (!state && /activation state:/i.test(message)) {
      state = message.replace(/.*activation state:\s*/i, "").trim();
    }
  }

  if (!startup && !state) return null;

  return {
    state: state || "—",
    socGeneration: startup?.soc_generation ?? "—",
    hasBaseband: startup?.has_baseband === "true" ? "Yes" : startup?.has_baseband === "false" ? "No" : "—",
    buildVersion: startup?.build_version ?? "—",
  };
}

export function iosParserQuery(source: string, parser: string, pipeline = "| head 40"): string {
  return `source="${source}" parser="${parser}" ${pipeline}`.trim();
}
