import { extField, numField, numFromValue, parseExt, strField } from "@/lib/rowExt";
import { looksLikeAndroidPackage } from "@/lib/networkOwner";

const AID_APP_START = 10_000;
const PER_USER_RANGE = 100_000;

export type UidOwnerHint = {
  package?: string;
  process?: string;
  user?: string;
};

/** Well-known Android UIDs where netstat only reports a numeric UID. */
const KNOWN_ANDROID_UID_INFO: Record<string, { process: string; explanation: string }> = {
  "1073": {
    process: "com.android.networkstack.process",
    explanation:
      "UID 1073 is the network stack shared UID; the listen socket has no program name in netstat, but process rows identify com.android.networkstack.process.",
  },
};

export type UidOwnerPresentation = {
  secondary: string | null;
  explanation: string | null;
};

/** Parse Android `ps` user column (`u0_a109`, `system`, …) into a Linux UID string. */
export function parseAndroidLinuxUid(user: string): string | null {
  const trimmed = user.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("u")) {
    const rest = trimmed.slice(1);
    const underscore = rest.indexOf("_");
    if (underscore < 0) return null;
    const userId = Number(rest.slice(0, underscore));
    const suffix = rest.slice(underscore + 1);
    if (!Number.isFinite(userId)) return null;
    const base = userId * PER_USER_RANGE;

    if (suffix.startsWith("a")) {
      const offset = Number(suffix.slice(1));
      if (!Number.isFinite(offset)) return null;
      return String(base + AID_APP_START + offset);
    }
    if (suffix.startsWith("i")) {
      const offset = Number(suffix.slice(1));
      if (!Number.isFinite(offset)) return null;
      return String(base + 99_000 + offset);
    }
    const named = namedAndroidUid(suffix);
    return named != null ? String(base + named) : null;
  }

  const named = namedAndroidUid(trimmed);
  return named != null ? String(named) : null;
}

function namedAndroidUid(name: string): number | null {
  const table: Record<string, number> = {
    root: 0,
    system: 1000,
    radio: 1001,
    phone: 1001,
    bluetooth: 1002,
    graphics: 1003,
    input: 1004,
    audio: 1005,
    camera: 1006,
    log: 1007,
    compass: 1008,
    mount: 1009,
    wifi: 1010,
    adb: 1011,
    install: 1012,
    media: 1013,
    dhcp: 1014,
    sdcard_rw: 1015,
    vpn: 1016,
    keystore: 1017,
    drm: 1019,
    media_rw: 1023,
    nfc: 1027,
    clat: 1029,
    shell: 2000,
    network_stack: 1073,
    nobody: 9999,
  };
  return table[name] ?? null;
}

function mergeUidHint(map: Map<string, UidOwnerHint>, uid: string, patch: UidOwnerHint) {
  if (!uid || uid === "0") return;
  const prev = map.get(uid) ?? {};
  map.set(uid, {
    package: patch.package || prev.package,
    process: patch.process || prev.process,
    user: patch.user || prev.user,
  });
}

function hintFromNetworkRow(row: Record<string, unknown>): { uid: string; hint: UidOwnerHint } | null {
  const uid =
    strField(row, "process_id") ||
    extField(row, "uid") ||
    extField(row, "program_pid");
  if (!uid || uid === "0") return null;

  const hint: UidOwnerHint = {};
  const owner = strField(row, "owner") || extField(row, "owner");
  const ownerType = strField(row, "owner_type") || extField(row, "owner_type");

  if (owner && ownerType === "package") hint.package = owner;
  else if (owner && ownerType === "process") hint.process = owner;
  else if (owner && looksLikeAndroidPackage(owner)) hint.package = owner;
  else if (owner) hint.process = owner;

  const bundle =
    strField(row, "bundle_id") ||
    strField(row, "package_name") ||
    extField(row, "package_name");
  if (bundle) hint.package = bundle;

  const program = extField(row, "program_name");
  if (program) hint.process = program;

  const processName = strField(row, "process_name") || extField(row, "process_cmd");
  if (processName) hint.process = processName;

  const user = strField(row, "user") || extField(row, "process_user");
  if (user) hint.user = user;

  if (!hint.package && !hint.process && !hint.user) return null;
  return { uid, hint };
}

