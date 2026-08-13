import { parseRowExt, parseRowExtObject } from "@/lib/iosDeviceSnapshot";
import { strField } from "@/lib/rowExt";

export type IosSwcutilDomain = {
  domain: string;
  status: string;
};

export type IosPowerlogPush = {
  bundleId: string;
  hostname: string;
  serverIp: string;
  topic: string;
  connectionType: string;
  timestamp: string;
};

export type IosPowerlogUsage = {
  bundleId: string;
  processName: string;
  wifiIn: string;
  wifiOut: string;
  cellIn: string;
  cellOut: string;
  timestamp: string;
};

export type IosNetworkExtensionHint = {
  path: string;
  key: string;
  value: string;
};

export type IosPlistUrlHit = {
  path: string;
  key: string;
  url: string;
};

export type IosTransparencyContact = {
  uri: string;
  kind: "mailto" | "tel" | "other";
  label: string;
};

export type IosNetworkIoc = {
  kind: "ipv4" | "domain" | "url" | string;
  value: string;
  sourceParser: string;
  jsonPath: string;
};

export type IosNetusageRoute = {
  networkType: string;
  identifier: string;
  displayName: string;
  bssid: string;
  bytesIn: string;
  bytesOut: string;
  packetsIn: string;
  packetsOut: string;
  connAttempts: string;
  connSuccesses: string;
  timestamp: string;
  isWifi: boolean;
};

export type IosSafariVisit = {
  url: string;
  domain: string;
  title: string;
  visitCount: string;
  timestamp: string;
};

export type IosKnowledgeWebUsage = {
  appName: string;
  bundleId: string;
  domain: string;
  url: string;
  seconds: string;
  timestamp: string;
  module: string;
};

export type IosQuarantineUrl = {
  originUrl: string;
  dataUrl: string;
  agentBundleId: string;
  agentName: string;
  timestamp: string;
};

export type IosScreentimeDomain = {
  domain: string;
  bundleId: string;
  category: string;
  timestamp: string;
  hits: number;
};

export type IosInteractionUrl = {
  contentUrl: string;
  domainId: string;
  contextText: string;
  timestamp: string;
};

export type IosConnectedDomain = {
  domain: string;
  sources: string[];
  sampleUrl: string;
  hits: number;
};

const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const HOST_FROM_URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^/@\s]+@)?([^/:?#\s]+)/i;

function normKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, "_");
}

/** Hostname from a URL or bare host string; empty if not parseable. */
export function hostFromUrlOrDomain(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || s.includes("://")) {
    try {
      const u = new URL(s.includes("://") ? s : `https://${s}`);
      return u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    } catch {
      /* fall through */
    }
  }
  const m = s.match(HOST_FROM_URL_RE);
  const host = (m?.[1] || s).replace(/\.$/, "").toLowerCase();
  if (!host || host.includes(" ") || !host.includes(".")) return "";
  if (IPV4_RE.test(host)) return "";
  return host;
}

