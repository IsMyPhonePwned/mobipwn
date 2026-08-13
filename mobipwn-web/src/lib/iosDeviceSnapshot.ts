/** Parse `ext` from a search row into a flat string map (top-level keys only). */

export function parseRowExt(row: Record<string, unknown>): Record<string, string> {
  const raw = row.ext;
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    if (typeof value === "string") {
      const s = value.trim();
      if (s) out[key] = s;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return out;
}

export function parseRowExtObject(row: Record<string, unknown>): Record<string, unknown> {
  const raw = row.ext;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export type IosBatterySnapshot = {
  stateOfCharge: string;
  currentCapacity: string;
  designCapacity: string;
  isCharging: boolean;
  externalConnected: boolean;
  temperature: string;
  voltage: string;
  amperage: string;
};

export function batterySnapshotFromRows(rows: Record<string, unknown>[]): IosBatterySnapshot | null {
  const extFromRows = rows.map((row) => {
    const ext = parseRowExt(row);
    if (!ext.type && strField(row, "timestamp_desc")) {
      ext.type = strField(row, "timestamp_desc");
    }
    return ext;
  });

  let sbc: Record<string, string> | null = null;
  let once: Record<string, string> | null = null;
  let obc: Record<string, string> | null = null;

  for (const ext of extFromRows) {
    const type = ext.type ?? "";
    const family = type.match(/^(BDC_(?:SBC|Once|OBC))/)?.[1] ?? type;
    if (!sbc && (family === "BDC_SBC" || ext.StateOfCharge || ext.Temperature)) sbc = ext;
    if (!once && (family === "BDC_Once" || ext.DesignCapacity || ext.CycleCount)) once = ext;
    if (!obc && (family === "BDC_OBC" || ext.ExternalConnected)) obc = ext;
    if (sbc && once && obc) break;
  }

  if (!sbc && !once && !obc) return null;

  const tempRaw = sbc?.Temperature ?? sbc?.VirtualTemperature ?? "";
  const tempC =
    tempRaw && /^-?\d+$/.test(tempRaw) ? `${(Number(tempRaw) / 100).toFixed(1)} °C` : tempRaw;

  return {
    stateOfCharge: sbc?.StateOfCharge ? `${sbc.StateOfCharge}%` : "—",
    currentCapacity: sbc?.CurrentCapacity
      ? Number(sbc.CurrentCapacity) <= 100
        ? `${sbc.CurrentCapacity}%`
        : `${sbc.CurrentCapacity} mAh`
      : "—",
    designCapacity: once?.DesignCapacity ? `${once.DesignCapacity} mAh` : "—",
    isCharging: sbc?.IsCharging === "1",
    externalConnected: obc?.ExternalConnected === "1" || obc?.AppleRawExternalConnected === "1",
    temperature: tempC || "—",
    voltage: sbc?.Voltage ? `${(Number(sbc.Voltage) / 1000).toFixed(2)} V` : "—",
    amperage: sbc?.InstantAmperage || sbc?.Amperage || "—",
  };
}

function strField(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (v == null) return "";
  return String(v).trim();
}

export type IosStorageSnapshot = {
  mount: string;
  size: string;
  used: string;
  avail: string;
  capacity: string;
};

export function storageSnapshotsFromRows(rows: Record<string, unknown>[]): IosStorageSnapshot[] {
  const out: IosStorageSnapshot[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const ext = parseRowExt(row);
    const mount = ext.mounted_on ?? "";
    if (!mount || seen.has(mount)) continue;
    if (!ext.size && !ext.used) continue;
    seen.add(mount);
    out.push({
      mount,
      size: ext.size || "—",
      used: ext.used || "—",
      avail: ext.avail || "—",
      capacity: ext.capacity || (ext.capacity_percent ? `${ext.capacity_percent}%` : "—"),
    });
  }

  const root = out.find((s) => s.mount === "/");
  if (root) return [root, ...out.filter((s) => s.mount !== "/").slice(0, 3)];
  return out.slice(0, 4);
}

export type IosActivationSnapshot = {
  hardwareModel: string;
  productType: string;
  deviceClass: string;
  buildVersion: string;
  socGeneration: string;
  hasBaseband: string;
  internalBuild: string;
  activationState: string;
};

export function activationSnapshotFromRows(rows: Record<string, unknown>[]): IosActivationSnapshot | null {
  let startup: Record<string, string> | null = null;
  let activationState = "";

  for (const row of rows) {
    const ext = parseRowExt(row);
    const message = typeof row.message === "string" ? row.message : "";
    if (!startup && ext.hardware_model) startup = ext;
    if (!activationState && /activation state:/i.test(message)) {
      activationState = message.replace(/.*activation state:\s*/i, "").trim();
    }
  }

  if (!startup && !activationState) return null;

  return {
    hardwareModel: startup?.hardware_model ?? "—",
    productType: startup?.product_type ?? "—",
    deviceClass: startup?.device_class ?? "—",
    buildVersion: startup?.build_version ?? "—",
    socGeneration: startup?.soc_generation ?? "—",
    hasBaseband: startup?.has_baseband === "true" ? "Yes" : startup?.has_baseband === "false" ? "No" : "—",
    internalBuild: startup?.internal_build === "true" ? "Yes" : startup?.internal_build === "false" ? "No" : "—",
    activationState: activationState || "—",
  };
}

export function lockdownBuildFromRows(rows: Record<string, unknown>[]): string {
  for (const row of rows) {
    const message = typeof row.message === "string" ? row.message : "";
    const match = message.match(/build version:\s*(.+)/i);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

export function pairedDevicesFromSecurityRows(rows: Record<string, unknown>[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    const ext = parseRowExtObject(row);
    const attrs = ext.attributes;
    if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) continue;
    const labl = (attrs as Record<string, unknown>).labl;
    if (typeof labl === "string" && labl.trim()) names.add(labl.trim());
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function iosDeviceSnapshotQuery(source: string, parser: string, pipeline = "| head 30"): string {
  return `source="${source}" parser="${parser}" ${pipeline}`.trim();
}
