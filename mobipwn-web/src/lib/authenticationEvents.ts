import { extField, formatRowTimestamp, parseExt, strField } from "@/lib/rowExt";
import type { LockUnlockTimelinePoint } from "@/lib/lockUnlockTimeline";

export type AuthEvent = {
  timestamp: string;
  /** Calendar date when available (e.g. "Apr 7, 2025"). */
  date: string;
  /** Clock time when available. */
  time: string;
  /** ISO / raw timestamp for `<time datetime>` and chips. */
  timestampRaw: string;
  timestampMs: number | null;
  user: string;
  authType: string;
  success: boolean;
  source: string;
  wakeReason: string;
  message: string;
};

function extBool(row: Record<string, unknown>, key: string): boolean | null {
  const v = parseExt(row)[key];
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

export function resolveAuthDate(row: Record<string, unknown>): Date | null {
  const candidates = [strField(row, "datetime"), strField(row, "timestamp"), extField(row, "timestamp")];
  for (const raw of candidates) {
    if (!raw) continue;
    const normalized =
      raw.includes("T") || /[+-]\d{2}:?\d{2}$/.test(raw) || raw.endsWith("Z")
        ? raw
        : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)
          ? `${raw.replace(" ", "T")}Z`
          : raw;
    const asIso = new Date(normalized);
    if (!Number.isNaN(asIso.getTime()) && asIso.getFullYear() > 2000) return asIso;

    const d = new Date(raw);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2000) return d;

    const ts = Number(raw);
    if (!Number.isNaN(ts) && ts > 0) {
      const ms = ts > 1e14 ? Math.floor(ts / 1000) : ts < 1e12 ? ts * 1000 : ts;
      const fromNum = new Date(ms);
      if (!Number.isNaN(fromNum.getTime()) && fromNum.getFullYear() > 2000) return fromNum;
    }
  }
  return null;
}

export function formatAuthTimestamp(row: Record<string, unknown>): string {
  const d = resolveAuthDate(row);
  if (!d) return formatRowTimestamp(row);
  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${date} · ${time}`;
}

function formatAuthDateParts(row: Record<string, unknown>): {
  date: string;
  time: string;
  timestamp: string;
  timestampRaw: string;
  timestampMs: number | null;
} {
  const d = resolveAuthDate(row);
  if (!d) {
    const fallback = formatRowTimestamp(row);
    const raw = strField(row, "datetime") || strField(row, "timestamp");
    return { date: fallback, time: "", timestamp: fallback, timestampRaw: raw, timestampMs: null };
  }
  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return {
    date,
    time,
    timestamp: `${date} · ${time}`,
    timestampRaw: d.toISOString(),
    timestampMs: d.getTime(),
  };
}

function authRowSortKey(row: Record<string, unknown>): number {
  const d = resolveAuthDate(row);
  return d ? d.getTime() : 0;
}

export function parseAuthEvent(row: Record<string, unknown>): AuthEvent {
  const ext = parseExt(row);
  const user =
    strField(row, "user") ||
    extField(row, "user_id") ||
    extField(row, "user") ||
    "?";
  const action = strField(row, "action");
  const authTypeRaw =
    extField(row, "auth_type") ||
    (isGenericAuthAction(action) ? "" : action) ||
    extField(row, "wake_reason") ||
    "unknown";
  const authType = normalizeAuthType(authTypeRaw);
  const successRaw = extBool(row, "success");
  const status = extField(row, "status") || strField(row, "action");
  const success =
    successRaw ??
    (status === "failed" ? false : status === "success" ? true : !/denied|fail/i.test(strField(row, "message")));
  const source = extField(row, "event_source");
  const wakeReason = extField(row, "wake_reason");
  const rawMessage = extField(row, "raw_message") || strField(row, "message");
  const parts = formatAuthDateParts(row);

  return {
    timestamp: parts.timestamp,
    date: parts.date,
    time: parts.time,
    timestampRaw: parts.timestampRaw,
    timestampMs: parts.timestampMs,
    user,
    authType,
    success,
    source,
    wakeReason,
    message: rawMessage,
  };
}

export function isGenericAuthAction(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    !v ||
    v === "authentication_event" ||
    v === "authentication event" ||
    v === "success" ||
    v === "failed" ||
    v === "unknown"
  );
}

export function normalizeAuthType(value: string): string {
  const v = value.trim().toLowerCase();
  if (isGenericAuthAction(v)) return "unlock";
  return v.replace(/_/g, " ");
}

export function authTypeLabel(authType: string): string {
  const labels: Record<string, string> = {
    biometric: "Biometric",
    fingerprint: "Fingerprint",
    face: "Face unlock",
    passcode: "Passcode",
    password: "Password",
    pattern: "Pattern",
    pin: "PIN",
    power_button: "Power button",
    unlock: "Unlock",
  };
  return labels[authType] ?? authType.replace(/\b\w/g, (c) => c.toUpperCase());
}

export type AuthSummary = {
  total: number;
  success: number;
  failed: number;
  users: number;
  topTypes: Array<{ type: string; count: number }>;
};

export function summarizeAuthRows(rows: Record<string, unknown>[]): AuthSummary {
  const events = rows.map(parseAuthEvent);
  const typeCounts = new Map<string, number>();
  const users = new Set<string>();
  let success = 0;
  let failed = 0;

  for (const e of events) {
    users.add(e.user);
    if (e.success) success += 1;
    else failed += 1;
    typeCounts.set(e.authType, (typeCounts.get(e.authType) ?? 0) + 1);
  }

  const topTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, count]) => ({ type, count }));

  return {
    total: events.length,
    success,
    failed,
    users: users.size,
    topTypes,
  };
}

export function authEventsSorted(rows: Record<string, unknown>[], limit = 12): AuthEvent[] {
  return rows
    .slice()
    .sort((a, b) => authRowSortKey(b) - authRowSortKey(a))
    .slice(0, limit)
    .map(parseAuthEvent);
}

/** Map Android authentication events onto the lock/unlock timeline series. */
export function authEventsToTimelinePoints(events: AuthEvent[]): LockUnlockTimelinePoint[] {
  const out: LockUnlockTimelinePoint[] = [];
  for (const e of events) {
    if (e.timestampMs == null || e.timestampMs <= 0) continue;
    if (!e.success) {
      out.push({ t: e.timestampMs, kind: "failed" });
      continue;
    }
    const type = e.authType.toLowerCase();
    if (type.includes("lock") && !type.includes("unlock")) {
      out.push({ t: e.timestampMs, kind: "locked" });
    } else {
      out.push({ t: e.timestampMs, kind: "unlocked" });
    }
  }
  return out;
}

export function authSearchQuery(event: AuthEvent, scope: string): string {
  const parts = [`${scope} parser="Authentication"`];
  if (event.user && event.user !== "?") parts.push(`user="${event.user.replace(/"/g, '\\"')}"`);
  if (event.authType && event.authType !== "unlock") {
    parts.push(`action=*${event.authType.replace(/"/g, "")}*`);
  }
  return `${parts.join(" ")} | sort -timestamp | head 30`;
}