/** Read a field from top-level row, ext strings, or ext object (Apollo / plist flatten keys). */
export function rowLooseField(row: Record<string, unknown>, ...candidates: string[]): string {
  const want = new Set(candidates.map(normKey));

  const read = (obj: Record<string, unknown>): string => {
    for (const [k, v] of Object.entries(obj)) {
      if (!want.has(normKey(k))) continue;
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return "";
  };

  return read(row) || read(parseRowExtObject(row)) || read(parseRowExt(row) as unknown as Record<string, unknown>);
}

export function swcutilDomainsFromRows(rows: Record<string, unknown>[]): IosSwcutilDomain[] {
  const out: IosSwcutilDomain[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const section = rowLooseField(row, "section");
    const message = strField(row, "message");
    const isNetwork =
      section === "network" || /^Network:/i.test(message) || message.startsWith("Network: ");
    if (!isNetwork) continue;

    let domain = rowLooseField(row, "domain");
    if (!domain) {
      const m = message.match(/^Network:\s*(\S+)/i);
      domain = m?.[1]?.replace(/,.*$/, "") ?? "";
    }
    if (!domain) continue;

    const status = message.includes("approved")
      ? "approved"
      : message.includes("pending")
        ? "pending"
        : message.includes("rejected")
          ? "rejected"
          : "";

    const key = `${domain}:${status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ domain, status });
  }

  return out.sort((a, b) => a.domain.localeCompare(b.domain));
}

export function powerlogPushFromRows(rows: Record<string, unknown>[]): IosPowerlogPush[] {
  const out: IosPowerlogPush[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const module = rowLooseField(row, "apollo_module");
    const message = strField(row, "message");
    if (module !== "powerlog_push_message_received" && !/push message received/i.test(message)) {
      continue;
    }

    const serverIp = rowLooseField(row, "server ip", "serverip", "dest_ip");
    const hostname = rowLooseField(row, "serverhostname", "server_hostname", "destination_domain");
    const bundleId = rowLooseField(row, "bundle id", "bundleid", "bundle_id") || strField(row, "bundle_id");
    const topic = rowLooseField(row, "topic");
    const connectionType = rowLooseField(row, "connection type", "connectiontype");
    const timestamp = strField(row, "timestamp") || strField(row, "datetime");

    if (!serverIp && !hostname && !topic) continue;

    const key = `${bundleId}:${hostname}:${serverIp}:${topic}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ bundleId, hostname, serverIp, topic, connectionType, timestamp });
  }

  return out;
}

function formatBytes(raw: string): string {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return raw || "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function powerlogUsageFromRows(rows: Record<string, unknown>[]): IosPowerlogUsage[] {
  const out: IosPowerlogUsage[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const module = rowLooseField(row, "apollo_module");
    const message = strField(row, "message");
    if (module !== "powerlog_process_data_usage" && !/process data usage/i.test(message)) {
      continue;
    }

    const bundleId = rowLooseField(row, "bundle id", "bundleid", "bundle_id") || strField(row, "bundle_id");
    const processName = rowLooseField(row, "process name", "processname", "process_name");
    const wifiIn = formatBytes(rowLooseField(row, "wifi in", "wifiin"));
    const wifiOut = formatBytes(rowLooseField(row, "wifi out", "wifiout"));
    const cellIn = formatBytes(rowLooseField(row, "cell in", "cellin"));
    const cellOut = formatBytes(rowLooseField(row, "cell out", "cellout"));
    const timestamp = strField(row, "timestamp") || strField(row, "datetime");

    if (wifiIn === "—" && wifiOut === "—" && cellIn === "—" && cellOut === "—") continue;

    const key = `${bundleId}:${processName}:${wifiIn}:${cellIn}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ bundleId, processName, wifiIn, wifiOut, cellIn, cellOut, timestamp });
  }

  return out.sort((a, b) => a.bundleId.localeCompare(b.bundleId));
}

export function networkExtensionHintsFromRows(rows: Record<string, unknown>[]): IosNetworkExtensionHint[] {
  const out: IosNetworkExtensionHint[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const path = rowLooseField(row, "plist_path");
    const key = rowLooseField(row, "plist_key");
    const value = rowLooseField(row, "network_hint", "destination_domain", "dest_ip");
    if (!path && !value) continue;

    const hitKey = `${path}:${key}:${value}`;
    if (seen.has(hitKey)) continue;
    seen.add(hitKey);

    out.push({
      path: path || "—",
      key: key || "—",
      value: value || strField(row, "message"),
    });
  }

  return out;
}

export function plistUrlHitsFromRows(rows: Record<string, unknown>[]): IosPlistUrlHit[] {
  const out: IosPlistUrlHit[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const path = rowLooseField(row, "plist_path");
    const key = rowLooseField(row, "plist_key");
    const url = rowLooseField(row, "url", "destination_domain") || strField(row, "message");
    if (!url || (!url.includes("://") && !url.includes("."))) continue;

    const hitKey = `${path}:${key}:${url}`;
    if (seen.has(hitKey)) continue;
    seen.add(hitKey);

    out.push({ path: path || "—", key: key || "—", url });
  }

  return out;
}

export function transparencyContactsFromRows(rows: Record<string, unknown>[]): IosTransparencyContact[] {
  const out: IosTransparencyContact[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    let uri = rowLooseField(row, "contact_uri");
    if (!uri) {
      const message = strField(row, "message");
      const m = message.match(/im:\/\/(?:mailto|tel):[^\s]+/);
      uri = m?.[0] ?? "";
    }
    if (!uri.startsWith("im://")) continue;
    if (seen.has(uri)) continue;
    seen.add(uri);

    const kind: IosTransparencyContact["kind"] = uri.includes("mailto:")
      ? "mailto"
      : uri.includes("tel:")
        ? "tel"
        : "other";
    const label = uri.replace(/^im:\/\/(mailto|tel):/, "");

    out.push({ uri, kind, label });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function networkIocsFromRows(rows: Record<string, unknown>[]): IosNetworkIoc[] {
  const out: IosNetworkIoc[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const kind = rowLooseField(row, "ioc_kind", "kind") || "unknown";
    const value =
      rowLooseField(row, "ioc_value", "value") ||
      rowLooseField(row, "dest_ip", "destination_domain", "url");
    if (!value) continue;

    const sourceParser = rowLooseField(row, "source_parser");
    const jsonPath = rowLooseField(row, "json_path");
    const key = `${kind}:${value}:${sourceParser}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ kind, value, sourceParser, jsonPath });
  }

  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}

