import { extField, numField, numFromValue, parseExt, strField } from "@/lib/rowExt";
import type { CasePlatform } from "@/lib/caseDashboard";

export type ProcessRow = {
  name: string;
  pid: number;
  ppid: number | null;
  user: string;
  uid: string;
  policy: string;
  policyLabel: string;
  threads: number;
  /** Resident / RSS from Android top (`res`). */
  rss: string;
  /** Virtual size from Android top (`virt`). */
  virt: string;
  /** Combined thread %CPU when present. */
  cpuPercent: number | null;
  footprint: string;
  path: string;
  /** argv after the executable (from ps COMMAND / ps_everywhere). */
  args: string;
  /** Full command line when known. */
  commandLine: string;
  parent: string;
  status: string;
  /** Estimated process start (ISO / display), when known. */
  startedAt: string;
  /** Human uptime (e.g. `2h 15m`) from run time / time_since_fork. */
  uptime: string;
  /** Raw uptime seconds when parseable. */
  uptimeSeconds: number | null;
  /** True when start was estimated (taskinfo/spindump), not wall-clock from OS. */
  startedEstimated: boolean;
  message: string;
  parser?: string;
  serviceHint?: string;
};

export type ProcessSummary = {
  total: number;
  withCpu: number;
  topCpu: number | null;
  foreground: number;
  background: number;
};

/** Android `pcy` / scheduling policy codes from `top`. */
export function androidPolicyLabel(code: string): string {
  const c = code.trim().toLowerCase();
  if (!c) return "";
  switch (c) {
    case "fg":
      return "foreground";
    case "bg":
      return "background";
    case "ta":
      return "top-app";
    case "sf":
      return "system";
    case "ts":
      return "top-sleeping";
    default:
      return code.trim();
  }
}

export function formatCpuPercent(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 10) return `${n.toFixed(1)}%`;
  return `${Math.round(n)}%`;
}

