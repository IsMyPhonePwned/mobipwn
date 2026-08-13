import { extField, numField, strField } from "@/lib/rowExt";
import type { CasePlatform } from "@/lib/caseDashboard";
import { resolveDisplayHost } from "@/lib/ipResolve";
import { networkOwnerDisplay, resolveNetworkOwner, resolvePeerIp, isStaleNetworkRow, compareNetworkOwnerLabels } from "@/lib/networkOwner";
import { uidOwnerPresentation, type UidOwnerHint } from "@/lib/networkUidHints";

export type NetworkSocketRow = {
  protocol: string;
  local: string;
  remote: string;
  destIp: string;
  srcIp: string;
  state: string;
  uid: string;
  owner: string;
  ownerLabel: string;
  ownerDetail: string | null;
  ownerExplanation: string | null;
  isStale: boolean;
};

const JUNK_REMOTE = new Set(["", "*", ":", "::", "[::]", "[::]:*"]);

/** Prefer embedded IPv4 for ipv4_mapped endpoints from bugreport network parser. */
export function resolveEndpointIp(
  row: Record<string, unknown>,
  side: "local" | "remote"
): string {
  const embedded = extField(row, `${side}_ipv4`);
  if (embedded) return embedded;

  if (side === "remote") {
    const peer = resolvePeerIp(row);
    if (peer) return resolveDisplayHost(peer);
  }

  const top = side === "local" ? strField(row, "src_ip") : strField(row, "dest_ip");
  if (top) return hostFromAddress(top);

  const ip = extField(row, `${side}_ip`) || extField(row, `${side}_address`);
  return hostFromAddress(ip);
}

export function hostFromAddress(raw: string): string {
  return resolveDisplayHost(raw);
}

function endpointAddress(row: Record<string, unknown>, side: "local" | "remote"): string {
  const combined = extField(row, side === "local" ? "local_address" : "remote_address");
  const port = extField(row, `${side}_port`);
  if (combined) {
    if (port && !combined.includes(":")) {
      const host = hostFromAddress(combined);
      if (host) return `${host}:${port}`;
    }
    return combined;
  }
  const ip = resolveEndpointIp(row, side);
  if (ip && port) return `${ip}:${port}`;
  return ip;
}

function parseSocketMessage(message: string): { protocol: string; local: string; remote: string } | null {
  const m = message.match(/Socket\s+(\S+)\s+(.+?)\s*->\s*(.+)$/i);
  if (!m) return null;
  return {
    protocol: m[1],
    local: m[2].trim(),
    remote: m[3].trim(),
  };
}

function isMeaningfulRemote(remote: string): boolean {
  const r = remote.trim();
  if (!r || JUNK_REMOTE.has(r)) return false;
  if (r.endsWith(":*") || r === "[::]:*") return false;
  return true;
}

export function networkSocketsQuery(source: string, platform: CasePlatform = "android"): string {
  const src = source.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (platform === "ios") {
    return `source="${src}" parser="network_iocs" (dest_ip=* OR ioc_kind="ipv4" OR ioc_kind="domain") | fields dest_ip, destination_domain, ioc_kind, ioc_value, action, message, ext, parser, bundle_id, process_id | head 80`;
  }
  return `source="${src}" parser="Network" data_type=*network_socket* | fields data_type, dest_ip, src_ip, action, message, ext, process_id, process_name, bundle_id | head 80`;
}