export function netusageRoutesFromRows(rows: Record<string, unknown>[]): IosNetusageRoute[] {
  const out: IosNetusageRoute[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const module = rowLooseField(row, "apollo_module");
    const message = strField(row, "message");
    if (
      module !== "netusage_zliverouteperf" &&
      module !== "netusage_zliveusage" &&
      !/network usage/i.test(message)
    ) {
      continue;
    }

    const networkType = rowLooseField(row, "network type", "network_type");
    const identifier = rowLooseField(row, "network identifier", "network_identifier");
    const ssid = rowLooseField(
      row,
      "ssid",
      "network name",
      "network_name",
      "wifi network name",
      "wifi_network_name"
    );
    const bssid = rowLooseField(row, "bssid", "wifi bssid", "wifi_bssid");
    const bytesIn = formatBytes(rowLooseField(row, "bytes in", "bytesin"));
    const bytesOut = formatBytes(rowLooseField(row, "bytes out", "bytesout"));
    const packetsIn = rowLooseField(row, "packets in", "packetsin") || "—";
    const packetsOut = rowLooseField(row, "packets out", "packetsout") || "—";
    const connAttempts = rowLooseField(row, "connection attempts", "connection_attempts");
    const connSuccesses = rowLooseField(row, "connection successes", "connection_successes");
    const timestamp =
      rowLooseField(row, "liveroutepref timestamp", "timestamp") || strField(row, "datetime");

    const isWifi = /wifi/i.test(networkType) || Boolean(ssid);
    const displayName =
      ssid ||
      (identifier && !/^[0-9a-f:-]{11,}$/i.test(identifier) ? identifier : "") ||
      identifier ||
      networkType ||
      "route";

    const key = `${networkType}:${identifier}:${displayName}:${bytesIn}:${timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      networkType,
      identifier,
      displayName,
      bssid,
      bytesIn,
      bytesOut,
      packetsIn,
      packetsOut,
      connAttempts,
      connSuccesses,
      timestamp,
      isWifi,
    });
  }

  return out.sort((a, b) => {
    if (a.isWifi !== b.isWifi) return a.isWifi ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  });
}

export function safariHistoryFromRows(rows: Record<string, unknown>[]): IosSafariVisit[] {
  const out: IosSafariVisit[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const module = rowLooseField(row, "apollo_module");
    const message = strField(row, "message");
    if (module !== "safari_history" && !/safari browsing/i.test(message)) {
      continue;
    }

    const url = rowLooseField(row, "url");
    if (!url) continue;
    const title = rowLooseField(row, "title");
    const visitCount = rowLooseField(row, "visit count", "visit_count");
    const timestamp = rowLooseField(row, "visit time", "visit_time") || strField(row, "datetime");
    const domain =
      rowLooseField(row, "destination_domain") || hostFromUrlOrDomain(url);

    const key = `${url}:${timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ url, domain, title, visitCount, timestamp });
  }

  return out;
}

