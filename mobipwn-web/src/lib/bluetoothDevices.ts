import { formatRowTimestamp, numFromValue, parseExt, strField } from "@/lib/rowExt";

export type BluetoothDevice = {
  name: string;
  address: string;
  identityAddress: string;
  connected: boolean | null;
  deviceClass: string;
  deviceType: string;
  transportType: string;
  linkType: string;
  manufacturerId: string;
  services: string[];
  /** UUID-looking service identifiers (shown separately from profile names). */
  serviceUuids: string[];
  message: string;
  timestamp: string;
};

const BT_PROFILE_TOKENS = new Set([
  "spp",
  "hsp",
  "hfp",
  "a2dp",
  "audiosink",
  "audiosource",
  "avrcp",
  "handsfree",
  "headset",
  "panu",
  "nap",
  "mns",
  "opp",
  "pbap",
  "map",
  "hid",
  "gatt",
  "bnep",
]);

function rowSortKey(row: Record<string, unknown>): number {
  const datetime = strField(row, "datetime");
  if (datetime) {
    const t = new Date(datetime).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const ts = Number(strField(row, "timestamp"));
  if (!Number.isNaN(ts) && ts > 0) return ts > 1e14 ? Math.floor(ts / 1000) : ts;
  return 0;
}

function boolValue(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function cleanValue(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s || s === "None" || s === "null") return "";
  return s;
}

function looksLikeUuid(token: string): boolean {
  const t = token.trim();
  return t.length >= 32 && (t.match(/-/g) || []).length >= 4;
}

function looksLikeMac(s: string): boolean {
  const parts = s.split(":");
  return parts.length === 6 && parts.every((p) => p.length === 2);
}

/** True when a "name" is really a profile/UUID dump (`: SPP HSP AudioSink …`). */
export function looksLikeBluetoothServiceBlob(raw: string): boolean {
  const t = raw.trim().replace(/^:\s*/, "");
  if (!t) return false;
  const tokens = t.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  if (!tokens.length) return false;
  const profileHits = tokens.filter((tok) => BT_PROFILE_TOKENS.has(tok.toLowerCase())).length;
  const uuidHits = tokens.filter(looksLikeUuid).length;
  if (profileHits >= 2) return true;
  if (profileHits >= 1 && (uuidHits >= 1 || tokens.length >= 3)) return true;
  if (uuidHits >= 1 && profileHits >= 1) return true;
  if (raw.trim().startsWith(":") && (profileHits >= 1 || uuidHits >= 1)) return true;
  return false;
}

function parseServiceTokens(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => cleanValue(item)).filter(Boolean);
  }
  const s = cleanValue(raw);
  if (!s) return [];
  return s
    .replace(/^:\s*/, "")
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t && t.toLowerCase() !== "no" && t.toLowerCase() !== "uuid");
}

export function splitBluetoothServices(raw: unknown): { profiles: string[]; uuids: string[] } {
  const tokens = parseServiceTokens(raw);
  const profiles: string[] = [];
  const uuids: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokens) {
    const key = tok.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (looksLikeUuid(tok) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(tok)) {
      if (!/^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(tok)) uuids.push(tok);
      continue;
    }
    if (tok.toLowerCase() === "no uuid") continue;
    profiles.push(tok);
  }
  return { profiles, uuids };
}

function sanitizeDeviceName(raw: string): string {
  const t = raw.trim().replace(/^:\s*/, "").replace(/:\s*$/, "").trim();
  if (!t || looksLikeMac(t) || looksLikeBluetoothServiceBlob(t)) return "";
  return t;
}

function deviceAddress(ext: Record<string, unknown>, row: Record<string, unknown>): string {
  return (
    cleanValue(ext.mac_address) ||
    cleanValue(ext.address) ||
    cleanValue(ext.mac) ||
    cleanValue(ext.masked_address) ||
    strField(row, "device_id")
  );
}

