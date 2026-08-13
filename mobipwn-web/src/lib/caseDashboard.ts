import {
  createPanel,
  parseDashboardDocument,
  type DashboardDocument,
  type DashboardPanel,
} from "@/lib/dashboard";
import type { CaseRecord } from "@/lib/cases";
import { escapeMplString } from "@/lib/mplQuery";

export type CasePlatform = "android" | "ios" | "endpoint";

export const CASE_PLATFORMS: CasePlatform[] = ["android", "ios", "endpoint"];

export const CASE_DEVICE_HEADER_PANEL_ID = "case_device_header";
export const CASE_CRASH_TRACES_PANEL_ID = "case_crash_traces";
export const CASE_POWER_HISTORY_PANEL_ID = "case_power_history";
export const CASE_BATTERY_PANEL_ID = "case_battery";
export const CASE_NETWORK_USAGE_PANEL_ID = "case_network_usage";
export const CASE_NETWORK_SOCKETS_PANEL_ID = "case_network";
export const CASE_NETWORK_LISTEN_PORTS_PANEL_ID = "case_network_listen";
export const CASE_NETWORK_FLOW_PANEL_ID = "case_network_flow";
export const CASE_BLUETOOTH_PANEL_ID = "case_bluetooth";
/** Android USB host devices / ports (bugreport Usb parser). */
export const CASE_ANDROID_USB_PANEL_ID = "case_usb";
export const CASE_MEMORY_PANEL_ID = "case_memory";
export const CASE_PRIVACY_PANEL_ID = "case_privacy";
export const CASE_AUTHENTICATION_PANEL_ID = "case_authentication";
export const CASE_VPN_PANEL_ID = "case_vpn";
export const CASE_ACCOUNTS_PANEL_ID = "case_accounts";
export const CASE_PACKAGES_PANEL_ID = "case_packages";
export const CASE_IOS_MOBILE_INSTALL_PANEL_ID = "case_ios_mobile_install";
export const CASE_ANDROID_DANGEROUS_PERMS_PANEL_ID = "case_android_dangerous_perms";
export const CASE_PROCESSES_PANEL_ID = "case_processes";
export const CASE_IOS_RUNNING_SERVICES_PANEL_ID = "case_ios_running_services";
export const CASE_IOS_PROCESS_EVENTS_PANEL_ID = "case_ios_process_events";
export const CASE_ADB_PANEL_ID = "case_adb";
export const CASE_DEVICE_POLICY_PANEL_ID = "case_device_policy";
export const CASE_DELETED_PACKAGES_PANEL_ID = "case_deleted_packages";
export const CASE_APK_DOWNGRADE_PANEL_ID = "case_apk_downgrade";
export const CASE_TIMELINE_PANEL_ID = "case_timeline";
export const CASE_IOS_BATTERY_PANEL_ID = "case_ios_battery";
export const CASE_IOS_STORAGE_PANEL_ID = "case_ios_storage";
export const CASE_IOS_SECURITY_PANEL_ID = "case_ios_security";
export const CASE_IOS_LOCK_STATE_PANEL_ID = "case_ios_lock_state";
export const CASE_IOS_TCC_PANEL_ID = "case_ios_tcc";
export const CASE_IOS_SENSITIVE_PERMS_PANEL_ID = "case_ios_sensitive_perms";
export const CASE_IOS_WIFI_PANEL_ID = "case_ios_wifi";
export const CASE_IOS_WIFI_NETWORKS_PANEL_ID = "case_ios_wifi_networks";
export const CASE_IOS_WIFI_KNOWN_PANEL_ID = "case_ios_wifi_known";
export const CASE_IOS_WIFI_SECURITY_PANEL_ID = "case_ios_wifi_security";
export const CASE_IOS_SWCUTIL_DOMAINS_PANEL_ID = "case_ios_swcutil_domains";
export const CASE_IOS_POWERLOG_PUSH_PANEL_ID = "case_ios_powerlog_push";
export const CASE_IOS_POWERLOG_USAGE_PANEL_ID = "case_ios_powerlog_usage";
export const CASE_IOS_NETWORK_EXTENSION_PANEL_ID = "case_ios_network_extension";
export const CASE_IOS_PLIST_URLS_PANEL_ID = "case_ios_plist_urls";
export const CASE_IOS_TRANSPARENCY_CONTACTS_PANEL_ID = "case_ios_transparency_contacts";
export const CASE_IOS_NETWORK_IOCS_PANEL_ID = "case_ios_network_iocs";
export const CASE_IOS_NETUSAGE_PANEL_ID = "case_ios_netusage";
export const CASE_IOS_SAFARI_HISTORY_PANEL_ID = "case_ios_safari_history";
export const CASE_IOS_KNOWLEDGE_WEB_PANEL_ID = "case_ios_knowledge_web";
export const CASE_IOS_CONNECTED_DOMAINS_PANEL_ID = "case_ios_connected_domains";
export const CASE_IOS_QUARANTINE_URLS_PANEL_ID = "case_ios_quarantine_urls";
export const CASE_IOS_SCREENTIME_DOMAINS_PANEL_ID = "case_ios_screentime_domains";
export const CASE_IOS_INTERACTION_URLS_PANEL_ID = "case_ios_interaction_urls";
export const CASE_IOS_LOG_IPS_PANEL_ID = "case_ios_log_ips";
export const CASE_IOS_LOGARCHIVE_PANEL_ID = "case_ios_logarchive";
export const CASE_IOS_IOSERVICE_PANEL_ID = "case_ios_ioservice";
export const CASE_IOS_ACTIVATION_PANEL_ID = "case_ios_activation";
export const CASE_IOS_USB_PANEL_ID = "case_ios_usb";

/** Bump when the default Android layout changes — older saved layouts are replaced. */
export const ANDROID_CASE_DASHBOARD_VERSION = 29;

/** Bump when the default iOS layout changes — older saved layouts are replaced. */
export const IOS_CASE_DASHBOARD_VERSION = 28;

/** Bump when the Android network section layout changes. */
export const ANDROID_CASE_NETWORK_DASHBOARD_VERSION = 11;

/** Bump when the iOS network section layout changes. */
export const IOS_CASE_NETWORK_DASHBOARD_VERSION = 14;

/** Bump when the Android packages section layout changes. */
export const ANDROID_CASE_PACKAGES_DASHBOARD_VERSION = 7;

/** Bump when the iOS packages section layout changes. */
export const IOS_CASE_PACKAGES_DASHBOARD_VERSION = 7;

