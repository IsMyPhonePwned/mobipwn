import { extField, formatRowTimestamp, parseExt, strField } from "@/lib/rowExt";
import { escapeMplString } from "@/lib/mplQuery";

export type IosUsbDevice = {
  product: string;
  vendor: string;
  idVendor: string;
  idProduct: string;
  serial: string;
  usbClass: string;
  port: string;
  nodeName: string;
  path: string;
  when: string;
};

export type IosUsbLockdownKind = "attach" | "detach" | "pair" | "usbmux" | "trust" | "other";

export type IosUsbLockdownEvent = {
  when: string;
  whenMs: number | null;
  message: string;
  /** Short analyst-facing title. */
  title: string;
  /** Optional host / pair label (e.g. iphone-wasm). */
  host: string;
  kind: IosUsbLockdownKind;
};

export type IosUsbPowerSample = {
  when: string;
  whenMs: number | null;
  externalConnected: boolean | null;
  charging: boolean | null;
  soc: string;
};

export type IosUsbCableSession = {
  startMs: number;
  endMs: number | null;
  startWhen: string;
  endWhen: string;
  durationMs: number | null;
  chargingSeen: boolean;
  samples: number;
};

export type IosUsbView = {
  deviceCount: number;
  devices: IosUsbDevice[];
  lockdown: IosUsbLockdownEvent[];
  lockdownKindCounts: Partial<Record<IosUsbLockdownKind, number>>;
  pairHosts: string[];
  power: IosUsbPowerSample[];
  /** Chronological cable-connected sessions (most recent first). */
  sessions: IosUsbCableSession[];
  externalOnCount: number;
  chargingCount: number;
  lastExternalConnected: boolean | null;
  lastExternalWhen: string;
  timelineStartMs: number | null;
  timelineEndMs: number | null;
};

export function iosUsbDevicesQuery(source: string): string {
  const src = escapeMplString(source);
  return (
    `source="${src}" parser="iousb" ` +
    `| fields timestamp, datetime, message, action, app_name, ext ` +
    `| sort -timestamp | head 250`
  );
}

export function iosUsbLockdownQuery(source: string): string {
  const src = escapeMplString(source);
  return (
    `source="${src}" parser="lockdownd" ` +
    `(message="*USB*" OR message="*usbmux*" OR message="*pair*" OR message="*trust*" OR message="*Pair*") ` +
    `| fields timestamp, datetime, message, ext | sort -timestamp | head 120`
  );
}

export function iosUsbPowerQuery(source: string): string {
  const src = escapeMplString(source);
  return (
    `source="${src}" parser="battery_bdc" ` +
    `| fields timestamp, datetime, message, ext | sort -timestamp | head 400`
  );
}

function rowTimeMs(row: Record<string, unknown>): number | null {
  const raw = strField(row, "datetime") || strField(row, "timestamp");
  if (!raw) return null;
  let s = raw.trim();
  if (!s.includes("T") && /^\d{4}-\d{2}-\d{2}[ T]/.test(s)) {
    s = s.replace(" ", "T");
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function lockdownKind(message: string): IosUsbLockdownKind {
  const m = message.toLowerCase();
  if (m.includes("no longer connected") || m.includes("disconnected")) return "detach";
  if (m.includes("usb2.device") || m.includes("iokit.matching")) return "attach";
  if (m.includes("pair") || m.includes("pairing")) return "pair";
  if (m.includes("usbmux")) return "usbmux";
  if (m.includes("trusted") || m.includes("trust")) return "trust";
  return "other";
}

/** Drop high-volume / low-signal lockdownd chatter. */
export function isLowValueUsbLockdownMessage(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("remotepairingdeviced attempting to get")) return true;
  if (m.includes("hostmaypairwithoptions")) return true;
  if (m.includes("allowing pairing from connection")) return true;
  if (m.startsWith("pair message:")) return true;
  if (m.includes("handle_pair pairingdialogresponsepending") && !m.includes("failed")) return true;
  return false;
}

export function summarizeUsbLockdownMessage(message: string): { title: string; host: string } {
  const hostMatch =
    message.match(/pair(?:ing)?(?:\s+for|\s+from)?\s+([A-Za-z0-9._-]+)/i) ||
    message.match(/Label\s*=\s*"([^"]+)"/i) ||
    message.match(/Preparing to pair for\s+([A-Za-z0-9._-]+)/i) ||
    message.match(/Pair for\s+([A-Za-z0-9._-]+)/i) ||
    message.match(/Host client\s+([A-Za-z0-9._-]+)/i);
  const host = hostMatch?.[1]?.replace(/[.\s]+$/, "") ?? "";

  if (/USB2\.Device/i.test(message) || /iokit\.matching/i.test(message)) {
    return { title: "USB host attached", host };
  }
  if (/no longer connected/i.test(message)) {
    return { title: "USB host disconnected", host };
  }
  if (/Pair for .+ succeeded/i.test(message)) {
    return { title: `Pair succeeded${host ? ` · ${host}` : ""}`, host };
  }
  if (/Pair for .+ failed/i.test(message)) {
    const reason = message.split(":").slice(1).join(":").trim();
    return {
      title: `Pair failed${host ? ` · ${host}` : ""}${reason ? ` (${reason})` : ""}`,
      host,
    };
  }
  if (/Preparing to pair/i.test(message)) {
    return { title: `Preparing to pair${host ? ` · ${host}` : ""}`, host };
  }
  if (/Notifying host to pair/i.test(message)) {
    return { title: "Notifying host to pair", host };
  }
  if (/Deleted pair record/i.test(message)) {
    return { title: "Deleted pair record", host };
  }
  if (/is trusted/i.test(message)) {
    return { title: `Host trusted${host ? ` · ${host}` : ""}`, host };
  }
  if (/usbmux/i.test(message)) {
    return { title: message.length > 90 ? `${message.slice(0, 87)}…` : message, host };
  }
  const compact = message.replace(/\s+/g, " ").trim();
  return {
    title: compact.length > 100 ? `${compact.slice(0, 97)}…` : compact,
    host,
  };
}

