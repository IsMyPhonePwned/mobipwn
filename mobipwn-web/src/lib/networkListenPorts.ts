import { splitHostPort } from "@/lib/ipResolve";
import { extField, strField } from "@/lib/rowExt";
import { compareNetworkOwnerLabels, isListenerNetworkRow, networkOwnerDisplay, resolveNetworkOwner } from "@/lib/networkOwner";
import { uidOwnerPresentation, type UidOwnerHint } from "@/lib/networkUidHints";
import { networkSocketsQuery } from "@/lib/networkSockets";

export { splitHostPort };

export type ListenPortRow = {
  protocol: string;
  bindHost: string;
  port: string;
  local: string;
  owner: string;
  ownerLabel: string;
  ownerDetail: string | null;
  ownerExplanation: string | null;
};

export type ListenOwnerDisplay = {
  primary: string;
  secondary: string | null;
  explanation: string | null;
  isUid: boolean;
};

export function listenOwnerDisplay(row: Pick<ListenPortRow, "owner" | "ownerLabel" | "ownerDetail" | "ownerExplanation">): ListenOwnerDisplay {
  const isUid = row.owner.startsWith("uid:");
  return {
    primary: row.ownerLabel === "stale" ? "stale" : row.ownerLabel,
    secondary: row.ownerDetail,
    explanation: row.ownerExplanation,
    isUid,
  };
}

function localAddressFromRow(row: Record<string, unknown>): string {
  const fromExt = extField(row, "local_address");
  if (fromExt) return fromExt;

  const msg = strField(row, "message");
  const m = msg.match(/Socket\s+\S+\s+(.+?)\s*->/i);
  return m?.[1]?.trim() ?? "";
}

export function parseListenPortRow(row: Record<string, unknown>): ListenPortRow | null {
  const dt = strField(row, "data_type").toLowerCase();
  if (dt && !dt.includes("network_socket")) return null;

  const state = (extField(row, "state") || strField(row, "action")).toUpperCase();
  if (!isListenerNetworkRow(row) && state !== "LISTEN") return null;

  const local = localAddressFromRow(row);
  if (!local) return null;

  const { host, port } = splitHostPort(local);
  const protocol =
    extField(row, "protocol") ||
    strField(row, "message").match(/Socket\s+(\S+)/i)?.[1] ||
    strField(row, "action") ||
    "tcp";

  const owner = resolveNetworkOwner(row);
  const ownerLabel = networkOwnerDisplay(row);

  return {
    protocol,
    bindHost: host || "*",
    port: port || extField(row, "local_port") || "—",
    local,
    owner,
    ownerLabel,
    ownerDetail: null,
    ownerExplanation: null,
  };
}

function enrichListenPortOwners(
  rows: ListenPortRow[],
  uidHints: Map<string, UidOwnerHint>
): ListenPortRow[] {
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

export function listenPortsQuery(source: string): string {
  return networkSocketsQuery(source, "android");
}

export function listenPortRows(
  rows: Record<string, unknown>[],
  options?: { limit?: number; uidHints?: Map<string, UidOwnerHint> }
): ListenPortRow[] {
  const limit = options?.limit ?? 48;
  const uidHints = options?.uidHints;
  const seen = new Set<string>();
  const out: ListenPortRow[] = [];

  for (const row of rows) {
    const parsed = parseListenPortRow(row);
    if (!parsed) continue;
    const key = `${parsed.protocol}|${parsed.local}|${parsed.owner}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }

  const sorted = out
    .sort((a, b) => {
    const byOwner = compareNetworkOwnerLabels(a.ownerLabel, b.ownerLabel);
    if (byOwner !== 0) return byOwner;
    const pa = Number.parseInt(a.port, 10);
    const pb = Number.parseInt(b.port, 10);
    if (Number.isFinite(pa) && Number.isFinite(pb)) {
      return pa - pb || a.protocol.localeCompare(b.protocol);
    }
    return a.port.localeCompare(b.port) || a.protocol.localeCompare(b.protocol);
    })
    .slice(0, limit);

  return uidHints ? enrichListenPortOwners(sorted, uidHints) : sorted;
}
