import { useLocale } from "@/contexts/LocaleContext";
import type { IronSiftTabId } from "@/lib/ironsift";

const TAB_LABELS: Record<IronSiftTabId, string> = {
  dashboard: "ironsift.tabDashboard",
  ingestion: "ironsift.tabIngestion",
  config: "ironsift.tabConfig",
  runs: "ironsift.tabRuns",
  anomark: "ironsift.tabAnomark",
  "fleet-memory": "ironsift.tabFleetMemory",
};

const TAB_ICONS: Record<IronSiftTabId, string> = {
  dashboard: "◈",
  ingestion: "↓",
  config: "⚙",
  runs: "⚡",
  anomark: "⌗",
  "fleet-memory": "◉",
};

export function IronSiftTabBar({
  active,
  onChange,
}: {
  active: IronSiftTabId;
  onChange: (tab: IronSiftTabId) => void;
}) {
  const { t } = useLocale();
  return (
    <nav className="ironsift-tabs" role="tablist" aria-label="IronSift">
      {(Object.keys(TAB_LABELS) as IronSiftTabId[]).map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          data-tab={id}
          aria-selected={active === id}
          className={`ironsift-tab${active === id ? " ironsift-tab--active" : ""}`}
          onClick={() => onChange(id)}
        >
          <span className="ironsift-tab__icon" aria-hidden>
            {TAB_ICONS[id]}
          </span>
          {t(TAB_LABELS[id])}
        </button>
      ))}
    </nav>
  );
}
