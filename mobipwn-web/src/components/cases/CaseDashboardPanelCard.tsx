import type { ReactNode } from "react";
import { DashboardPanelCard } from "@/components/dashboard/DashboardPanelCard";
import { CaseAndroidBatteryPanel } from "@/components/cases/CaseAndroidBatteryPanel";
import { CaseAdbPanel } from "@/components/cases/CaseAdbPanel";
import { CaseAccountsPanel } from "@/components/cases/CaseAccountsPanel";
import { CaseDeletedPackagesPanel } from "@/components/cases/CaseDeletedPackagesPanel";
import { CaseIosMobileInstallPanel } from "@/components/cases/CaseIosMobileInstallPanel";
import { CaseApkDowngradePanel } from "@/components/cases/CaseApkDowngradePanel";
import { CaseDevicePolicyPanel } from "@/components/cases/CaseDevicePolicyPanel";
import { CaseAuthenticationPanel } from "@/components/cases/CaseAuthenticationPanel";
import { CaseAndroidUsbPanel } from "@/components/cases/CaseAndroidUsbPanel";
import { CaseBluetoothPanel } from "@/components/cases/CaseBluetoothPanel";
import { CaseBuiltinPanelShell } from "@/components/cases/CaseBuiltinPanelShell";
import { CaseDeviceHeaderPanel } from "@/components/cases/CaseDeviceHeaderPanel";
import { CaseCrashTracesPanel } from "@/components/cases/CaseCrashTracesPanel";
import { CaseIosActivationPanel } from "@/components/cases/CaseIosActivationPanel";
import { CaseIosIoservicePanel } from "@/components/cases/CaseIosIoservicePanel";
import { CaseIosLogarchivePanel } from "@/components/cases/CaseIosLogarchivePanel";
import { CaseIosBatteryPanel } from "@/components/cases/CaseIosBatteryPanel";
import { CaseIosSecurityPanel } from "@/components/cases/CaseIosSecurityPanel";
import { CaseIosLockStatePanel } from "@/components/cases/CaseIosLockStatePanel";
import { CaseIosStoragePanel } from "@/components/cases/CaseIosStoragePanel";
import { CaseIosSensitivePermissionsPanel } from "@/components/cases/CaseIosSensitivePermissionsPanel";
import { CaseIosTccPanel } from "@/components/cases/CaseIosTccPanel";
import { CaseIosUsbPanel } from "@/components/cases/CaseIosUsbPanel";
import { CaseIosWifiPanel } from "@/components/cases/CaseIosWifiPanel";
import { CaseIosWifiKnownPanel } from "@/components/cases/CaseIosWifiKnownPanel";
import { CaseIosWifiNetworksPanel } from "@/components/cases/CaseIosWifiNetworksPanel";
import { CaseIosWifiSecurityPanel } from "@/components/cases/CaseIosWifiSecurityPanel";
import {
  CaseIosConnectedDomainsPanel,
  CaseIosInteractionUrlsPanel,
  CaseIosLogIpsPanel,
  CaseIosNetworkExtensionPanel,
  CaseIosNetworkIocsPanel,
  CaseIosNetusagePanel,
  CaseIosPlistUrlsPanel,
  CaseIosPowerlogPushPanel,
  CaseIosPowerlogUsagePanel,
  CaseIosQuarantineUrlsPanel,
  CaseIosSafariHistoryPanel,
  CaseIosScreentimeDomainsPanel,
  CaseIosKnowledgeWebPanel,
  CaseIosSwcutilDomainsPanel,
  CaseIosTransparencyContactsPanel,
} from "@/components/cases/CaseIosNetworkTelemetryPanels";
import { CaseMemoryPanel } from "@/components/cases/CaseMemoryPanel";
import { CaseAndroidDangerousPermissionsPanel } from "@/components/cases/CaseAndroidDangerousPermissionsPanel";
import { CasePackagesPanel } from "@/components/cases/CasePackagesPanel";
import { CaseProcessesPanel } from "@/components/cases/CaseProcessesPanel";
import { CaseIosProcessEventsPanel } from "@/components/cases/CaseIosProcessEventsPanel";
import { CaseNetworkFlowPanel } from "@/components/cases/CaseNetworkFlowPanel";
import { CaseNetworkListenPortsPanel } from "@/components/cases/CaseNetworkListenPortsPanel";
import { CaseNetworkSocketsPanel } from "@/components/cases/CaseNetworkSocketsPanel";
import { CaseNetworkUsagePanel } from "@/components/cases/CaseNetworkUsagePanel";
import { CasePowerHistoryPanel } from "@/components/cases/CasePowerHistoryPanel";
import { CasePrivacyPanel } from "@/components/cases/CasePrivacyPanel";
import { CaseVpnPanel } from "@/components/cases/CaseVpnPanel";
import { CaseTimelinePanel } from "@/components/cases/CaseTimelinePanel";
import {
  CASE_ADB_PANEL_ID,
  CASE_DEVICE_POLICY_PANEL_ID,
  CASE_DELETED_PACKAGES_PANEL_ID,
  CASE_IOS_MOBILE_INSTALL_PANEL_ID,
  CASE_APK_DOWNGRADE_PANEL_ID,
  CASE_AUTHENTICATION_PANEL_ID,
  CASE_ANDROID_USB_PANEL_ID,
  CASE_BLUETOOTH_PANEL_ID,
  CASE_CRASH_TRACES_PANEL_ID,
  CASE_DEVICE_HEADER_PANEL_ID,
  CASE_MEMORY_PANEL_ID,
  CASE_NETWORK_SOCKETS_PANEL_ID,
  CASE_NETWORK_LISTEN_PORTS_PANEL_ID,
  CASE_NETWORK_FLOW_PANEL_ID,
  CASE_PACKAGES_PANEL_ID,
  CASE_ANDROID_DANGEROUS_PERMS_PANEL_ID,
  CASE_PROCESSES_PANEL_ID,
  CASE_IOS_RUNNING_SERVICES_PANEL_ID,
  CASE_IOS_PROCESS_EVENTS_PANEL_ID,
  CASE_NETWORK_USAGE_PANEL_ID,
  CASE_POWER_HISTORY_PANEL_ID,
  CASE_BATTERY_PANEL_ID,
  CASE_PRIVACY_PANEL_ID,
  CASE_VPN_PANEL_ID,
  CASE_ACCOUNTS_PANEL_ID,
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
  CASE_TIMELINE_PANEL_ID,
  caseBuiltinPanelBodyClass,
} from "@/lib/caseDashboard";
import type { CasePlatform } from "@/lib/caseDashboard";
import type { DashboardPanel } from "@/lib/dashboard";