function hintFromPackageRow(row: Record<string, unknown>): Array<{ uid: string; hint: UidOwnerHint }> {
  const ext = parseExt(row);
  const packageName = strField(row, "bundle_id") || extField(row, "package_name");
  if (!packageName) return [];

  const out: Array<{ uid: string; hint: UidOwnerHint }> = [];
  const appId = numField(row, "appId") ?? numFromValue(ext.appId);
  const directUid = numField(row, "uid") ?? numFromValue(ext.uid);

  if (directUid != null) {
    out.push({ uid: String(directUid), hint: { package: packageName } });
  }
  if (appId != null) {
    out.push({ uid: String(appId), hint: { package: packageName } });
    const users = ext.users;
    if (Array.isArray(users)) {
      for (const entry of users) {
        if (!entry || typeof entry !== "object") continue;
        const userId = numFromValue((entry as Record<string, unknown>).user_id);
        if (userId == null) continue;
        out.push({ uid: String(userId * PER_USER_RANGE + appId), hint: { package: packageName } });
      }
    }
  }
  return out;
}

function hintFromProcessRow(row: Record<string, unknown>): { uid: string; hint: UidOwnerHint } | null {
  const user = strField(row, "user") || extField(row, "user");
  const uid = user ? parseAndroidLinuxUid(user) : null;
  if (!uid) return null;

  const process =
    strField(row, "process_name") ||
    extField(row, "cmd") ||
    extField(row, "command") ||
    extField(row, "name");
  if (!process && !user) return null;

  return {
    uid,
    hint: {
      process: process || undefined,
      user: user || undefined,
    },
  };
}

/** Build Linux UID → package/process hints from network, package, and process rows. */
export function collectUidOwnerHints(rows: Record<string, unknown>[]): Map<string, UidOwnerHint> {
  const map = new Map<string, UidOwnerHint>();

  for (const row of rows) {
    const parser = strField(row, "parser").toLowerCase();
    const dataType = strField(row, "data_type").toLowerCase();

    if (parser === "package" || dataType.includes("package_metadata")) {
      for (const entry of hintFromPackageRow(row)) {
        mergeUidHint(map, entry.uid, entry.hint);
      }
      continue;
    }

    if (parser === "process" || dataType.includes("process")) {
      const proc = hintFromProcessRow(row);
      if (proc) mergeUidHint(map, proc.uid, proc.hint);
      continue;
    }

    if (parser === "network" || dataType.includes("network")) {
      const net = hintFromNetworkRow(row);
      if (net) mergeUidHint(map, net.uid, net.hint);
    }
  }

  return map;
}

function formatUidHint(hint: UidOwnerHint): string | null {
  if (hint.package && hint.process && hint.package !== hint.process) {
    return `${hint.process} · ${hint.package}`;
  }
  if (hint.package) return hint.package;
  if (hint.process) return hint.process;
  if (hint.user) return hint.user;
  return null;
}

export function uidOwnerDetail(uidKey: string, hints: Map<string, UidOwnerHint>): string | null {
  if (!uidKey.startsWith("uid:")) return null;
  const uid = uidKey.slice(4);
  const fromHint = hints.get(uid);
  if (fromHint) {
    const formatted = formatUidHint(fromHint);
    if (formatted) return formatted;
  }
  return KNOWN_ANDROID_UID_INFO[uid]?.process ?? null;
}

/** Resolved package/process name plus analyst footnote for ambiguous netstat UIDs. */
export function uidOwnerPresentation(
  uidKey: string,
  hints: Map<string, UidOwnerHint>
): UidOwnerPresentation {
  if (!uidKey.startsWith("uid:")) {
    return { secondary: null, explanation: null };
  }
  const uid = uidKey.slice(4);
  const secondary = uidOwnerDetail(uidKey, hints);
  const explanation = KNOWN_ANDROID_UID_INFO[uid]?.explanation ?? null;
  return { secondary, explanation };
}