export function knowledgeWebUsageFromRows(rows: Record<string, unknown>[]): IosKnowledgeWebUsage[] {
  const out: IosKnowledgeWebUsage[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const module = rowLooseField(row, "apollo_module");
    const message = strField(row, "message");
    const isWebUsage =
      module === "knowledge_app_webusage" || /application web usage/i.test(message);
    const isSafariBrowse =
      module === "knowledge_safari_browsing" || /safari browsing/i.test(message);
    const isSafariActivity =
      module === "knowledge_app_activity_safari" || /safari activity/i.test(message);
    if (!isWebUsage && !isSafariBrowse && !isSafariActivity) continue;

    const appName = rowLooseField(row, "app name", "app_name");
    const bundleId =
      rowLooseField(row, "bundle id", "bundle_id") || strField(row, "bundle_id");
    const url = rowLooseField(
      row,
      "digital health url",
      "content url",
      "url",
      "webpageurl"
    );
    const domain =
      rowLooseField(
        row,
        "digital health domain",
        "domain",
        "destination_domain",
        "webdomain"
      ) || hostFromUrlOrDomain(url);
    const seconds = rowLooseField(row, "usage in seconds", "usage_in_seconds");
    const timestamp = rowLooseField(row, "start", "timestamp") || strField(row, "datetime");
    if (!appName && !domain && !url && !bundleId) continue;

    const key = `${module}:${appName}:${bundleId}:${domain}:${url}:${timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      appName,
      bundleId,
      domain,
      url,
      seconds,
      timestamp,
      module: module || (isWebUsage ? "webusage" : isSafariBrowse ? "safari_browsing" : "safari_activity"),
    });
  }

  return out;
}

export function quarantineUrlsFromRows(rows: Record<string, unknown>[]): IosQuarantineUrl[] {
  const out: IosQuarantineUrl[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const originUrl = rowLooseField(row, "origin url string", "origin_url_string", "origin_url");
    const dataUrl = rowLooseField(row, "data url string", "data_url_string", "data_url");
    if (!originUrl && !dataUrl) continue;

    const agentBundleId = rowLooseField(
      row,
      "agent bundle id",
      "agent_bundle_id",
      "bundle_id"
    );
    const agentName = rowLooseField(row, "agent name", "agent_name");
    const timestamp =
      rowLooseField(row, "timestamp", "time stamp", "quarantine timestamp") ||
      strField(row, "datetime");

    const key = `${originUrl}:${dataUrl}:${timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ originUrl, dataUrl, agentBundleId, agentName, timestamp });
  }

  return out;
}

export function screentimeDomainsFromRows(rows: Record<string, unknown>[]): IosScreentimeDomain[] {
  const byDomain = new Map<string, IosScreentimeDomain>();

  for (const row of rows) {
    const domain = rowLooseField(row, "domain", "destination_domain");
    if (!domain || !domain.includes(".")) continue;

    const bundleId = rowLooseField(row, "bundle id", "bundle_id") || strField(row, "bundle_id");
    const category = rowLooseField(row, "category id", "category_id", "category");
    const timestamp =
      rowLooseField(row, "start", "timestamp", "block start") || strField(row, "datetime");
    const key = domain.toLowerCase();
    const prev = byDomain.get(key);
    if (prev) {
      prev.hits += 1;
      if (!prev.bundleId && bundleId) prev.bundleId = bundleId;
      if (!prev.category && category) prev.category = category;
      continue;
    }
    byDomain.set(key, { domain: key, bundleId, category, timestamp, hits: 1 });
  }

  return [...byDomain.values()].sort(
    (a, b) => b.hits - a.hits || a.domain.localeCompare(b.domain)
  );
}

