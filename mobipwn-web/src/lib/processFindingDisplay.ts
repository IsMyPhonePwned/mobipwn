export type ProcessExample = {
  pid: number;
  ppid: number;
  name: string;
  path: string;
  args: string;
  uid: number;
};

export type ParsedProcessReason = {
  headline: string;
  pid?: number;
  ppid?: number;
  uid?: number;
  path?: string;
  args?: string;
  flags?: string;
  count?: number;
};

function readNum(raw: Record<string, unknown>, key: string): number | undefined {
  const v = raw[key];
  return typeof v === "number" ? v : undefined;
}

export function parseProcessExamples(raw?: Record<string, unknown> | null): ProcessExample[] {
  if (!raw || !Array.isArray(raw.process_examples)) return [];
  return raw.process_examples
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      pid: Number(item.pid) || 0,
      ppid: Number(item.ppid) || 0,
      name: String(item.name ?? ""),
      path: String(item.path ?? ""),
      args: String(item.args ?? ""),
      uid: Number(item.uid) || 0,
    }))
    .filter((ex) => ex.pid > 0 || ex.name);
}

export function parseProcessReason(reason: string): ParsedProcessReason {
  const pid = reason.match(/(?:^|\s)pid=(\d+)/)?.[1];
  const ppid = reason.match(/(?:^|\s)ppid=(\d+)/)?.[1];
  const uid = reason.match(/(?:^|\s)uid=(\d+)/)?.[1];
  const args = reason.match(/\| args=(.+)$/)?.[1];
  const pathFromPipe = reason.match(/\| path=([^|]+?)(?:\s*\||\s*$)/)?.[1];

  if (reason.startsWith("RISK DETECTED:")) {
    const name = reason.match(/name=([^\s]+)/)?.[1];
    const path = reason.match(/path=([^\s]+)/)?.[1];
    const parent = reason.match(/parent=([^\s]+)/)?.[1];
    const count = reason.match(/count=(\d+)/)?.[1];
    const flags = reason.match(/reasons=([^\s|]+)/)?.[1];
    const headline = [name, parent && parent !== "(none)" ? `← ${parent}` : null]
      .filter(Boolean)
      .join(" ");
    return {
      headline: headline || "Suspicious process",
      pid: pid ? Number(pid) : undefined,
      ppid: ppid ? Number(ppid) : undefined,
      uid: uid ? Number(uid) : undefined,
      path: path && path !== "(none)" ? path : pathFromPipe,
      args,
      flags,
      count: count ? Number(count) : undefined,
    };
  }

  if (reason.startsWith("Rare process:")) {
    const name = reason.replace(/^Rare process:\s*/, "").split("|")[0]?.trim();
    return {
      headline: name ? `Rare process: ${name}` : reason.split("|")[0]?.trim() || reason,
      pid: pid ? Number(pid) : undefined,
      ppid: ppid ? Number(ppid) : undefined,
      uid: uid ? Number(uid) : undefined,
      path: pathFromPipe,
      args,
    };
  }

  const namePath = reason.match(/^(.+?) \(path: (.+?)\)/);
  if (namePath) {
    return {
      headline: namePath[1],
      path: namePath[2],
      pid: pid ? Number(pid) : undefined,
      ppid: ppid ? Number(ppid) : undefined,
      uid: uid ? Number(uid) : undefined,
      args,
    };
  }

  return { headline: reason.split("|")[0]?.trim() || reason, pid: pid ? Number(pid) : undefined, ppid: ppid ? Number(ppid) : undefined, uid: uid ? Number(uid) : undefined, path: pathFromPipe, args };
}

export function processFindingStats(raw?: Record<string, unknown> | null): {
  processCount?: number;
  suspiciousCount?: number;
  clusterId?: string | number;
  distanceScore?: number;
} {
  if (!raw) return {};
  const cluster = raw.cluster_id;
  return {
    processCount: readNum(raw, "process_count"),
    suspiciousCount: readNum(raw, "suspicious_process_count"),
    clusterId:
      typeof cluster === "string" || typeof cluster === "number" ? cluster : undefined,
    distanceScore: readNum(raw, "distance_score"),
  };
}
