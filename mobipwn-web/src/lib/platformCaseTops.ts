import { applyTimePresetToQuery } from "@/lib/dashboard";
import { toBarData, type SearchRow } from "@/lib/dashboardPanelData";

/** Built-in dashboard panel id — multi-section Android/iOS case highlights. */
export const PLATFORM_CASE_TOPS_PANEL_ID = "platform_case_tops";

export const BUILTIN_DASHBOARD_PANEL_IDS = new Set([
  "alerts_link",
  PLATFORM_CASE_TOPS_PANEL_ID,
]);

export function isBuiltInDashboardPanel(id: string): boolean {
  return BUILTIN_DASHBOARD_PANEL_IDS.has(id);
}

export type PlatformCaseTopSection = {
  id: string;
  labelKey:
    | "platformTopsAndroidApps"
    | "platformTopsAndroidProcesses"
    | "platformTopsAndroidIps"
    | "platformTopsAndroidDomains"
    | "platformTopsIosApps"
    | "platformTopsIosProcesses"
    | "platformTopsIosIps"
    | "platformTopsIosDomains";
  query: string;
  drilldownField: string;
};

export const PLATFORM_CASE_TOP_SECTIONS: PlatformCaseTopSection[] = [
  {
    id: "android_apps",
    labelKey: "platformTopsAndroidApps",
    query: 'platform="android" parser="Package" bundle_id=* | stats count by bundle_id | head 8',
    drilldownField: "bundle_id",
  },
  {
    id: "android_processes",
    labelKey: "platformTopsAndroidProcesses",
    query: 'platform="android" process_name=* | stats count by process_name | head 8',
    drilldownField: "process_name",
  },
  {
    id: "android_ips",
    labelKey: "platformTopsAndroidIps",
    query: 'platform="android" parser="Network" dest_ip=* | stats count by dest_ip | head 8',
    drilldownField: "dest_ip",
  },
  {
    id: "android_domains",
    labelKey: "platformTopsAndroidDomains",
    query: 'platform="android" destination_domain=* | stats count by destination_domain | head 8',
    drilldownField: "destination_domain",
  },
  {
    id: "ios_apps",
    labelKey: "platformTopsIosApps",
    query: 'platform="ios" bundle_id=* | stats count by bundle_id | head 8',
    drilldownField: "bundle_id",
  },
  {
    id: "ios_processes",
    labelKey: "platformTopsIosProcesses",
    query: 'platform="ios" process_name=* | stats count by process_name | head 8',
    drilldownField: "process_name",
  },
  {
    id: "ios_ips",
    labelKey: "platformTopsIosIps",
    query: 'platform="ios" parser="network_iocs" ioc_kind="ipv4" | stats count by dest_ip | head 8',
    drilldownField: "dest_ip",
  },
  {
    id: "ios_domains",
    labelKey: "platformTopsIosDomains",
    query: 'platform="ios" destination_domain=* | stats count by destination_domain | head 8',
    drilldownField: "destination_domain",
  },
];

export type PlatformCaseTopItem = {
  label: string;
  value: number;
  field: string;
};

export type PlatformCaseTopSectionResult = {
  section: PlatformCaseTopSection;
  items: PlatformCaseTopItem[];
  loading: boolean;
  error: string;
  elapsedMs: number | null;
};

export function rowsToTopItems(rows: SearchRow[], columns: string[]): PlatformCaseTopItem[] {
  return toBarData(rows, columns);
}

export function queryForSection(section: PlatformCaseTopSection, timePreset: string): string {
  return applyTimePresetToQuery(section.query, timePreset);
}

/** Human label for opaque IP placeholders in top-destination lists. */
export function formatTopDestIpLabel(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed === "::" || trimmed === "::0") {
    return ":: — unspecified IPv6";
  }
  if (trimmed === "0.0.0.0") {
    return "0.0.0.0 — unspecified IPv4";
  }
  return ip;
}

export function formatPlatformTopLabel(field: string, label: string): string {
  if (field === "dest_ip") return formatTopDestIpLabel(label);
  return label;
}
