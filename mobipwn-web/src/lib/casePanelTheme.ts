import type { PanelViz } from "@/lib/dashboard";
import {
  CASE_ADB_PANEL_ID,
  CASE_ANDROID_DANGEROUS_PERMS_PANEL_ID,
  CASE_AUTHENTICATION_PANEL_ID,
  CASE_BLUETOOTH_PANEL_ID,
  CASE_CRASH_TRACES_PANEL_ID,
  CASE_DELETED_PACKAGES_PANEL_ID,
  CASE_IOS_MOBILE_INSTALL_PANEL_ID,
  CASE_DEVICE_HEADER_PANEL_ID,
  CASE_DEVICE_POLICY_PANEL_ID,
  CASE_MEMORY_PANEL_ID,
  CASE_NETWORK_SOCKETS_PANEL_ID,
  CASE_NETWORK_LISTEN_PORTS_PANEL_ID,
  CASE_NETWORK_FLOW_PANEL_ID,
  CASE_NETWORK_USAGE_PANEL_ID,
  CASE_PACKAGES_PANEL_ID,
  CASE_POWER_HISTORY_PANEL_ID,
  CASE_BATTERY_PANEL_ID,
  CASE_PRIVACY_PANEL_ID,
  CASE_VPN_PANEL_ID,
  CASE_ACCOUNTS_PANEL_ID,
  CASE_PROCESSES_PANEL_ID,
  CASE_IOS_RUNNING_SERVICES_PANEL_ID,
  CASE_IOS_PROCESS_EVENTS_PANEL_ID,
  CASE_TIMELINE_PANEL_ID,
  CASE_IOS_BATTERY_PANEL_ID,
  CASE_IOS_STORAGE_PANEL_ID,
  CASE_IOS_SECURITY_PANEL_ID,
  CASE_IOS_LOCK_STATE_PANEL_ID,
  CASE_IOS_TCC_PANEL_ID,
  CASE_IOS_SENSITIVE_PERMS_PANEL_ID,
  CASE_IOS_WIFI_PANEL_ID,
  CASE_IOS_WIFI_NETWORKS_PANEL_ID,
  CASE_IOS_WIFI_KNOWN_PANEL_ID,
  CASE_IOS_WIFI_SECURITY_PANEL_ID,
  CASE_IOS_SWCUTIL_DOMAINS_PANEL_ID,
  CASE_IOS_POWERLOG_PUSH_PANEL_ID,
  CASE_IOS_POWERLOG_USAGE_PANEL_ID,
  CASE_IOS_NETWORK_EXTENSION_PANEL_ID,
  CASE_IOS_PLIST_URLS_PANEL_ID,
  CASE_IOS_TRANSPARENCY_CONTACTS_PANEL_ID,
  CASE_IOS_NETWORK_IOCS_PANEL_ID,
  CASE_IOS_NETUSAGE_PANEL_ID,
  CASE_IOS_SAFARI_HISTORY_PANEL_ID,
  CASE_IOS_KNOWLEDGE_WEB_PANEL_ID,
  CASE_IOS_LOG_IPS_PANEL_ID,
  CASE_IOS_LOGARCHIVE_PANEL_ID,
  CASE_IOS_IOSERVICE_PANEL_ID,
  CASE_IOS_ACTIVATION_PANEL_ID,
  CASE_IOS_USB_PANEL_ID,
} from "@/lib/caseDashboard";

/** Semantic accent bucket for case dashboard panel chrome. */
export type CasePanelTheme =
  | "device"
  | "stats"
  | "timeline"
  | "apps"
  | "network"
  | "power"
  | "security"
  | "wireless"
  | "system"
  | "crashes"
  | "chart"
  | "default";