function truthyFlag(raw: string): boolean | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t === "1" || t === "true" || t === "yes") return true;
  if (t === "0" || t === "false" || t === "no") return false;
  return null;
}

export function formatUsbDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM ? `${h}h ${remM}m` : `${h}h`;
}

export function iosUsbDevicesFromRows(rows: Record<string, unknown>[]): {
  deviceCount: number;
  devices: IosUsbDevice[];
} {
  let deviceCount = 0;
  const devices: IosUsbDevice[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const ext = parseExt(row);
    const kind = String(ext.usb_kind ?? ext.event_type ?? "").toLowerCase();
    if (kind.includes("summary") || strField(row, "action") === "iousb_summary") {
      const n = Number(ext.device_count ?? 0);
      if (Number.isFinite(n) && n > deviceCount) deviceCount = n;
      continue;
    }

    const product =
      extField(row, "usb_product") ||
      strField(row, "action") ||
      extField(row, "node_name") ||
      strField(row, "message").split(" · ")[0] ||
      "";
    const vendor = extField(row, "usb_vendor") || strField(row, "app_name");
    const idVendor = extField(row, "id_vendor");
    const idProduct = extField(row, "id_product");
    const serial = extField(row, "usb_serial");
    const usbClass = extField(row, "usb_class");
    const port = extField(row, "port_num");
    const nodeName = extField(row, "node_name");
    const path = extField(row, "ioreg_path");

    if (!product && !idVendor && !idProduct && !serial) continue;

    const key = `${product}|${vendor}|${idVendor}|${idProduct}|${serial}|${nodeName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    devices.push({
      product: product || nodeName || "USB device",
      vendor,
      idVendor,
      idProduct,
      serial,
      usbClass,
      port,
      nodeName,
      path,
      when: formatRowTimestamp(row),
    });
  }

  if (!deviceCount) deviceCount = devices.length;
  return { deviceCount, devices };
}

export function iosUsbLockdownFromRows(rows: Record<string, unknown>[]): IosUsbLockdownEvent[] {
  const out: IosUsbLockdownEvent[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const message = strField(row, "message");
    if (!message) continue;
    if (isLowValueUsbLockdownMessage(message)) continue;
    const when = formatRowTimestamp(row);
    const whenMs = rowTimeMs(row);
    const { title, host } = summarizeUsbLockdownMessage(message);
    const kind = lockdownKind(message);
    const key = `${when}|${kind}|${title}|${host}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ when, whenMs, message, title, host, kind });
    if (out.length >= 50) break;
  }
  return out;
}