export function interactionUrlsFromRows(rows: Record<string, unknown>[]): IosInteractionUrl[] {
  const out: IosInteractionUrl[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const contentUrl = rowLooseField(row, "content url", "content_url", "url");
    const domainId = rowLooseField(row, "domain identifier", "domain_identifier", "domain");
    if (!contentUrl && !domainId) continue;
    if (contentUrl && !contentUrl.includes("://") && !contentUrl.includes(".")) {
      if (!domainId) continue;
    }

    const contextText = rowLooseField(row, "context text", "context_text", "content text");
    const timestamp = rowLooseField(row, "timestamp", "start") || strField(row, "datetime");
    const key = `${contentUrl}:${domainId}:${timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ contentUrl, domainId, contextText, timestamp });
  }

  return out;
}

/** Roll up unique hostnames from IOC / Safari / Knowledge / Screen Time / quarantine rows. */
export function connectedDomainsFromSources(input: {
  iocs?: IosNetworkIoc[];
  safari?: IosSafariVisit[];
  knowledge?: IosKnowledgeWebUsage[];
  screentime?: IosScreentimeDomain[];
  quarantine?: IosQuarantineUrl[];
  interaction?: IosInteractionUrl[];
  swcutil?: IosSwcutilDomain[];
  plists?: IosPlistUrlHit[];
}): IosConnectedDomain[] {
  const map = new Map<string, IosConnectedDomain>();

  const bump = (domain: string, source: string, sampleUrl = "") => {
    const d = domain.trim().toLowerCase();
    if (!d || !d.includes(".")) return;
    const cur = map.get(d);
    if (cur) {
      cur.hits += 1;
      if (!cur.sources.includes(source)) cur.sources.push(source);
      if (!cur.sampleUrl && sampleUrl) cur.sampleUrl = sampleUrl;
      return;
    }
    map.set(d, {
      domain: d,
      sources: [source],
      sampleUrl,
      hits: 1,
    });
  };

  for (const ioc of input.iocs ?? []) {
    if (ioc.kind === "domain") bump(ioc.value, ioc.sourceParser || "network_iocs");
    else if (ioc.kind === "url") bump(hostFromUrlOrDomain(ioc.value), ioc.sourceParser || "network_iocs", ioc.value);
  }
  for (const v of input.safari ?? []) {
    bump(v.domain || hostFromUrlOrDomain(v.url), "safari_history", v.url);
  }
  for (const k of input.knowledge ?? []) {
    bump(k.domain || hostFromUrlOrDomain(k.url), "knowledgec", k.url);
  }
  for (const s of input.screentime ?? []) bump(s.domain, "screentime");
  for (const q of input.quarantine ?? []) {
    bump(hostFromUrlOrDomain(q.originUrl), "quarantine_events", q.originUrl);
    bump(hostFromUrlOrDomain(q.dataUrl), "quarantine_events", q.dataUrl);
  }
  for (const i of input.interaction ?? []) {
    bump(hostFromUrlOrDomain(i.contentUrl) || i.domainId, "interactionc", i.contentUrl);
  }
  for (const d of input.swcutil ?? []) bump(d.domain, "swcutil");
  for (const p of input.plists ?? []) bump(hostFromUrlOrDomain(p.url), "plists", p.url);

  return [...map.values()].sort(
    (a, b) => b.hits - a.hits || a.domain.localeCompare(b.domain)
  );
}

export function logMessageIpsFromRows(rows: Record<string, unknown>[]): { ip: string; parser: string; message: string }[] {
  const out: { ip: string; parser: string; message: string }[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const message = strField(row, "message");
    const parser = strField(row, "parser");
    const matches = message.match(new RegExp(IPV4_RE, "g")) ?? [];
    for (const ip of matches) {
      if (ip.startsWith("0.") || ip === "127.0.0.1" || ip.startsWith("255.")) continue;
      const key = `${parser}:${ip}:${message.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ip, parser, message: message.length > 120 ? `${message.slice(0, 117)}…` : message });
    }
  }

  return out;
}
