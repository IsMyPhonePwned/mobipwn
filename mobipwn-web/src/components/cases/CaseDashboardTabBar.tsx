import { AlertTriangle, Battery, Cable, Cpu, Fingerprint, LayoutDashboard, ListTree, Network, Package, Waypoints } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { CASE_DASHBOARD_TAB_ORDER, type CaseDashboardSectionId } from "@/lib/caseDashboard";

const TAB_LABEL_KEYS: Record<CaseDashboardSectionId, string> = {
  overview: "cases.dashboardTabGeneral",
  crashes: "cases.dashboardTabCrashes",
  packages: "cases.dashboardTabPackages",
  processes: "cases.dashboardTabProcesses",
  process_events: "cases.dashboardTabProcessEvents",
  battery: "cases.dashboardTabBattery",
  external_devices: "cases.dashboardTabExternalDevices",
  network: "cases.dashboardTabNetwork",
  authentication: "cases.dashboardTabAuthentication",
  entities: "cases.dashboardTabEntities",
};

const TAB_ICONS: Record<CaseDashboardSectionId, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  crashes: AlertTriangle,
  packages: Package,
  processes: Cpu,
  process_events: ListTree,
  battery: Battery,
  external_devices: Cable,
  network: Network,
  authentication: Fingerprint,
  entities: Waypoints,
};

export function CaseDashboardTabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: CaseDashboardSectionId[];
  active: CaseDashboardSectionId;
  onChange: (tab: CaseDashboardSectionId) => void;
}) {
  const { t } = useLocale();
  if (tabs.length < 2) return null;

  return (
    <nav className="case-dashboard-tabs" role="tablist" aria-label={t("cases.dashboardTabsLabel")}>
      {CASE_DASHBOARD_TAB_ORDER.filter((id) => tabs.includes(id)).map((id) => {
        const Icon = TAB_ICONS[id];
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`case-dashboard-tab-${id}`}
            aria-selected={active === id}
            aria-controls={`case-dashboard-panel-${id}`}
            className={`case-dashboard-tab${active === id ? " case-dashboard-tab--active" : ""}`}
            data-tab={id}
            onClick={() => onChange(id)}
          >
            <Icon size={14} aria-hidden className="case-dashboard-tab__icon" />
            {t(TAB_LABEL_KEYS[id])}
          </button>
        );
      })}
    </nav>
  );
}
