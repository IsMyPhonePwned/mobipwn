import { parseExt } from "@/lib/rowExt";
import { escapeMplString } from "@/lib/mplQuery";

export type CrashKind = "tombstone" | "anr" | "backtrace" | "crash";

export type CrashRow = Record<string, unknown>;

export function strField(row: CrashRow, key: string): string {
  const v = row[key];
  if (v == null) return "";
  return String(v).trim();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function nestedStr(obj: Record<string, unknown> | null, ...keys: string[]): string {
  if (!obj) return "";
  for (const key of keys) {
    const v = obj[key];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

export function classifyCrashRow(row: CrashRow): CrashKind {
  const dt = strField(row, "data_type").toLowerCase();
  const parser = strField(row, "parser").toLowerCase();
  const msg = strField(row, "message").toLowerCase();
  if (dt.includes("backtrace") || msg.includes("backtrace")) return "backtrace";
  if (strField(row, "function") && (parser === "crash" || dt.includes("tombstone"))) {
    return "backtrace";
  }
  if (dt.includes("tombstone") || msg.includes("tombstone")) return "tombstone";
  if (dt.includes("anr") || msg.includes("anr")) return "anr";
  // iOS .ips crashlogs from sysdiagnose-extractor-library
  if (parser === "crashlogs" || dt === "crashlogs" || msg.startsWith("crashlog:")) return "crash";
  if (strField(row, "function")) return "backtrace";
  return "crash";
}

export function crashKindLabel(kind: CrashKind): string {
  switch (kind) {
    case "tombstone":
      return "Native crash";
    case "anr":
      return "ANR";
    case "backtrace":
      return "Backtrace";
    default:
      return "Crash";
  }
}

export function crashKindBadgeClass(kind: CrashKind): string {
  switch (kind) {
    case "tombstone":
      return "case-crash-kind--tombstone";
    case "anr":
      return "case-crash-kind--anr";
    case "backtrace":
      return "case-crash-kind--backtrace";
    default:
      return "case-crash-kind--crash";
  }
}

export function shortDataType(dataType: string): string {
  const dt = dataType.trim();
  if (!dt) return "";
  const parts = dt.split(":");
  return parts[parts.length - 1] ?? dt;
}

export function summarizeCrashRows(rows: CrashRow[]) {
  const counts = { tombstone: 0, anr: 0, backtrace: 0, crash: 0 };
  for (const row of rows) {
    counts[classifyCrashRow(row)] += 1;
  }
  return counts;
}

export type SymbolStat = {
  process: string;
  function: string;
  bundle: string;
  count: number;
};

export type IosCrashFrame = {
  index: number;
  symbol: string;
  image: string;
  address: string;
  imageOffset: string;
  imageIndex: string;
  symbolLocation: string;
};

export type IosCrashImage = {
  index: number;
  name: string;
  uuid: string;
  arch: string;
  base: string;
};

export type IosCrashThread = {
  id: string;
  triggered: boolean;
  name: string;
  queue: string;
  frameCount: number;
  frames: IosCrashFrame[];
};

export type IosCrashStructure = {
  threadsTotal: number;
  threadsTruncated: boolean;
  framesTruncated: boolean;
  imagesTotal: number;
  imagesTruncated: boolean;
};

export type IosCrashField = {
  key: string;
  value: string;
};

export type IosCrashDetail = {
  process: string;
  bundle: string;
  exceptionType: string;
  exceptionCodes: string;
  signal: string;
  termination: string;
  reason: string;
  asi: string;
  pid: string;
  osVersion: string;
  appVersion: string;
  ipsFormat: string;
  crashPath: string;
  crashFile: string;
  faultingThread: string;
  threadName: string;
  threadQueue: string;
  threadsTotal: number;
  frameCount: number;
  frames: IosCrashFrame[];
  lastExceptionFrames: IosCrashFrame[];
  images: IosCrashImage[];
};

/** Full parser payload for the advanced crash explorer (no UI truncation). */
export type IosCrashAdvancedDetail = IosCrashDetail & {
  timestamp: string;
  message: string;
  key: string;
  threads: IosCrashThread[];
  structure: IosCrashStructure | null;
  reportRaw: string;
  reportFields: IosCrashField[];
  headerFields: IosCrashField[];
  exceptionFields: IosCrashField[];
  terminationFields: IosCrashField[];
  extJson: string;
};

function basenamePath(path: string): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function formatExceptionCodes(exception: Record<string, unknown> | null): string {
  if (!exception) return "";
  const codes = exception.codes;
  if (Array.isArray(codes)) {
    return codes.map(String).filter(Boolean).join(", ");
  }
  if (codes != null && String(codes).trim()) return String(codes).trim();
  const raw = exception.rawCodes ?? exception.subtype;
  if (raw != null && String(raw).trim()) return String(raw).trim();
  return "";
}

function formatAsi(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        const rec = asRecord(item);
        if (!rec) return "";
        return Object.values(rec)
          .map((v) => (v == null ? "" : String(v).trim()))
          .filter(Boolean)
          .join(": ");
      })
      .filter(Boolean)
      .join("\n");
  }
  const rec = asRecord(value);
  if (!rec) return String(value).trim();
  return Object.entries(rec)
    .map(([k, v]) => {
      const body = Array.isArray(v)
        ? v.map(String).join("\n")
        : v == null
          ? ""
          : String(v);
      return body ? `${k}: ${body}` : k;
    })
    .filter(Boolean)
    .join("\n");
}

