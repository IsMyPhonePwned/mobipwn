import { extField, formatRowTimestamp, numField, numFromValue, parseExt, strField } from "@/lib/rowExt";
import { escapeMplString } from "@/lib/mplQuery";
import { parseRowExt } from "@/lib/iosDeviceSnapshot";

export type BatteryField = { key: string; label: string; value: string };

export type BatteryHeroStats = {
  temperature: string;
  voltage: string;
  amperage: string;
  designCapacity: string;
  plug: string;
  health: string;
};

export type IosBatteryView = {
  stateOfCharge: string;
  healthPercent: string | null;
  isCharging: boolean;
  externalConnected: boolean;
  statusBadges: string[];
  heroStats: BatteryHeroStats;
  highlightFields: BatteryField[];
  sections: Array<{ id: string; title: string; fields: BatteryField[] }>;
  recentSamples: Array<{ when: string; type: string; summary: string }>;
  typeCount: number;
};

export type AndroidBatteryHistorySample = {
  when: string;
  status: string;
  charge: string;
  temp: string;
  volt: string;
  current: string;
  plug: string;
  health: string;
  flags: string;
};

export type AndroidBatteryApp = {
  package: string;
  wakelock: string;
  network: string;
  cpu: string;
  jobs: string;
  foreground: string;
};

export type AndroidBatteryHardwareSample = {
  when: string;
  soc: string;
  voltage: string;
  current: string;
  temperature: string;
  chargerTemp: string;
};

export type AndroidBatteryView = {
  charge: string;
  status: string;
  isCharging: boolean;
  statusBadges: string[];
  plug: string;
  temp: string;
  volt: string;
  current: string;
  health: string;
  heroStats: BatteryHeroStats;
  history: AndroidBatteryHistorySample[];
  hardware: AndroidBatteryHardwareSample[];
  topApps: AndroidBatteryApp[];
  historyCount: number;
  hardwareCount: number;
  appCount: number;
};

const IOS_FIELD_LABELS: Record<string, string> = {
  StateOfCharge: "State of charge",
  CurrentCapacity: "Current capacity",
  DesignCapacity: "Design capacity",
  MaxCapacity: "Max capacity",
  NominalChargeCapacity: "Nominal charge capacity",
  AppleRawMaxCapacity: "Raw max capacity",
  CycleCount: "Cycle count",
  Serial: "Serial",
  ManufactureDate: "Manufacture date",
  TimeInstalled: "Time installed",
  Temperature: "Temperature",
  VirtualTemperature: "Virtual temperature",
  Voltage: "Voltage",
  InstantAmperage: "Instant amperage",
  Amperage: "Amperage",
  AverageAmperage: "Average amperage",
  IsCharging: "Charging",
  FullyCharged: "Fully charged",
  ExternalConnected: "External power",
  AppleRawExternalConnected: "Raw external power",
  AtWarnLevel: "At warn level",
  AtCriticalLevel: "At critical level",
  PerformanceThrottle: "Performance throttle",
  BatteryCellDisconnect: "Cell disconnect",
  Qmax: "Qmax",
  BatteryHealthMetric: "Health metric",
};

const IOS_SECTION_TITLES: Record<string, string> = {
  BDC_SBC: "Live status (SBC)",
  BDC_Once: "Health & lifetime",
  BDC_OBC: "External connection",
};

const IOS_HIGHLIGHT_KEYS = [
  "StateOfCharge",
  "CurrentCapacity",
  "DesignCapacity",
  "MaxCapacity",
  "CycleCount",
  "Temperature",
  "VirtualTemperature",
  "Voltage",
  "InstantAmperage",
  "Amperage",
  "NominalChargeCapacity",
  "BatteryHealthMetric",
];

const IOS_MERGE_KEYS = new Set([
  "type",
  ...IOS_HIGHLIGHT_KEYS,
  "IsCharging",
  "FullyCharged",
  "ExternalConnected",
  "AppleRawExternalConnected",
  "AtWarnLevel",
  "AtCriticalLevel",
  "PerformanceThrottle",
  "BatteryCellDisconnect",
  "AverageAmperage",
  "Qmax",
  "Serial",
  "ManufactureDate",
  "TimeInstalled",
]);

const BATTERY_KEY_CANONICAL: Record<string, string> = {
  temperature: "Temperature",
  virtualtemperature: "VirtualTemperature",
  stateofcharge: "StateOfCharge",
  currentcapacity: "CurrentCapacity",
  designcapacity: "DesignCapacity",
  maxcapacity: "MaxCapacity",
  nominalchargecapacity: "NominalChargeCapacity",
  instantamperage: "InstantAmperage",
  averageamperage: "AverageAmperage",
  amperage: "Amperage",
  voltage: "Voltage",
  ischarging: "IsCharging",
  fullycharged: "FullyCharged",
  externalconnected: "ExternalConnected",
  applerawexternalconnected: "AppleRawExternalConnected",
  cyclecount: "CycleCount",
};

function canonicalBatteryKey(key: string): string {
  const norm = key.replace(/[\s_-]/g, "").toLowerCase();
  return BATTERY_KEY_CANONICAL[norm] ?? key;
}

function scalarToBatteryString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return "";
}

/** Flatten nested ext blobs (one level) and normalize BDC key casing. */
export function flattenBatteryExtObject(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};

  const assign = (key: string, value: unknown) => {
    const s = scalarToBatteryString(value);
    if (!s) return;
    const canon = canonicalBatteryKey(key);
    if (!out[canon]) out[canon] = s;
  };

  for (const [key, value] of Object.entries(raw)) {
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        assign(nestedKey, nestedValue);
      }
    }
    assign(key, value);
  }

  return out;
}