const PANEL_THEME_BY_ID: Record<string, CasePanelTheme> = {
  [CASE_DEVICE_HEADER_PANEL_ID]: "device",
  case_events: "stats",
  [CASE_TIMELINE_PANEL_ID]: "timeline",
  [CASE_PACKAGES_PANEL_ID]: "apps",
  [CASE_IOS_MOBILE_INSTALL_PANEL_ID]: "apps",
  [CASE_DELETED_PACKAGES_PANEL_ID]: "apps",
  [CASE_PROCESSES_PANEL_ID]: "system",
  [CASE_IOS_RUNNING_SERVICES_PANEL_ID]: "system",
  [CASE_IOS_PROCESS_EVENTS_PANEL_ID]: "system",
  case_last_install: "apps",
  case_bundles: "apps",
  case_sideload: "apps",
  [CASE_NETWORK_SOCKETS_PANEL_ID]: "network",
  [CASE_NETWORK_LISTEN_PORTS_PANEL_ID]: "network",
  [CASE_NETWORK_FLOW_PANEL_ID]: "network",
  [CASE_NETWORK_USAGE_PANEL_ID]: "network",
  case_dest_ips: "network",
  case_network_log: "network",
  case_usb_actions: "wireless",
  case_bluetooth_events: "wireless",
  case_domains: "network",
  [CASE_POWER_HISTORY_PANEL_ID]: "power",
  [CASE_BATTERY_PANEL_ID]: "power",
  [CASE_IOS_BATTERY_PANEL_ID]: "power",
  [CASE_IOS_STORAGE_PANEL_ID]: "system",
  [CASE_IOS_ACTIVATION_PANEL_ID]: "device",
  [CASE_IOS_SECURITY_PANEL_ID]: "security",
  [CASE_IOS_LOCK_STATE_PANEL_ID]: "security",
  [CASE_IOS_TCC_PANEL_ID]: "security",
  [CASE_IOS_SENSITIVE_PERMS_PANEL_ID]: "security",
  [CASE_ANDROID_DANGEROUS_PERMS_PANEL_ID]: "security",
  [CASE_IOS_WIFI_PANEL_ID]: "wireless",
  [CASE_IOS_WIFI_NETWORKS_PANEL_ID]: "wireless",
  [CASE_IOS_WIFI_KNOWN_PANEL_ID]: "wireless",
  [CASE_IOS_WIFI_SECURITY_PANEL_ID]: "wireless",
  [CASE_IOS_SWCUTIL_DOMAINS_PANEL_ID]: "network",
  [CASE_IOS_POWERLOG_PUSH_PANEL_ID]: "network",
  [CASE_IOS_POWERLOG_USAGE_PANEL_ID]: "network",
  [CASE_IOS_NETWORK_EXTENSION_PANEL_ID]: "security",
  [CASE_IOS_PLIST_URLS_PANEL_ID]: "network",
  [CASE_IOS_TRANSPARENCY_CONTACTS_PANEL_ID]: "security",
  [CASE_IOS_NETWORK_IOCS_PANEL_ID]: "network",
  [CASE_IOS_NETUSAGE_PANEL_ID]: "network",
  [CASE_IOS_SAFARI_HISTORY_PANEL_ID]: "network",
  [CASE_IOS_KNOWLEDGE_WEB_PANEL_ID]: "network",
  [CASE_IOS_LOG_IPS_PANEL_ID]: "network",
  [CASE_IOS_LOGARCHIVE_PANEL_ID]: "network",
  [CASE_IOS_IOSERVICE_PANEL_ID]: "device",
  [CASE_IOS_USB_PANEL_ID]: "wireless",
  case_storage: "system",
  [CASE_AUTHENTICATION_PANEL_ID]: "security",
  [CASE_PRIVACY_PANEL_ID]: "security",
  [CASE_DEVICE_POLICY_PANEL_ID]: "security",
  [CASE_VPN_PANEL_ID]: "security",
  [CASE_ACCOUNTS_PANEL_ID]: "device",
  [CASE_BLUETOOTH_PANEL_ID]: "wireless",
  case_usb: "wireless",
  [CASE_ADB_PANEL_ID]: "wireless",
  [CASE_MEMORY_PANEL_ID]: "system",
  case_parsers: "system",
  [CASE_CRASH_TRACES_PANEL_ID]: "crashes",
  case_high_sev: "crashes",
  case_devices: "device",
};

function themeFromViz(viz: PanelViz): CasePanelTheme {
  switch (viz) {
    case "single_value":
      return "stats";
    case "timechart":
      return "timeline";
    case "bar":
    case "pie":
    case "line":
    case "area":
      return "chart";
    default:
      return "default";
  }
}

export function resolveCasePanelTheme(panel: {
  id: string;
  viz: PanelViz;
}): CasePanelTheme {
  return PANEL_THEME_BY_ID[panel.id] ?? themeFromViz(panel.viz);
}