function mapFrame(fr: unknown, fallbackIndex: number): IosCrashFrame {
  const f = asRecord(fr) ?? {};
  const offset = f.image_offset ?? f.imageOffset;
  const imageIndex = f.image_index ?? f.imageIndex;
  const symbolLocation = f.symbol_location ?? f.symbolLocation;
  return {
    index: numOr(f.index, fallbackIndex),
    symbol: nestedStr(f, "symbol", "symbolName") || "—",
    image: nestedStr(f, "image", "image_name", "name"),
    address: nestedStr(f, "address"),
    imageOffset: offset == null || offset === "" ? "" : String(offset),
    imageIndex: imageIndex == null || imageIndex === "" ? "" : String(imageIndex),
    symbolLocation:
      symbolLocation == null || symbolLocation === "" ? "" : String(symbolLocation),
  };
}

function mapFrameList(frames: unknown[], limit?: number): IosCrashFrame[] {
  const sliced = limit == null ? frames : frames.slice(0, limit);
  return sliced.map((fr, i) => mapFrame(fr, i));
}

function mapThread(th: unknown, fallbackId: number): IosCrashThread {
  const t = asRecord(th) ?? {};
  const frames = asArray(t.frames);
  return {
    id: t.id == null || t.id === "" ? String(fallbackId) : String(t.id),
    triggered: t.triggered === true,
    name: nestedStr(t, "name"),
    queue: nestedStr(t, "queue", "dispatch_queue"),
    frameCount: numOr(t.frame_count, frames.length),
    frames: mapFrameList(frames),
  };
}

function mapImage(img: unknown, fallbackIndex: number): IosCrashImage {
  const o = asRecord(img) ?? {};
  return {
    index: numOr(o.index, fallbackIndex),
    name: nestedStr(o, "name", "path") || "—",
    uuid: nestedStr(o, "uuid"),
    arch: nestedStr(o, "arch"),
    base: nestedStr(o, "base"),
  };
}

const SKIP_SCALAR_KEYS = new Set([
  "threads",
  "used_images",
  "usedImages",
  "last_exception_backtrace",
  "lastExceptionBacktrace",
  "exception",
  "termination",
  "report",
  "report_raw",
  "crash_structure",
  "asi",
  "ASI",
  "frames",
]);