/** Format seconds as compact uptime (`45s`, `12m`, `2h 15m`, `3d 4h`). */
export function formatUptimeSeconds(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 48) {
    const remM = m % 60;
    return remM ? `${h}h ${remM}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

export function formatProcessStarted(isoOrRaw: string): string {
  if (!isoOrRaw) return "";
  const d = new Date(isoOrRaw);
  if (Number.isNaN(d.getTime())) return isoOrRaw;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Parse taskinfo `run time` / spindump `time_since_fork` into seconds. */
export function parseUptimeSeconds(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const fork = s.match(/^(\d+(?:\.\d+)?)\s*s(?:ecs?)?$/);
  if (fork) return Math.floor(Number(fork[1]));
  const secsWord = s.match(/^(\d+)\s*sec/);
  if (secsWord) return Number(secsWord[1]);
  // taskinfo often: "12345 seconds" or "12345 secs ..."
  const leading = s.match(/^(\d+)\b/);
  if (leading && /sec|s\b/.test(s)) return Number(leading[1]);
  return null;
}

function processTiming(row: Record<string, unknown>, ext: Record<string, unknown>) {
  const runTime =
    (typeof ext["run time"] === "string" ? ext["run time"] : "") ||
    (typeof ext.run_time === "string" ? ext.run_time : "") ||
    extField(row, "run time") ||
    extField(row, "run_time");
  const sinceFork =
    (typeof ext.time_since_fork === "string" ? ext.time_since_fork : "") ||
    extField(row, "time_since_fork");
  const psStarted =
    (typeof ext.started === "string" ? ext.started : "") || extField(row, "started");

  const uptimeSeconds =
    parseUptimeSeconds(runTime) ?? parseUptimeSeconds(sinceFork) ?? null;
  const uptime =
    formatUptimeSeconds(uptimeSeconds) ||
    (sinceFork && !uptimeSeconds ? sinceFork.replace(/\s+/g, "") : "") ||
    (runTime && !uptimeSeconds ? runTime : "");

  const tsDesc = strField(row, "timestamp_desc").toLowerCase();
  const estimated =
    tsDesc.includes("process start") ||
    tsDesc.includes("spindump") ||
    Boolean(runTime || sinceFork);

  const rawStart =
    strField(row, "datetime") ||
    strField(row, "timestamp") ||
    (typeof ext.datetime === "string" ? ext.datetime : "");

  let startedAt = "";
  if (rawStart) {
    const d = new Date(rawStart);
    // Reject bogus epoch / empty
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 2008) {
      startedAt = d.toISOString();
    } else if (psStarted) {
      startedAt = psStarted;
    } else if (Number.isNaN(d.getTime()) && rawStart.trim()) {
      startedAt = rawStart.trim();
    }
  } else if (psStarted) {
    startedAt = psStarted;
  }

  return {
    startedAt,
    uptime,
    uptimeSeconds,
    startedEstimated: estimated && Boolean(startedAt || uptime),
  };
}

function sumThreadCpu(ext: Record<string, unknown>): number | null {
  const threads = ext.threads;
  if (!Array.isArray(threads)) return null;
  let sum = 0;
  let any = false;
  for (const t of threads) {
    if (!t || typeof t !== "object" || Array.isArray(t)) continue;
    const cpu = numFromValue((t as Record<string, unknown>).cpu_percent);
    if (cpu == null) continue;
    sum += cpu;
    any = true;
  }
  return any ? sum : null;
}

function mainThreadStatus(ext: Record<string, unknown>, pid: number): string {
  const threads = ext.threads;
  if (!Array.isArray(threads)) return "";
  for (const t of threads) {
    if (!t || typeof t !== "object" || Array.isArray(t)) continue;
    const rec = t as Record<string, unknown>;
    const tid = numFromValue(rec.tid);
    if (tid != null && pid > 0 && tid === pid) {
      return typeof rec.status === "string" ? rec.status.trim() : "";
    }
  }
  const first = threads[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const status = (first as Record<string, unknown>).status;
    return typeof status === "string" ? status.trim() : "";
  }
  return "";
}

export function processesQuery(source: string, platform: CasePlatform = "android"): string {
  const src = source.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (platform === "ios") {
    // Prefer merged inventory rows from the sysdiagnose library; keep raw parser fallback
    // for older ingests that predate `ps_everywhere`.
    return (
      `source="${src}" (parser="ps_everywhere" OR parser="taskinfo" OR parser="spindumpnosymbols" OR parser="ps" OR parser="psthread") ` +
      `process_name=* ` +
      `| fields timestamp, datetime, process_name, process_id, user, parser, message, timestamp_desc, args, command_line, command, ext ` +
      `| sort process_id | head 5000`
    );
  }
  return `source="${src}" parser="Process" process_name=* | fields process_name, process_id, user, message, ext | sort process_id | head 5000`;
}

/** Strip leading top/ps priority leftovers: `22 tz_worker_thread/8` → `tz_worker_thread/8`. */
export function stripLeadingSchedulerJunk(name: string): string {
  const t = name.trim();
  const m = t.match(/^(\d{1,3})\s+(\S.*)$/);
  if (!m) return t;
  const rest = m[2].trim();
  const first = rest.split(/\s+/)[0] || rest;
  if (
    first.startsWith("[") ||
    first.startsWith("/") ||
    /^[A-Za-z_][A-Za-z0-9_./:@+-]*$/.test(first)
  ) {
    return rest;
  }
  return t;
}

/** Bracket unbracketed kernel threads parented by kthreadd. */
export function bracketKernelThreadName(name: string, parent: string): string {
  const t = name.trim();
  if (!t || (t.startsWith("[") && t.endsWith("]"))) return t;
  const parentLooksKernel =
    /kthreadd/i.test(parent) || parent.trim() === "2";
  if (!parentLooksKernel) return t;
  // Typical kernel thread names: tz_worker_thread/8, ksoftirqd/0, kworker/0:0H
  if (/^[A-Za-z_][\w./:@+-]*$/.test(t)) {
    return `[${t}]`;
  }
  return t;
}

export function parseProcessRow(row: Record<string, unknown>): ProcessRow | null {
  const ext = parseExt(row);
  const message = strField(row, "message");
  const nameRaw =
    extField(row, "name") ||
    extField(row, "process") ||
    strField(row, "process_name") ||
    extField(row, "cmd") ||
    extField(row, "command");
  // Prefer quoted token from legacy dirty identity lines (`"sshd" [298] …`).
  const quoted = nameRaw.match(/"([^"]+)"/);
  let name =
    /\[unique ID:/i.test(nameRaw) && quoted?.[1]
      ? quoted[1]
      : nameRaw.replace(/^"+|"+$/g, "").trim() || nameRaw;
  // Peel glued ps TIME (`0:00.10 sshd:…`) and shorten `sshd: root@ttys000` → `sshd`.
  name = name.replace(/^\d+:\d{2}(?::\d{2})?(?:\.\d+)?\s+/, "");
  // Strip leading top/ps PRI leftovers before taking the first token (`22 tz_worker…`).
  name = stripLeadingSchedulerJunk(name);
  // If the name is still only digits, try a cleaner thread name from ext.
  if (/^\d+$/.test(name) && Array.isArray(ext.threads)) {
    for (const t of ext.threads) {
      if (!t || typeof t !== "object" || Array.isArray(t)) continue;
      const tn = stripLeadingSchedulerJunk(
        typeof (t as { name?: unknown }).name === "string"
          ? String((t as { name: string }).name)
          : ""
      );
      if (tn && !/^\d+$/.test(tn.split(/\s+/)[0] || tn)) {
        name = tn;
        break;
      }
    }
  }
  const bare = name.split(/\s+/)[0] || name;
  // Only basename absolute paths (`/usr/sbin/sshd` → `sshd`). Do not split on `/`
  // or `:` inside Android kernel names like `[ksoftirqd/0]` / `[sugov:0]`.
  const base = bare.startsWith("/") ? bare.split("/").pop() || bare : bare;
  const colon = base.indexOf(":");
  if (colon > 0 && !(base.startsWith("[") && base.endsWith("]"))) {
    name = base.slice(0, colon);
  } else if (base) {
    name = base.replace(/^\(|\)$/g, "");
  }
  const pid =
    numField(row, "process_id") ??
    numField(row, "pid") ??
    numFromValue(ext.pid) ??
    0;
  if (!name && !pid) return null;

  const threadsArr = Array.isArray(ext.threads) ? ext.threads.length : 0;
  const threadsCount =
    threadsArr ||
    numFromValue(ext.thread_count) ||
    numFromValue(ext.threads_total) ||
    0;

  const policy = extField(row, "pcy") || extField(row, "policy") || "";
  const rss = extField(row, "res") || extField(row, "rss") || "";
  const virt = extField(row, "virt") || extField(row, "vsz") || "";
  const footprint =
    extField(row, "footprint") ||
    extField(row, "memory_limit") ||
    rss ||
    "";

  const path =
    extField(row, "path") ||
    (typeof ext.file_path === "string" ? ext.file_path : "") ||
    "";
  const asToken = parseProcessAsToken(message);
  const ppid =
    numFromValue(ext.ppid) ??
    numFromValue(ext.parent_pid) ??
    numField(row, "ppid") ??
    numField(row, "parent_pid");
  const commandLine =
    extField(row, "command_line") ||
    extField(row, "command") ||
    strField(row, "command_line") ||
    strField(row, "command") ||
    "";
  const splitFrom =
    commandLine ||
    (message.includes("/") || message.includes(" ") ? message : "");
  const split = splitProcessCommand(splitFrom);
  const args =
    extField(row, "args") ||
    strField(row, "args") ||
    split.args ||
    "";
  const resolvedPath =
    path ||
    (split.exe.startsWith("/") ? split.exe : "") ||
    "";
  const parent =
    extField(row, "parent") ||
    (message.match(/\bparent=(\S+)/i)?.[1] ?? "") ||
    "";
  name = bracketKernelThreadName(name, parent);
  // Prefer numeric UID (ps/spindump); keep username separate.
  const uidNum =
    (ext.uid != null && typeof ext.uid !== "object" && String(ext.uid).trim() !== ""
      ? String(ext.uid).trim()
      : "") ||
    (extField(row, "uid").match(/^\d+$/) ? extField(row, "uid") : "") ||
    asToken.uid ||
    "";
  const userName =
    strField(row, "user") ||
    extField(row, "user") ||
    asToken.user ||
    "";
  const timing = processTiming(row, ext);

  const proc: ProcessRow = {
    name: name || `pid ${pid}`,
    pid,
    ppid,
    user: userName || "—",
    uid: uidNum,
    policy,
    policyLabel: androidPolicyLabel(policy),
    threads: threadsCount,
    rss,
    virt,
    cpuPercent: sumThreadCpu(ext),
    footprint,
    path: resolvedPath,
    args,
    commandLine: commandLine || (args ? `${resolvedPath} ${args}`.trim() : ""),
    parent,
    status: mainThreadStatus(ext, pid),
    startedAt: timing.startedAt,
    uptime: timing.uptime,
    uptimeSeconds: timing.uptimeSeconds,
    startedEstimated: timing.startedEstimated,
    message,
    parser: strField(row, "parser") || undefined,
  };
  proc.serviceHint = iosServiceHint(proc);
  return proc;
}

/** Spindump/psthread: `… [pid] as 0 parent=launchd` or `… as root`. */
function parseProcessAsToken(message: string): { uid?: string; user?: string } {
  const m = message.match(/\bas\s+(\d+|[A-Za-z_][\w.-]*)\b/);
  if (!m?.[1]) return {};
  if (/^\d+$/.test(m[1])) return { uid: m[1] };
  return { user: m[1] };
}

function pickStr(a: string, b: string): string {
  const av = a.trim();
  if (av && av !== "—") return a;
  const bv = b.trim();
  return bv && bv !== "—" ? b : a;
}

function normalizeProcessPath(path: string): string {
  const t = path.trim();
  if (!t) return "";
  return (t.startsWith("/private/") ? t.slice("/private".length) : t).replace(/\/+$/, "");
}

/** Split ps-style COMMAND into argv0 + args (skip Apple `name: detail` forms). */
export function splitProcessCommand(command: string): { exe: string; args: string } {
  const cmd = command.replace(/^\d+:\d{2}(?::\d{2})?(?:\.\d+)?\s+/, "").trim();
  if (!cmd) return { exe: "", args: "" };
  const first = cmd.split(/\s+/)[0] || cmd;
  if (first.includes(":") && !first.startsWith("/")) {
    return { exe: cmd, args: "" };
  }
  const sp = cmd.search(/\s/);
  if (sp < 0) return { exe: cmd, args: "" };
  return { exe: cmd.slice(0, sp), args: cmd.slice(sp + 1).trim() };
}

function pickLonger(a: string, b: string): string {
  const av = a.trim();
  const bv = b.trim();
  if (!bv) return a;
  if (!av) return b;
  return bv.length > av.length ? b : a;
}

export function iosServiceHint(proc: ProcessRow): string {
  if (proc.pid > 0 || proc.uid || proc.ppid != null) return "";
  if (!/^com\.[a-z0-9_.-]+$/i.test(proc.name)) return "";
  return `${proc.name} has no UID/PPID because it was only found in remotectl_dumpstate (registered service list)`;
}

/** Remotectl / launchd-style registered services (no live PID inventory). */
export function isIosRegisteredService(proc: ProcessRow): boolean {
  return Boolean(proc.serviceHint) || Boolean(iosServiceHint(proc));
}

/** Fill blanks from another parser’s view of the same PID (taskinfo + ps/spindump). */
function mergeProcessRow(primary: ProcessRow, other: ProcessRow): ProcessRow {
  const merged: ProcessRow = {
    ...primary,
    name: primary.name || other.name,
    ppid: primary.ppid ?? other.ppid,
    user: pickStr(primary.user, other.user),
    uid: pickStr(primary.uid, other.uid),
    policy: pickStr(primary.policy, other.policy),
    policyLabel: pickStr(primary.policyLabel, other.policyLabel),
    threads: primary.threads > 0 ? primary.threads : other.threads,
    rss: pickStr(primary.rss, other.rss),
    virt: pickStr(primary.virt, other.virt),
    cpuPercent: primary.cpuPercent ?? other.cpuPercent,
    footprint: pickStr(primary.footprint, other.footprint),
    path: pickStr(primary.path, other.path),
    args: pickLonger(primary.args, other.args),
    commandLine: pickLonger(primary.commandLine, other.commandLine),
    parent: pickStr(primary.parent, other.parent),
    status: pickStr(primary.status, other.status),
    startedAt: pickStr(primary.startedAt, other.startedAt),
    uptime: pickStr(primary.uptime, other.uptime),
    uptimeSeconds: primary.uptimeSeconds ?? other.uptimeSeconds,
    startedEstimated: primary.startedAt || primary.uptime
      ? primary.startedEstimated
      : other.startedEstimated,
    message: pickLonger(primary.message, other.message),
    parser: primary.parser || other.parser,
    serviceHint: primary.serviceHint || other.serviceHint,
  };
  merged.serviceHint = iosServiceHint(merged);
  return merged;
}

export function processSummary(rows: ProcessRow[]): ProcessSummary {
  let withCpu = 0;
  let topCpu: number | null = null;
  let foreground = 0;
  let background = 0;
  for (const p of rows) {
    if (p.cpuPercent != null) {
      withCpu += 1;
      if (topCpu == null || p.cpuPercent > topCpu) topCpu = p.cpuPercent;
    }
    const pol = p.policy.trim().toLowerCase();
    if (pol === "fg" || pol === "ta") foreground += 1;
    if (pol === "bg" || pol === "ts") background += 1;
  }
  return { total: rows.length, withCpu, topCpu, foreground, background };
}

export type ProcessSort = "cpu" | "pid";

export function processRows(
  rows: Record<string, unknown>[],
  limit = 14,
  sortBy: ProcessSort = "cpu"
): ProcessRow[] {
  const byKey = new Map<string, ProcessRow>();
  const richness = (p: ProcessRow) =>
    (p.cpuPercent != null ? 4 : 0) +
    (p.startedAt ? 3 : 0) +
    (p.uptime ? 2 : 0) +
    (p.rss ? 1 : 0) +
    (p.threads > 0 ? 1 : 0) +
    (p.path ? 1 : 0) +
    (p.args ? 3 : 0) +
    (p.parser === "taskinfo" ? 2 : 0) +
    (p.parser === "ps_everywhere" ? 4 : 0);

  for (const row of rows) {
    const proc = parseProcessRow(row);
    if (!proc) continue;
    // Skip aggregate / non-process rows that slipped through.
    if (/tasks\/programs running/i.test(proc.message)) continue;
    if (/^spindump\b/i.test(proc.message.trim()) && !proc.pid) continue;
    // Same PID from ps / psthread / taskinfo is one process; keep richest base
    // and merge complementary fields (UID from ps/spindump into taskinfo, etc.).
    const key = proc.pid > 0 ? `pid:${proc.pid}` : `${proc.pid}:${proc.name}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, proc);
    } else if (richness(proc) > richness(existing)) {
      byKey.set(key, mergeProcessRow(proc, existing));
    } else {
      byKey.set(key, mergeProcessRow(existing, proc));
    }
  }

  const sorted = [...byKey.values()].sort((a, b) => {
    if (sortBy === "pid") {
      return a.pid - b.pid || a.name.localeCompare(b.name);
    }
    if (a.cpuPercent != null || b.cpuPercent != null) {
      const ac = a.cpuPercent ?? -1;
      const bc = b.cpuPercent ?? -1;
      if (ac !== bc) return bc - ac;
    }
    return a.pid - b.pid || a.name.localeCompare(b.name);
  });

  // Resolve missing parent names from PPID → process name (Android Process / iOS inventory).
  const pidToName = new Map<number, string>();
  for (const p of sorted) {
    if (p.pid > 0 && p.name) pidToName.set(p.pid, p.name);
  }
  for (const p of sorted) {
    if (p.parent || p.ppid == null || p.ppid <= 0) continue;
    const parentName = pidToName.get(p.ppid);
    if (parentName) p.parent = parentName;
  }

  // Generic: copy longest argv onto rows that share the same executable path
  // (ps snapshot PIDs often differ from taskinfo PIDs).
  const pathArgs = new Map<string, string>();
  for (const p of sorted) {
    const key = normalizeProcessPath(p.path);
    if (!key || !p.args) continue;
    const cur = pathArgs.get(key) || "";
    if (p.args.length >= cur.length) pathArgs.set(key, p.args);
  }
  for (const p of sorted) {
    const key = normalizeProcessPath(p.path);
    if (!key) continue;
    const args = pathArgs.get(key);
    if (args && args.length > (p.args?.length || 0)) {
      p.args = args;
      if (!p.commandLine || p.commandLine.length < `${p.path} ${args}`.length) {
        p.commandLine = `${p.path} ${args}`.trim();
      }
    }
  }

  if (limit <= 0 || limit >= sorted.length) return sorted;
  return sorted.slice(0, limit);
}

