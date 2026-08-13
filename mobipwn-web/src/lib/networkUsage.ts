import { extField, formatBytes, numField, parseExt, strField } from "@/lib/rowExt";

export type NetworkUsageRow = {
  kind: "interface" | "stats";
  interfaceLabel: string;
  networkType: string;
  rxBytes: number;
  txBytes: number;
  dataType: string;
  detail: string;
};

export type WifiAccessPoint = {
  ssid: string;
  bssid: string;
  rssi: number | null;
  frequencyMhz: number | null;
  security: string;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  scanSection: string;
  detail: string;
};

function isNetworkUsageRow(row: Record<string, unknown>): boolean {
  const dt = strField(row, "data_type").toLowerCase();
  return dt.includes("network_interface") || dt.includes("network_stats");
}

function isWifiStatsRow(row: Record<string, unknown>, ext: Record<string, unknown>): boolean {
  const dt = strField(row, "data_type").toLowerCase();
  if (!dt.includes("network_stats")) return false;
  const networkType = (strField(row, "action") || extField(row, "network_type")).toUpperCase();
  const wifiName = strField(row, "ssid") || extField(row, "wifi_network_name");
  return networkType.includes("WIFI") || Boolean(wifiName);
}

function apKey(ssid: string, bssid: string): string {
  return `${ssid.trim() || "(hidden)"}\0${bssid.trim().toLowerCase()}`;
}

function frequencyToChannel(mhz: number): string {
  if (mhz >= 2412 && mhz <= 2484) return `ch ${Math.round((mhz - 2407) / 5)}`;
  if (mhz >= 5170 && mhz <= 5825) return `ch ${Math.round((mhz - 5000) / 5)}`;
  return `${mhz} MHz`;
}

export function wifiApFrequencyLabel(mhz: number | null): string {
  if (mhz == null || mhz <= 0) return "";
  return frequencyToChannel(mhz);
}

export type WifiRssiTone = "strong" | "fair" | "weak" | "unknown";

export function wifiRssiTone(rssi: number | null): WifiRssiTone {
  if (rssi == null) return "unknown";
  if (rssi >= -55) return "strong";
  if (rssi >= -70) return "fair";
  return "weak";
}

export function formatPacketCount(n: number): string {
  if (n <= 0) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function interfaceUsageRows(
  usage: NetworkUsageRow[],
  wifiAps: WifiAccessPoint[]
): NetworkUsageRow[] {
  if (!wifiAps.length) return usage;
  const wifiNames = new Set(wifiAps.map((ap) => ap.ssid.toLowerCase()));
  return usage.filter(
    (row) =>
      row.kind === "interface" ||
      !wifiNames.has(row.interfaceLabel.toLowerCase()) ||
      !/wifi/i.test(row.networkType)
  );
}

export function networkUsageTotals(rows: NetworkUsageRow[]): { rxBytes: number; txBytes: number } {
  return rows.reduce(
    (acc, row) => ({
      rxBytes: acc.rxBytes + row.rxBytes,
      txBytes: acc.txBytes + row.txBytes,
    }),
    { rxBytes: 0, txBytes: 0 }
  );
}

export function wifiApTotals(aps: WifiAccessPoint[]): { rxBytes: number; txBytes: number } {
  return aps.reduce(
    (acc, ap) => ({
      rxBytes: acc.rxBytes + ap.rxBytes,
      txBytes: acc.txBytes + ap.txBytes,
    }),
    { rxBytes: 0, txBytes: 0 }
  );
}

function securityLabel(ext: Record<string, unknown>): string {
  const raw = ext.security;
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v)).filter(Boolean).join(", ");
  }
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "";
}

export function wifiApMeta(ap: WifiAccessPoint): string {
  const parts: string[] = [];
  if (ap.bssid) parts.push(ap.bssid);
  if (ap.rssi != null) parts.push(`${ap.rssi} dBm`);
  const freq = wifiApFrequencyLabel(ap.frequencyMhz);
  if (freq) parts.push(freq);
  if (ap.security) parts.push(ap.security);
  if (ap.rxPackets > 0 || ap.txPackets > 0) {
    parts.push(`↓${ap.rxPackets} pkt · ↑${ap.txPackets} pkt`);
  }
  if (ap.scanSection) parts.push(ap.scanSection);
  if (ap.detail) parts.push(ap.detail);
  return parts.join(" · ");
}

function mergeAp(map: Map<string, WifiAccessPoint>, ap: WifiAccessPoint) {
  const key = apKey(ap.ssid, ap.bssid);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, ap);
    return;
  }
  existing.rxBytes += ap.rxBytes;
  existing.txBytes += ap.txBytes;
  existing.rxPackets += ap.rxPackets;
  existing.txPackets += ap.txPackets;
  if (ap.rssi != null && (existing.rssi == null || ap.rssi > existing.rssi)) {
    existing.rssi = ap.rssi;
  }
  if (!existing.frequencyMhz && ap.frequencyMhz) existing.frequencyMhz = ap.frequencyMhz;
  if (!existing.security && ap.security) existing.security = ap.security;
  if (!existing.scanSection && ap.scanSection) existing.scanSection = ap.scanSection;
  if (!existing.detail && ap.detail) existing.detail = ap.detail;
  if (!existing.bssid && ap.bssid) existing.bssid = ap.bssid;
}

