import { extField, numField, strField } from "@/lib/rowExt";
import { formatIpv6ForDisplay, splitHostPort } from "@/lib/ipResolve";
import { escapeMplString } from "@/lib/mplQuery";
import { hostFromAddress, resolveEndpointIp } from "@/lib/networkSockets";
import {
  compareFlowSources,
  flowSourceFromRow,
  isListenerNetworkRow,
  isMeaningfulFlowDestination,
  isStaleNetworkRow,
  looksLikeAndroidPackage,
  networkOwnerLabel,
  resolvePeerIp,
} from "@/lib/networkOwner";
import { collectUidOwnerHints, uidOwnerPresentation, type UidOwnerHint } from "@/lib/networkUidHints";
import type { CasePlatform } from "@/lib/caseDashboard";

export type FlowDestKind = "ip" | "domain";

export type NetworkFlowLink = {
  source: string;
  sourceDetail: string | null;
  sourceExplanation: string | null;
  isStale: boolean;
  target: string;
  targetKind: FlowDestKind;
  count: number;
  bytes: number;
};

/** Wi‑Fi SSIDs heard in a scan — not an app→destination connection. */
export type WifiScanSighting = {
  ssid: string;
  count: number;
  bssid: string | null;
  rssi: number | null;
  frequencyMhz: number | null;
  security: string | null;
};

export type FlowWeightMode = "count" | "bytes";

function isWifiScanResultRow(row: Record<string, unknown>): boolean {
  return strField(row, "data_type").toLowerCase().includes("wifi_scan_result");
}