export function parseNetworkSocket(
  row: Record<string, unknown>,
  options?: { iosRelaxed?: boolean }
): NetworkSocketRow | null {
  const dt = strField(row, "data_type").toLowerCase();
  if (!options?.iosRelaxed) {
    if (dt && !dt.includes("network_socket")) return null;
  } else if (
    !strField(row, "dest_ip") &&
    !extField(row, "remote_ip") &&
    !extField(row, "destination_domain")
  ) {
    return null;
  }

  const fromMsg = parseSocketMessage(strField(row, "message"));
  const protocol =
    fromMsg?.protocol || extField(row, "protocol") || strField(row, "action") || "tcp";

  const local = fromMsg?.local || endpointAddress(row, "local");

  let remote = fromMsg?.remote || endpointAddress(row, "remote");

  if (!isMeaningfulRemote(remote)) {
    const rip = resolveEndpointIp(row, "remote");
    const rport = extField(row, "remote_port");
    if (rip && rport && rip !== ":") remote = `${rip}:${rport}`;
  }

  if (!isMeaningfulRemote(remote) && options?.iosRelaxed) {
    const domain = extField(row, "destination_domain");
    if (domain) remote = domain;
  }

  const isStale = isStaleNetworkRow(row);
  if (!local && !isMeaningfulRemote(remote) && !isStale) return null;

  const destIp = resolveEndpointIp(row, "remote") || hostFromAddress(remote);

  const uid =
    strField(row, "process_id") ||
    extField(row, "uid") ||
    (numField(row, "process_id") != null ? String(numField(row, "process_id")) : "");

  const owner = resolveNetworkOwner(row);
  const ownerLabel = networkOwnerDisplay(row);

  const listen = extField(row, "socket_direction") === "listen" || extField(row, "state").toUpperCase() === "LISTEN";
  let displayRemote = listen
    ? extField(row, "peer_ip_display") || "(listen)"
    : isMeaningfulRemote(remote)
      ? remote
      : "";
  if (!displayRemote && isStale && destIp) {
    const rport = extField(row, "remote_port");
    displayRemote = rport ? `${destIp}:${rport}` : destIp;
  }
  const displayDestIp = listen ? "" : destIp;

  return {
    protocol,
    local,
    remote: displayRemote,
    destIp: displayDestIp,
    srcIp: resolveEndpointIp(row, "local") || strField(row, "src_ip"),
    state: extField(row, "state"),
    uid,
    owner,
    ownerLabel,
    ownerDetail: null,
    ownerExplanation: null,
    isStale,
  };
}

function enrichSocketOwners(
  rows: NetworkSocketRow[],
  uidHints: Map<string, UidOwnerHint>
): NetworkSocketRow[] {
  return rows.map((row) => {
    if (!row.owner.startsWith("uid:")) return row;
    const { secondary, explanation } = uidOwnerPresentation(row.owner, uidHints);
    return {
      ...row,
      ownerDetail: secondary,
      ownerExplanation: explanation,
    };
  });
}

export function networkSocketRows(
  rows: Record<string, unknown>[],
  limit = 12,
  options?: { iosRelaxed?: boolean; uidHints?: Map<string, UidOwnerHint> }
): NetworkSocketRow[] {
  const seen = new Set<string>();
  const out: NetworkSocketRow[] = [];
  for (const row of rows) {
    const parsed = parseNetworkSocket(row, options);
    if (!parsed) continue;
    if (!parsed.remote && !parsed.local && !parsed.isStale) continue;
    const key = `${parsed.protocol}|${parsed.local}|${parsed.remote}|${parsed.uid}|${parsed.isStale}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  const sorted = out
    .sort((a, b) => {
    const byOwner = compareNetworkOwnerLabels(a.ownerLabel, b.ownerLabel);
    if (byOwner !== 0) return byOwner;
    const byRemote = (a.remote || a.destIp).localeCompare(b.remote || b.destIp);
    if (byRemote !== 0) return byRemote;
    return a.protocol.localeCompare(b.protocol);
    })
    .slice(0, limit);
  return options?.uidHints ? enrichSocketOwners(sorted, options.uidHints) : sorted;
}

export function topDestinations(rows: NetworkSocketRow[], limit = 5): Array<{ dest: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const dest = row.destIp || hostFromAddress(row.remote) || row.remote;
    if (!dest || dest === "0.0.0.0" || !isMeaningfulRemote(dest)) continue;
    counts.set(dest, (counts.get(dest) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([dest, count]) => ({ dest, count }));
}