export function iosUsbPowerFromRows(rows: Record<string, unknown>[]): {
  power: IosUsbPowerSample[];
  sessions: IosUsbCableSession[];
  externalOnCount: number;
  chargingCount: number;
  lastExternalConnected: boolean | null;
  lastExternalWhen: string;
  timelineStartMs: number | null;
  timelineEndMs: number | null;
} {
  const samples: IosUsbPowerSample[] = [];
  let externalOnCount = 0;
  let chargingCount = 0;

  for (const row of rows) {
    const ext = parseExt(row);
    const type = String(ext.type ?? "").toLowerCase();
    const externalConnected = truthyFlag(
      String(ext.ExternalConnected ?? ext.AppleRawExternalConnected ?? "")
    );
    const charging = truthyFlag(String(ext.IsCharging ?? ""));
    const soc = ext.StateOfCharge != null ? String(ext.StateOfCharge) : "";

    if (externalConnected === true) externalOnCount += 1;
    if (charging === true) chargingCount += 1;

    if (externalConnected == null && charging == null && !type.includes("obc")) continue;

    const whenMs = rowTimeMs(row);
    samples.push({
      when: formatRowTimestamp(row),
      whenMs,
      externalConnected,
      charging,
      soc,
    });
  }

  // Keep transition list for UI (newest first), but build sessions chronologically.
  const dated = samples
    .filter((s) => s.whenMs != null && s.externalConnected != null)
    .sort((a, b) => (a.whenMs ?? 0) - (b.whenMs ?? 0));

  const sessions: IosUsbCableSession[] = [];
  let open: IosUsbCableSession | null = null;
  for (const s of dated) {
    const t = s.whenMs!;
    if (s.externalConnected === true) {
      if (!open) {
        open = {
          startMs: t,
          endMs: null,
          startWhen: s.when,
          endWhen: "",
          durationMs: null,
          chargingSeen: s.charging === true,
          samples: 1,
        };
      } else {
        open.samples += 1;
        if (s.charging === true) open.chargingSeen = true;
      }
    } else if (s.externalConnected === false && open) {
      open.endMs = t;
      open.endWhen = s.when;
      open.durationMs = Math.max(0, t - open.startMs);
      open.samples += 1;
      sessions.push(open);
      open = null;
    }
  }
  if (open) {
    const last = dated[dated.length - 1]!;
    open.endMs = null;
    open.endWhen = "still connected";
    open.durationMs = last.whenMs != null ? Math.max(0, last.whenMs - open.startMs) : null;
    sessions.push(open);
  }

  sessions.reverse();

  // Transition strip: only state changes (newest first).
  const transitions: IosUsbPowerSample[] = [];
  let prev: boolean | null = null;
  for (let i = dated.length - 1; i >= 0; i--) {
    const s = dated[i]!;
    if (s.externalConnected == null) continue;
    if (prev === s.externalConnected) continue;
    prev = s.externalConnected;
    transitions.push(s);
    if (transitions.length >= 24) break;
  }

  const lastDated = dated.length ? dated[dated.length - 1]! : null;
  const timelineStartMs = dated[0]?.whenMs ?? null;
  const timelineEndMs = lastDated?.whenMs ?? null;

  return {
    power: transitions,
    sessions: sessions.slice(0, 20),
    externalOnCount,
    chargingCount,
    lastExternalConnected: lastDated?.externalConnected ?? null,
    lastExternalWhen: lastDated?.when ?? "",
    timelineStartMs,
    timelineEndMs,
  };
}

export function iosUsbViewFromRows(
  deviceRows: Record<string, unknown>[],
  lockdownRows: Record<string, unknown>[],
  powerRows: Record<string, unknown>[]
): IosUsbView | null {
  const { deviceCount, devices } = iosUsbDevicesFromRows(deviceRows);
  const lockdown = iosUsbLockdownFromRows(lockdownRows);
  const {
    power,
    sessions,
    externalOnCount,
    chargingCount,
    lastExternalConnected,
    lastExternalWhen,
    timelineStartMs,
    timelineEndMs,
  } = iosUsbPowerFromRows(powerRows);

  if (!devices.length && !lockdown.length && !power.length && !sessions.length) return null;

  const lockdownKindCounts: Partial<Record<IosUsbLockdownKind, number>> = {};
  const hostSet = new Set<string>();
  for (const e of lockdown) {
    lockdownKindCounts[e.kind] = (lockdownKindCounts[e.kind] ?? 0) + 1;
    if (e.host) hostSet.add(e.host);
  }

  return {
    deviceCount,
    devices,
    lockdown,
    lockdownKindCounts,
    pairHosts: [...hostSet].sort((a, b) => a.localeCompare(b)),
    power,
    sessions,
    externalOnCount,
    chargingCount,
    lastExternalConnected,
    lastExternalWhen,
    timelineStartMs,
    timelineEndMs,
  };
}