function escapeSource(source: string): string {
  return source.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Raw network rows for client-side bundle → destination flow aggregation. */
export function networkFlowQuery(source: string, platform: CasePlatform = "android"): string {
  const src = escapeSource(source);
  if (platform === "ios") {
    return `source="${src}" (parser="network_iocs" OR parser="netusage" OR parser="networkextension") (dest_ip=* OR destination_domain=* OR ioc_value=*) | fields bundle_id, dest_ip, destination_domain, ioc_kind, ioc_value, ext, rx_bytes, tx_bytes, package_name, app_name, process_id, parser, message | head 200`;
  }
  return `source="${src}" parser="Network" (data_type=*network_socket* OR data_type=*wifi_scan_event* OR data_type=*wifi_scan_result*) | fields bundle_id, dest_ip, destination_domain, ext, data_type, rx_bytes, tx_bytes, package_name, message, process_id, process_name, src_ip, action, ssid, owner, owner_type, attribution_status, program_name, uid, user | head 500`;
}

export type FlowSourceDisplay = {
  primary: string;
  secondary: string | null;
  explanation: string | null;
  isStale: boolean;
  isUid: boolean;
};

export function flowSourceDisplay(link: Pick<NetworkFlowLink, "source" | "sourceDetail" | "sourceExplanation" | "isStale">): FlowSourceDisplay {
  const isStale = link.isStale || link.source === "stale";
  const isUid = link.source.startsWith("uid:");
  return {
    primary: isStale ? "stale" : networkOwnerLabel(link.source),
    secondary: link.sourceDetail,
    explanation: link.sourceExplanation,
    isStale,
    isUid,
  };
}

function isIpLike(value: string): boolean {
  if (!value) return false;
  if (value.includes(":")) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

export function flowSourceLabel(source: string): string {
  return networkOwnerLabel(source);
}

export function flowTargetDisplay(link: Pick<NetworkFlowLink, "target" | "targetKind">): string {
  if (link.targetKind !== "ip") return link.target;
  return formatIpv6ForDisplay(link.target);
}

export function flowTargetTitle(link: Pick<NetworkFlowLink, "target" | "targetKind">): string {
  if (link.targetKind !== "ip") return link.target;
  if (link.target.includes("::") && !link.target.startsWith("::ffff:")) {
    const expanded = formatIpv6ForDisplay(link.target);
    if (expanded !== link.target) {
      return `${link.target} → ${expanded} (compressed form from Android netstat)`;
    }
    return `${link.target} (as reported in bugreport netstat)`;
  }
  return link.target;
}

function resolveBundleId(row: Record<string, unknown>, unknownLabel: string): string {
  return flowSourceFromRow(row, unknownLabel);
}

function resolveDestination(row: Record<string, unknown>): { target: string; kind: FlowDestKind } | null {
  if (isListenerNetworkRow(row)) return null;

  const peer = resolvePeerIp(row);
  if (peer && isMeaningfulFlowDestination(row, peer)) {
    return { target: hostFromAddress(peer), kind: "ip" };
  }

  const promotedDest = strField(row, "dest_ip");
  if (promotedDest) {
    const host = hostFromAddress(promotedDest);
    if (host && isMeaningfulFlowDestination(row, host)) {
      return { target: host, kind: isIpLike(host) ? "ip" : "domain" };
    }
  }

  const ip = resolveEndpointIp(row, "remote");
  if (ip && isMeaningfulFlowDestination(row, ip)) {
    return { target: ip, kind: "ip" };
  }

  const remote = extField(row, "remote_address");
  if (remote) {
    const host = hostFromAddress(remote);
    if (host && isMeaningfulFlowDestination(row, host)) {
      return { target: host, kind: isIpLike(host) ? "ip" : "domain" };
    }
  }

  const domain =
    strField(row, "destination_domain") ||
    extField(row, "destination_domain");
  if (domain && !isIpLike(domain) && !looksLikeAndroidPackage(domain)) {
    return { target: domain.toLowerCase(), kind: "domain" };
  }

  const fromMsg = strField(row, "message").match(/Socket\s+\S+\s+.+?\s*->\s*(.+)$/i);
  if (fromMsg) {
    const remote = fromMsg[1].trim();
    const { host } = splitHostPort(remote);
    const resolved = hostFromAddress(host || remote);
    if (resolved && isMeaningfulFlowDestination(row, resolved) && isIpLike(resolved)) {
      return { target: resolved, kind: "ip" };
    }
  }

  return null;
}

function rowBytes(row: Record<string, unknown>): number {
  const rx = numField(row, "rx_bytes") ?? 0;
  const tx = numField(row, "tx_bytes") ?? 0;
  const total = rx + tx;
  if (total > 0) return total;
  const extRx = numField(row, "rx") ?? 0;
  const extTx = numField(row, "tx") ?? 0;
  return extRx + extTx;
}

export function aggregateNetworkFlows(
  rows: Record<string, unknown>[],
  options?: { unknownBundleLabel?: string; uidHints?: Map<string, UidOwnerHint> }
): NetworkFlowLink[] {
  const unknownLabel = options?.unknownBundleLabel ?? "unattributed";
  const uidHints = options?.uidHints ?? collectUidOwnerHints(rows);
  const map = new Map<string, NetworkFlowLink>();

  for (const row of rows) {
    // Scan results are nearby SSIDs, not socket flows — see aggregateWifiScanSightings.
    if (isWifiScanResultRow(row)) continue;

    const dest = resolveDestination(row);
    if (!dest) continue;

    const source = resolveBundleId(row, unknownLabel);
    const isStale = source === "stale" || isStaleNetworkRow(row);
    const key = `${source}\0${dest.target}\0${dest.kind}`;

    const existing = map.get(key);
    const bytes = rowBytes(row);
    if (existing) {
      existing.count += 1;
      existing.bytes += bytes;
      existing.isStale = existing.isStale || isStale;
    } else {
      const presentation = source.startsWith("uid:")
        ? uidOwnerPresentation(source, uidHints)
        : { secondary: null as string | null, explanation: null as string | null };
      map.set(key, {
        source,
        sourceDetail: presentation.secondary,
        sourceExplanation: presentation.explanation,
        isStale,
        target: dest.target,
        targetKind: dest.kind,
        count: 1,
        bytes,
      });
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      compareFlowSources(a.source, b.source) ||
      a.target.localeCompare(b.target) ||
      b.count - a.count
  );
}

/** Aggregate bugreport Wi‑Fi scan results (SSID seen ≠ connected). */
export function aggregateWifiScanSightings(rows: Record<string, unknown>[]): WifiScanSighting[] {
  const map = new Map<string, WifiScanSighting>();

  for (const row of rows) {
    if (!isWifiScanResultRow(row)) continue;
    const ssid = (strField(row, "ssid") || extField(row, "ssid")).trim();
    if (!ssid) continue;

    const bssid = extField(row, "bssid") || null;
    const key = `${ssid}\0${bssid ?? ""}`;
    const rssiRaw = numField(row, "rssi") ?? (() => {
      const v = extField(row, "rssi");
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })();
    const freqRaw = (() => {
      const v = extField(row, "frequency");
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })();
    const security = extField(row, "security") || null;

    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (rssiRaw != null && (existing.rssi == null || rssiRaw > existing.rssi)) {
        existing.rssi = rssiRaw;
      }
      if (!existing.frequencyMhz && freqRaw != null) existing.frequencyMhz = freqRaw;
      if (!existing.security && security) existing.security = security;
      if (!existing.bssid && bssid) existing.bssid = bssid;
    } else {
      map.set(key, {
        ssid,
        count: 1,
        bssid,
        rssi: rssiRaw,
        frequencyMhz: freqRaw,
        security,
      });
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      (b.rssi ?? -999) - (a.rssi ?? -999) ||
      b.count - a.count ||
      a.ssid.localeCompare(b.ssid, undefined, { sensitivity: "base" })
  );
}

export function flowWeight(link: NetworkFlowLink, mode: FlowWeightMode): number {
  return mode === "bytes" ? link.bytes : link.count;
}

export function wifiScanSearchQuery(ingestSource: string, sighting: WifiScanSighting): string {
  const scope = `source="${escapeMplString(ingestSource)}"`;
  const parts = [
    scope,
    'parser="Network"',
    "data_type=*wifi_scan_result*",
    `ssid="${escapeMplString(sighting.ssid)}"`,
  ];
  if (sighting.bssid) {
    parts.push(`bssid="${escapeMplString(sighting.bssid)}"`);
  }
  return `${parts.join(" ")} | sort -timestamp | head 80`;
}

export function networkFlowSearchQuery(
  ingestSource: string,
  link: NetworkFlowLink,
  platform: CasePlatform = "android"
): string {
  const scope = `source="${escapeMplString(ingestSource)}"`;
  const parser =
    platform === "endpoint"
      ? 'parser="network"'
      : platform === "ios"
        ? '(parser="network_iocs" OR parser="netusage" OR parser="networkextension")'
        : 'parser="Network"';
  const parts = [scope, parser];

  if (platform !== "ios" && link.source === "stale") {
    parts.push('data_type=*network_socket*');
  } else if (link.source && link.source !== "unattributed" && link.source !== "unknown" && link.source !== "stale") {
    if (link.source.startsWith("uid:")) {
      parts.push(`process_id="${escapeMplString(link.source.slice(4))}"`);
    } else if (link.source.startsWith("proc:")) {
      parts.push(`process_name="${escapeMplString(link.source.slice(5))}"`);
    } else {
      parts.push(`bundle_id="${escapeMplString(link.source)}"`);
    }
  }

  if (link.targetKind === "domain") {
    parts.push(`destination_domain="${escapeMplString(link.target)}"`);
  } else {
    parts.push(`dest_ip="${escapeMplString(link.target)}"`);
  }

  return `${parts.join(" ")} | sort -timestamp | head 80`;
}