/** Bump when the Android processes section layout changes. */
export const ANDROID_CASE_PROCESSES_DASHBOARD_VERSION = 4;

/** Bump when the iOS processes section layout changes. */
export const IOS_CASE_PROCESSES_DASHBOARD_VERSION = 11;

/** Bump when the Android crashes section layout changes. */
export const ANDROID_CASE_CRASHES_DASHBOARD_VERSION = 3;

/** Bump when the iOS crashes section layout changes. */
export const IOS_CASE_CRASHES_DASHBOARD_VERSION = 3;

/** Bump when the Android external-devices section layout changes. */
export const ANDROID_CASE_EXTERNAL_DEVICES_DASHBOARD_VERSION = 2;

/** Bump when the iOS external-devices section layout changes. */
export const IOS_CASE_EXTERNAL_DEVICES_DASHBOARD_VERSION = 7;

/** Bump when the Android battery section layout changes. */
export const ANDROID_CASE_BATTERY_DASHBOARD_VERSION = 2;

/** Bump when the iOS battery section layout changes. */
export const IOS_CASE_BATTERY_DASHBOARD_VERSION = 1;

/** Bump when the iOS process-events section layout changes. */
export const IOS_CASE_PROCESS_EVENTS_DASHBOARD_VERSION = 1;

/** Bump when the Android authentication section layout changes. */
export const ANDROID_CASE_AUTHENTICATION_DASHBOARD_VERSION = 3;

/** Bump when the iOS authentication section layout changes. */
export const IOS_CASE_AUTHENTICATION_DASHBOARD_VERSION = 3;

export type CaseDashboardSectionId =
  | "overview"
  | "crashes"
  | "packages"
  | "processes"
  | "process_events"
  | "battery"
  | "external_devices"
  | "network"
  | "authentication"
  | "entities";

type SavedCaseDashboard = DashboardDocument & { case_platform?: CasePlatform };

export const CASE_BUILTIN_PANEL_IDS = new Set<string>([
  CASE_DEVICE_HEADER_PANEL_ID,
  CASE_CRASH_TRACES_PANEL_ID,
  CASE_POWER_HISTORY_PANEL_ID,
  CASE_BATTERY_PANEL_ID,
  CASE_NETWORK_USAGE_PANEL_ID,
  CASE_NETWORK_SOCKETS_PANEL_ID,
  CASE_NETWORK_LISTEN_PORTS_PANEL_ID,
  CASE_NETWORK_FLOW_PANEL_ID,
  CASE_BLUETOOTH_PANEL_ID,
  CASE_ANDROID_USB_PANEL_ID,
  CASE_MEMORY_PANEL_ID,
  CASE_PRIVACY_PANEL_ID,
  CASE_AUTHENTICATION_PANEL_ID,
  CASE_VPN_PANEL_ID,
  CASE_ACCOUNTS_PANEL_ID,
  CASE_PACKAGES_PANEL_ID,
  CASE_IOS_MOBILE_INSTALL_PANEL_ID,
  CASE_ANDROID_DANGEROUS_PERMS_PANEL_ID,
  CASE_PROCESSES_PANEL_ID,
  CASE_IOS_RUNNING_SERVICES_PANEL_ID,
  CASE_IOS_PROCESS_EVENTS_PANEL_ID,
  CASE_ADB_PANEL_ID,
  CASE_DEVICE_POLICY_PANEL_ID,
  CASE_DELETED_PACKAGES_PANEL_ID,
  CASE_APK_DOWNGRADE_PANEL_ID,
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
  CASE_IOS_CONNECTED_DOMAINS_PANEL_ID,
  CASE_IOS_QUARANTINE_URLS_PANEL_ID,
  CASE_IOS_SCREENTIME_DOMAINS_PANEL_ID,
  CASE_IOS_INTERACTION_URLS_PANEL_ID,
  CASE_IOS_LOG_IPS_PANEL_ID,
  CASE_IOS_LOGARCHIVE_PANEL_ID,
  CASE_IOS_IOSERVICE_PANEL_ID,
  CASE_IOS_ACTIVATION_PANEL_ID,
  CASE_IOS_USB_PANEL_ID,
]);

/** Bugreport parsers from bugreport-extractor-library (same set as webadb-rs bugreport analysis). */
export const BUGREPORT_PARSER_NAMES = [
  "Header",
  "Memory",
  "Battery",
  "Package",
  "Process",
  "Power",
  "Usb",
  "Crash",
  "Network",
  "Bluetooth",
  "DevicePolicy",
  "Adb",
  "Authentication",
  "Account",
  "Vpn",
  "Privacy",
  "Logcat",
  "SamsungSfsLogs",
] as const;

export function isCaseBuiltinPanel(id: string): boolean {
  return CASE_BUILTIN_PANEL_IDS.has(id);
}

const CASE_PANEL_BODY_CUSTOM_CLASS: Record<string, string> = {
  [CASE_TIMELINE_PANEL_ID]: "case-panel-body--timeline",
  [CASE_NETWORK_FLOW_PANEL_ID]: "case-panel-body--network-flow",
  [CASE_DEVICE_HEADER_PANEL_ID]: "case-panel-body--device",
};

/** Scrollable body for builtin panels — pins headers/footers, scrolls list content. */
export function caseBuiltinPanelBodyClass(panelId: string): string | undefined {
  if (!isCaseBuiltinPanel(panelId)) return undefined;
  return CASE_PANEL_BODY_CUSTOM_CLASS[panelId] ?? "case-panel-body--list-scroll";
}

const STORAGE_PREFIX = "mobipwn-case-dashboard:";

const BASE_LAYOUT = { minW: 3, minH: 2 } as const;

function panel(
  id: string,
  title: string,
  query: string,
  viz: DashboardPanel["viz"],
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return {
    id,
    title,
    query,
    viz,
    layout: { i: id, ...BASE_LAYOUT, ...layout },
  };
}

function deviceHeaderPanel(): DashboardPanel {
  return panel(CASE_DEVICE_HEADER_PANEL_ID, "Device", "", "table", {
    x: 0,
    y: 0,
    w: 12,
    h: 7,
    minH: 5,
  });
}

function iosBatteryPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_BATTERY_PANEL_ID, "Battery", "", "table", {
    minH: 4,
    ...layout,
  });
}

function iosStoragePanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_IOS_STORAGE_PANEL_ID, "Storage", "", "table", {
    ...layout,
    minH: 4,
  });
}

function iosIoservicePanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_IOS_IOSERVICE_PANEL_ID, "IOService hardware", "", "table", {
    ...layout,
    minH: 4,
  });
}

function iosLogarchivePanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_LOGARCHIVE_PANEL_ID, "Unified logs", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosLogIpsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_LOG_IPS_PANEL_ID, "IPs in log text", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosActivationPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_IOS_ACTIVATION_PANEL_ID, "Activation", "", "table", {
    ...layout,
    minH: 4,
  });
}

function iosSecurityPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_IOS_SECURITY_PANEL_ID, "Paired devices", "", "table", {
    ...layout,
    minH: 4,
  });
}

function iosLockStatePanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_IOS_LOCK_STATE_PANEL_ID, "Lock / unlock", "", "table", {
    ...layout,
    minH: 8,
  });
}

function iosTccPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_IOS_TCC_PANEL_ID, "App permissions", "", "table", {
    ...layout,
    minH: 4,
  });
}

function iosSensitivePermissionsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">
): DashboardPanel {
  return panel(CASE_IOS_SENSITIVE_PERMS_PANEL_ID, "Sensitive permissions", "", "table", {
    ...layout,
    minH: 5,
  });
}

function iosWifiPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_WIFI_PANEL_ID, "Wi‑Fi scan", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosUsbPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_USB_PANEL_ID, "USB / cable", "", "table", {
    minH: 6,
    minW: 6,
    ...layout,
  });
}

function iosWifiNetworksPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_WIFI_NETWORKS_PANEL_ID, "Saved Wi‑Fi networks", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosWifiKnownPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_WIFI_KNOWN_PANEL_ID, "Wi‑Fi geolocation", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosWifiSecurityPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_WIFI_SECURITY_PANEL_ID, "Wi‑Fi security", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosSwcutilDomainsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_SWCUTIL_DOMAINS_PANEL_ID, "Associated domains", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosPowerlogPushPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_POWERLOG_PUSH_PANEL_ID, "Push server endpoints", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosPowerlogUsagePanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_POWERLOG_USAGE_PANEL_ID, "Process network bytes", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosNetworkExtensionPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_NETWORK_EXTENSION_PANEL_ID, "VPN / proxy config", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosPlistUrlsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_PLIST_URLS_PANEL_ID, "URLs in plists", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosTransparencyContactsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_TRANSPARENCY_CONTACTS_PANEL_ID, "Contact URIs", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosNetworkIocsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_NETWORK_IOCS_PANEL_ID, "Network IOCs", "", "table", {
    minH: 4,
    ...layout,
  });
}

function iosNetusagePanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_NETUSAGE_PANEL_ID, "Netusage routes", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosSafariHistoryPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_SAFARI_HISTORY_PANEL_ID, "Safari history", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosKnowledgeWebPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_KNOWLEDGE_WEB_PANEL_ID, "App web usage", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosConnectedDomainsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_CONNECTED_DOMAINS_PANEL_ID, "Connected domains", "", "table", {
    minH: 4,
    ...layout,
  });
}

function iosQuarantineUrlsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_QUARANTINE_URLS_PANEL_ID, "Quarantine download URLs", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosScreentimeDomainsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_SCREENTIME_DOMAINS_PANEL_ID, "Screen Time domains", "", "table", {
    minH: 3,
    ...layout,
  });
}

function iosInteractionUrlsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_INTERACTION_URLS_PANEL_ID, "Shared / interaction URLs", "", "table", {
    minH: 3,
    ...layout,
  });
}

function crashTracesPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_CRASH_TRACES_PANEL_ID, "Crashes & backtraces", "", "table", {
    ...layout,
    minH: 10,
  });
}

function powerHistoryPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_POWER_HISTORY_PANEL_ID, "Power history", "", "table", {
    ...layout,
    minH: 4,
  });
}

function androidBatteryPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_BATTERY_PANEL_ID, "Battery", "", "table", {
    minH: 4,
    ...layout,
  });
}

function networkFlowPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_NETWORK_FLOW_PANEL_ID, "Network flows", "", "table", {
    minH: 8,
    minW: 6,
    ...layout,
  });
}

function networkSocketsPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_NETWORK_SOCKETS_PANEL_ID, "Network sockets", "", "table", {
    ...layout,
    minH: 3,
  });
}

function networkListenPortsPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_NETWORK_LISTEN_PORTS_PANEL_ID, "Listening ports", "", "table", {
    ...layout,
    minH: 3,
  });
}

function networkUsagePanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_NETWORK_USAGE_PANEL_ID, "Network usage", "", "table", {
    ...layout,
    minH: 7,
  });
}

/** Stack panels top-to-bottom in title order (A→Z). */
function stackPanelsByTitle(panels: DashboardPanel[]): DashboardPanel[] {
  const sorted = [...panels].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
  let y = 0;
  return sorted.map((p) => {
    const next = {
      ...p,
      layout: { ...p.layout, y, x: 0, w: 12 },
    };
    y += p.layout.h;
    return next;
  });
}

/** Android network tab: flows, listening ports, usage (socket rows covered by flows + listen). */
function stackAndroidNetworkPanels(panels: DashboardPanel[]): DashboardPanel[] {
  const order = [
    CASE_NETWORK_FLOW_PANEL_ID,
    CASE_NETWORK_LISTEN_PORTS_PANEL_ID,
    CASE_NETWORK_USAGE_PANEL_ID,
  ];
  const byId = new Map(panels.map((p) => [p.id, p]));
  let y = 0;
  return order
    .map((id) => byId.get(id))
    .filter((p): p is DashboardPanel => p != null)
    .map((p) => {
      const next = { ...p, layout: { ...p.layout, y, x: 0, w: 12 } };
      y += p.layout.h;
      return next;
    });
}

function androidUsbPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_ANDROID_USB_PANEL_ID, "USB", "", "table", {
    minH: 5,
    ...layout,
  });
}

function bluetoothPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_BLUETOOTH_PANEL_ID, "Bluetooth", "", "table", {
    ...layout,
    minH: 4,
  });
}

function memoryPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_MEMORY_PANEL_ID, "Memory", "", "table", {
    ...layout,
    minH: 4,
  });
}

function privacyPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_PRIVACY_PANEL_ID, "Privacy", "", "table", {
    ...layout,
    minH: 4,
  });
}

function authenticationPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_AUTHENTICATION_PANEL_ID, "Authentication", "", "table", {
    ...layout,
    minH: 8,
  });
}

function vpnPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_VPN_PANEL_ID, "VPN", "", "table", {
    ...layout,
    minH: 4,
  });
}

function accountsPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_ACCOUNTS_PANEL_ID, "Accounts", "", "table", {
    ...layout,
    minH: 4,
  });
}

function packagesPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_PACKAGES_PANEL_ID, "Packages & permissions", "", "table", {
    ...layout,
    minH: 6,
  });
}

function iosMobileInstallPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">
): DashboardPanel {
  return panel(CASE_IOS_MOBILE_INSTALL_PANEL_ID, "Installed / deleted apps", "", "table", {
    ...layout,
    minH: 5,
  });
}

function androidDangerousPermissionsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">
): DashboardPanel {
  return panel(CASE_ANDROID_DANGEROUS_PERMS_PANEL_ID, "Dangerous permissions", "", "table", {
    ...layout,
    minH: 5,
  });
}

function deletedPackagesPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_DELETED_PACKAGES_PANEL_ID, "Deleted packages", "", "table", {
    ...layout,
    minH: 4,
  });
}

function apkDowngradePanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_APK_DOWNGRADE_PANEL_ID, "APK downgrades (battery daily)", "", "table", {
    ...layout,
    minH: 4,
  });
}

function iosProcessEventsPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_IOS_PROCESS_EVENTS_PANEL_ID, "Process events", "", "table", {
    minH: 5,
    minW: 6,
    ...layout,
  });
}

function processesPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH">>
): DashboardPanel {
  return panel(CASE_PROCESSES_PANEL_ID, "Running processes", "", "table", {
    minH: 4,
    ...layout,
  });
}

function iosRunningServicesPanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH">>
): DashboardPanel {
  return panel(CASE_IOS_RUNNING_SERVICES_PANEL_ID, "Running services", "", "table", {
    minH: 4,
    ...layout,
  });
}

function adbPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_ADB_PANEL_ID, "ADB", "", "table", {
    ...layout,
    minH: 4,
  });
}

function devicePolicyPanel(layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h">): DashboardPanel {
  return panel(CASE_DEVICE_POLICY_PANEL_ID, "Device policy", "", "table", {
    ...layout,
    minH: 4,
  });
}

function timelinePanel(
  layout: Pick<DashboardPanel["layout"], "x" | "y" | "w" | "h"> &
    Partial<Pick<DashboardPanel["layout"], "minH" | "minW">>
): DashboardPanel {
  return panel(CASE_TIMELINE_PANEL_ID, "Event timeline", "", "timechart", {
    ...layout,
    minH: 4,
  });
}

/** Scoped mPL for the case timeline builtin panel. */
export function caseTimelineQuery(source: string, span: string): string {
  const src = escapeMplString(source);
  return `source="${src}" | timechart span=${span} count by parser limit=10 useother=true`;
}

/** Full parser inventory for case overview (no small head cap). */
export const CASE_EVENTS_PER_PARSER_QUERY = "| stats count by parser | sort -count | head 200";

function eventsPerParserPanel(layout: {
  x: number;
  y: number;
  w: number;
  h: number;
  minH?: number;
}): DashboardPanel {
  return panel("case_parsers", "Events per parser", CASE_EVENTS_PER_PARSER_QUERY, "table", {
    ...layout,
    minH: layout.minH ?? 3,
  });
}

/**
 * Default investigation dashboard for Android bugreport cases.
 * 12-column grid — each row uses consistent y/h so panels align without overlap.
 */
export const DEFAULT_ANDROID_CASE_DASHBOARD: DashboardDocument = {
  version: ANDROID_CASE_DASHBOARD_VERSION,
  description: "Android case overview — device, apps, network, power, and security.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [
    // Row 0 — device identity (full width)
    deviceHeaderPanel(),
    // Row 7 — device user / AccountManager accounts
    accountsPanel({ x: 0, y: 7, w: 12, h: 5 }),
    // Row 12 — volume overview (all parsers)
    eventsPerParserPanel({ x: 0, y: 12, w: 12, h: 5, minH: 3 }),
    // Row 17 — system health (power history moved to Authentication tab)
    memoryPanel({ x: 0, y: 17, w: 12, h: 5 }),
    // Row 22 — security (authentication moved to Authentication tab)
    privacyPanel({ x: 0, y: 22, w: 6, h: 5 }),
    vpnPanel({ x: 6, y: 22, w: 6, h: 5 }),
    // Row 27 — policy
    devicePolicyPanel({ x: 0, y: 27, w: 12, h: 5 }),
  ],
};

/** Default investigation dashboard for iOS sysdiagnose cases. */
export const DEFAULT_IOS_CASE_DASHBOARD: DashboardDocument = {
  version: IOS_CASE_DASHBOARD_VERSION,
  description: "iOS case overview — device, accounts, parsers, IOService, storage, security.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [
    deviceHeaderPanel(),
    accountsPanel({ x: 0, y: 7, w: 12, h: 5 }),
    eventsPerParserPanel({ x: 0, y: 12, w: 12, h: 6, minH: 3 }),
    iosStoragePanel({ x: 0, y: 18, w: 6, h: 7 }),
    iosActivationPanel({ x: 6, y: 18, w: 6, h: 7 }),
    iosSecurityPanel({ x: 0, y: 25, w: 6, h: 6 }),
    iosIoservicePanel({ x: 6, y: 25, w: 6, h: 6 }),
    iosTccPanel({ x: 0, y: 31, w: 12, h: 5 }),
    panel(
      "case_high_sev",
      "High severity (sample)",
      'severity="high" | head 12',
      "table",
      { x: 0, y: 36, w: 12, h: 3 }
    ),
  ],
};

/** Android unlock / authentication events and power history from bugreport. */
export const DEFAULT_ANDROID_CASE_AUTHENTICATION_DASHBOARD: DashboardDocument = {
  version: ANDROID_CASE_AUTHENTICATION_DASHBOARD_VERSION,
  description: "Android unlock/authentication events and power history from the bugreport.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [
    authenticationPanel({ x: 0, y: 0, w: 12, h: 14 }),
    powerHistoryPanel({ x: 0, y: 14, w: 12, h: 8 }),
  ],
};

/** iOS lock / unlock timeline from powerlogs and KnowledgeC. */
export const DEFAULT_IOS_CASE_AUTHENTICATION_DASHBOARD: DashboardDocument = {
  version: IOS_CASE_AUTHENTICATION_DASHBOARD_VERSION,
  description: "iOS lock and unlock timeline from powerlogs and KnowledgeC.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [iosLockStatePanel({ x: 0, y: 0, w: 12, h: 18 })],
};

