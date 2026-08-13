import { escapeMplString } from "@/lib/mplQuery";
import { formatRowTimestamp, parseExt, strField } from "@/lib/rowExt";

export type IosLockKind = "unlocked" | "locked" | "autolock" | "failed" | "unknown";

export type IosLockExtra = {
  label: string;
  value: string;
};

export type IosLockEvent = {
  kind: IosLockKind;
  /** Full localized date + time (e.g. "Apr 7, 2025 · 08:10:00"). */
  when: string;
  /** Date only (e.g. "Apr 7, 2025"). */
  whenDate: string;
  /** Time only (e.g. "08:10:00"). */
  whenTime: string;
  /** ISO / raw timestamp for `<time datetime>`. */
  whenRaw: string;
  /** Absolute epoch ms when known (for sorting / display). */
  timestampMs: number | null;
  source: string;
  status: string;
  detail: string;
  message: string;
  parser: string;
  activity: string;
  apolloModule: string;
  sourceDb: string;
  extras: IosLockExtra[];
  sortKey: number;
};

export type IosLockStateSummary = {
  unlocked: number;
  locked: number;
  autolock: number;
  failed: number;
  lastUnlocked: string;
  lastLocked: string;
  lastFailed: string;
};

function extStr(ext: Record<string, unknown>, ...keys: string[]): string {
  const lowerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(ext)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    lowerMap.set(k.toLowerCase(), s);
  }
  for (const key of keys) {
    const hit = lowerMap.get(key.toLowerCase());
    if (hit) return hit;
  }
  return "";
}

function resolveLockDate(row: Record<string, unknown>): Date | null {
  const ext = parseExt(row);
  const candidates = [
    strField(row, "datetime"),
    strField(row, "timestamp"),
    extStr(ext, "adjusted_timestamp", "ADJUSTED_TIMESTAMP", "START", "start"),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    // ClickHouse DateTime string "2026-07-08 12:56:49.000000"
    const normalized =
      raw.includes("T") || /[+-]\d{2}:?\d{2}$/.test(raw) || raw.endsWith("Z")
        ? raw
        : `${raw.replace(" ", "T")}Z`;
    const asIso = new Date(normalized);
    if (!Number.isNaN(asIso.getTime()) && asIso.getFullYear() > 2000) return asIso;

    const d = new Date(raw);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2000) return d;

    const ts = Number(raw);
    if (!Number.isNaN(ts) && ts > 0) {
      const ms = ts > 1e14 ? Math.floor(ts / 1e3) : ts < 1e12 ? ts * 1000 : ts;
      const fromNum = new Date(ms);
      if (!Number.isNaN(fromNum.getTime()) && fromNum.getFullYear() > 2000) return fromNum;
    }
  }
  return null;
}

/** Explicit calendar date + clock time for lock/unlock rows. */
export function formatLockEventParts(row: Record<string, unknown>): {
  when: string;
  whenDate: string;
  whenTime: string;
  whenRaw: string;
  timestampMs: number | null;
} {
  const d = resolveLockDate(row);
  if (!d) {
    const fallback = formatRowTimestamp(row);
    return {
      when: fallback,
      whenDate: fallback,
      whenTime: "",
      whenRaw: strField(row, "datetime") || strField(row, "timestamp"),
      timestampMs: null,
    };
  }
  const whenDate = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const whenTime = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return {
    when: `${whenDate} · ${whenTime}`,
    whenDate,
    whenTime,
    whenRaw: d.toISOString(),
    timestampMs: d.getTime(),
  };
}

function scrapeMessageValue(message: string, key: string): string {
  const lowerMsg = message.toLowerCase();
  const lowerKey = key.toLowerCase();
  const patterns = [`, ${lowerKey}=`, `: ${lowerKey}=`, `:${lowerKey}=`];
  for (const needle of patterns) {
    const idx = lowerMsg.indexOf(needle);
    if (idx < 0) continue;
    const rest = message.slice(idx + needle.length);
    const token = rest.split(",")[0]?.trim() ?? "";
    if (token) return token;
  }
  return "";
}