function humanizeKey(key: string): string {
  return IOS_FIELD_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

function isTruthyFlag(raw: string): boolean {
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

/** iOS BDC temperatures are usually centidegrees (e.g. 2850 → 28.5 °C). */
export function formatIosTemperature(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/°c/i.test(trimmed)) return trimmed;

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isInteger(n) && Math.abs(n) >= 100) {
      return `${(n / 100).toFixed(1)} °C`;
    }
    if (trimmed.includes(".")) return `${trimmed} °C`;
    return `${n} °C`;
  }

  return trimmed;
}

export function formatIosBatteryValue(key: string, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (
    /^(Is|At|Fully|External|AppleRaw|BatteryCell|Performance|Update)/.test(key) ||
    key.endsWith("Connected") ||
    key.endsWith("Charging")
  ) {
    if (trimmed === "1" || trimmed.toLowerCase() === "true") return "Yes";
    if (trimmed === "0" || trimmed.toLowerCase() === "false") return "No";
  }

  if (/temperature/i.test(key)) {
    return formatIosTemperature(trimmed);
  }

  if (key === "Voltage" && /^\d+$/.test(trimmed)) {
    return `${(Number(trimmed) / 1000).toFixed(2)} V`;
  }

  if (/amperage/i.test(key) && /^-?\d+$/.test(trimmed)) {
    return `${trimmed} mA`;
  }

  if (
    (key === "DesignCapacity" ||
      key === "MaxCapacity" ||
      key === "NominalChargeCapacity" ||
      key === "AppleRawMaxCapacity" ||
      key === "Qmax") &&
    /^\d+$/.test(trimmed)
  ) {
    return `${trimmed} mAh`;
  }

  if (key === "StateOfCharge" && /^\d+$/.test(trimmed) && Number(trimmed) <= 100) {
    return `${trimmed}%`;
  }

  if (key === "CurrentCapacity" && /^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (n <= 100) return `${n}%`;
    return `${n} mAh`;
  }

  if (key === "CycleCount" && /^\d+$/.test(trimmed)) {
    return `${trimmed} cycles`;
  }

  return trimmed;
}

/** Merge ext JSON with top-level BDC columns returned by search. */
export function iosBatteryExtFromRow(row: Record<string, unknown>): Record<string, string> {
  const out = {
    ...flattenBatteryExtObject(parseExt(row)),
    ...parseRowExt(row),
  };
  for (const key of IOS_MERGE_KEYS) {
    if (out[key]) continue;
    const v = row[key];
    if (v == null) continue;
    const s = scalarToBatteryString(v);
    if (s) out[canonicalBatteryKey(key)] = s;
  }
  if (!out.type) {
    const tsDesc = strField(row, "timestamp_desc");
    if (tsDesc) out.type = tsDesc;
  }
  return out;
}

/** Normalize BDC entry type (filename stem quirks, missing type). */
export function normalizeIosBatteryFamily(type: string, ext: Record<string, string>): string {
  const t = type.trim();
  const bdc = t.match(/^(BDC_(?:SBC|Once|OBC))/);
  if (bdc) return bdc[1];

  if (ext.StateOfCharge || ext.Temperature || ext.Voltage || ext.IsCharging !== undefined) {
    return "BDC_SBC";
  }
  if (ext.DesignCapacity || ext.CycleCount || ext.MaxCapacity) return "BDC_Once";
  if (ext.ExternalConnected !== undefined || ext.AppleRawExternalConnected !== undefined) {
    return "BDC_OBC";
  }
  if (t.startsWith("powerlog")) return t;
  return t || "battery_bdc";
}

