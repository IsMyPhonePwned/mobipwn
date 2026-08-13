import { formatRowTimestamp, parseExt, strField } from "@/lib/rowExt";

export type AndroidUsbDevice = {
  vid: string;
  pid: string;
  driver: string;
  interface: string;
  firstSeen: string;
  lastSeen: string;
  lastAction: string;
  productName: string;
  manufacturer: string;
  path: string;
  message: string;
  timestamp: string;
  /** Event count from UsbUI Host Interface log merge. */
  eventCount: number;
};

export type AndroidUsbPort = {
  id: string;
  connected: boolean | null;
  currentMode: string;
  firstSeen: string;
  lastStateChange: string;
  message: string;
  timestamp: string;
};

export type AndroidUsbView = {
  devices: AndroidUsbDevice[];
  ports: AndroidUsbPort[];
};

function clean(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s || s === "None" || s === "null") return "";
  return s;
}

function boolValue(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/** Decode `PRODUCT=vid/pid/rev` or `MODALIAS=usb:vXXXXpYYYY…` from raw UsbUI lines. */
export function usbIdsFromRawLine(raw: string): { vid: string; pid: string } {
  const product = raw.match(/\bPRODUCT=([0-9A-Fa-f]+)\/([0-9A-Fa-f]+)/);
  if (product) {
    return { vid: product[1].toLowerCase(), pid: product[2].toLowerCase() };
  }
  const moda = raw.match(/\bMODALIAS=usb:v([0-9A-Fa-f]{4})p([0-9A-Fa-f]{4})/i);
  if (moda) {
    return { vid: moda[1].toLowerCase(), pid: moda[2].toLowerCase().replace(/^0+/, "") || "0" };
  }
  return { vid: "", pid: "" };
}

function idsFromEvents(ext: Record<string, unknown>): { vid: string; pid: string } {
  const events = ext.events;
  if (!Array.isArray(events)) return { vid: "", pid: "" };
  for (const ev of events) {
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) continue;
    const raw = clean((ev as Record<string, unknown>).raw_line);
    if (!raw) continue;
    const ids = usbIdsFromRawLine(raw);
    if (ids.vid || ids.pid) return ids;
  }
  return { vid: "", pid: "" };
}

function normalizeHexId(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/^0x/, "");
  if (!s) return "";
  // Keep hub-style decimal PRODUCT pids (`2`) and hex (`80f4`) as stored.
  return s;
}

export function parseAndroidUsbDevice(row: Record<string, unknown>): AndroidUsbDevice | null {
  const dataType = strField(row, "data_type").toLowerCase();
  const message = strField(row, "message");
  const ext = parseExt(row);
  const isDevice =
    dataType.includes("usb_device") ||
    /^USB device/i.test(message) ||
    Boolean(clean(ext.vid) || clean(ext.vendor_id) || clean(ext.product_id) || clean(ext.driver));
  if (!isDevice) return null;
  if (dataType.includes("usb_port") || /^USB port:/i.test(message)) return null;

  const fromEvents = idsFromEvents(ext);
  const vid = normalizeHexId(
    clean(ext.vid) || clean(ext.vendor_id) || fromEvents.vid || ""
  );
  const pid = normalizeHexId(
    clean(ext.product_id) || clean(ext.usb_pid) || clean(ext.pid) || fromEvents.pid || ""
  );
  const driver = clean(ext.driver) || strField(row, "app_name");
  const iface = clean(ext.interface);
  const firstSeen = clean(ext.first_seen);
  const lastSeen = clean(ext.last_seen);
  const lastAction = clean(ext.last_action) || strField(row, "action");
  const productName = clean(ext.product_name);
  const manufacturer = clean(ext.manufacturer);
  const path = clean(ext.path);
  const events = Array.isArray(ext.events) ? ext.events.length : 0;

  if (!vid && !pid && !driver && !iface && !productName) return null;

  return {
    vid,
    pid,
    driver,
    interface: iface,
    firstSeen,
    lastSeen,
    lastAction,
    productName,
    manufacturer,
    path,
    message,
    timestamp: formatRowTimestamp(row),
    eventCount: events,
  };
}