function flattenScalarFields(
  obj: Record<string, unknown> | null,
  opts?: { prefix?: string; skip?: Set<string> }
): IosCrashField[] {
  if (!obj) return [];
  const skip = opts?.skip ?? SKIP_SCALAR_KEYS;
  const prefix = opts?.prefix ?? "";
  const out: IosCrashField[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "object") {
      // Keep compact one-liners for small nested scalars (e.g. storeInfo.appVersion).
      const nested = asRecord(v);
      if (nested) {
        for (const field of flattenScalarFields(nested, {
          prefix: `${prefix}${k}.`,
          skip,
        })) {
          out.push(field);
        }
      } else if (Array.isArray(v) && v.every((x) => typeof x !== "object")) {
        const joined = v.map(String).filter(Boolean).join(", ");
        if (joined) out.push({ key: `${prefix}${k}`, value: joined });
      }
      continue;
    }
    const s = String(v).trim();
    if (!s) continue;
    out.push({ key: `${prefix}${k}`, value: s });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function faultingThreadRecord(ext: Record<string, unknown>): Record<string, unknown> | null {
  const threads = asArray(ext.threads);
  if (!threads.length) return null;

  const faultingRaw = ext.faulting_thread;
  const faulting =
    typeof faultingRaw === "number"
      ? faultingRaw
      : typeof faultingRaw === "string" && faultingRaw.trim()
        ? Number(faultingRaw)
        : null;

  const thread =
    threads.find((t) => asRecord(t)?.triggered === true) ||
    (faulting != null && Number.isFinite(faulting)
      ? threads.find((t) => {
          const id = asRecord(t)?.id;
          return id != null && Number(id) === faulting;
        })
      : null) ||
    threads[0];

  return asRecord(thread);
}

/** Structured iOS .ips fields stored in `ext` (+ promoted columns). */
export function iosCrashDetail(row: CrashRow): IosCrashDetail {
  const ext = parseExt(row);
  const exception = asRecord(ext.exception) ?? asRecord(asRecord(ext.report)?.exception);
  const termination =
    asRecord(ext.termination) ?? asRecord(asRecord(ext.report)?.termination);
  const report = asRecord(ext.report);
  const structure = asRecord(ext.crash_structure);
  const thread = faultingThreadRecord(ext);

  const process =
    strField(row, "process_name") ||
    nestedStr(report, "procName") ||
    nestedStr(ext, "procName", "app_name", "name") ||
    strField(row, "bundle_id") ||
    "—";
  const bundle =
    strField(row, "bundle_id") ||
    nestedStr(ext, "bundleIdentifier", "bundleID", "bundleId") ||
    nestedStr(report, "bundleID", "bundleIdentifier", "coalitionName");

  const exceptionType = nestedStr(exception, "type") || nestedStr(ext, "exception");
  const exceptionCodes = formatExceptionCodes(exception);
  const signal =
    strField(row, "action") ||
    nestedStr(exception, "signal") ||
    nestedStr(ext, "signal");
  const terminationText =
    nestedStr(termination, "indicator", "namespace", "code") ||
    (termination
      ? [termination.indicator, termination.namespace, termination.code]
          .filter((x) => x != null && String(x).trim())
          .map(String)
          .join(" / ")
      : "");
  const reason =
    nestedStr(report, "reason") ||
    nestedStr(ext, "reason") ||
    nestedStr(termination, "reason");
  const asi = formatAsi(report?.asi ?? ext.asi ?? report?.ASI);

  const pid =
    nestedStr(report, "pid", "procid") ||
    (report?.pid != null ? String(report.pid) : "") ||
    nestedStr(ext, "pid");
  const osVersion =
    nestedStr(report, "osVersion", "os_version") ||
    nestedStr(ext, "osVersion", "os_version");
  const appVersion =
    nestedStr(report, "appVersion", "bundleVersion", "CFBundleVersion", "version") ||
    nestedStr(asRecord(report?.storeInfo), "appVersion", "applicationVersion");

  const crashPath =
    nestedStr(ext, "crash_source", "file_path", "path", "source") ||
    strField(row, "file_path");
  const ipsFormat = nestedStr(ext, "ips_format") || strField(row, "ips_format");
  const faultingThread =
    nestedStr(ext, "faulting_thread") ||
    (ext.faulting_thread != null ? String(ext.faulting_thread) : "") ||
    (thread?.id != null ? String(thread.id) : "");
  const threadName = nestedStr(thread, "name");
  const threadQueue = nestedStr(thread, "queue", "dispatch_queue");
  const threadsTotal = numOr(structure?.threads_total, asArray(ext.threads).length);

  const frames = iosStackFrames(row);
  const lastExceptionFrames = iosLastExceptionFrames(row, 16);
  const images = iosUsedImages(row, 12);

  return {
    process,
    bundle,
    exceptionType,
    exceptionCodes,
    signal,
    termination: terminationText,
    reason,
    asi,
    pid,
    osVersion,
    appVersion,
    ipsFormat,
    crashPath,
    crashFile: basenamePath(crashPath),
    faultingThread,
    threadName,
    threadQueue,
    threadsTotal,
    frameCount: frames.length,
    frames,
    lastExceptionFrames,
    images,
  };
}

export function iosStackFrames(row: CrashRow, limit = 24): IosCrashFrame[] {
  const ext = parseExt(row);
  const thread = faultingThreadRecord(ext);
  if (!thread) return [];
  return mapFrameList(asArray(thread.frames), limit);
}

export function iosLastExceptionFrames(row: CrashRow, limit = 16): IosCrashFrame[] {
  const ext = parseExt(row);
  return mapFrameList(asArray(ext.last_exception_backtrace), limit);
}

export function iosAllThreads(row: CrashRow): IosCrashThread[] {
  const ext = parseExt(row);
  return asArray(ext.threads).map((th, i) => mapThread(th, i));
}

export function iosUsedImages(row: CrashRow, limit?: number): IosCrashImage[] {
  const ext = parseExt(row);
  const images = asArray(ext.used_images);
  const sliced = limit == null ? images : images.slice(0, limit);
  return sliced
    .map((img, i) => mapImage(img, i))
    .filter((img) => img.name && img.name !== "—");
}

export function iosCrashKey(row: CrashRow): string {
  const detail = iosCrashDetail(row);
  const ts = strField(row, "timestamp");
  return detail.crashPath || detail.crashFile || `${ts}|${detail.process}|${detail.pid}`;
}

export function iosCrashStructure(row: CrashRow): IosCrashStructure | null {
  const structure = asRecord(parseExt(row).crash_structure);
  if (!structure) return null;
  return {
    threadsTotal: numOr(structure.threads_total, 0),
    threadsTruncated: structure.threads_truncated === true,
    framesTruncated: structure.frames_truncated === true,
    imagesTotal: numOr(structure.images_total, 0),
    imagesTruncated: structure.images_truncated === true,
  };
}

/** Full iOS crash explorer payload — all threads, images, and scalar metadata. */
export function iosCrashAdvancedDetail(row: CrashRow): IosCrashAdvancedDetail {
  const base = iosCrashDetail(row);
  const ext = parseExt(row);
  const exception = asRecord(ext.exception) ?? asRecord(asRecord(ext.report)?.exception);
  const termination =
    asRecord(ext.termination) ?? asRecord(asRecord(ext.report)?.termination);
  const report = asRecord(ext.report);
  const threads = iosAllThreads(row);
  const images = iosUsedImages(row);
  const lastExceptionFrames = iosLastExceptionFrames(row);
  const structure = iosCrashStructure(row);
  const reportRaw =
    typeof ext.report_raw === "string"
      ? ext.report_raw
      : ext.report_raw != null
        ? JSON.stringify(ext.report_raw, null, 2)
        : "";

  const headerSkip = new Set([
    ...SKIP_SCALAR_KEYS,
    "crash_source",
    "file_path",
    "path",
    "source",
    "process_name",
    "bundle_id",
    "bundleIdentifier",
    "bundleID",
    "bundleId",
    "function",
    "symbol",
    "signal",
    "action",
    "event_type",
    "parser",
    "datetime",
    "timestamp",
    "timestamp_desc",
    "message",
    "data_type",
    "severity",
    "platform",
  ]);

  let extJson = "";
  try {
    extJson = JSON.stringify(ext, null, 2);
  } catch {
    extJson = "";
  }

  return {
    ...base,
    frames: iosStackFrames(row),
    lastExceptionFrames,
    images,
    threadsTotal: structure?.threadsTotal || threads.length || base.threadsTotal,
    frameCount: threads.find((t) => t.triggered)?.frames.length ?? base.frameCount,
    timestamp: strField(row, "timestamp"),
    message: strField(row, "message"),
    key: iosCrashKey(row),
    threads,
    structure,
    reportRaw,
    reportFields: flattenScalarFields(report),
    headerFields: flattenScalarFields(ext, { skip: headerSkip }),
    exceptionFields: flattenScalarFields(exception, { skip: new Set() }),
    terminationFields: flattenScalarFields(termination, { skip: new Set() }),
    extJson,
  };
}

function numOr(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function topCrashSymbols(rows: CrashRow[], limit = 10): SymbolStat[] {
  const map = new Map<string, SymbolStat>();
  const bump = (process: string, fn: string, bundle: string) => {
    if (!fn || fn === "—") return;
    const key = `${process}\0${fn}`;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { process, function: fn, bundle, count: 1 });
  };

  for (const row of rows) {
    const process = strField(row, "process_name") || strField(row, "bundle_id") || "—";
    const bundle = strField(row, "bundle_id");
    const promoted = strField(row, "function");
    if (promoted) bump(process, promoted, bundle);

    // Walk faulting-thread frames when present (iOS structured .ips).
    for (const fr of iosStackFrames(row, 12)) {
      if (fr.symbol && fr.symbol !== "—") bump(process, fr.symbol, bundle);
    }
    // Android tombstone / ANR frames from nested ext.
    for (const fr of androidTombstoneFrames(row, 12)) {
      const sym = fr.function || fr.method;
      if (sym) bump(process, sym, bundle);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Android Crash parser (tombstone / ANR)
// ---------------------------------------------------------------------------

export type AndroidCrashFrame = {
  index: number;
  function: string;
  library: string;
  pc: string;
  offset: string;
  buildId: string;
  rawLine: string;
  frameType: string;
  method: string;
  fileLoc: string;
  lineNumber: string;
  address: string;
  details: string;
};

export type AndroidCrashThread = {
  id: string;
  name: string;
  tid: string;
  priority: string;
  status: string;
  isDaemon: boolean;
  frameCount: number;
  frames: AndroidCrashFrame[];
};

export type AndroidCrashDetail = {
  kind: CrashKind;
  process: string;
  signal: string;
  code: string;
  faultAddr: string;
  abortMessage: string;
  pid: string;
  tid: string;
  uid: string;
  threadName: string;
  cmdline: string;
  abi: string;
  buildFingerprint: string;
  filename: string;
  subject: string;
  size: string;
  owner: string;
  group: string;
  permissions: string;
  frameCount: number;
  frames: AndroidCrashFrame[];
  threadsTotal: number;
};

export type AndroidCrashAdvancedDetail = AndroidCrashDetail & {
  timestamp: string;
  message: string;
  key: string;
  threads: AndroidCrashThread[];
  processInfoFields: IosCrashField[];
  headerFields: IosCrashField[];
  metadataFields: IosCrashField[];
  extJson: string;
};

function mapAndroidNativeFrame(fr: unknown, fallbackIndex: number): AndroidCrashFrame {
  const f = asRecord(fr) ?? {};
  const frameNum = numOr(f.frame, fallbackIndex);
  return {
    index: frameNum >= 0 ? frameNum : fallbackIndex,
    function: nestedStr(f, "function") || nestedStr(f, "method"),
    library: nestedStr(f, "library"),
    pc: nestedStr(f, "pc"),
    offset: nestedStr(f, "offset"),
    buildId: nestedStr(f, "build_id", "buildId"),
    rawLine: nestedStr(f, "raw_line", "rawLine"),
    frameType: nestedStr(f, "frame_type", "frameType"),
    method: nestedStr(f, "method"),
    fileLoc: nestedStr(f, "file_loc", "fileLoc"),
    lineNumber:
      f.line_number != null && String(f.line_number).trim()
        ? String(f.line_number)
        : f.lineNumber != null
          ? String(f.lineNumber)
          : "",
    address: nestedStr(f, "address"),
    details: nestedStr(f, "details"),
  };
}

function mapAndroidAnrFrame(fr: unknown, fallbackIndex: number): AndroidCrashFrame {
  const f = asRecord(fr) ?? {};
  const method = nestedStr(f, "method");
  const library = nestedStr(f, "library");
  const fileLoc = nestedStr(f, "file_loc", "fileLoc");
  const line =
    f.line_number != null && Number(f.line_number) > 0
      ? String(f.line_number)
      : f.lineNumber != null && Number(f.lineNumber) > 0
        ? String(f.lineNumber)
        : "";
  const details = nestedStr(f, "details");
  const display =
    method ||
    details ||
    [library, fileLoc && line ? `${fileLoc}:${line}` : fileLoc].filter(Boolean).join(" ");
  return {
    index: fallbackIndex,
    function: display,
    library,
    pc: "",
    offset: "",
    buildId: "",
    rawLine: details,
    frameType: nestedStr(f, "frame_type", "frameType") || "managed",
    method,
    fileLoc,
    lineNumber: line,
    address: nestedStr(f, "address"),
    details,
  };
}

function mapAndroidAnrThread(th: unknown, fallbackId: number): AndroidCrashThread {
  const t = asRecord(th) ?? {};
  const stack = asArray(t.stack_trace ?? t.stackTrace);
  const tid = t.tid != null ? String(t.tid) : "";
  return {
    id: tid || nestedStr(t, "name") || String(fallbackId),
    name: nestedStr(t, "name") || `thread ${fallbackId}`,
    tid,
    priority: t.priority != null ? String(t.priority) : "",
    status: nestedStr(t, "status", "state"),
    isDaemon: t.is_daemon === true || t.isDaemon === true,
    frameCount: stack.length,
    frames: stack.map((fr, i) => mapAndroidAnrFrame(fr, i)),
  };
}

/** Native backtrace frames nested on a tombstone row (`ext.backtrace`). */
export function androidTombstoneFrames(row: CrashRow, limit?: number): AndroidCrashFrame[] {
  const ext = parseExt(row);
  const bt = asArray(ext.backtrace);
  if (!bt.length) return [];
  const sliced = limit == null ? bt : bt.slice(0, limit);
  return sliced.map((fr, i) => mapAndroidNativeFrame(fr, i));
}

/** ANR VM-trace threads with managed/native stacks. */
export function androidAnrThreads(row: CrashRow): AndroidCrashThread[] {
  const ext = parseExt(row);
  return asArray(ext.threads).map((th, i) => mapAndroidAnrThread(th, i));
}

/** Join sibling `tombstone_frame` rows when nested backtrace is missing. */
export function androidFramesFromSiblings(
  tombstoneRow: CrashRow,
  allRows: CrashRow[],
  limit = 64
): AndroidCrashFrame[] {
  const nested = androidTombstoneFrames(tombstoneRow, limit);
  if (nested.length) return nested;

  const process =
    strField(tombstoneRow, "process_name") ||
    nestedStr(parseExt(tombstoneRow), "process_name", "tombstone_process");
  const ts = strField(tombstoneRow, "timestamp");
  const out: AndroidCrashFrame[] = [];
  for (const row of allRows) {
    if (classifyCrashRow(row) !== "backtrace") continue;
    const ext = parseExt(row);
    const proc =
      nestedStr(ext, "tombstone_process") ||
      strField(row, "process_name");
    if (process && proc && proc !== process) continue;
    if (ts && strField(row, "timestamp") && strField(row, "timestamp") !== ts) continue;
    out.push(mapAndroidNativeFrame(ext, out.length));
    if (out.length >= limit) break;
  }
  return out;
}

export function androidRecentFrames(
  rows: CrashRow[],
  limit = 16
): { row: CrashRow; frame: AndroidCrashFrame; process: string }[] {
  const out: { row: CrashRow; frame: AndroidCrashFrame; process: string }[] = [];
  for (const row of crashIncidents(rows)) {
    const detail = androidCrashDetail(row, rows);
    for (const frame of detail.frames.slice(0, 8)) {
      out.push({ row, frame, process: detail.process });
      if (out.length >= limit) return out;
    }
  }
  // Fall back to standalone frame events.
  for (const row of backtraceFrames(rows, limit)) {
    const ext = parseExt(row);
    const frame = mapAndroidNativeFrame(
      {
        ...ext,
        function: strField(row, "function") || nestedStr(ext, "function"),
        library: nestedStr(ext, "library"),
      },
      out.length
    );
    const process =
      nestedStr(ext, "tombstone_process") ||
      strField(row, "process_name") ||
      "—";
    out.push({ row, frame, process });
    if (out.length >= limit) break;
  }
  return out;
}

/** Structured Android tombstone / ANR fields from `ext` (+ promoted columns). */
export function androidCrashDetail(row: CrashRow, allRows?: CrashRow[]): AndroidCrashDetail {
  const kind = classifyCrashRow(row);
  const ext = parseExt(row);
  const processInfo = asRecord(ext.process_info) ?? asRecord(ext.processInfo);
  const header = asRecord(ext.header);

  const process =
    strField(row, "process_name") ||
    nestedStr(ext, "process_name", "tombstone_process") ||
    nestedStr(processInfo, "cmd_line", "cmdLine", "process_name") ||
    nestedStr(ext, "filename") ||
    nestedStr(header, "subject") ||
    "—";

  const signal =
    nestedStr(ext, "signal") ||
    (kind === "tombstone" ? strField(row, "action") : "") ||
    "";
  const code = nestedStr(ext, "code");
  const faultAddr = nestedStr(ext, "fault_addr", "faultAddr");
  const abortMessage = nestedStr(ext, "abort_message", "abortMessage");
  const pid =
    nestedStr(ext, "pid") ||
    (ext.pid != null ? String(ext.pid) : "") ||
    (strField(row, "process_id") ? strField(row, "process_id") : "");
  const tid = nestedStr(ext, "tid") || (ext.tid != null ? String(ext.tid) : "");
  const uid = nestedStr(ext, "uid") || (ext.uid != null ? String(ext.uid) : "");
  const threadName = nestedStr(ext, "thread_name", "threadName");
  const cmdline = nestedStr(ext, "cmdline", "cmd_line") || nestedStr(processInfo, "cmd_line", "cmdLine");
  const abi = nestedStr(ext, "abi") || nestedStr(processInfo, "abi");
  const buildFingerprint =
    nestedStr(ext, "build_fingerprint", "buildFingerprint") ||
    nestedStr(processInfo, "build_fingerprint", "buildFingerprint");
  const filename = nestedStr(ext, "filename") || (kind === "anr" ? strField(row, "action") : "");
  const subject = nestedStr(header, "subject");
  const size = ext.size != null ? String(ext.size) : "";
  const owner = nestedStr(ext, "owner");
  const group = nestedStr(ext, "group");
  const permissions = nestedStr(ext, "permissions");

  const anrThreads = androidAnrThreads(row);
  const frames =
    kind === "anr" && anrThreads.length
      ? anrThreads[0]?.frames ?? []
      : allRows
        ? androidFramesFromSiblings(row, allRows, 24)
        : androidTombstoneFrames(row, 24);

  return {
    kind,
    process,
    signal,
    code,
    faultAddr,
    abortMessage,
    pid,
    tid,
    uid,
    threadName,
    cmdline,
    abi,
    buildFingerprint,
    filename,
    subject,
    size,
    owner,
    group,
    permissions,
    frameCount: frames.length,
    frames,
    threadsTotal: anrThreads.length,
  };
}

export function androidCrashKey(row: CrashRow): string {
  const detail = androidCrashDetail(row);
  const ts = strField(row, "timestamp");
  const dt = strField(row, "data_type");
  if (detail.filename) return `anr-file:${detail.filename}`;
  if (detail.subject) return `anr-trace:${detail.subject}|${ts}`;
  return `${dt}|${ts}|${detail.process}|${detail.pid}|${detail.signal}`;
}

/** Full Android crash explorer payload. */
export function androidCrashAdvancedDetail(
  row: CrashRow,
  allRows?: CrashRow[]
): AndroidCrashAdvancedDetail {
  const base = androidCrashDetail(row, allRows);
  const ext = parseExt(row);
  const processInfo = asRecord(ext.process_info) ?? asRecord(ext.processInfo);
  const header = asRecord(ext.header);
  const threads =
    base.kind === "anr"
      ? androidAnrThreads(row)
      : base.frames.length
        ? [
            {
              id: base.tid || "0",
              name: base.threadName || "crashing thread",
              tid: base.tid,
              priority: "",
              status: "",
              isDaemon: false,
              frameCount: base.frames.length,
              frames: allRows
                ? androidFramesFromSiblings(row, allRows)
                : androidTombstoneFrames(row),
            } satisfies AndroidCrashThread,
          ]
        : [];

  const skip = new Set([
    "backtrace",
    "threads",
    "header",
    "process_info",
    "processInfo",
    "stack_trace",
    "stackTrace",
  ]);

  let extJson = "";
  try {
    extJson = JSON.stringify(ext, null, 2);
  } catch {
    extJson = "";
  }

  return {
    ...base,
    frames:
      threads[0]?.frames ??
      (allRows ? androidFramesFromSiblings(row, allRows) : androidTombstoneFrames(row)),
    frameCount: threads.reduce((n, t) => n + t.frames.length, 0) || base.frameCount,
    threadsTotal: threads.length || base.threadsTotal,
    timestamp: strField(row, "timestamp"),
    message: strField(row, "message"),
    key: androidCrashKey(row),
    threads,
    processInfoFields: flattenScalarFields(processInfo, { skip: new Set() }),
    headerFields: flattenScalarFields(header, { skip: new Set() }),
    metadataFields: flattenScalarFields(ext, { skip }),
    extJson,
  };
}

export function crashIncidents(rows: CrashRow[]): CrashRow[] {
  return rows.filter((row) => {
    const kind = classifyCrashRow(row);
    return kind === "tombstone" || kind === "anr" || kind === "crash";
  });
}

export function backtraceFrames(rows: CrashRow[], limit = 24): CrashRow[] {
  return rows.filter((row) => classifyCrashRow(row) === "backtrace").slice(0, limit);
}

/** Flatten iOS stack frames across crash incidents for the “Recent frames” list. */
export function iosRecentFrames(
  rows: CrashRow[],
  limit = 16
): { row: CrashRow; frame: IosCrashFrame; process: string }[] {
  const out: { row: CrashRow; frame: IosCrashFrame; process: string }[] = [];
  for (const row of crashIncidents(rows)) {
    const process = iosCrashDetail(row).process;
    for (const frame of iosStackFrames(row, 6)) {
      out.push({ row, frame, process });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function formatCrashTimestamp(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function crashTracesQuery(
  source: string,
  platform: "android" | "ios" | "endpoint" = "android",
  opts?: { head?: number }
): string {
  const src = source.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const head = opts?.head ?? (platform === "ios" ? 80 : 80);
  if (platform === "ios") {
    return `source="${src}" parser="crashlogs" | fields timestamp, bundle_id, process_name, function, action, message, data_type, severity, ips_format, file_path, ext | sort -timestamp | head ${head}`;
  }
  return `source="${src}" parser="Crash" (function=* OR data_type=*tombstone* OR data_type=*anr* OR data_type=*backtrace* OR process_name=*) | fields timestamp, bundle_id, process_name, function, action, message, data_type, severity, process_id, ext | sort -timestamp | head ${head}`;
}

/** Stable path to the advanced crash explorer for a case (iOS or Android). */
export function caseCrashAdvancedHref(caseId: string, crashKey?: string): string {
  const base = `/cases/${encodeURIComponent(caseId)}/crashes`;
  if (!crashKey) return base;
  return `${base}?crash=${encodeURIComponent(crashKey)}`;
}

/** @deprecated Prefer {@link caseCrashAdvancedHref} */
export function caseIosCrashAdvancedHref(caseId: string, crashKey?: string): string {
  return caseCrashAdvancedHref(caseId, crashKey);
}

function crashParserFilter(platform: "android" | "ios" | "endpoint" = "android"): string {
  return platform === "ios" ? 'parser="crashlogs"' : 'parser="Crash"';
}

export function crashSearchQuery(
  row: CrashRow,
  scope: string,
  platform: "android" | "ios" | "endpoint" = "android"
): string {
  const kind = classifyCrashRow(row);
  const fn = strField(row, "function");
  const process = strField(row, "process_name");
  const bundle = strField(row, "bundle_id");
  const dt = strField(row, "data_type");
  const iosDetail = platform === "ios" ? iosCrashDetail(row) : null;
  const androidDetail = platform !== "ios" ? androidCrashDetail(row) : null;

  let filter = crashParserFilter(platform);
  if (kind === "backtrace" && fn) {
    filter += ` ${wildcardFieldQuery("function", fn)}`;
  } else if (iosDetail?.signal) {
    filter += ` action="${escapeMplString(iosDetail.signal)}"`;
  } else if (androidDetail?.signal) {
    filter += ` action="${escapeMplString(androidDetail.signal)}"`;
  } else if (androidDetail?.filename) {
    filter += ` ${wildcardFieldQuery("action", androidDetail.filename)}`;
  } else if (process || iosDetail?.process || androidDetail?.process) {
    const p = process || iosDetail?.process || androidDetail?.process || "";
    if (p && p !== "—") {
      filter += ` process_name="${escapeMplString(p)}"`;
    }
  } else if (bundle) {
    filter += ` bundle_id="${escapeMplString(bundle)}"`;
  } else if (dt) {
    filter += ` ${wildcardFieldQuery("data_type", dt)}`;
  }

  return `${scope} ${filter}`;
}

export function symbolSearchQuery(
  stat: SymbolStat,
  scope: string,
  platform: "android" | "ios" | "endpoint" = "android"
): string {
  return `${scope} ${crashParserFilter(platform)} ${wildcardFieldQuery("function", stat.function)}`;
}

function wildcardFieldQuery(field: string, value: string): string {
  return `${field}="*${escapeMplString(value)}*"`;
}