export function wifiAccessPointsFromRows(rows: Record<string, unknown>[]): WifiAccessPoint[] {
  const map = new Map<string, WifiAccessPoint>();

  for (const row of rows) {
    const ext = parseExt(row);
    const dataType = strField(row, "data_type").toLowerCase();

    if (dataType.includes("wifi_scan_result") || dataType.includes("wifi_saved")) {
      const ssid = strField(row, "ssid") || extField(row, "ssid");
      const bssid = extField(row, "bssid");
      mergeAp(map, {
        ssid: ssid || "(hidden)",
        bssid,
        rssi: numField(row, "rssi") ?? numFromExt(ext, "rssi"),
        frequencyMhz: numFromExt(ext, "frequency"),
        security: securityLabel(ext),
        rxBytes: 0,
        txBytes: 0,
        rxPackets: 0,
        txPackets: 0,
        scanSection: extField(row, "scan_section"),
        detail: dataType.includes("wifi_saved") ? "saved network" : "",
      });
      continue;
    }

    if (isWifiStatsRow(row, ext)) {
      const ssid =
        strField(row, "ssid") || extField(row, "wifi_network_name") || extField(row, "ssid");
      if (!ssid) continue;
      const detail = statsDetail(ext, row);
      mergeAp(map, {
        ssid,
        bssid: extField(row, "bssid"),
        rssi: null,
        frequencyMhz: null,
        security: "",
        rxBytes: numField(row, "rx_bytes") ?? 0,
        txBytes: numField(row, "tx_bytes") ?? 0,
        rxPackets: numField(row, "rx_packets") ?? 0,
        txPackets: numField(row, "tx_packets") ?? 0,
        scanSection: "",
        detail,
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    const trafficDelta = b.rxBytes + b.txBytes - (a.rxBytes + a.txBytes);
    if (trafficDelta !== 0) return trafficDelta;
    const ar = a.rssi ?? -999;
    const br = b.rssi ?? -999;
    if (ar !== br) return br - ar;
    return a.ssid.localeCompare(b.ssid, undefined, { sensitivity: "base" });
  });
}

function numFromExt(ext: Record<string, unknown>, key: string): number | null {
  const v = ext[key];
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function statsDetail(ext: Record<string, unknown>, row: Record<string, unknown>): string {
  const parts: string[] = [];
  const metered = ext.metered;
  if (metered === true) parts.push("metered");
  if (metered === false) parts.push("unmetered");
  if (ext.default_network === true || ext.default_network === "true") parts.push("default");
  const rat = extField(row, "rat_type");
  if (rat) parts.push(rat);
  return parts.join(" · ");
}

export function parseNetworkUsageRow(row: Record<string, unknown>): NetworkUsageRow | null {
  if (!isNetworkUsageRow(row)) return null;

  const ext = parseExt(row);
  const dataType = strField(row, "data_type");
  const isInterface = dataType.toLowerCase().includes("network_interface");

  const rx = numField(row, "rx_bytes") ?? 0;
  const tx = numField(row, "tx_bytes") ?? 0;

  if (isInterface) {
    const name = extField(row, "name") || strField(row, "action") || "interface";
    return {
      kind: "interface",
      interfaceLabel: name,
      networkType: "iface",
      rxBytes: rx,
      txBytes: tx,
      dataType,
      detail: "",
    };
  }

  const networkType =
    strField(row, "action") || extField(row, "network_type") || "mobile/wifi";
  const wifi =
    strField(row, "ssid") || extField(row, "wifi_network_name") || extField(row, "ssid");
  const subscriber = extField(row, "subscriber_id");
  const interfaceLabel = wifi || subscriber || networkType;

  return {
    kind: "stats",
    interfaceLabel,
    networkType,
    rxBytes: rx,
    txBytes: tx,
    dataType,
    detail: statsDetail(ext, row),
  };
}

export function networkUsageRows(rows: Record<string, unknown>[]): NetworkUsageRow[] {
  const parsed = rows
    .map(parseNetworkUsageRow)
    .filter((r): r is NetworkUsageRow => r != null);

  const byKey = new Map<string, NetworkUsageRow>();
  for (const row of parsed) {
    const key = `${row.kind}:${row.interfaceLabel}:${row.networkType}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row });
      continue;
    }
    existing.rxBytes += row.rxBytes;
    existing.txBytes += row.txBytes;
    if (!existing.detail && row.detail) existing.detail = row.detail;
  }

  return [...byKey.values()].sort(
    (a, b) =>
      a.interfaceLabel.localeCompare(b.interfaceLabel, undefined, { sensitivity: "base" }) ||
      a.networkType.localeCompare(b.networkType, undefined, { sensitivity: "base" })
  );
}

export function networkUsageQueryFields(source: string): string {
  const src = source.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `source="${src}" parser="Network" (data_type=*network_interface* OR data_type=*network_stats* OR data_type=*wifi_scan_result* OR data_type=*wifi_saved*) | fields timestamp, action, message, data_type, ssid, ext, rx_bytes, tx_bytes, rx_packets, tx_packets, rssi | head 120`;
}

export { formatBytes };