export function parseAndroidUsbPort(row: Record<string, unknown>): AndroidUsbPort | null {
  const dataType = strField(row, "data_type").toLowerCase();
  const message = strField(row, "message");
  const ext = parseExt(row);
  const isPort =
    dataType.includes("usb_port") ||
    /^USB port:/i.test(message) ||
    (clean(ext.id) !== "" && (ext.connected != null || clean(ext.current_mode) !== ""));
  if (!isPort) return null;
  if (dataType.includes("usb_device")) return null;

  const id =
    clean(ext.id) ||
    message.replace(/^USB port:\s*/i, "").trim() ||
    strField(row, "action");
  if (!id) return null;

  return {
    id,
    connected: boolValue(ext.connected),
    currentMode: clean(ext.current_mode),
    firstSeen: clean(ext.first_seen),
    lastStateChange: clean(ext.last_state_change),
    message,
    timestamp: formatRowTimestamp(row),
  };
}

function deviceKey(d: AndroidUsbDevice): string {
  return [d.vid, d.pid, d.interface, d.driver, d.firstSeen].join("|");
}

function portKey(p: AndroidUsbPort): string {
  return p.id;
}

function richerDevice(a: AndroidUsbDevice, b: AndroidUsbDevice): AndroidUsbDevice {
  const score = (d: AndroidUsbDevice) =>
    (d.vid ? 2 : 0) +
    (d.pid ? 2 : 0) +
    (d.driver ? 1 : 0) +
    (d.interface ? 1 : 0) +
    (d.lastAction ? 1 : 0) +
    (d.productName ? 1 : 0) +
    d.eventCount;
  return score(b) > score(a)
    ? {
        ...b,
        vid: b.vid || a.vid,
        pid: b.pid || a.pid,
        driver: b.driver || a.driver,
        interface: b.interface || a.interface,
        firstSeen: a.firstSeen || b.firstSeen,
        lastSeen: b.lastSeen || a.lastSeen,
        lastAction: b.lastAction || a.lastAction,
      }
    : {
        ...a,
        vid: a.vid || b.vid,
        pid: a.pid || b.pid,
        driver: a.driver || b.driver,
        interface: a.interface || b.interface,
        firstSeen: a.firstSeen || b.firstSeen,
        lastSeen: b.lastSeen || a.lastSeen,
        lastAction: b.lastAction || a.lastAction,
      };
}

export function androidUsbViewFromRows(rows: Record<string, unknown>[]): AndroidUsbView {
  const devices = new Map<string, AndroidUsbDevice>();
  const ports = new Map<string, AndroidUsbPort>();

  for (const row of rows) {
    const device = parseAndroidUsbDevice(row);
    if (device) {
      const key = deviceKey(device);
      const prev = devices.get(key);
      devices.set(key, prev ? richerDevice(prev, device) : device);
      continue;
    }
    const port = parseAndroidUsbPort(row);
    if (port) {
      ports.set(portKey(port), port);
    }
  }

  const sortSeen = (a: string, b: string) => b.localeCompare(a);
  return {
    devices: [...devices.values()].sort(
      (a, b) =>
        sortSeen(a.lastSeen || a.firstSeen, b.lastSeen || b.firstSeen) ||
        a.vid.localeCompare(b.vid) ||
        a.pid.localeCompare(b.pid)
    ),
    ports: [...ports.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function androidUsbDevicesQuery(source: string): string {
  const src = source.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return (
    `source="${src}" parser="Usb" ` +
    `| fields timestamp, datetime, message, action, app_name, data_type, ext ` +
    `| sort -timestamp | head 200`
  );
}

export function androidUsbActionLabel(action: string): string {
  const a = action.trim().toLowerCase();
  if (!a) return "unknown";
  return a;
}
