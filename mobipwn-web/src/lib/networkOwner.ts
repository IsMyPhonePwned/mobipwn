import { extField, strField } from "@/lib/rowExt";

export function isStaleNetworkRow(row: Record<string, unknown>): boolean {
  const status = strField(row, "attribution_status") || extField(row, "attribution_status");
  if (status === "stale_socket") return true;
  const ownerType = strField(row, "owner_type") || extField(row, "owner_type");
  return ownerType === "stale";
}

export function isListenerNetworkRow(row: Record<string, unknown>): boolean {
  const direction = strField(row, "socket_direction") || extField(row, "socket_direction");
  if (direction === "listen") return true;
  const state = (extField(row, "state") || strField(row, "action")).toUpperCase();
  return state === "LISTEN";
}

function isWildcardIp(host: string): boolean {
  return host === "*" || host === "::" || host === "0.0.0.0" || host === "0:0:0:0:0:0:0:0";
}

/** Resolved peer IP from enrichment (`peer_ip` preferred over wildcard remote). */
export function resolvePeerIp(row: Record<string, unknown>): string {
  const peer = strField(row, "peer_ip") || extField(row, "peer_ip");
  if (peer && !isWildcardIp(peer)) return peer;
  return "";
}

/** Resolve package / process owner for network socket and flow rows. */
export function resolveNetworkOwner(row: Record<string, unknown>): string {
  if (isStaleNetworkRow(row)) return "";

  const owner = strField(row, "owner") || extField(row, "owner");
  const ownerType = strField(row, "owner_type") || extField(row, "owner_type");
  const ownerIsEnriched =
    owner &&
    ownerType !== "stale" &&
    ownerType !== "unknown" &&
    owner !== "unattributed" &&
    !owner.startsWith("unattributed");

  if (ownerIsEnriched) {
    if (
      ownerType === "package" ||
      (ownerType !== "process" && owner.includes(".") && !owner.includes(" ") && !owner.startsWith("binder:"))
    ) {
      return owner;
    }
    return `proc:${owner}`;
  }

  const bundle =
    strField(row, "bundle_id") ||
    strField(row, "package_name") ||
    extField(row, "package_name") ||
    extField(row, "package") ||
    extField(row, "bundle_id");
  if (bundle) return bundle;

  const programName = extField(row, "program_name");
  if (programName) {
    if (programName.includes(".") && !programName.includes(" ") && !programName.startsWith("binder:")) {
      return programName;
    }
    return `proc:${programName}`;
  }

  const processName =
    strField(row, "process_name") ||
    extField(row, "process_cmd") ||
    extField(row, "process_name");
  if (processName) {
    if (processName.includes(".") && !processName.includes(" ") && !processName.startsWith("binder:")) {
      return processName;
    }
    return `proc:${processName}`;
  }

  const appName = strField(row, "app_name") || extField(row, "app_name");
  if (appName) return appName;

  const uid = strField(row, "process_id") || extField(row, "uid");
  if (uid && uid !== "0") return `uid:${uid}`;

  return "";
}

export function networkOwnerLabel(owner: string): string {
  if (!owner || owner === "unknown") return "unknown";
  if (owner === "stale") return "stale";
  if (owner === "unattributed") return "unattributed";
  if (owner.startsWith("uid:")) return owner;
  if (owner.startsWith("proc:")) return owner.slice(5);
  if (looksLikeAndroidPackage(owner)) {
    const parts = owner.split(".");
    if (parts.length >= 2) return parts.slice(-2).join(".");
  }
  return owner;
}

/** Android package id (com.* / org.*) — not a network hostname. */
export function looksLikeAndroidPackage(value: string): boolean {
  return /^(com|org|io|android|edu|gov|de|fr|uk|jp|co)\.[a-z0-9_]+(\.[a-z0-9_]+)+$/i.test(value);
}

export function networkOwnerDisplay(row: Record<string, unknown>): string {
  if (isStaleNetworkRow(row)) return "stale";
  const owner = resolveNetworkOwner(row);
  return networkOwnerLabel(owner || "unattributed");
}

export function isMeaningfulFlowDestination(row: Record<string, unknown>, target: string): boolean {
  if (!target || isWildcardIp(target)) return false;
  if (isListenerNetworkRow(row)) return false;
  return true;
}

/** Sort key for owner labels (names first, then unattributed, stale last). */
export function networkOwnerSortKey(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized === "stale") return "\uffff stale";
  if (normalized === "unattributed" || normalized === "unknown") return "\ufffe unattributed";
  return normalized;
}

export function compareNetworkOwnerLabels(a: string, b: string): number {
  return networkOwnerSortKey(a).localeCompare(networkOwnerSortKey(b)) || a.localeCompare(b);
}

export function compareFlowSources(a: string, b: string): number {
  return compareNetworkOwnerLabels(networkOwnerLabel(a), networkOwnerLabel(b));
}

export function flowSourceFromRow(
  row: Record<string, unknown>,
  unknownLabel = "unattributed"
): string {
  if (isStaleNetworkRow(row)) return "stale";
  return resolveNetworkOwner(row) || unknownLabel;
}