function sortKey(row: Record<string, unknown>): number {
  const d = resolveLockDate(row);
  return d ? d.getTime() : 0;
}

function normalizeLockKind(raw: string): IosLockKind {
  const v = raw.trim().toLowerCase().replace(/_/g, " ");
  if (!v) return "unknown";
  // Activity titles alone are not a lock/unlock state.
  if (v === "lock state" || v === "device lock status" || v === "screen unlock state") {
    return "unknown";
  }
  if (v.includes("fail") || v.includes("denied") || v.includes("lockout")) return "failed";
  if (v.includes("unlock") || v === "0" || v === "device unlocked") return "unlocked";
  if ((v.includes("lock") && !v.includes("unlock")) || v === "1" || v === "device locked") {
    return "locked";
  }
  if (v.includes("autolock") || v.includes("auto lock")) return "autolock";
  return "unknown";
}

function looksLikeSensibleTimestamp(value: string): boolean {
  if (!value) return false;
  if (/^1970-/.test(value)) return false;
  const d = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return !Number.isNaN(d.getTime()) && d.getFullYear() > 2000;
}

function pushExtra(extras: IosLockExtra[], label: string, value: string) {
  const v = value.trim();
  if (!v) return;
  if (extras.some((e) => e.label === label && e.value === v)) return;
  extras.push({ label, value: v });
}

function collectLockExtras(
  row: Record<string, unknown>,
  ext: Record<string, unknown>,
  message: string
): IosLockExtra[] {
  const extras: IosLockExtra[] = [];
  const adjusted =
    extStr(ext, "adjusted_timestamp", "ADJUSTED_TIMESTAMP") ||
    scrapeMessageValue(message, "ADJUSTED_TIMESTAMP");
  if (looksLikeSensibleTimestamp(adjusted)) {
    pushExtra(extras, "Adjusted", adjusted);
  }

  const original =
    extStr(ext, "original_lockstate_timestamp", "ORIGINAL_LOCKSTATE_TIMESTAMP") ||
    scrapeMessageValue(message, "ORIGINAL_LOCKSTATE_TIMESTAMP");
  if (looksLikeSensibleTimestamp(original)) {
    pushExtra(extras, "Original", original);
  }

  const end = extStr(ext, "END", "end") || scrapeMessageValue(message, "END");
  if (looksLikeSensibleTimestamp(end)) {
    pushExtra(extras, "End", end);
  }

  const usageSec =
    extStr(ext, "USAGE IN SECONDS", "usage_in_seconds", "usage in seconds") ||
    scrapeMessageValue(message, "USAGE IN SECONDS");
  if (usageSec) pushExtra(extras, "Duration", `${usageSec}s`);

  const day =
    extStr(ext, "DAY OF WEEK", "day_of_week", "day of week") ||
    scrapeMessageValue(message, "DAY OF WEEK");
  if (day) pushExtra(extras, "Day", day);

  const deviceId =
    extStr(ext, "DEVICE ID", "device_id", "device id") || scrapeMessageValue(message, "DEVICE ID");
  if (deviceId) pushExtra(extras, "Device", deviceId);

  const autoLock =
    strField(row, "auto_lock_type") ||
    extStr(ext, "AUTO LOCK TYPE", "auto_lock_type", "auto lock type") ||
    scrapeMessageValue(message, "AUTO LOCK TYPE");
  if (autoLock) pushExtra(extras, "Auto-lock", autoLock);

  const gmt =
    extStr(ext, "GMT OFFSET", "gmt_offset", "gmt offset") ||
    scrapeMessageValue(message, "GMT OFFSET");
  if (gmt) pushExtra(extras, "GMT", gmt);

  const tableId = extStr(
    ext,
    "plspringboardagent_eventforward_sblock table id",
    "PLSPRINGBOARDAGENT_EVENTFORWARD_SBLOCK TABLE ID",
    "lockstate_id"
  );
  if (tableId) pushExtra(extras, "Event ID", tableId);

  const sourceDb = extStr(ext, "source_db");
  if (sourceDb) {
    const short = sourceDb.split("/").pop() || sourceDb;
    pushExtra(extras, "DB", short);
  }

  return extras;
}