type BuiltinPanelProps = {
  ingestSource: string;
  refreshKey: number;
  platform: CasePlatform;
};

const BUILTIN_PANELS: Record<string, (props: BuiltinPanelProps) => ReactNode> = {
  [CASE_DEVICE_HEADER_PANEL_ID]: (p) => <CaseDeviceHeaderPanel {...p} />,
  [CASE_TIMELINE_PANEL_ID]: (p) => <CaseTimelinePanel {...p} />,
  [CASE_PACKAGES_PANEL_ID]: (p) => <CasePackagesPanel {...p} />,
  [CASE_ANDROID_DANGEROUS_PERMS_PANEL_ID]: (p) =>
    p.platform === "android" ? (
      <CaseAndroidDangerousPermissionsPanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">Android bugreport only.</p>
    ),
  [CASE_DELETED_PACKAGES_PANEL_ID]: (p) => <CaseDeletedPackagesPanel {...p} />,
  [CASE_IOS_MOBILE_INSTALL_PANEL_ID]: (p) =>
    p.platform === "ios" ? (
      <CaseIosMobileInstallPanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">iOS sysdiagnose only.</p>
    ),
  [CASE_APK_DOWNGRADE_PANEL_ID]: (p) =>
    p.platform === "android" ? (
      <CaseApkDowngradePanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">Android bugreport only.</p>
    ),
  [CASE_PROCESSES_PANEL_ID]: (p) => <CaseProcessesPanel {...p} />,
  [CASE_IOS_RUNNING_SERVICES_PANEL_ID]: (p) =>
    p.platform === "ios" ? (
      <CaseProcessesPanel
        ingestSource={p.ingestSource}
        refreshKey={p.refreshKey}
        platform="ios"
        variant="services"
      />
    ) : (
      <p className="muted text-xs">iOS sysdiagnose only.</p>
    ),
  [CASE_IOS_PROCESS_EVENTS_PANEL_ID]: (p) =>
    p.platform === "ios" ? (
      <CaseIosProcessEventsPanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">iOS sysdiagnose only.</p>
    ),
  [CASE_NETWORK_SOCKETS_PANEL_ID]: (p) => <CaseNetworkSocketsPanel {...p} />,
  [CASE_NETWORK_LISTEN_PORTS_PANEL_ID]: (p) =>
    p.platform === "android" ? (
      <CaseNetworkListenPortsPanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">Android bugreport only.</p>
    ),
  [CASE_NETWORK_FLOW_PANEL_ID]: (p) => <CaseNetworkFlowPanel {...p} />,
  [CASE_NETWORK_USAGE_PANEL_ID]: (p) => <CaseNetworkUsagePanel {...p} />,
  [CASE_POWER_HISTORY_PANEL_ID]: (p) => <CasePowerHistoryPanel {...p} />,
  [CASE_BATTERY_PANEL_ID]: (p) =>
    p.platform === "android" ? (
      <CaseAndroidBatteryPanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">Android bugreport only.</p>
    ),
  [CASE_ADB_PANEL_ID]: (p) => <CaseAdbPanel {...p} />,
  [CASE_DEVICE_POLICY_PANEL_ID]: (p) => <CaseDevicePolicyPanel {...p} />,
  [CASE_AUTHENTICATION_PANEL_ID]: (p) => <CaseAuthenticationPanel {...p} />,
  [CASE_ANDROID_USB_PANEL_ID]: (p) =>
    p.platform === "android" ? (
      <CaseAndroidUsbPanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">Android bugreport only.</p>
    ),
  [CASE_BLUETOOTH_PANEL_ID]: (p) => <CaseBluetoothPanel {...p} />,
  [CASE_MEMORY_PANEL_ID]: (p) => <CaseMemoryPanel {...p} />,
  [CASE_PRIVACY_PANEL_ID]: (p) => <CasePrivacyPanel {...p} />,
  [CASE_VPN_PANEL_ID]: (p) =>
    p.platform === "android" ? (
      <CaseVpnPanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">Android bugreport only.</p>
    ),
  [CASE_ACCOUNTS_PANEL_ID]: (p) =>
    p.platform === "android" || p.platform === "ios" ? (
      <CaseAccountsPanel
        ingestSource={p.ingestSource}
        refreshKey={p.refreshKey}
        platform={p.platform}
      />
    ) : (
      <p className="muted text-xs">Android bugreport or iOS sysdiagnose only.</p>
    ),
  [CASE_CRASH_TRACES_PANEL_ID]: (p) => <CaseCrashTracesPanel {...p} />,
  [CASE_IOS_BATTERY_PANEL_ID]: (p) => <CaseIosBatteryPanel {...p} />,
  [CASE_IOS_STORAGE_PANEL_ID]: (p) => <CaseIosStoragePanel {...p} />,
  [CASE_IOS_ACTIVATION_PANEL_ID]: (p) => <CaseIosActivationPanel {...p} />,
  [CASE_IOS_SECURITY_PANEL_ID]: (p) => <CaseIosSecurityPanel {...p} />,
  [CASE_IOS_LOCK_STATE_PANEL_ID]: (p) =>
    p.platform === "ios" ? (
      <CaseIosLockStatePanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">iOS sysdiagnose only.</p>
    ),
  [CASE_IOS_TCC_PANEL_ID]: (p) => <CaseIosTccPanel {...p} />,
  [CASE_IOS_SENSITIVE_PERMS_PANEL_ID]: (p) =>
    p.platform === "ios" ? (
      <CaseIosSensitivePermissionsPanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">iOS sysdiagnose only.</p>
    ),
  [CASE_IOS_WIFI_PANEL_ID]: (p) => <CaseIosWifiPanel {...p} />,
  [CASE_IOS_WIFI_NETWORKS_PANEL_ID]: (p) => <CaseIosWifiNetworksPanel {...p} />,
  [CASE_IOS_WIFI_KNOWN_PANEL_ID]: (p) => <CaseIosWifiKnownPanel {...p} />,
  [CASE_IOS_WIFI_SECURITY_PANEL_ID]: (p) => <CaseIosWifiSecurityPanel {...p} />,
  [CASE_IOS_SWCUTIL_DOMAINS_PANEL_ID]: (p) => <CaseIosSwcutilDomainsPanel {...p} />,
  [CASE_IOS_POWERLOG_PUSH_PANEL_ID]: (p) => <CaseIosPowerlogPushPanel {...p} />,
  [CASE_IOS_POWERLOG_USAGE_PANEL_ID]: (p) => <CaseIosPowerlogUsagePanel {...p} />,
  [CASE_IOS_NETWORK_EXTENSION_PANEL_ID]: (p) => <CaseIosNetworkExtensionPanel {...p} />,
  [CASE_IOS_PLIST_URLS_PANEL_ID]: (p) => <CaseIosPlistUrlsPanel {...p} />,
  [CASE_IOS_TRANSPARENCY_CONTACTS_PANEL_ID]: (p) => <CaseIosTransparencyContactsPanel {...p} />,
  [CASE_IOS_NETWORK_IOCS_PANEL_ID]: (p) => <CaseIosNetworkIocsPanel {...p} />,
  [CASE_IOS_NETUSAGE_PANEL_ID]: (p) => <CaseIosNetusagePanel {...p} />,
  [CASE_IOS_SAFARI_HISTORY_PANEL_ID]: (p) => <CaseIosSafariHistoryPanel {...p} />,
  [CASE_IOS_KNOWLEDGE_WEB_PANEL_ID]: (p) => <CaseIosKnowledgeWebPanel {...p} />,
  [CASE_IOS_CONNECTED_DOMAINS_PANEL_ID]: (p) => <CaseIosConnectedDomainsPanel {...p} />,
  [CASE_IOS_QUARANTINE_URLS_PANEL_ID]: (p) => <CaseIosQuarantineUrlsPanel {...p} />,
  [CASE_IOS_SCREENTIME_DOMAINS_PANEL_ID]: (p) => <CaseIosScreentimeDomainsPanel {...p} />,
  [CASE_IOS_INTERACTION_URLS_PANEL_ID]: (p) => <CaseIosInteractionUrlsPanel {...p} />,
  [CASE_IOS_LOG_IPS_PANEL_ID]: (p) => <CaseIosLogIpsPanel {...p} />,
  [CASE_IOS_LOGARCHIVE_PANEL_ID]: (p) => <CaseIosLogarchivePanel {...p} />,
  [CASE_IOS_IOSERVICE_PANEL_ID]: (p) => <CaseIosIoservicePanel {...p} />,
  [CASE_IOS_USB_PANEL_ID]: (p) =>
    p.platform === "ios" ? (
      <CaseIosUsbPanel ingestSource={p.ingestSource} refreshKey={p.refreshKey} />
    ) : (
      <p className="muted text-xs">iOS sysdiagnose only.</p>
    ),
};

export function CaseDashboardPanelCard({
  panel,
  ingestSource,
  platform,
  timePreset,
  refreshKey,
  editMode,
  onEdit,
  onRemove,
}: {
  panel: DashboardPanel;
  ingestSource: string;
  platform: CasePlatform;
  timePreset: string;
  refreshKey: number;
  editMode: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const builtin = BUILTIN_PANELS[panel.id];

  if (builtin) {
    return (
      <CaseBuiltinPanelShell
        panelId={panel.id}
        title={panel.title}
        viz={panel.viz}
        bodyClassName={caseBuiltinPanelBodyClass(panel.id)}
        editMode={editMode}
        onEdit={onEdit}
        onRemove={onRemove}
      >
        {builtin({ ingestSource, refreshKey, platform })}
      </CaseBuiltinPanelShell>
    );
  }

  return (
    <DashboardPanelCard
      panel={panel}
      timePreset={timePreset}
      refreshKey={refreshKey}
      editMode={editMode}
      onEdit={onEdit}
      onRemove={onRemove}
      caseMode
    />
  );
}