function parseBluetoothDeviceRow(row: Record<string, unknown>): BluetoothDevice | null {
  const parser = strField(row, "parser");
  const dataType = strField(row, "data_type").toLowerCase();
  if (parser && parser !== "Bluetooth" && !dataType.includes("bluetooth")) {
    return null;
  }

  const ext = parseExt(row);
  let name = sanitizeDeviceName(
    strField(row, "app_name") || cleanValue(ext.name) || cleanValue(ext.Name) || ""
  );
  const address = deviceAddress(ext, row);

  let servicesRaw: unknown = ext.services;
  if ((!Array.isArray(servicesRaw) || !(servicesRaw as unknown[]).length) && looksLikeBluetoothServiceBlob(strField(row, "app_name"))) {
    servicesRaw = strField(row, "app_name");
    name = "";
  }
  if ((!Array.isArray(servicesRaw) || !(servicesRaw as unknown[]).length) && looksLikeBluetoothServiceBlob(cleanValue(ext.name))) {
    servicesRaw = ext.name;
    name = "";
  }

  const { profiles, uuids } = splitBluetoothServices(servicesRaw);
  if (!name && !address && !profiles.length && !uuids.length) return null;

  const manufacturer = ext.manufacturer ?? ext.Manufacturer;
  const manufacturerId =
    cleanValue(manufacturer) ||
    (numFromValue(manufacturer) != null ? String(numFromValue(manufacturer)) : "");

  const displayName =
    name ||
    (address ? `Bluetooth device (${address})` : profiles.length ? "Unnamed Bluetooth device" : "Unknown device");

  return {
    name: displayName,
    address,
    identityAddress: cleanValue(ext.identity_address),
    connected: boolValue(ext.connected),
    deviceClass: cleanValue(ext.device_class) || cleanValue(ext.DevClass),
    deviceType:
      cleanValue(ext.device_type) ||
      cleanValue(ext.DevType) ||
      (numFromValue(ext.device_type) != null ? String(numFromValue(ext.device_type)) : ""),
    transportType: cleanValue(ext.transport_type),
    linkType:
      cleanValue(ext.link_type) ||
      cleanValue(ext.LinkType) ||
      (numFromValue(ext.link_type) != null ? String(numFromValue(ext.link_type)) : ""),
    manufacturerId,
    services: profiles,
    serviceUuids: uuids,
    message: strField(row, "message"),
    timestamp: formatRowTimestamp(row),
  };
}

function deviceKey(device: BluetoothDevice): string {
  return device.address || device.name;
}

function richness(device: BluetoothDevice): number {
  let score = 0;
  if (device.deviceClass) score += 1;
  if (device.deviceType) score += 1;
  if (device.transportType) score += 1;
  if (device.linkType) score += 1;
  if (device.manufacturerId) score += 1;
  if (device.services.length) score += device.services.length;
  if (device.serviceUuids.length) score += 1;
  if (device.identityAddress) score += 1;
  if (device.connected != null) score += 1;
  if (device.name && !device.name.startsWith("Bluetooth device") && device.name !== "Unnamed Bluetooth device") {
    score += 2;
  }
  return score;
}

function mergeDevices(existing: BluetoothDevice, incoming: BluetoothDevice): BluetoothDevice {
  const pick = (a: string, b: string) => b || a;
  const connected = incoming.connected ?? existing.connected;
  const services =
    incoming.services.length >= existing.services.length ? incoming.services : existing.services;
  const serviceUuids =
    incoming.serviceUuids.length >= existing.serviceUuids.length
      ? incoming.serviceUuids
      : existing.serviceUuids;
  const base = richness(incoming) >= richness(existing) ? incoming : existing;
  const other = base === incoming ? existing : incoming;
  return {
    name: pick(other.name, base.name),
    address: pick(other.address, base.address),
    identityAddress: pick(other.identityAddress, base.identityAddress),
    connected,
    deviceClass: pick(other.deviceClass, base.deviceClass),
    deviceType: pick(other.deviceType, base.deviceType),
    transportType: pick(other.transportType, base.transportType),
    linkType: pick(other.linkType, base.linkType),
    manufacturerId: pick(other.manufacturerId, base.manufacturerId),
    services,
    serviceUuids,
    message: pick(other.message, base.message),
    timestamp: base.timestamp || other.timestamp,
  };
}

export function bluetoothConnectionLabel(connected: boolean | null): string {
  if (connected === true) return "CONNECTED";
  if (connected === false) return "NOT CONNECTED";
  return "UNKNOWN";
}

export function parseBluetoothDevice(row: Record<string, unknown>): BluetoothDevice | null {
  return parseBluetoothDeviceRow(row);
}

export function bluetoothDevices(rows: Record<string, unknown>[]): BluetoothDevice[] {
  const byKey = new Map<string, { device: BluetoothDevice; sortKey: number }>();
  for (const row of rows.slice().sort((a, b) => rowSortKey(b) - rowSortKey(a))) {
    const device = parseBluetoothDeviceRow(row);
    if (!device) continue;
    const key = deviceKey(device);
    const sortKey = rowSortKey(row);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { device, sortKey });
      continue;
    }
    byKey.set(key, {
      device: mergeDevices(prev.device, device),
      sortKey: Math.max(prev.sortKey, sortKey),
    });
  }
  return [...byKey.values()]
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((entry) => entry.device);
}
