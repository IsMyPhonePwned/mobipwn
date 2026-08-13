import { numFromValue, parseExt, strField } from "@/lib/rowExt";

export type AdbAuthorizedKey = {
  identifier: string;
  keyPreview: string;
};

export type AdbKeystore = {
  hasKey: boolean;
  hasLastConnection: boolean;
  hasVersion: boolean;
  keyIdentifier: string;
  rawLength: number | null;
};

export type AdbSnapshot = {
  connected: boolean | null;
  lastKeyReceived: string;
  servicePid: number | null;
  threadsInUse: string;
  clientPids: number[];
  authorizedKeys: AdbAuthorizedKey[];
  keystore: AdbKeystore | null;
  wirelessHosts: string[];
};

const DM_KNOWN_KEYS = new Set([
  "connected_to_adb",
  "last_key_received",
  "user_keys",
  "user_keys_parsed",
  "keystore",
  "keystore_parsed",
]);

function cleanLabel(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "").trim();
}

function keyPreview(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 36) return trimmed;
  return `${trimmed.slice(0, 36)}…`;
}

function boolValue(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function parseKeystore(raw: unknown): AdbKeystore | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const ks = raw as Record<string, unknown>;
  return {
    hasKey: boolValue(ks.has_adb_key) ?? false,
    hasLastConnection: boolValue(ks.has_last_connection) ?? false,
    hasVersion: boolValue(ks.has_version) ?? false,
    keyIdentifier: cleanLabel(String(ks.key_identifier ?? "")),
    rawLength: numFromValue(ks.raw_length),
  };
}

function parseAuthorizedKeys(raw: unknown): AdbAuthorizedKey[] {
  if (!Array.isArray(raw)) return [];
  const keys: AdbAuthorizedKey[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const identifier = cleanLabel(String(row.identifier ?? "authorized key"));
    const key = String(row.key ?? "").trim();
    if (!identifier && !key) continue;
    keys.push({
      identifier: identifier || "authorized key",
      keyPreview: key ? keyPreview(key) : "—",
    });
  }
  return keys;
}

function wirelessHostsFromDm(dm: Record<string, unknown>): string[] {
  const hosts = new Set<string>();
  for (const [key, value] of Object.entries(dm)) {
    if (DM_KNOWN_KEYS.has(key)) continue;
    if (typeof value !== "string") continue;
    const host = cleanLabel(value);
    if (host.includes("@")) hosts.add(host);
  }
  return [...hosts];
}

function mergeKeys(existing: AdbAuthorizedKey[], incoming: AdbAuthorizedKey[]): AdbAuthorizedKey[] {
  const byId = new Map(existing.map((k) => [k.identifier, k]));
  for (const key of incoming) {
    if (!byId.has(key.identifier)) byId.set(key.identifier, key);
  }
  return [...byId.values()];
}

function parseDebuggingManager(dm: Record<string, unknown>): Partial<AdbSnapshot> {
  const patch: Partial<AdbSnapshot> = {};
  const connected = boolValue(dm.connected_to_adb);
  if (connected != null) patch.connected = connected;
  const lastKey = cleanLabel(String(dm.last_key_received ?? ""));
  if (lastKey) patch.lastKeyReceived = lastKey;
  const keys = parseAuthorizedKeys(dm.user_keys_parsed);
  if (keys.length) patch.authorizedKeys = keys;
  const keystore = parseKeystore(dm.keystore_parsed);
  if (keystore) patch.keystore = keystore;
  const hosts = wirelessHostsFromDm(dm);
  if (hosts.length) patch.wirelessHosts = hosts;
  return patch;
}

function eventType(ext: Record<string, unknown>, row: Record<string, unknown>): string {
  const fromExt = strField(ext as Record<string, unknown>, "event_type");
  if (fromExt) return fromExt;
  const dataType = strField(row, "data_type");
  const suffix = dataType.split(":").pop() ?? "";
  if (suffix === "adb_key" || suffix === "adb_keystore" || suffix === "adb_status") {
    return suffix;
  }
  return "";
}

