import { useLocale } from "@/contexts/LocaleContext";

export type CollectorTabId = "collect" | "yara" | "settings";

const TAB_ORDER: CollectorTabId[] = ["collect", "yara", "settings"];

const TAB_LABELS: Record<CollectorTabId, string> = {
  collect: "collector.tabCollect",
  yara: "collector.tabYara",
  settings: "collector.tabSettings",
};

const TAB_ICONS: Record<CollectorTabId, string> = {
  collect: "⬇",
  yara: "🛡",
  settings: "⚙",
};

export function CollectorTabBar({
  active,
  onChange,
}: {
  active: CollectorTabId;
  onChange: (tab: CollectorTabId) => void;
}) {
  const { t } = useLocale();
  return (
    <nav className="app-tabs collector-tabs" role="tablist" aria-label="Collector">
      {TAB_ORDER.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          data-tab={id}
          aria-selected={active === id}
          className={`app-tab collector-tab${active === id ? " app-tab--active" : ""}`}
          onClick={() => onChange(id)}
        >
          <span className="app-tab__icon" aria-hidden>
            {TAB_ICONS[id]}
          </span>
          {t(TAB_LABELS[id])}
        </button>
      ))}
    </nav>
  );
}