const DEFAULT_ANDROID_CASE_CRASHES_DASHBOARD: DashboardDocument = {
  version: ANDROID_CASE_CRASHES_DASHBOARD_VERSION,
  description: "Android crash, ANR, tombstone, and backtrace signals.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [crashTracesPanel({ x: 0, y: 0, w: 12, h: 18 })],
};

const DEFAULT_IOS_CASE_CRASHES_DASHBOARD: DashboardDocument = {
  version: IOS_CASE_CRASHES_DASHBOARD_VERSION,
  description: "iOS crash reports, faulting threads, and binary images.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [crashTracesPanel({ x: 0, y: 0, w: 12, h: 18 })],
};

/** Packages — installed apps, installs, sideloading. */
export const DEFAULT_ANDROID_CASE_PACKAGES_DASHBOARD: DashboardDocument = {
  version: ANDROID_CASE_PACKAGES_DASHBOARD_VERSION,
  description: "Android packages, installs, and sideloading.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [
    packagesPanel({ x: 0, y: 0, w: 12, h: 14 }),
    androidDangerousPermissionsPanel({ x: 0, y: 14, w: 12, h: 8 }),
    apkDowngradePanel({ x: 0, y: 22, w: 12, h: 6 }),
    deletedPackagesPanel({ x: 0, y: 28, w: 12, h: 5 }),
    panel(
      "case_last_install",
      "Latest installs",
      'parser="Package" data_type=*package_install* bundle_id=* | fields timestamp, bundle_id, action, message | sort -timestamp | head 8',
      "table",
      { x: 0, y: 33, w: 6, h: 4, minH: 4 }
    ),
    panel(
      "case_sideload",
      "Non-Play installs",
      'parser="Package" data_type=*package_metadata* installer=* installer NOT IN ("com.android.vending", "com.google.android.packageinstaller", "com.android.packageinstaller", "null") | stats count by bundle_id, installer | head 10',
      "table",
      { x: 6, y: 33, w: 6, h: 4, minH: 3 }
    ),
  ],
};

export const DEFAULT_IOS_CASE_PACKAGES_DASHBOARD: DashboardDocument = {
  version: IOS_CASE_PACKAGES_DASHBOARD_VERSION,
  description: "iOS bundles and recent app activity.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [
    packagesPanel({ x: 0, y: 0, w: 12, h: 14 }),
    iosMobileInstallPanel({ x: 0, y: 14, w: 12, h: 10 }),
    iosSensitivePermissionsPanel({ x: 0, y: 24, w: 12, h: 8 }),
    panel(
      "case_last_install",
      "Recent app activity",
      "bundle_id=* | fields timestamp, bundle_id, app_name, parser, action, message | sort -timestamp | head 10",
      "table",
      { x: 0, y: 32, w: 12, h: 5, minH: 3 }
    ),
  ],
};

/** Running processes from bugreport / sysdiagnose. */
export const DEFAULT_ANDROID_CASE_PROCESSES_DASHBOARD: DashboardDocument = {
  version: ANDROID_CASE_PROCESSES_DASHBOARD_VERSION,
  description: "Android process list from the bugreport.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [
    processesPanel({ x: 0, y: 0, w: 12, h: 12, minH: 8 }),
    panel(
      "case_process_users",
      "Processes by user",
      'parser="Process" process_name=* | stats count by user | head 20',
      "table",
      { x: 0, y: 12, w: 6, h: 5, minH: 3 }
    ),
    panel(
      "case_process_sample",
      "Process events (sample)",
      'parser="Process" | fields timestamp, process_name, process_id, user, message | sort -timestamp | head 20',
      "table",
      { x: 6, y: 12, w: 6, h: 5, minH: 3 }
    ),
  ],
};

export const DEFAULT_IOS_CASE_PROCESSES_DASHBOARD: DashboardDocument = {
  version: IOS_CASE_PROCESSES_DASHBOARD_VERSION,
  description: "iOS running processes and remotectl registered services.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [
    processesPanel({ x: 0, y: 0, w: 12, h: 12, minH: 8 }),
    iosRunningServicesPanel({ x: 0, y: 12, w: 12, h: 10, minH: 6 }),
  ],
};

/** Taskinfo starts, spindump, ps, and shutdownlogs clients (iOS only). */
export const DEFAULT_IOS_CASE_PROCESS_EVENTS_DASHBOARD: DashboardDocument = {
  version: IOS_CASE_PROCESS_EVENTS_DASHBOARD_VERSION,
  description: "iOS process lifecycle events — starts, spindump, ps snapshots, shutdown clients.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [iosProcessEventsPanel({ x: 0, y: 0, w: 12, h: 18, minH: 12 })],
};

/** Battery / power telemetry for Android bugreports. */
export const DEFAULT_ANDROID_CASE_BATTERY_DASHBOARD: DashboardDocument = {
  version: ANDROID_CASE_BATTERY_DASHBOARD_VERSION,
  description: "Android battery history, hardware samples, and top consumers.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [androidBatteryPanel({ x: 0, y: 0, w: 12, h: 18, minH: 12 })],
};

/** Battery BDC + powerlogs level chart for iOS sysdiagnose. */
export const DEFAULT_IOS_CASE_BATTERY_DASHBOARD: DashboardDocument = {
  version: IOS_CASE_BATTERY_DASHBOARD_VERSION,
  description: "iOS battery_bdc status and powerlogs Battery Level history.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [iosBatteryPanel({ x: 0, y: 0, w: 12, h: 16, minH: 10 })],
};

/** USB, Bluetooth, ADB, and other attached / debugging interfaces. */
export const DEFAULT_ANDROID_CASE_EXTERNAL_DEVICES_DASHBOARD: DashboardDocument = {
  version: ANDROID_CASE_EXTERNAL_DEVICES_DASHBOARD_VERSION,
  description: "Android USB, Bluetooth, and ADB attachment history.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [
    androidUsbPanel({ x: 0, y: 0, w: 6, h: 10, minH: 6 }),
    bluetoothPanel({ x: 6, y: 0, w: 6, h: 5 }),
    adbPanel({ x: 6, y: 5, w: 6, h: 5 }),
    panel(
      "case_bluetooth_events",
      "Bluetooth events",
      'parser="Bluetooth" | fields timestamp, action, message | sort -timestamp | head 8',
      "table",
      { x: 0, y: 10, w: 12, h: 3, minH: 3 }
    ),
  ],
};