/** Classify a powerlogs / knowledgec / logarchive / lockdownd auth row. */
export function parseIosLockEvent(row: Record<string, unknown>): IosLockEvent | null {
  const message = strField(row, "message");
  const desc = strField(row, "timestamp_desc");
  const parser = strField(row, "parser").toLowerCase();
  const ext = parseExt(row);
  const apollo = extStr(ext, "apollo_module");
  const eventType =
    strField(row, "event_type") || extStr(ext, "event_type");

  const authSuccessRaw =
    strField(row, "auth_success") ||
    strField(row, "success") ||
    extStr(ext, "auth_success", "success");
  const authSuccess =
    authSuccessRaw === "true" || authSuccessRaw === "1"
      ? true
      : authSuccessRaw === "false" || authSuccessRaw === "0"
        ? false
        : null;

  // Boot noise / companion stubs — never treat as lock-screen auth outcomes.
  const isAuthNoise =
    /before first unlock/i.test(message) ||
    /companions not supported/i.test(message) ||
    /Code=-1000/i.test(message);

  if (isAuthNoise) {
    return null;
  }

  const looksLikeAuthFailure =
    authSuccess === false ||
    /processed authentication request \(success\s*=\s*no\)/i.test(message) ||
    /unlock attempt succeeded:\s*no/i.test(message) ||
    /identity match failed/i.test(message) ||
    /processMatchFailReason/i.test(message) ||
    /passcode authentication failed/i.test(message) ||
    /biometry is locked/i.test(message) ||
    /needs passcode bio lockout/i.test(message) ||
    (/code=-8/i.test(message) && /biom/i.test(message) && /locked out/i.test(message)) ||
    /device authentication is (now )?locked out/i.test(message);

  const looksLikeAuthSuccess =
    authSuccess === true ||
    /processed authentication request \(success\s*=\s*yes\)/i.test(message) ||
    /unlock attempt succeeded:\s*yes/i.test(message) ||
    /passcode authentication succeeded/i.test(message) ||
    /bio unlocked/i.test(message);

  const isAuthEvent =
    eventType === "authentication_event" ||
    looksLikeAuthFailure ||
    looksLikeAuthSuccess ||
    /^Authentication (Failed|Succeeded)$/i.test(desc);

  const isLockActivity =
    isAuthEvent ||
    /^Lock State$/i.test(desc) ||
    /^Device Lock Status$/i.test(desc) ||
    /^Keybag Lock Status$/i.test(desc) ||
    /^Screen Unlock State$/i.test(desc) ||
    /^Lock State:/i.test(message) ||
    /^Device Lock Status:/i.test(message) ||
    /^Keybag Lock Status:/i.test(message) ||
    /^Screen Unlock State:/i.test(message) ||
    /DEVICE (UN)?LOCKED/i.test(message) ||
    Boolean(strField(row, "lock_status")) ||
    Boolean(strField(row, "is_locked")) ||
    Boolean(strField(row, "auto_lock_type")) ||
    apollo === "powerlog_device_lock_state" ||
    apollo === "powerlog_device_screen_autolock" ||
    apollo === "knowledge_device_locked" ||
    apollo === "knowledge_device_locked_imputed" ||
    apollo === "knowledge_device_keybag_locked" ||
    apollo === "coreduetd_device_lock_state";

  if (
    !isLockActivity &&
    parser !== "powerlogs" &&
    parser !== "knowledgec" &&
    parser !== "logarchive" &&
    parser !== "lockdownd"
  ) {
    return null;
  }
  if (!isLockActivity) return null;

  if (looksLikeAuthFailure) {
    const parts = formatLockEventParts(row);
    const authType =
      strField(row, "auth_type") || extStr(ext, "auth_type") || "passcode";
    return {
      kind: "failed",
      when: parts.when,
      whenDate: parts.whenDate,
      whenTime: parts.whenTime,
      whenRaw: parts.whenRaw,
      timestampMs: parts.timestampMs,
      source:
        parser === "logarchive"
          ? "Unified log"
          : parser === "lockdownd"
            ? "Lockdown"
            : "Authentication",
      status: "failed",
      detail:
        authType === "biometric"
          ? "Biometric authentication failed"
          : "Passcode / unlock failed",
      message,
      parser: parser || "logarchive",
      activity: desc || "Authentication Failed",
      apolloModule: apollo,
      sourceDb: extStr(ext, "source_db"),
      extras: collectLockExtras(row, ext, message),
      sortKey: sortKey(row),
    };
  }

  const statusRaw =
    strField(row, "lock_status") ||
    strField(row, "is_locked") ||
    extStr(
      ext,
      "lock status",
      "LOCK STATUS",
      "lock_status",
      "IS LOCKED",
      "is locked",
      "is_locked",
      "AUTO LOCK TYPE",
      "auto_lock_type",
      "auto lock type"
    ) ||
    scrapeMessageValue(message, "LOCK STATUS") ||
    scrapeMessageValue(message, "lock status") ||
    scrapeMessageValue(message, "IS LOCKED") ||
    scrapeMessageValue(message, "AUTO LOCK TYPE");

  let kind = normalizeLockKind(statusRaw);
  if (kind === "unknown" && looksLikeAuthSuccess) {
    kind = "unlocked";
  }
  if (kind === "unknown" && /^Screen Unlock State/i.test(desc || message)) {
    kind = "autolock";
  }
  // Last resort: DEVICE UNLOCKED/LOCKED in the message body.
  if (kind === "unknown") {
    if (/DEVICE UNLOCKED/i.test(message) || /\bunlocked\b/i.test(message)) kind = "unlocked";
    else if (/DEVICE LOCKED/i.test(message) || /\blocked\b/i.test(message)) kind = "locked";
  }

  // Pure auth-success rows without lock_status still count as unlocks.
  if (kind === "unknown" && isAuthEvent && looksLikeAuthSuccess) {
    kind = "unlocked";
  }
  if (kind === "unknown" && isAuthEvent && !looksLikeAuthSuccess) {
    return null;
  }

  const source =
    parser === "knowledgec"
      ? "KnowledgeC"
      : parser === "logarchive"
        ? "Unified log"
        : parser === "lockdownd"
          ? "Lockdown"
          : apollo.includes("autolock") || /^Screen Unlock State/i.test(desc || message)
            ? "Powerlog auto-lock"
            : "Powerlog";

  const detail =
    kind === "unlocked"
      ? "Device unlocked"
      : kind === "locked"
        ? "Device locked"
        : kind === "autolock"
          ? statusRaw || "Auto-lock"
          : kind === "failed"
            ? "Authentication failed"
            : statusRaw || desc || "Lock state";

  const parts = formatLockEventParts(row);
  const sourceDb = extStr(ext, "source_db");
  const extras = collectLockExtras(row, ext, message);

  return {
    kind,
    when: parts.when,
    whenDate: parts.whenDate,
    whenTime: parts.whenTime,
    whenRaw: parts.whenRaw,
    timestampMs: parts.timestampMs,
    source,
    status: statusRaw || detail,
    detail,
    message,
    parser: parser || "powerlogs",
    activity: desc || (message.includes(":") ? message.split(":")[0]!.trim() : ""),
    apolloModule: apollo,
    sourceDb,
    extras,
    sortKey: sortKey(row),
  };
}

