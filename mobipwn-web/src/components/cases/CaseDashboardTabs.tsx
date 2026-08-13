import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CaseDashboardSection } from "@/components/cases/CaseDashboardSection";
import { CaseDashboardTabBar } from "@/components/cases/CaseDashboardTabBar";
import { EntitiesSection } from "@/components/cases/EntitiesSection";
import { useLocale } from "@/contexts/LocaleContext";
import type { CaseEntitiesResponse } from "@/lib/cases";
import {
  caseDashboardSections,
  casePlatformLabel,
  type CaseDashboardSectionId,
  type CasePlatform,
} from "@/lib/caseDashboard";

const TAB_IDS = new Set<CaseDashboardSectionId>([
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
]);

function tabFromParam(raw: string | null, allowed: CaseDashboardSectionId[]): CaseDashboardSectionId {
  const normalized = (raw ?? "").trim().toLowerCase().replace(/-/g, "_");
  const v = normalized as CaseDashboardSectionId;
  if (TAB_IDS.has(v) && allowed.includes(v)) return v;
  return allowed[0] ?? "overview";
}

export function CaseDashboardTabs({
  caseId,
  ingestSource,
  platform,
  entities,
  canWriteEntities = false,
  onEntitiesChange,
}: {
  caseId: string;
  ingestSource: string;
  platform: CasePlatform;
  entities: CaseEntitiesResponse | null;
  canWriteEntities?: boolean;
  onEntitiesChange?: (data: CaseEntitiesResponse) => void;
}) {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs = useMemo(() => caseDashboardSections(platform), [platform]);

  const [activeTab, setActiveTab] = useState<CaseDashboardSectionId>(() =>
    tabFromParam(searchParams.get("tab"), tabs)
  );

  useEffect(() => {
    const next = tabFromParam(searchParams.get("tab"), tabs);
    setActiveTab((prev) => (prev === next ? prev : next));
  }, [searchParams, tabs]);

  const onChangeTab = (tab: CaseDashboardSectionId) => {
    setActiveTab(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "overview") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true }
    );
  };

  return (
    <section className={`card case-detail-dashboard case-detail-dashboard--${activeTab}`}>
      <header className="case-detail-dashboard__header">
        <div className="case-detail-dashboard__intro">
          <h2 className="case-detail-dashboard__title">
            <LayoutDashboard size={18} aria-hidden />
            {t("cases.dashboardTitle", { platform: casePlatformLabel(platform) })}
          </h2>
          <CaseDashboardTabBar tabs={tabs} active={activeTab} onChange={onChangeTab} />
        </div>
        <div className="case-detail-dashboard__actions case-detail-dashboard__actions--tabs">
          <Button variant="secondary" size="sm" asChild>
            <Link to="/dashboards">{t("cases.dashboardFleetLink")}</Link>
          </Button>
        </div>
      </header>

      <div
        id={`case-dashboard-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`case-dashboard-tab-${activeTab}`}
        className={`case-dashboard-tab-panel case-dashboard-tab-panel--${activeTab}`}
      >
        {activeTab === "entities" ? (
          <div className="case-dashboard-section-embedded case-dashboard-entities">
            <div className="case-detail-dashboard__subheader">
              <p className="muted text-xs case-detail-dashboard__hint">
                {t("cases.dashboardEntitiesHint")}
              </p>
            </div>
            {entities ? (
              <EntitiesSection
                caseId={caseId}
                data={entities}
                searchScope={`source="${ingestSource}"`}
                canWrite={canWriteEntities}
                onEntitiesChange={onEntitiesChange}
              />
            ) : (
              <p className="muted text-xs">No entities extracted from case events yet.</p>
            )}
          </div>
        ) : (
          <CaseDashboardSection
            key={activeTab}
            embedded
            caseId={caseId}
            ingestSource={ingestSource}
            platform={platform}
            section={activeTab}
          />
        )}
      </div>
    </section>
  );
}