export const DEFAULT_IOS_CASE_EXTERNAL_DEVICES_DASHBOARD: DashboardDocument = {
  version: IOS_CASE_EXTERNAL_DEVICES_DASHBOARD_VERSION,
  description:
    "iOS Wi‑Fi (scan, saved, geolocation, security) plus USB plane, lockdownd attach, and cable/power traces.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: stackPanelsByTitle([
    iosWifiPanel({ x: 0, y: 0, w: 12, h: 7, minH: 5 }),
    iosWifiNetworksPanel({ x: 0, y: 0, w: 6, h: 5, minH: 4 }),
    iosWifiKnownPanel({ x: 0, y: 0, w: 6, h: 5, minH: 4 }),
    iosWifiSecurityPanel({ x: 0, y: 0, w: 6, h: 4, minH: 3 }),
    iosUsbPanel({ x: 0, y: 0, w: 12, h: 18, minH: 12 }),
  ]),
};

/** Network investigation — flows, listening ports, and interface usage. */
export const DEFAULT_ANDROID_CASE_NETWORK_DASHBOARD: DashboardDocument = {
  version: ANDROID_CASE_NETWORK_DASHBOARD_VERSION,
  description: "Android network flows, listening ports, and interface usage.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: stackAndroidNetworkPanels([
    networkFlowPanel({ x: 0, y: 0, w: 12, h: 11, minH: 8 }),
    networkListenPortsPanel({ x: 0, y: 0, w: 6, h: 4 }),
    networkUsagePanel({ x: 0, y: 0, w: 12, h: 10 }),
  ]),
};

export const DEFAULT_IOS_CASE_NETWORK_DASHBOARD: DashboardDocument = {
  version: IOS_CASE_NETWORK_DASHBOARD_VERSION,
  description:
    "iOS URL/domain telemetry — connected domains, Safari, KnowledgeC, Screen Time, quarantine, IOCs, VPN/proxy.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: stackPanelsByTitle([
    iosConnectedDomainsPanel({ x: 0, y: 0, w: 12, h: 7, minH: 5 }),
    iosNetworkIocsPanel({ x: 0, y: 0, w: 12, h: 6, minH: 4 }),
    iosSafariHistoryPanel({ x: 0, y: 0, w: 6, h: 6, minH: 4 }),
    iosKnowledgeWebPanel({ x: 0, y: 0, w: 6, h: 6, minH: 4 }),
    iosScreentimeDomainsPanel({ x: 0, y: 0, w: 6, h: 5, minH: 4 }),
    iosQuarantineUrlsPanel({ x: 0, y: 0, w: 6, h: 5, minH: 4 }),
    iosInteractionUrlsPanel({ x: 0, y: 0, w: 6, h: 5, minH: 4 }),
    iosSwcutilDomainsPanel({ x: 0, y: 0, w: 6, h: 4, minH: 3 }),
    iosPlistUrlsPanel({ x: 0, y: 0, w: 6, h: 5, minH: 4 }),
    iosNetworkExtensionPanel({ x: 0, y: 0, w: 6, h: 5, minH: 4 }),
    iosPowerlogPushPanel({ x: 0, y: 0, w: 6, h: 4, minH: 3 }),
    iosNetusagePanel({ x: 0, y: 0, w: 6, h: 5, minH: 3 }),
    iosPowerlogUsagePanel({ x: 0, y: 0, w: 12, h: 5, minH: 4 }),
    iosLogarchivePanel({ x: 0, y: 0, w: 6, h: 4, minH: 3 }),
    iosLogIpsPanel({ x: 0, y: 0, w: 6, h: 4, minH: 3 }),
    iosTransparencyContactsPanel({ x: 0, y: 0, w: 6, h: 4, minH: 3 }),
  ]),
};

/** Default dashboard for endpoint / IronSift ingest cases. */
export const DEFAULT_ENDPOINT_CASE_DASHBOARD: DashboardDocument = {
  version: 3,
  description: "Endpoint fleet overview — hosts, processes, and network telemetry.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [
    panel("case_events", "Total events", "| stats count", "single_value", { x: 0, y: 0, w: 3, h: 2 }),
    panel(
      "case_devices",
      "Hosts in scope",
      "device_id=* | stats count by device_id | head 12",
      "table",
      { x: 3, y: 0, w: 9, h: 3, minH: 3 }
    ),
    eventsPerParserPanel({ x: 0, y: 3, w: 12, h: 5, minH: 3 }),
    panel(
      "case_timeline",
      "Parser activity",
      "| timechart span=1d count by parser limit=8",
      "timechart",
      { x: 0, y: 8, w: 12, h: 3 }
    ),
    panel(
      "case_processes",
      "Top processes",
      'parser="process" process_name=* | stats count by process_name | head 10',
      "bar",
      { x: 0, y: 11, w: 6, h: 3 }
    ),
    panel(
      "case_network",
      "Network",
      'parser="network" dest_ip=* | fields timestamp, device_id, dest_ip, src_ip, action, message | sort -timestamp | head 10',
      "table",
      { x: 6, y: 11, w: 6, h: 3, minH: 3 }
    ),
  ],
};

const PLATFORM_TEMPLATES: Record<CasePlatform, DashboardDocument> = {
  android: DEFAULT_ANDROID_CASE_DASHBOARD,
  ios: DEFAULT_IOS_CASE_DASHBOARD,
  endpoint: DEFAULT_ENDPOINT_CASE_DASHBOARD,
};

const SECTION_TEMPLATES: Record<
  Exclude<CaseDashboardSectionId, "overview" | "entities">,
  Partial<Record<CasePlatform, DashboardDocument>>
> = {
  crashes: {
    android: DEFAULT_ANDROID_CASE_CRASHES_DASHBOARD,
    ios: DEFAULT_IOS_CASE_CRASHES_DASHBOARD,
  },
  packages: {
    android: DEFAULT_ANDROID_CASE_PACKAGES_DASHBOARD,
    ios: DEFAULT_IOS_CASE_PACKAGES_DASHBOARD,
  },
  processes: {
    android: DEFAULT_ANDROID_CASE_PROCESSES_DASHBOARD,
    ios: DEFAULT_IOS_CASE_PROCESSES_DASHBOARD,
  },
  process_events: {
    ios: DEFAULT_IOS_CASE_PROCESS_EVENTS_DASHBOARD,
  },
  battery: {
    android: DEFAULT_ANDROID_CASE_BATTERY_DASHBOARD,
    ios: DEFAULT_IOS_CASE_BATTERY_DASHBOARD,
  },
  external_devices: {
    android: DEFAULT_ANDROID_CASE_EXTERNAL_DEVICES_DASHBOARD,
    ios: DEFAULT_IOS_CASE_EXTERNAL_DEVICES_DASHBOARD,
  },
  network: {
    android: DEFAULT_ANDROID_CASE_NETWORK_DASHBOARD,
    ios: DEFAULT_IOS_CASE_NETWORK_DASHBOARD,
  },
  authentication: {
    android: DEFAULT_ANDROID_CASE_AUTHENTICATION_DASHBOARD,
    ios: DEFAULT_IOS_CASE_AUTHENTICATION_DASHBOARD,
  },
};

