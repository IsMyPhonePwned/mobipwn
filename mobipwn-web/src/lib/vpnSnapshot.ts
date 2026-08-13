import { extField, parseExt, strField } from "@/lib/rowExt";

export type VpnSession = {
  userId: string;
  packageName: string;
  interfaceName: string;
  addresses: string;
  routes: string;
  dnsServers: string;
  searchDomains: string;
  rawData: string;
};

export type VpnNetworkProperty = {
  key: string;
  value: string;
};

export type VpnSnapshot = {
  sessions: VpnSession[];
  networkProperties: VpnNetworkProperty[];
  /** SecurityControllerImpl section was parsed (even if tunnels are empty). */
  sectionFound: boolean;
};

function packageFromRaw(raw: string, fallbackKey: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallbackKey;
  const kv = trimmed.match(/^\d+=(.+)$/);
  if (kv?.[1]) return kv[1].trim();
  if (/^[\w.]+$/.test(trimmed)) return trimmed;
  return fallbackKey;
}

function parseVpnEntry(key: string, value: unknown): VpnSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const rawData = String(o.raw_data ?? "").trim();
  const userId = String(o.user_id ?? key).trim() || key;
  const packageName =
    String(o.package_name ?? "").trim() || packageFromRaw(rawData, key === userId ? "" : key) || "unknown";

  return {
    userId,
    packageName,
    interfaceName: String(o.interface ?? "").trim(),
    addresses: String(o.addresses ?? "").trim(),
    routes: String(o.routes ?? "").trim(),
    dnsServers: String(o.dns_servers ?? "").trim(),
    searchDomains: String(o.search_domains ?? "").trim(),
    rawData,
  };
}

function parseNetworkProperty(key: string, value: unknown): VpnNetworkProperty | null {
  if (!key.trim()) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { key, value: String(value ?? "").trim() };
  }
  const o = value as Record<string, unknown>;
  const explicit = o.value != null ? String(o.value).trim() : "";
  const raw = String(o.raw_data ?? "").trim();
  return {
    key,
    value: explicit || raw || "—",
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parserPayloadFromExt(ext: Record<string, unknown>): {
  vpns: Record<string, unknown>;
  props: Record<string, unknown>;
} | null {
  if (!("current_vpns" in ext) && !("network_properties" in ext)) return null;
  return {
    vpns: objectRecord(ext.current_vpns),
    props: objectRecord(ext.network_properties),
  };
}

function parserPayloadFromMessage(message: string): {
  vpns: Record<string, unknown>;
  props: Record<string, unknown>;
} | null {
  const prefix = "vpn parser output:";
  const idx = message.toLowerCase().indexOf(prefix);
  if (idx < 0) return null;
  const jsonPart = message.slice(idx + prefix.length).trim();
  if (!jsonPart.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    return {
      vpns: objectRecord(o.current_vpns),
      props: objectRecord(o.network_properties),
    };
  } catch {
    return null;
  }
}

function mergePayload(
  sessionsByKey: Map<string, VpnSession>,
  propsByKey: Map<string, VpnNetworkProperty>,
  payload: { vpns: Record<string, unknown>; props: Record<string, unknown> }
) {
  for (const [key, value] of Object.entries(payload.vpns)) {
    const session = parseVpnEntry(key, value);
    if (session) sessionsByKey.set(`${session.userId}:${session.packageName}`, session);
  }
  for (const [key, value] of Object.entries(payload.props)) {
    const prop = parseNetworkProperty(key, value);
    if (prop) propsByKey.set(key, prop);
  }
}

export function vpnSnapshotFromRows(rows: Record<string, unknown>[]): VpnSnapshot {
  const sessionsByKey = new Map<string, VpnSession>();
  const propsByKey = new Map<string, VpnNetworkProperty>();
  let sectionFound = false;

  for (const row of rows) {
    const parser = strField(row, "parser").toLowerCase();
    if (parser && parser !== "vpn") continue;

    const ext = parseExt(row);
    const eventType = extField(row, "event_type");

    if (eventType === "vpn_session") {
      sectionFound = true;
      const session = parseVpnEntry(extField(row, "user_id") || "0", ext);
      if (session) sessionsByKey.set(`${session.userId}:${session.packageName}`, session);
      continue;
    }

    const payload = parserPayloadFromExt(ext) ?? parserPayloadFromMessage(strField(row, "message"));
    if (!payload) continue;

    sectionFound = true;
    mergePayload(sessionsByKey, propsByKey, payload);
  }

  return {
    sessions: [...sessionsByKey.values()].sort((a, b) =>
      a.packageName.localeCompare(b.packageName) || a.userId.localeCompare(b.userId)
    ),
    networkProperties: [...propsByKey.values()].sort((a, b) => a.key.localeCompare(b.key)),
    sectionFound,
  };
}

export function vpnSearchQuery(scope: string): string {
  return `${scope} parser="Vpn" | head 20`;
}