function applyPatch(target: AdbSnapshot, patch: Partial<AdbSnapshot>): void {
  if (patch.connected != null) target.connected = patch.connected;
  if (patch.lastKeyReceived) target.lastKeyReceived = patch.lastKeyReceived;
  if (patch.servicePid != null) target.servicePid = patch.servicePid;
  if (patch.threadsInUse) target.threadsInUse = patch.threadsInUse;
  if (patch.clientPids?.length) target.clientPids = patch.clientPids;
  if (patch.authorizedKeys?.length) {
    target.authorizedKeys = mergeKeys(target.authorizedKeys, patch.authorizedKeys);
  }
  if (patch.keystore) target.keystore = patch.keystore;
  if (patch.wirelessHosts?.length) {
    const hosts = new Set([...target.wirelessHosts, ...patch.wirelessHosts]);
    target.wirelessHosts = [...hosts];
  }
}

function parseRow(row: Record<string, unknown>): Partial<AdbSnapshot> {
  const ext = parseExt(row);
  const patch: Partial<AdbSnapshot> = {};

  const connected = boolValue(ext.connected_to_adb);
  if (connected != null) patch.connected = connected;

  const servicePid = numFromValue(ext.service_pid);
  if (servicePid != null) patch.servicePid = servicePid;

  const threads = cleanLabel(String(ext.threads_in_use ?? ""));
  if (threads) patch.threadsInUse = threads;

  if (Array.isArray(ext.client_pids)) {
    const pids = ext.client_pids
      .map((pid) => numFromValue(pid))
      .filter((pid): pid is number => pid != null);
    if (pids.length) patch.clientPids = pids;
  }

  const dm = ext.debugging_manager;
  if (dm && typeof dm === "object" && !Array.isArray(dm)) {
    const dmPatch = parseDebuggingManager(dm as Record<string, unknown>);
    if (dmPatch.authorizedKeys?.length) {
      dmPatch.authorizedKeys = mergeKeys(patch.authorizedKeys ?? [], dmPatch.authorizedKeys);
    }
    Object.assign(patch, dmPatch);
  }

  const kind = eventType(ext, row);
  if (kind === "adb_key") {
    const identifier = cleanLabel(String(ext.identifier ?? "authorized key"));
    const key = String(ext.key ?? "").trim();
    patch.authorizedKeys = [{ identifier, keyPreview: key ? keyPreview(key) : "—" }];
  } else if (kind === "adb_keystore") {
    const keystore = parseKeystore(ext);
    if (keystore) patch.keystore = keystore;
  }

  return patch;
}

export function emptyAdbSnapshot(): AdbSnapshot {
  return {
    connected: null,
    lastKeyReceived: "",
    servicePid: null,
    threadsInUse: "",
    clientPids: [],
    authorizedKeys: [],
    keystore: null,
    wirelessHosts: [],
  };
}

export function adbSnapshotFromRows(rows: Record<string, unknown>[]): AdbSnapshot | null {
  const snapshot = emptyAdbSnapshot();
  let hasData = false;

  for (const row of rows) {
    if (strField(row, "parser") && strField(row, "parser") !== "Adb") continue;
    const patch = parseRow(row);
    applyPatch(snapshot, patch);
    if (
      patch.connected != null ||
      patch.lastKeyReceived ||
      patch.servicePid != null ||
      patch.threadsInUse ||
      patch.clientPids?.length ||
      patch.authorizedKeys?.length ||
      patch.keystore ||
      patch.wirelessHosts?.length
    ) {
      hasData = true;
    }
  }

  return hasData ? snapshot : null;
}

export function adbConnectedLabel(connected: boolean | null): string {
  if (connected === true) return "Connected";
  if (connected === false) return "Not connected";
  return "Unknown";
}