export function iosLockEventsFromRows(rows: Record<string, unknown>[]): IosLockEvent[] {
  const out: IosLockEvent[] = [];
  for (const row of rows) {
    const ev = parseIosLockEvent(row);
    if (ev) out.push(ev);
  }
  out.sort((a, b) => b.sortKey - a.sortKey);
  return out;
}

export function summarizeIosLockEvents(events: IosLockEvent[]): IosLockStateSummary {
  let unlocked = 0;
  let locked = 0;
  let autolock = 0;
  let failed = 0;
  let lastUnlocked = "";
  let lastLocked = "";
  let lastFailed = "";
  for (const ev of events) {
    if (ev.kind === "unlocked") {
      unlocked += 1;
      if (!lastUnlocked) lastUnlocked = ev.when;
    } else if (ev.kind === "locked") {
      locked += 1;
      if (!lastLocked) lastLocked = ev.when;
    } else if (ev.kind === "autolock") {
      autolock += 1;
    } else if (ev.kind === "failed") {
      failed += 1;
      if (!lastFailed) lastFailed = ev.when;
    }
  }
  return { unlocked, locked, autolock, failed, lastUnlocked, lastLocked, lastFailed };
}

export function iosLockStateQuery(source: string, head = 500): string {
  const src = escapeMplString(source);
  return (
    `source="${src}" ` +
    `(` +
    `lock_status=* OR auto_lock_type=* OR is_locked=* OR auth_success=* OR ` +
    `event_type="authentication_event" OR ` +
    `(parser="powerlogs" AND (` +
    `timestamp_desc="Lock State" OR timestamp_desc="Screen Unlock State" OR ` +
    `message="Lock State*" OR message="Screen Unlock State*" OR ` +
    `message="*DEVICE UNLOCKED*" OR message="*DEVICE LOCKED*" OR message="*lock status=*"` +
    `)) OR ` +
    `(parser="knowledgec" AND (` +
    `timestamp_desc="Device Lock Status" OR timestamp_desc="Keybag Lock Status" OR ` +
    `message="Device Lock Status*" OR message="Keybag Lock Status*"` +
    `)) OR ` +
    `(parser="logarchive" AND (` +
    `message="*Unlock attempt succeeded*" OR message="*Processed authentication request*" OR ` +
    `message="*identity match failed*" OR message="*processMatchFailReason*" OR ` +
    `message="*bio unlocked*" OR message="*Passcode authentication*" OR ` +
    `message="*Biometry is locked*" OR message="*needs passcode bio lockout*" OR ` +
    `timestamp_desc="Authentication Failed" OR timestamp_desc="Authentication Succeeded"` +
    `)) OR ` +
    `(parser="lockdownd" AND message="*Passcode authentication*")` +
    `) | fields timestamp, datetime, parser, message, timestamp_desc, lock_status, is_locked, auto_lock_type, auth_success, auth_type, success, event_type, ext ` +
    `| sort -timestamp | head ${head}`
  );
}

export function iosLockStateSearchQuery(source: string): string {
  const src = escapeMplString(source);
  return (
    `source="${src}" (lock_status=* OR auto_lock_type=* OR is_locked=* OR auth_success=* OR ` +
    `event_type="authentication_event" OR ` +
    `message="*Unlock attempt succeeded*" OR message="*Processed authentication request*" OR ` +
    `message="*identity match failed*" OR message="*processMatchFailReason*" OR ` +
    `message="*Passcode authentication*" OR message="*Biometry is locked*" OR ` +
    `message="*needs passcode bio lockout*" OR ` +
    `timestamp_desc="Lock State" OR timestamp_desc="Device Lock Status" OR ` +
    `timestamp_desc="Screen Unlock State" OR message="*DEVICE UNLOCKED*" OR message="Lock State*" OR message="*lock status=*") ` +
    `| sort -timestamp | head 500`
  );
}