export type IosProcessEvent = ProcessRow & {
  when: string;
  whenRaw: string;
  timestampDesc: string;
  kind: "start" | "running" | "snapshot" | "shutdown" | "other";
  /** Seconds still present at shutdown (`shutdownlogs.time_waiting`). */
  waitSeconds: number | null;
  /** Trailing binary UUID from iOS 26 client paths, when present. */
  uuid: string;
  /** Shutdown log path that produced this event. */
  sourcePath: string;
  /** Executable path with trailing UUID removed. */
  executablePath: string;
};

export function iosProcessEventsQuery(source: string): string {
  const src = source.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  // Use the /v1/search/run ceiling (10_000) so the panel does not silently drop events.
  return (
    `source="${src}" ` +
    `(parser="taskinfo" OR parser="spindumpnosymbols" OR parser="ps" OR parser="psthread" OR parser="shutdownlogs") ` +
    `(process_name=* OR pid=* OR process_id=* OR command=*) ` +
    `| fields timestamp, datetime, process_name, process_id, user, parser, message, timestamp_desc, args, command_line, command, path, ext ` +
    `| sort -timestamp | head 10000`
  );
}

/** Default list page size in the Process events panel (UI only — query is uncapped below). */
export const IOS_PROCESS_EVENTS_LIST_PAGE = 120;

