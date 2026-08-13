/** Best-effort iOS device identity from lockdownd syslog rows when remotectl/ioservice are absent. */

const PRODUCT_TYPE_RE = /product_type:\s*(\S+)/i;
const BUILD_VERSION_RE = /build version:\s*(\S+)/i;
const SERIAL_PAIR_RE = /SerialNumber\s*=\s*([A-Z0-9]+)/i;
const KEY_VALUE_RE = /^([A-Za-z][A-Za-z0-9_]+):\s*(.+)$/;

export function lockdowndDeviceMapFromRows(rows: Record<string, unknown>[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const row of rows) {
    const message = typeof row.message === "string" ? row.message : "";
    if (!message.trim()) continue;

    const productType = message.match(PRODUCT_TYPE_RE)?.[1];
    if (productType) map.set("producttype", productType);

    const buildVersion = message.match(BUILD_VERSION_RE)?.[1];
    if (buildVersion) map.set("buildversion", buildVersion);

    const serial = message.match(SERIAL_PAIR_RE)?.[1];
    if (serial) map.set("serialnumber", serial);

    const kv = message.match(KEY_VALUE_RE);
    if (kv) {
      const key = kv[1].toLowerCase();
      const value = kv[2].trim();
      if (key === "productversion" && value) map.set("osversion", value);
      if (key === "buildversion" && value) map.set("buildversion", value);
      if (key === "devicename" && value) map.set("productname", value);
    }
  }

  return map;
}

export function lockdowndDeviceMapHasIdentity(map: Map<string, string>): boolean {
  return Boolean(
    map.get("producttype") ||
      map.get("serialnumber") ||
      map.get("osversion") ||
      map.get("buildversion")
  );
}