function sectionVersion(platform: CasePlatform, section: CaseDashboardSectionId): number {
  if (section === "entities") return 1;
  if (section === "packages") {
    if (platform === "android") return ANDROID_CASE_PACKAGES_DASHBOARD_VERSION;
    if (platform === "ios") return IOS_CASE_PACKAGES_DASHBOARD_VERSION;
    return 1;
  }
  if (section === "crashes") {
    if (platform === "android") return ANDROID_CASE_CRASHES_DASHBOARD_VERSION;
    if (platform === "ios") return IOS_CASE_CRASHES_DASHBOARD_VERSION;
    return 1;
  }
  if (section === "processes") {
    if (platform === "android") return ANDROID_CASE_PROCESSES_DASHBOARD_VERSION;
    if (platform === "ios") return IOS_CASE_PROCESSES_DASHBOARD_VERSION;
    return 1;
  }
  if (section === "process_events") {
    if (platform === "ios") return IOS_CASE_PROCESS_EVENTS_DASHBOARD_VERSION;
    return 1;
  }
  if (section === "battery") {
    if (platform === "android") return ANDROID_CASE_BATTERY_DASHBOARD_VERSION;
    if (platform === "ios") return IOS_CASE_BATTERY_DASHBOARD_VERSION;
    return 1;
  }
  if (section === "external_devices") {
    if (platform === "android") return ANDROID_CASE_EXTERNAL_DEVICES_DASHBOARD_VERSION;
    if (platform === "ios") return IOS_CASE_EXTERNAL_DEVICES_DASHBOARD_VERSION;
    return 1;
  }
  if (section === "network") {
    if (platform === "android") return ANDROID_CASE_NETWORK_DASHBOARD_VERSION;
    if (platform === "ios") return IOS_CASE_NETWORK_DASHBOARD_VERSION;
    return 1;
  }
  if (section === "authentication") {
    if (platform === "android") return ANDROID_CASE_AUTHENTICATION_DASHBOARD_VERSION;
    if (platform === "ios") return IOS_CASE_AUTHENTICATION_DASHBOARD_VERSION;
    return 1;
  }
  if (platform === "android") return ANDROID_CASE_DASHBOARD_VERSION;
  if (platform === "ios") return IOS_CASE_DASHBOARD_VERSION;
  return PLATFORM_TEMPLATES[platform].version;
}

export const CASE_DASHBOARD_TAB_ORDER: CaseDashboardSectionId[] = [
  "overview",
  "crashes",
  "packages",
  "processes",
  "process_events",
  "battery",
  "external_devices",
  "network",
  "authentication",
  "entities",
];

export function caseDashboardSections(platform: CasePlatform): CaseDashboardSectionId[] {
  if (platform === "endpoint") return ["overview", "entities"];
  if (platform === "ios") return CASE_DASHBOARD_TAB_ORDER;
  return CASE_DASHBOARD_TAB_ORDER.filter((id) => id !== "process_events");
}

/** @deprecated Use caseDashboardSections */
export function caseDashboardHasNetworkSection(platform: CasePlatform): boolean {
  return caseDashboardSections(platform).includes("network");
}

export function defaultCaseDashboard(
  platform: CasePlatform,
  section: CaseDashboardSectionId = "overview"
): DashboardDocument {
  if (section === "entities") {
    return {
      version: 1,
      description: "Case entities",
      refresh_sec: 0,
      time_preset: "24h",
      panels: [],
    };
  }
  const template =
    section === "overview"
      ? PLATFORM_TEMPLATES[platform]
      : SECTION_TEMPLATES[section][platform] ?? PLATFORM_TEMPLATES[platform];
  return {
    ...template,
    panels: template.panels.map((p) => ({
      ...p,
      layout: { ...p.layout, i: p.id },
    })),
  };
}

/** Map ingest labels / tags to a case dashboard platform. */
export function normalizeCasePlatform(value: string): CasePlatform | null {
  const v = value.trim().toLowerCase();
  if (v === "android" || v === "bugreport" || v === "apk") return "android";
  if (v === "ios" || v === "sysdiagnose" || v === "iphone" || v === "ipad") return "ios";
  if (v === "endpoint" || v === "vector" || v === "linux" || v === "ironsift") return "endpoint";
  return null;
}

/**
 * Resolve case type from tags (set on ingest) then ingest job platform.
 * Tags are authoritative — each ingested case gets `[platform, ingested, source]`.
 */
export function inferCasePlatform(
  caseRec: Pick<CaseRecord, "tags">,
  jobs?: Array<{ platform?: string | null }>
): CasePlatform | null {
  for (const tag of caseRec.tags) {
    const platform = normalizeCasePlatform(tag);
    if (platform) return platform;
  }
  for (const job of jobs ?? []) {
    const platform = normalizeCasePlatform(job.platform ?? "");
    if (platform) return platform;
  }
  return null;
}

/** Prefix panel queries with the case ingest source. */
export function scopeQueryToCase(query: string, ingestSource: string): string {
  const q = query.trim();
  if (!q) return q;
  if (/^source\s*=/i.test(q)) return q;
  const src = `source="${escapeMplString(ingestSource)}"`;
  if (q.startsWith("|")) return `${src} ${q}`;
  return `${src} ${q}`;
}

/** Remove case source prefix before persisting customized queries. */
export function unscopeQueryFromCase(query: string, ingestSource: string): string {
  const q = query.trim();
  if (!q) return q;
  const escaped = escapeMplString(ingestSource);
  const double = `source="${escaped}"`;
  if (q.startsWith(double)) {
    const rest = q.slice(double.length).trim();
    return rest.startsWith("|") ? rest : rest ? `| ${rest}` : "";
  }
  const single = `source='${escaped.replace(/'/g, "\\'")}'`;
  if (q.startsWith(single)) {
    const rest = q.slice(single.length).trim();
    return rest.startsWith("|") ? rest : rest ? `| ${rest}` : "";
  }
  return q;
}