function eventKind(parser: string, desc: string, message: string): IosProcessEvent["kind"] {
  const d = desc.toLowerCase();
  const m = message.toLowerCase();
  if (parser === "shutdownlogs" || d.includes("at shutdown") || m.includes("during shutdown")) {
    return "shutdown";
  }
  if (d.includes("process start") || m.endsWith(" started")) return "start";
  if (d.includes("spindump") || parser === "spindumpnosymbols") {
    if (/^spindump\b/i.test(message.trim())) return "other";
    return "running";
  }
  if (parser === "ps" || parser === "psthread") return "snapshot";
  if (parser === "taskinfo" && /tasks\/programs running/i.test(message)) return "other";
  return "other";
}

export function iosProcessEventsFromRows(
  rows: Record<string, unknown>[],
  limit?: number
): IosProcessEvent[] {
  const out: IosProcessEvent[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const message = strField(row, "message");
    if (/tasks\/programs running/i.test(message) || /^spindump\b/i.test(message.trim())) {
      continue;
    }
    const proc = parseProcessRow(row);
    if (!proc || (!proc.name && !proc.pid)) continue;

    const ext = parseExt(row);
    const whenRaw = strField(row, "datetime") || strField(row, "timestamp") || proc.startedAt;
    const when = formatProcessStarted(whenRaw) || whenRaw;
    const timestampDesc = strField(row, "timestamp_desc");
    const parser = proc.parser || "";
    const kind = eventKind(parser, timestampDesc, message);
    if (kind === "other" && !proc.pid && !proc.path) continue;

    const waitSeconds =
      numFromValue(ext.time_waiting) ??
      numFromValue(ext.wait_time) ??
      null;
    const uuid = extField(row, "uuid");
    const sourcePath = extField(row, "source_path");
    const executablePath =
      extField(row, "executable_path") ||
      (kind === "shutdown" && proc.path.includes("/") ? proc.path.replace(/\/[0-9a-fA-F-]{36}$/, "") : "");

    // Prefer executable path without trailing UUID for display path when present.
    if (executablePath && (!proc.path || proc.path.endsWith(uuid))) {
      proc.path = executablePath;
    }

    const key = `${parser}:${proc.pid}:${proc.name}:${whenRaw}:${message.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ...proc,
      when,
      whenRaw,
      timestampDesc,
      kind,
      waitSeconds,
      uuid,
      sourcePath,
      executablePath,
    });
    if (limit != null && out.length >= limit) break;
  }

  return out;
}

export function iosProcessEventParserCounts(
  events: IosProcessEvent[]
): { parser: string; count: number }[] {
  const map = new Map<string, number>();
  for (const e of events) {
    const p = e.parser || "unknown";
    map.set(p, (map.get(p) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([parser, count]) => ({ parser, count }))
    .sort((a, b) => b.count - a.count || a.parser.localeCompare(b.parser));
}

export const IOS_PROCESS_EVENT_KINDS = [
  "start",
  "running",
  "snapshot",
  "shutdown",
  "other",
] as const;

export type IosProcessEventKind = (typeof IOS_PROCESS_EVENT_KINDS)[number];

/** Chart / badge colors aligned with `.case-ios-procevents__kind--*`. */
export const IOS_PROCESS_EVENT_KIND_COLORS: Record<IosProcessEventKind, string> = {
  // Solid hex — SVG/Recharts fill often ignores CSS custom properties.
  start: "#22c55e",
  running: "#3b82f6",
  snapshot: "#8b5cf6",
  shutdown: "#eab308",
  other: "#94a3b8",
};

export const IOS_PROCESS_EVENT_KIND_LABELS: Record<IosProcessEventKind, string> = {
  start: "Starts",
  running: "Spindump",
  snapshot: "Snapshots",
  shutdown: "Shutdown",
  other: "Other",
};

/** Y-lane for swimlane scatter (top = starts). */
export const IOS_PROCESS_EVENT_KIND_LANE: Record<IosProcessEventKind, number> = {
  start: 4,
  running: 3,
  snapshot: 2,
  shutdown: 1,
  other: 0,
};

export type IosProcessEventTimelinePoint = {
  t: number;
  kind: IosProcessEventKind;
  kindY: number;
  name: string;
  when: string;
  parser: string;
  pid: number;
};

export type IosProcessEventTimelineBucket = {
  t: number;
  label: string;
  start: number;
  running: number;
  snapshot: number;
  shutdown: number;
  other: number;
  total: number;
};

/** Reject epoch placeholders (common for iOS `ps` without wall-clock) and absurd futures. */
function isPlausibleProcessEventMs(ms: number): boolean {
  const now = Date.now();
  return ms >= Date.UTC(2008, 0, 1) && ms <= now + 24 * 60 * 60 * 1000;
}

export function iosProcessEventTimeMs(event: IosProcessEvent): number | null {
  for (const raw of [event.whenRaw, event.startedAt]) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // ClickHouse / dumps: "YYYY-MM-DD HH:MM:SS(.us)" — Safari Date.parse often fails on spaces.
    const spaceDate = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (spaceDate) {
      const ms = Date.parse(`${spaceDate[1]}T${spaceDate[2]}Z`);
      if (Number.isFinite(ms) && isPlausibleProcessEventMs(ms)) return ms;
      continue;
    }

    const asNum = Number(trimmed);
    if (Number.isFinite(asNum) && asNum > 0) {
      const ms =
        asNum > 1e14 ? Math.floor(asNum / 1000) : asNum < 1e12 ? Math.floor(asNum * 1000) : asNum;
      if (isPlausibleProcessEventMs(ms)) return ms;
      continue;
    }

    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms) && isPlausibleProcessEventMs(ms)) return ms;
  }
  return null;
}

function chooseTimelineBucketMs(spanMs: number): number {
  const candidates = [
    60_000,
    2 * 60_000,
    5 * 60_000,
    10 * 60_000,
    30 * 60_000,
    60 * 60_000,
    2 * 60 * 60_000,
    6 * 60 * 60_000,
    12 * 60 * 60_000,
    24 * 60 * 60_000,
  ];
  for (const ms of candidates) {
    if (spanMs / ms <= 48) return ms;
  }
  return 24 * 60 * 60_000;
}

function formatTimelineBucketLabel(ms: number, bucketMs: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  if (bucketMs < 60 * 60_000) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (bucketMs < 24 * 60 * 60_000) {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One scatter point per dated event (kind lanes for Y). */
export function iosProcessEventsTimelinePoints(
  events: IosProcessEvent[]
): IosProcessEventTimelinePoint[] {
  const out: IosProcessEventTimelinePoint[] = [];
  const kindIndex = new Map<IosProcessEventKind, number>();
  for (const e of events) {
    const t = iosProcessEventTimeMs(e);
    if (t == null) continue;
    const i = kindIndex.get(e.kind) ?? 0;
    kindIndex.set(e.kind, i + 1);
    // Slight vertical jitter so coincident events remain visible.
    const jitter = ((i % 9) - 4) * 0.06;
    out.push({
      t,
      kind: e.kind,
      kindY: IOS_PROCESS_EVENT_KIND_LANE[e.kind] + jitter,
      name: e.name,
      when: e.when || formatProcessStarted(e.whenRaw) || e.whenRaw,
      parser: e.parser || "",
      pid: e.pid,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Stacked counts over adaptive time buckets (for dense snapshots / shutdown spikes). */
export function iosProcessEventsTimelineBuckets(
  events: IosProcessEvent[]
): IosProcessEventTimelineBucket[] {
  const timed: { t: number; kind: IosProcessEventKind }[] = [];
  for (const e of events) {
    const t = iosProcessEventTimeMs(e);
    if (t == null) continue;
    timed.push({ t, kind: e.kind });
  }
  if (!timed.length) return [];

  timed.sort((a, b) => a.t - b.t);
  const minT = timed[0]!.t;
  const maxT = timed[timed.length - 1]!.t;
  const span = Math.max(maxT - minT, 1);
  const bucketMs = chooseTimelineBucketMs(span);

  // Only emit buckets that contain events — filling every slot across a multi-year
  // span (e.g. epoch placeholders mixed with real times) can create tens of thousands
  // of empty bars and freeze Recharts.
  const buckets = new Map<number, IosProcessEventTimelineBucket>();
  for (const e of timed) {
    const key = Math.floor(e.t / bucketMs) * bucketMs;
    let b = buckets.get(key);
    if (!b) {
      b = {
        t: key,
        label: formatTimelineBucketLabel(key, bucketMs),
        start: 0,
        running: 0,
        snapshot: 0,
        shutdown: 0,
        other: 0,
        total: 0,
      };
      buckets.set(key, b);
    }
    b[e.kind] += 1;
    b.total += 1;
  }

  return [...buckets.values()].sort((a, b) => a.t - b.t);
}
