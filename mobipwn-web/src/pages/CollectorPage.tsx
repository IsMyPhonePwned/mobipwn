import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollectorTabBar, type CollectorTabId } from "@/components/collector/CollectorTabBar";
import { CollectorYaraSection } from "@/components/collector/CollectorYaraSection";
import { PublicCollectPanel } from "@/components/collector/PublicCollectPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsCollectorSection } from "@/components/settings/SettingsCollectorSection";
import { useLocale } from "@/contexts/LocaleContext";

const VALID_TABS: CollectorTabId[] = ["collect", "yara", "settings"];

function tabFromParams(params: URLSearchParams): CollectorTabId {
  const raw = params.get("tab");
  if (raw === "repositories") return "collect";
  if (raw && VALID_TABS.includes(raw as CollectorTabId)) {
    return raw as CollectorTabId;
  }
  return "collect";
}

export default function CollectorPage() {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<CollectorTabId>(() => tabFromParams(searchParams));

  useEffect(() => {
    setTab(tabFromParams(searchParams));
  }, [searchParams]);

  const changeTab = (next: CollectorTabId) => {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === "collect") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="collector-page">
      <PageHeader
        title={t("collector.settingsTitle")}
        description={t("collector.pageSubtitle")}
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link to="/collect" target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden />
              {t("collector.openPublicPage")}
            </Link>
          </Button>
        }
      />

      <CollectorTabBar active={tab} onChange={changeTab} />

      <div className="collector-tab-panel">
        {tab === "collect" && (
          <PublicCollectPanel
            embedded
            onOpenSettings={() => changeTab("settings")}
            onOpenYara={() => changeTab("yara")}
          />
        )}
        {tab === "yara" && <CollectorYaraSection />}
        {tab === "settings" && <SettingsCollectorSection />}
      </div>
    </div>
  );
}