export function scopeDashboardToCase(
  doc: DashboardDocument,
  ingestSource: string
): DashboardDocument {
  return {
    ...doc,
    panels: doc.panels.map((p) => ({
      ...p,
      layout: { ...p.layout, i: p.id },
      query:
        isCaseBuiltinPanel(p.id) || !p.query.trim()
          ? p.query
          : scopeQueryToCase(p.query, ingestSource),
    })),
  };
}

export function unscopeDashboardFromCase(
  doc: DashboardDocument,
  ingestSource: string
): DashboardDocument {
  return {
    ...doc,
    version: 2,
    panels: doc.panels.map((p) => ({
      ...p,
      layout: { ...p.layout, i: p.id },
      query: isCaseBuiltinPanel(p.id) ? "" : unscopeQueryFromCase(p.query, ingestSource),
    })),
  };
}

function storageKey(caseId: string, platform: CasePlatform, section: CaseDashboardSectionId = "overview"): string {
  const base = `${STORAGE_PREFIX}${caseId}:${platform}`;
  return section === "overview" ? base : `${base}:${section}`;
}

function legacyStorageKey(caseId: string): string {
  return `${STORAGE_PREFIX}${caseId}`;
}

function parseSavedCaseDashboard(raw: string): SavedCaseDashboard | null {
  try {
    const parsed = JSON.parse(raw) as SavedCaseDashboard;
    const doc = parseDashboardDocument(parsed);
    return { ...doc, case_platform: parsed.case_platform };
  } catch {
    return null;
  }
}

export function loadSavedCaseDashboard(
  caseId: string,
  platform: CasePlatform,
  section: CaseDashboardSectionId = "overview"
): DashboardDocument | null {
  const scoped = localStorage.getItem(storageKey(caseId, platform, section));
  if (scoped) {
    const doc = parseSavedCaseDashboard(scoped);
    if (doc) return doc;
  }

  if (section !== "overview") return null;

  const legacy = localStorage.getItem(legacyStorageKey(caseId));
  if (!legacy) return null;
  const doc = parseSavedCaseDashboard(legacy);
  if (!doc) return null;
  if (doc.case_platform && doc.case_platform !== platform) return null;
  return doc;
}

export function hasSavedCaseDashboard(
  caseId: string,
  platform: CasePlatform,
  section: CaseDashboardSectionId = "overview"
): boolean {
  return (
    localStorage.getItem(storageKey(caseId, platform, section)) !== null ||
    (section === "overview" && loadSavedCaseDashboard(caseId, platform, section) !== null)
  );
}

export function saveCaseDashboard(
  caseId: string,
  platform: CasePlatform,
  doc: DashboardDocument,
  ingestSource: string,
  section: CaseDashboardSectionId = "overview"
): void {
  const payload: SavedCaseDashboard = {
    ...unscopeDashboardFromCase(doc, ingestSource),
    case_platform: platform,
  };
  localStorage.setItem(storageKey(caseId, platform, section), JSON.stringify(payload));
  if (section === "overview") {
    localStorage.removeItem(legacyStorageKey(caseId));
  }
}

export function clearSavedCaseDashboard(
  caseId: string,
  platform: CasePlatform,
  section: CaseDashboardSectionId = "overview"
): void {
  localStorage.removeItem(storageKey(caseId, platform, section));
  if (section !== "overview") return;
  const legacy = localStorage.getItem(legacyStorageKey(caseId));
  if (legacy) {
    const doc = parseSavedCaseDashboard(legacy);
    if (!doc?.case_platform || doc.case_platform === platform) {
      localStorage.removeItem(legacyStorageKey(caseId));
    }
  }
}

export function resolveCaseDashboard(
  caseId: string,
  platform: CasePlatform,
  ingestSource: string,
  section: CaseDashboardSectionId = "overview"
): DashboardDocument {
  const saved = loadSavedCaseDashboard(caseId, platform, section);
  let base: DashboardDocument;
  const savedVersion = saved?.version ?? 0;
  const currentVersion = sectionVersion(platform, section);
  const needsUpgrade = saved && savedVersion < currentVersion;
  if (needsUpgrade) {
    base = defaultCaseDashboard(platform, section);
  } else {
    base = saved ?? defaultCaseDashboard(platform, section);
  }
  // Authentication / power history belong on the Authentication tab only — never Overview.
  if (section === "overview") {
    const overviewAuthIds = new Set([CASE_AUTHENTICATION_PANEL_ID, CASE_POWER_HISTORY_PANEL_ID]);
    if (base.panels.some((p) => overviewAuthIds.has(p.id))) {
      base = {
        ...base,
        version: currentVersion,
        panels: base.panels.filter((p) => !overviewAuthIds.has(p.id)),
      };
    }
  }
  // iOS Authentication tab must use lock-state, never the Android Authentication parser panel.
  if (platform === "ios" && section === "authentication") {
    const hasAndroidAuth = base.panels.some((p) => p.id === CASE_AUTHENTICATION_PANEL_ID);
    const hasIosLock = base.panels.some((p) => p.id === CASE_IOS_LOCK_STATE_PANEL_ID);
    if (hasAndroidAuth || !hasIosLock) {
      base = defaultCaseDashboard(platform, section);
    }
  }
  // Android Authentication tab must include the Authentication parser panel.
  if (platform === "android" && section === "authentication") {
    const hasAndroidAuth = base.panels.some((p) => p.id === CASE_AUTHENTICATION_PANEL_ID);
    if (!hasAndroidAuth) {
      base = defaultCaseDashboard(platform, section);
    }
  }
  return scopeDashboardToCase(base, ingestSource);
}

export function buildCaseDashboard(
  platform: CasePlatform,
  ingestSource: string,
  section: CaseDashboardSectionId = "overview"
): DashboardDocument {
  return scopeDashboardToCase(defaultCaseDashboard(platform, section), ingestSource);
}

export function casePlatformLabel(platform: CasePlatform): string {
  switch (platform) {
    case "android":
      return "Android";
    case "ios":
      return "iOS";
    case "endpoint":
      return "Endpoint";
  }
}

export function createCaseDashboardPanel(existing: DashboardPanel[]): DashboardPanel {
  return createPanel({
    title: "New panel",
    query: "| stats count by parser | head 8",
    viz: "table",
    panels: existing,
  });
}