function fieldsFromExt(
  ext: Record<string, string>,
  skipKeys = new Set(["type"]),
  excludeKeys = new Set<string>()
): BatteryField[] {
  return Object.entries(ext)
    .filter(([key, value]) => !skipKeys.has(key) && !excludeKeys.has(key) && value.trim())
    .map(([key, value]) => ({
      key,
      label: humanizeKey(key),
      value: formatIosBatteryValue(key, value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function iosSectionTitle(family: string): string {
  for (const [prefix, title] of Object.entries(IOS_SECTION_TITLES)) {
    if (family.startsWith(prefix)) return title;
  }
  if (family.startsWith("BDC_")) return family.replace(/_/g, " ");
  if (family.startsWith("powerlog")) return `Power log · ${family}`;
  return family || "Battery sample";
}

function iosSampleSummary(ext: Record<string, string>): string {
  const parts: string[] = [];
  if (ext.StateOfCharge) parts.push(formatIosBatteryValue("StateOfCharge", ext.StateOfCharge));
  else if (ext.CurrentCapacity) parts.push(formatIosBatteryValue("CurrentCapacity", ext.CurrentCapacity));
  const temp = ext.Temperature ?? ext.VirtualTemperature;
  if (temp) parts.push(formatIosBatteryValue("Temperature", temp));
  if (ext.Voltage) parts.push(formatIosBatteryValue("Voltage", ext.Voltage));
  if (ext.InstantAmperage) parts.push(formatIosBatteryValue("InstantAmperage", ext.InstantAmperage));
  if (isTruthyFlag(ext.IsCharging ?? "")) parts.push("charging");
  return parts.join(" · ") || "sample";
}

function mergeExtFields(target: Record<string, string>, source: Record<string, string>) {
  for (const [key, value] of Object.entries(source)) {
    if (value.trim() && !target[key]) target[key] = value;
  }
}

function iosHeroStatsFromSources(
  sbc: Record<string, string> | null,
  once: Record<string, string> | null
): BatteryHeroStats {
  const tempRaw = sbc?.Temperature ?? sbc?.VirtualTemperature ?? "";
  const ampRaw = sbc?.InstantAmperage ?? sbc?.Amperage ?? sbc?.AverageAmperage ?? "";
  const designRaw = once?.DesignCapacity ?? "";

  return {
    temperature: tempRaw ? formatIosTemperature(tempRaw) : "—",
    voltage: sbc?.Voltage ? formatIosBatteryValue("Voltage", sbc.Voltage) : "—",
    amperage: ampRaw ? formatIosBatteryValue("InstantAmperage", ampRaw) : "—",
    designCapacity: designRaw ? formatIosBatteryValue("DesignCapacity", designRaw) : "—",
    plug: "—",
    health: "—",
  };
}

function firstHistoryMetric(
  history: AndroidBatteryHistorySample[],
  key: keyof Pick<AndroidBatteryHistorySample, "temp" | "volt" | "current">
): string {
  for (const sample of history) {
    const value = sample[key];
    if (value && value !== "—") return value;
  }
  return "—";
}

export function iosBatteryViewFromRows(rows: Record<string, unknown>[]): IosBatteryView | null {
  const byFamily = new Map<string, Record<string, string>>();
  const recentSamples: IosBatteryView["recentSamples"] = [];
  const seenSample = new Set<string>();

  for (const row of rows) {
    const ext = iosBatteryExtFromRow(row);
    const family = normalizeIosBatteryFamily(ext.type ?? "", ext);
    const merged = byFamily.get(family) ?? {};
    mergeExtFields(merged, ext);
    byFamily.set(family, merged);

    const when = formatRowTimestamp(row);
    const sampleKey = `${family}|${when}|${iosSampleSummary(ext)}`;
    if (!seenSample.has(sampleKey) && recentSamples.length < 12) {
      seenSample.add(sampleKey);
      recentSamples.push({
        when: when || "—",
        type: iosSectionTitle(family),
        summary: iosSampleSummary(ext),
      });
    }
  }

  if (byFamily.size === 0) return null;

  const sbc = byFamily.get("BDC_SBC") ?? null;
  const once = byFamily.get("BDC_Once") ?? null;
  const obc = byFamily.get("BDC_OBC") ?? null;

  const design = numFromValue(once?.DesignCapacity);
  const maxCap = numFromValue(once?.MaxCapacity ?? once?.NominalChargeCapacity ?? once?.AppleRawMaxCapacity);
  let healthPercent: string | null = null;
  if (design && maxCap && design > 0) {
    healthPercent = `${Math.round((maxCap / design) * 100)}%`;
  } else if (once?.BatteryHealthMetric) {
    healthPercent = formatIosBatteryValue("BatteryHealthMetric", once.BatteryHealthMetric);
  }

  const statusBadges: string[] = [];
  if (isTruthyFlag(sbc?.IsCharging ?? "")) statusBadges.push("Charging");
  if (isTruthyFlag(obc?.ExternalConnected ?? "") || isTruthyFlag(obc?.AppleRawExternalConnected ?? "")) {
    statusBadges.push("External power");
  }
  if (isTruthyFlag(sbc?.FullyCharged ?? "")) statusBadges.push("Fully charged");
  if (isTruthyFlag(sbc?.AtCriticalLevel ?? "")) statusBadges.push("Critical");
  if (isTruthyFlag(sbc?.AtWarnLevel ?? "")) statusBadges.push("Low");
  if (isTruthyFlag(sbc?.PerformanceThrottle ?? "")) statusBadges.push("Throttled");

  const mergedHighlight = new Map<string, BatteryField>();
  for (const source of [sbc, once, obc]) {
    if (!source) continue;
    for (const key of IOS_HIGHLIGHT_KEYS) {
      const raw = source[key];
      if (!raw?.trim() || mergedHighlight.has(key)) continue;
      mergedHighlight.set(key, {
        key,
        label: humanizeKey(key),
        value: formatIosBatteryValue(key, raw),
      });
    }
  }

  const highlightKeySet = new Set(mergedHighlight.keys());
  const sectionOrder = ["BDC_SBC", "BDC_Once", "BDC_OBC"];
  const sections: IosBatteryView["sections"] = [];
  const usedFamilies = new Set<string>();

  for (const family of sectionOrder) {
    const ext = byFamily.get(family);
    if (!ext) continue;
    usedFamilies.add(family);
    const fields = fieldsFromExt(ext, new Set(["type"]), highlightKeySet);
    if (fields.length) sections.push({ id: family, title: iosSectionTitle(family), fields });
  }

  const otherFamilies = [...byFamily.keys()].filter((family) => !usedFamilies.has(family)).sort();
  for (const family of otherFamilies) {
    const fields = fieldsFromExt(byFamily.get(family)!, new Set(["type"]), highlightKeySet);
    if (fields.length) sections.push({ id: family, title: iosSectionTitle(family), fields });
  }

  const socRaw = sbc?.StateOfCharge ?? "";
  const stateOfCharge = socRaw
    ? formatIosBatteryValue("StateOfCharge", socRaw)
    : sbc?.CurrentCapacity
      ? formatIosBatteryValue("CurrentCapacity", sbc.CurrentCapacity)
      : "—";

  const heroStats = iosHeroStatsFromSources(sbc, once);
  const heroMetricKeys = new Set([
    "Temperature",
    "VirtualTemperature",
    "Voltage",
    "InstantAmperage",
    "Amperage",
    "AverageAmperage",
    "DesignCapacity",
  ]);

  return {
    stateOfCharge,
    healthPercent,
    isCharging: isTruthyFlag(sbc?.IsCharging ?? ""),
    externalConnected:
      isTruthyFlag(obc?.ExternalConnected ?? "") || isTruthyFlag(obc?.AppleRawExternalConnected ?? ""),
    statusBadges,
    heroStats,
    highlightFields: [...mergedHighlight.values()].filter((field) => !heroMetricKeys.has(field.key)),
    sections,
    recentSamples,
    typeCount: byFamily.size,
  };
}

/**
 * When BatteryBDC CSVs are missing, still show a useful panel from powerlogs
 * Battery Level samples (common on lighter / older sysdiagnoses).
 */
export function iosBatteryViewFromPowerlogsSeries(
  series: BatteryLevelPoint[]
): IosBatteryView | null {
  if (!series.length) return null;

  const sorted = [...series].sort((a, b) => a.t - b.t);
  const latest = sorted[sorted.length - 1]!;
  const latestWithCharge = [...sorted].reverse().find((p) => p.charging != null) ?? latest;
  const isCharging = latestWithCharge.charging === true;
  const onBattery = latestWithCharge.charging === false;

  const levels = sorted.map((p) => p.level);
  const minLevel = Math.min(...levels);
  const maxLevel = Math.max(...levels);
  const chargingSamples = sorted.filter((p) => p.charging === true).length;
  const dischargeSamples = sorted.filter((p) => p.charging === false).length;

  const statusBadges: string[] = [];
  if (isCharging) statusBadges.push("Charging");
  else if (onBattery) statusBadges.push("On battery");
  if (latest.level >= 99.5) statusBadges.push("Full");
  else if (latest.level <= 20) statusBadges.push("Low");
  statusBadges.push("Powerlogs");

  const highlightFields: BatteryField[] = [
    {
      key: "ObservedRange",
      label: "Observed range",
      value: `${Math.round(minLevel)}–${Math.round(maxLevel)}%`,
    },
    {
      key: "SampleCount",
      label: "Samples",
      value: String(sorted.length),
    },
    {
      key: "FirstSample",
      label: "First sample",
      value: sorted[0]!.when || "—",
    },
    {
      key: "LastSample",
      label: "Last sample",
      value: latest.when || "—",
    },
  ];
  if (chargingSamples > 0 || dischargeSamples > 0) {
    highlightFields.push({
      key: "ChargeMix",
      label: "Charging samples",
      value: `${chargingSamples} charging · ${dischargeSamples} on battery`,
    });
  }

  const recentSamples = [...sorted]
    .reverse()
    .slice(0, 12)
    .map((p) => ({
      when: p.when || "—",
      type: "Battery Level",
      summary: [
        `${Math.round(p.level * 10) / 10}%`,
        p.charging === true ? "charging" : p.charging === false ? "on battery" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));

  return {
    stateOfCharge: `${Math.round(latest.level)}%`,
    healthPercent: null,
    isCharging,
    externalConnected: isCharging,
    statusBadges,
    heroStats: {
      temperature: "—",
      voltage: "—",
      amperage: "—",
      designCapacity: "—",
      plug: isCharging ? "Charging" : onBattery ? "Unplugged" : "—",
      health: "—",
    },
    highlightFields,
    sections: [
      {
        id: "powerlogs_battery_level",
        title: "Powerlogs Battery Level",
        fields: [
          {
            key: "note",
            label: "Source",
            value:
              "No BatteryBDC CSV in this sysdiagnose — metrics below are from powerlogs Battery Level only.",
          },
          ...highlightFields,
        ],
      },
    ],
    recentSamples,
    typeCount: 1,
  };
}

function isBatteryHistoryRow(row: Record<string, unknown>): boolean {
  const dt = strField(row, "data_type").toLowerCase();
  if (dt.includes("battery_history")) return true;
  const msg = strField(row, "message").toLowerCase();
  return msg.includes("battery history");
}

function isBatteryAppRow(row: Record<string, unknown>): boolean {
  const dt = strField(row, "data_type").toLowerCase();
  if (dt.includes("battery_app")) return true;
  const msg = strField(row, "message").toLowerCase();
  return msg.includes("battery stats app");
}

function isBatteryHardwareRow(row: Record<string, unknown>): boolean {
  const dt = strField(row, "data_type").toLowerCase();
  if (dt.includes("battery_hardware")) return true;
  const msg = strField(row, "message").toLowerCase();
  return msg.includes("battery kernel hardware");
}

function androidExtField(row: Record<string, unknown>, ext: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const top = row[key];
    if (top != null && String(top).trim()) return top;
    const nested = ext[key];
    if (nested != null && String(nested).trim()) return nested;
  }
  return undefined;
}

function formatAndroidTemp(value: unknown): string {
  const n = numFromValue(value);
  if (n == null) return "—";
  return `${(n / 10).toFixed(1)} °C`;
}

function pickAndroidTemperature(ext: Record<string, unknown>, row: Record<string, unknown>): string {
  const raw = androidExtField(row, ext, [
    "temp",
    "skin_temp",
    "ap_temp",
    "pa_temp",
    "sub_batt_temp",
    "tbat",
    "tsub",
    "tusb",
    "tchg",
    "twpc",
    "tblkt",
    "tdchg",
  ]);
  return formatAndroidTemp(raw);
}

function formatAndroidVolt(value: unknown): string {
  const n = numFromValue(value);
  if (n == null) return "—";
  if (n > 100) return `${(n / 1000).toFixed(2)} V`;
  return `${n} V`;
}

function formatAndroidCurrent(value: unknown): string {
  const n = numFromValue(value);
  if (n == null) return "—";
  return `${n} mA`;
}

function formatAndroidCharge(value: unknown): string {
  const n = numFromValue(value);
  if (n == null) return "—";
  // Bugreport SoC is 0–100. Values like 3175 are mV / capacity junk misfiled as charge.
  if (n >= 0 && n <= 100) return `${Math.round(n)}%`;
  if (n > 100 && n <= 1000) {
    // Occasional milli-percent (e.g. 785 = 78.5%).
    const pct = n / 10;
    if (pct <= 100) return `${pct % 1 === 0 ? pct : pct.toFixed(1)}%`;
  }
  return "—";
}

function formatDurationMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatAndroidBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function androidField(row: Record<string, unknown>, ext: Record<string, unknown>, key: string): string {
  const top = row[key];
  if (top != null && String(top).trim()) return String(top).trim();
  const nested = ext[key];
  if (nested == null) return "";
  return String(nested).trim();
}

function historySortKey(row: Record<string, unknown>): number {
  const ext = parseExt(row);
  const ts =
    androidField(row, ext, "timestamp") ||
    strField(row, "datetime") ||
    strField(row, "timestamp");
  const d = new Date(ts);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  return 0;
}

function parseHistorySample(row: Record<string, unknown>): AndroidBatteryHistorySample {
  const ext = parseExt(row);
  const flags = Array.isArray(ext.flags) ? (ext.flags as unknown[]).map(String).join(", ") : androidField(row, ext, "flags");
  return {
    when: androidField(row, ext, "timestamp") || formatRowTimestamp(row) || "—",
    status: androidField(row, ext, "status") || strField(row, "action") || "—",
    charge: formatAndroidCharge(
      androidExtField(row, ext, ["soc_percent", "msoc_percent", "ssoc_percent", "charge"])
    ),
    temp: pickAndroidTemperature(ext, row),
    volt: formatAndroidVolt(
      androidExtField(row, ext, ["volt", "vm_mv", "vavgm_mv", "vs_mv", "chgin_s_mv"])
    ),
    current: formatAndroidCurrent(
      androidExtField(row, ext, ["current", "inow_ma", "inow_m_ma", "iavg_ma", "ichg_ma", "ichg_m_ma"])
    ),
    plug: androidField(row, ext, "plug") || "—",
    health: androidField(row, ext, "health") || "—",
    flags,
  };
}

function parseHardwareSample(row: Record<string, unknown>): AndroidBatteryHardwareSample {
  const ext = parseExt(row);
  const socRaw = androidExtField(row, ext, ["soc_percent", "msoc_percent", "ssoc_percent"]);
  const socN = numFromValue(socRaw);
  return {
    when: androidField(row, ext, "timestamp") || formatRowTimestamp(row) || "—",
    soc: socN != null && socN <= 100 ? `${socN}%` : socRaw != null ? String(socRaw) : "—",
    voltage: formatAndroidVolt(
      androidExtField(row, ext, ["vm_mv", "vavgm_mv", "vs_mv", "vavgs_mv", "chgin_s_mv", "volt"])
    ),
    current: formatAndroidCurrent(
      androidExtField(row, ext, ["inow_ma", "inow_m_ma", "iavg_ma", "ichg_ma", "ichg_m_ma", "isysavg_ma"])
    ),
    temperature: pickAndroidTemperature(ext, row),
    chargerTemp: formatAndroidTemp(androidExtField(row, ext, ["tchg", "tusb", "twpc"])),
  };
}

function isAndroidChargingStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes("charg") && !s.includes("discharg");
}

function formatAndroidStatusLabel(status: string): string {
  const s = status.trim();
  if (!s || s === "—") return "—";
  if (/^charg/i.test(s) && !/discharg/i.test(s)) return "Charging";
  if (/discharg/i.test(s)) return "Discharging";
  if (/not[- ]?charg/i.test(s)) return "Not charging";
  if (/full/i.test(s)) return "Full";
  return s;
}

function androidStatusBadges(status: string, plug: string, health: string): string[] {
  const badges: string[] = [];
  const label = formatAndroidStatusLabel(status);
  if (label !== "—") badges.push(label);
  if (plug && plug !== "—" && plug.toLowerCase() !== "none") badges.push(plug);
  if (health && health !== "—" && health.toLowerCase() !== "unknown") badges.push(health);
  return badges;
}

function firstNonDash(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value !== "—") return value;
  }
  return "—";
}

function androidHeroStatsFromSamples(
  history: AndroidBatteryHistorySample[],
  hardware: AndroidBatteryHardwareSample[],
  latestHistory: AndroidBatteryHistorySample | undefined,
  latestHardware: AndroidBatteryHardwareSample | undefined
): BatteryHeroStats {
  return {
    temperature: firstNonDash(
      latestHistory?.temp,
      firstHistoryMetric(history, "temp"),
      latestHardware?.temperature,
      hardware[0]?.temperature
    ),
    voltage: firstNonDash(
      latestHistory?.volt,
      firstHistoryMetric(history, "volt"),
      latestHardware?.voltage,
      hardware[0]?.voltage
    ),
    amperage: firstNonDash(
      latestHistory?.current,
      firstHistoryMetric(history, "current"),
      latestHardware?.current,
      hardware[0]?.current
    ),
    designCapacity: "—",
    plug: latestHistory?.plug && latestHistory.plug !== "—" ? latestHistory.plug : "—",
    health: latestHistory?.health && latestHistory.health !== "—" ? latestHistory.health : "—",
  };
}

type AndroidBatteryAppInternal = AndroidBatteryApp & {
  wakelockMs: number;
  cpuMs: number;
  jobTimeMs: number;
  fgServiceMs: number;
  networkBytes: number;
  drainScore: number;
};

/** Composite drain score from bugreport per-app battery stats (higher = more drain). */
export function androidBatteryDrainScore(metrics: {
  wakelockMs: number;
  cpuMs: number;
  jobTimeMs: number;
  fgServiceMs: number;
  networkBytes: number;
}): number {
  return (
    metrics.wakelockMs * 1.0 +
    metrics.cpuMs * 0.85 +
    metrics.jobTimeMs * 0.7 +
    metrics.fgServiceMs * 0.5 +
    metrics.networkBytes / 1024
  );
}

function formatAppFromMetrics(
  pkg: string,
  metrics: {
    wakelockMs: number;
    cpuMs: number;
    jobTimeMs: number;
    jobCount: number;
    fgServiceMs: number;
    networkBytes: number;
    drainScore?: number;
  }
): AndroidBatteryAppInternal {
  const drainScore =
    metrics.drainScore ??
    androidBatteryDrainScore({
      wakelockMs: metrics.wakelockMs,
      cpuMs: metrics.cpuMs,
      jobTimeMs: metrics.jobTimeMs,
      fgServiceMs: metrics.fgServiceMs,
      networkBytes: metrics.networkBytes,
    });
  return {
    package: pkg,
    wakelock: metrics.wakelockMs > 0 ? formatDurationMs(metrics.wakelockMs) : "—",
    network: metrics.networkBytes > 0 ? formatAndroidBytes(metrics.networkBytes) : "—",
    cpu: metrics.cpuMs > 0 ? formatDurationMs(metrics.cpuMs) : "—",
    jobs: metrics.jobCount > 0 ? String(metrics.jobCount) : "—",
    foreground: metrics.fgServiceMs > 0 ? formatDurationMs(metrics.fgServiceMs) : "—",
    wakelockMs: metrics.wakelockMs,
    cpuMs: metrics.cpuMs,
    jobTimeMs: metrics.jobTimeMs,
    fgServiceMs: metrics.fgServiceMs,
    networkBytes: metrics.networkBytes,
    drainScore,
  };
}

function mergeAppMetrics(existing: AndroidBatteryAppInternal, incoming: AndroidBatteryAppInternal): AndroidBatteryAppInternal {
  return formatAppFromMetrics(existing.package, {
    wakelockMs: Math.max(existing.wakelockMs, incoming.wakelockMs),
    cpuMs: Math.max(existing.cpuMs, incoming.cpuMs),
    jobTimeMs: Math.max(existing.jobTimeMs, incoming.jobTimeMs),
    jobCount: Math.max(
      existing.jobs !== "—" ? Number(existing.jobs) : 0,
      incoming.jobs !== "—" ? Number(incoming.jobs) : 0
    ),
    fgServiceMs: Math.max(existing.fgServiceMs, incoming.fgServiceMs),
    networkBytes: Math.max(existing.networkBytes, incoming.networkBytes),
  });
}

function parseAppRow(row: Record<string, unknown>): AndroidBatteryAppInternal | null {
  const ext = parseExt(row);
  const pkg = androidField(row, ext, "package_name") || strField(row, "bundle_id");
  if (!pkg) return null;

  const wakelockMs = numFromValue(ext.total_wakelock_time_ms) ?? 0;
  const networkBytes =
    numFromValue(ext.total_network_bytes) ??
    (numFromValue(ext.network_rx_mobile) ?? 0) +
      (numFromValue(ext.network_tx_mobile) ?? 0) +
      (numFromValue(ext.network_rx_wifi) ?? 0) +
      (numFromValue(ext.network_tx_wifi) ?? 0);
  const cpuMs =
    (numFromValue(ext.cpu_user_time_ms) ?? 0) + (numFromValue(ext.cpu_system_time_ms) ?? 0);
  const jobTimeMs = numFromValue(ext.total_job_time_ms) ?? 0;
  const jobCount = numFromValue(ext.total_job_count) ?? 0;
  const fgServiceMs = numFromValue(ext.foreground_service_time_ms) ?? 0;

  return formatAppFromMetrics(pkg.replace(/^"|"$/g, ""), {
    wakelockMs,
    cpuMs,
    jobTimeMs,
    jobCount,
    fgServiceMs,
    networkBytes,
  });
}

export function androidBatteryViewFromRows(rows: Record<string, unknown>[]): AndroidBatteryView | null {
  const historyRows = rows
    .filter(isBatteryHistoryRow)
    .sort((a, b) => historySortKey(b) - historySortKey(a));
  const hardwareRows = rows
    .filter(isBatteryHardwareRow)
    .sort((a, b) => historySortKey(b) - historySortKey(a));
  const appRows = rows.filter(isBatteryAppRow);

  if (!historyRows.length && !hardwareRows.length && !appRows.length) return null;

  const history = historyRows.map(parseHistorySample);
  const hardware = hardwareRows.map(parseHardwareSample);
  const latest = history[0];
  const latestHardware = hardware[0];

  const appByPackage = new Map<string, AndroidBatteryAppInternal>();
  for (const row of appRows) {
    const app = parseAppRow(row);
    if (!app) continue;
    const existing = appByPackage.get(app.package);
    appByPackage.set(app.package, existing ? mergeAppMetrics(existing, app) : app);
  }

  const apps = [...appByPackage.values()].sort((a, b) => {
    if (b.drainScore !== a.drainScore) return b.drainScore - a.drainScore;
    if (b.wakelockMs !== a.wakelockMs) return b.wakelockMs - a.wakelockMs;
    if (b.cpuMs !== a.cpuMs) return b.cpuMs - a.cpuMs;
    return a.package.localeCompare(b.package);
  });

  const heroStats = androidHeroStatsFromSamples(history, hardware, latest, latestHardware);
  const status = latest?.status ?? "—";
  const plug = heroStats.plug;
  const health = heroStats.health;
  const chargeFromHistory = latest?.charge && latest.charge !== "—" ? latest.charge : "";
  const chargeFromHardware =
    latestHardware?.soc && latestHardware.soc !== "—" ? latestHardware.soc : "";
  // Prefer a real %-formatted SoC; never surface raw mV-like junk as the hero charge.
  const charge = chargeFromHistory || chargeFromHardware || "—";

  return {
    charge,
    status: formatAndroidStatusLabel(status),
    isCharging: isAndroidChargingStatus(status),
    statusBadges: androidStatusBadges(status, plug, health),
    plug,
    temp: heroStats.temperature,
    volt: heroStats.voltage,
    current: heroStats.amperage,
    health,
    heroStats,
    history: history.slice(0, 12),
    hardware: hardware.slice(0, 8),
    topApps: apps.slice(0, 8).map(({ drainScore: _d, wakelockMs: _w, cpuMs: _c, jobTimeMs: _j, fgServiceMs: _f, networkBytes: _n, ...app }) => app),
    historyCount: historyRows.length,
    hardwareCount: hardwareRows.length,
    appCount: appByPackage.size,
  };
}

export function iosBatteryQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="battery_bdc" | fields timestamp, datetime, message, timestamp_desc, ext | sort -timestamp | head 120`;
}

/** Powerlogs Battery Level samples (workshop-style chart). */
export function iosPowerlogsBatteryQuery(source: string): string {
  const src = escapeMplString(source);
  // timestamp_desc is searchable after re-ingest; message prefix works on older data.
  return (
    `source="${src}" parser="powerlogs" ` +
    `(timestamp_desc="Battery Level" OR message="Battery Level*") ` +
    `| fields timestamp, datetime, message, timestamp_desc, raw_level, level, ext ` +
    `| sort timestamp | head 4000`
  );
}

export type BatteryLevelPoint = {
  t: number;
  when: string;
  level: number;
  charging: boolean | null;
};

export type BatteryChargingRange = { x1: number; x2: number };

function scrapeMessageNum(message: string, key: string): number | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Avoid matching LEVEL inside RAW LEVEL.
  const re = new RegExp(`(?:^|[,:])\\s*${escaped}=([\\d.]+)`, "i");
  const m = message.match(re);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isBatteryLevelRow(message: string, desc: string): boolean {
  if (/^battery\s*level$/i.test(desc)) return true;
  if (/^battery\s*level\b/i.test(message)) return true;
  return false;
}

/** Parse event time for chart axes (ClickHouse datetime / epoch / Date). */
export function parseBatterySeriesTimestamp(row: Record<string, unknown>): number | null {
  const candidates: unknown[] = [row.datetime, row.timestamp, parseExt(row).timestamp];
  for (const raw of candidates) {
    if (raw == null || raw === "") continue;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const ms = raw > 1e14 ? Math.floor(raw / 1000) : raw < 1e12 ? raw * 1000 : raw;
      if (ms > 0) return ms;
      continue;
    }
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.getTime();
    const s = String(raw).trim();
    if (!s) continue;
    let t = Date.parse(s);
    if (!Number.isFinite(t) && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
      const iso = s.includes("T") ? s : s.replace(" ", "T");
      t = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
    }
    if (Number.isFinite(t)) return t;
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) {
      return n > 1e14 ? Math.floor(n / 1000) : n < 1e12 ? n * 1000 : n;
    }
  }
  return null;
}

function normalizeBatteryLevel(level: number): number | null {
  if (!Number.isFinite(level)) return null;
  // Some powerlogs emit 0–1 fractions.
  if (level > 0 && level <= 1) return Math.round(level * 1000) / 10;
  if (level < 0 || level > 100) return null;
  return level;
}

function dedupBatterySeries(points: BatteryLevelPoint[]): BatteryLevelPoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const dedup: BatteryLevelPoint[] = [];
  for (const p of sorted) {
    const last = dedup[dedup.length - 1];
    if (last && last.t === p.t) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  return dedup;
}

/** Keep chart readable when powerlogs return thousands of samples. */
export function downsampleBatterySeries(
  points: BatteryLevelPoint[],
  maxPoints = 400
): BatteryLevelPoint[] {
  if (points.length <= maxPoints) return points;
  const out: BatteryLevelPoint[] = [];
  const lastIdx = points.length - 1;
  const step = lastIdx / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const idx = i === maxPoints - 1 ? lastIdx : Math.round(i * step);
    out.push(points[idx]!);
  }
  return out;
}

/** Highlight intervals where IS CHARGING was true. */
export function batteryChargingRanges(series: BatteryLevelPoint[]): BatteryChargingRange[] {
  const ranges: BatteryChargingRange[] = [];
  let start: number | null = null;
  for (const point of series) {
    if (point.charging === true) {
      if (start == null) start = point.t;
    } else if (start != null) {
      ranges.push({ x1: start, x2: point.t });
      start = null;
    }
  }
  if (start != null && series.length > 0) {
    ranges.push({ x1: start, x2: series[series.length - 1]!.t });
  }
  return ranges.filter((r) => r.x2 > r.x1);
}

/** Extract a Battery Level time series from powerlogs rows (ext or message). */
export function iosBatteryLevelSeriesFromRows(
  rows: Record<string, unknown>[]
): BatteryLevelPoint[] {
  const out: BatteryLevelPoint[] = [];
  for (const row of rows) {
    const message = strField(row, "message");
    const desc = strField(row, "timestamp_desc");
    if (!isBatteryLevelRow(message, desc)) continue;

    const ext = parseExt(row);
    const level = normalizeBatteryLevel(
      numFromValue(ext.raw_level) ??
        numFromValue(ext.level) ??
        numField(row, "raw_level") ??
        numField(row, "level") ??
        scrapeMessageNum(message, "RAW LEVEL") ??
        scrapeMessageNum(message, "LEVEL") ??
        NaN
    );
    if (level == null) continue;

    const t = parseBatterySeriesTimestamp(row);
    if (t == null) continue;

    const chargeRaw =
      extField(row, "is_charging") ||
      extField(row, "IS CHARGING") ||
      (scrapeMessageNum(message, "IS CHARGING") != null
        ? String(scrapeMessageNum(message, "IS CHARGING"))
        : "");
    const charging =
      chargeRaw === ""
        ? null
        : chargeRaw === "1" || /^true|yes|charg/i.test(chargeRaw);

    out.push({
      t,
      when: formatRowTimestamp(row) || new Date(t).toISOString(),
      level,
      charging,
    });
  }
  return dedupBatterySeries(out);
}

/** Fallback chart series from battery_bdc StateOfCharge samples. */
export function iosBatterySocSeriesFromBdcRows(
  rows: Record<string, unknown>[]
): BatteryLevelPoint[] {
  const out: BatteryLevelPoint[] = [];
  for (const row of rows) {
    const ext = iosBatteryExtFromRow(row);
    const soc =
      normalizeBatteryLevel(numFromValue(ext.StateOfCharge) ?? NaN) ??
      normalizeBatteryLevel(numFromValue(ext.CurrentCapacity) ?? NaN);
    if (soc == null) continue;
    const t = parseBatterySeriesTimestamp(row);
    if (t == null) continue;
    out.push({
      t,
      when: formatRowTimestamp(row) || new Date(t).toISOString(),
      level: soc,
      charging: ext.IsCharging ? isTruthyFlag(ext.IsCharging) : null,
    });
  }
  return dedupBatterySeries(out);
}

export function androidBatteryQuery(source: string): string {
  const src = escapeMplString(source);
  return (
    `source="${src}" parser="Battery" ` +
    `| fields timestamp, datetime, message, data_type, bundle_id, action, ext ` +
    `| sort -timestamp | head 400`
  );
}

/** History + hardware rows for the Android SoC timeline chart. */
export function androidBatteryLevelQuery(source: string): string {
  const src = escapeMplString(source);
  return (
    `source="${src}" parser="Battery" ` +
    `(data_type="*battery_history*" OR data_type="*battery_hardware*" ` +
    `OR message="Battery history*" OR message="Battery kernel hardware*") ` +
    `| fields timestamp, datetime, message, data_type, action, ext ` +
    `| sort timestamp | head 4000`
  );
}

/**
 * Resolve Android battery sample time.
 * Prefer the event timestamp; when ext carries SEC-LOG `MM-DD HH:MM:SS.mmm`, bind the year
 * from the event / capture time so the chart spans the history correctly.
 */
export function parseAndroidBatterySeriesTimestamp(row: Record<string, unknown>): number | null {
  const eventT = parseBatterySeriesTimestamp(row);
  const ext = parseExt(row);
  // Prefer SEC-LOG / history stamp in ext over the row event timestamp.
  const raw =
    (typeof ext.timestamp === "string" ? ext.timestamp : "") ||
    androidField(row, ext, "timestamp");
  const mmdd = String(raw)
    .trim()
    .match(/^(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  if (!mmdd) return eventT;

  const year = eventT != null ? new Date(eventT).getUTCFullYear() : new Date().getUTCFullYear();
  const iso = `${year}-${mmdd[1]}-${mmdd[2]}T${mmdd[3]}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return eventT;

  const eventMonth = eventT != null ? new Date(eventT).getUTCMonth() + 1 : 0;
  const histMonth = Number(mmdd[1]);
  let adjusted = t;
  if (eventMonth > 0 && eventMonth <= 2 && histMonth >= 11) {
    adjusted = Date.parse(`${year - 1}-${mmdd[1]}-${mmdd[2]}T${mmdd[3]}Z`);
  } else if (eventMonth >= 11 && histMonth <= 2) {
    adjusted = Date.parse(`${year + 1}-${mmdd[1]}-${mmdd[2]}T${mmdd[3]}Z`);
  }
  return Number.isFinite(adjusted) ? adjusted : t;
}

/** Battery level series from Android Battery history / kernel hardware rows. */
export function androidBatteryLevelSeriesFromRows(
  rows: Record<string, unknown>[]
): BatteryLevelPoint[] {
  const out: BatteryLevelPoint[] = [];
  for (const row of rows) {
    const history = isBatteryHistoryRow(row);
    const hardware = isBatteryHardwareRow(row);
    if (!history && !hardware) continue;

    const ext = parseExt(row);
    const level = normalizeBatteryLevel(
      numFromValue(
        history
          ? androidExtField(row, ext, ["charge", "soc_percent", "msoc_percent"])
          : androidExtField(row, ext, ["soc_percent", "msoc_percent", "ssoc_percent", "charge"])
      ) ?? NaN
    );
    if (level == null) continue;

    const t = parseAndroidBatterySeriesTimestamp(row);
    if (t == null) continue;

    const status = androidField(row, ext, "status") || strField(row, "action");
    let charging: boolean | null = null;
    if (status) {
      const s = status.toLowerCase();
      if (s.includes("charg") && !s.includes("discharg")) charging = true;
      else if (s.includes("discharg")) charging = false;
    }
    if (charging == null) {
      const flags = Array.isArray(ext.flags) ? (ext.flags as unknown[]).map(String) : [];
      if (flags.some((f) => f === "+charging" || f === "+plugged")) charging = true;
      else if (flags.some((f) => f === "-charging" || f === "-plugged")) charging = false;
    }

    out.push({
      t,
      when: formatRowTimestamp(row) || new Date(t).toLocaleString(),
      level,
      charging,
    });
  }

  // Prefer history points when both history and hardware share a timestamp.
  const sorted = dedupBatterySeries(out);
  return sorted;
}
