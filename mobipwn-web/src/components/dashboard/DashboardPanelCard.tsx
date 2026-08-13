import { Link } from "react-router-dom";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { CasePanelTitle, casePanelCardProps } from "@/components/cases/CasePanelTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardPanelChart } from "@/components/dashboard/DashboardPanelChart";
import { PlatformCaseTopsPanel } from "@/components/dashboard/PlatformCaseTopsPanel";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { applyTimePresetToQuery, type DashboardPanel } from "@/lib/dashboard";
import { PLATFORM_CASE_TOPS_PANEL_ID } from "@/lib/platformCaseTops";

type OverviewStats = {
  alerts_new?: number;
  events_24h?: number;
};

type Props = {
  panel: DashboardPanel;
  timePreset: string;
  refreshKey: number;
  editMode: boolean;
  overview?: OverviewStats | null;
  onEdit?: () => void;
  onRemove?: () => void;
  removing?: boolean;
  /** Unified chrome when embedded in the case investigation dashboard. */
  caseMode?: boolean;
};

export function DashboardPanelCard({
  panel,
  timePreset,
  refreshKey,
  editMode,
  overview,
  onEdit,
  onRemove,
  removing,
  caseMode = false,
}: Props) {
  const { t } = useLocale();
  const isOverviewWidget = panel.id === "alerts_link" && !panel.query.trim();
  const isPlatformCaseTops = panel.id === PLATFORM_CASE_TOPS_PANEL_ID;
  const isCustomWidget = isOverviewWidget || isPlatformCaseTops;
  const { rows, columns, loading, error, elapsedMs, refresh } = useDashboardPanel(
    panel,
    timePreset,
    refreshKey,
    !isCustomWidget
  );

  const queryForChart = applyTimePresetToQuery(panel.query, timePreset);

  return (
    <Card
      className={`dashboard-panel-card h-full${caseMode ? " case-panel-card" : ""}${editMode ? " dashboard-panel-card--editing" : ""}`}
      {...(caseMode ? casePanelCardProps(panel) : {})}
    >
      <CardHeader className={`dashboard-panel-header py-2${caseMode ? " case-panel-header" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          {caseMode ? (
            <CasePanelTitle title={panel.title} viz={panel.viz} />
          ) : (
            <CardTitle className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted-foreground)]">
              {panel.title}
            </CardTitle>
          )}
          <div className="dashboard-panel-actions flex shrink-0 items-center gap-1 dashboard-no-drag">
            {!editMode && !isCustomWidget && !caseMode && (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => void refresh()} title="Refresh panel">
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              </Button>
            )}
            {editMode && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={onEdit}>
                {t("dashboards.edit")}
              </Button>
            )}
            {onRemove && editMode && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-[var(--destructive)]"
                disabled={removing}
                title={t("dashboards.deletePanel")}
                onClick={onRemove}
              >
                <Trash2 size={12} />
              </Button>
            )}
          </div>
        </div>
        {!editMode && elapsedMs != null && !isCustomWidget && !caseMode && (
          <p className="text-[10px] text-[var(--muted-foreground)]">{elapsedMs} ms</p>
        )}
        {!editMode && isPlatformCaseTops && (
          <p className="text-[10px] text-[var(--muted-foreground)]">{t("dashboards.platformTopsHint")}</p>
        )}
      </CardHeader>
      <CardContent
        className={`dashboard-panel-body dashboard-no-drag${caseMode ? " dashboard-panel-body--scroll case-panel-body" : ""}`}
      >
        {isOverviewWidget ? (
          <>
            <div className="dashboard-single-value">
              {overview?.alerts_new?.toLocaleString() ?? "—"}
            </div>
            <Button variant="ghost" size="sm" className="mt-2 px-0" asChild>
              <Link to="/alerts">Triage alerts</Link>
            </Button>
          </>
        ) : isPlatformCaseTops ? (
          <PlatformCaseTopsPanel timePreset={timePreset} refreshKey={refreshKey} />
        ) : loading && !rows.length ? (
          <div className="dashboard-panel-loading">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : error ? (
          <p className="dashboard-panel-error">{error}</p>
        ) : (
          <DashboardPanelChart
            viz={panel.viz}
            query={queryForChart}
            rows={rows}
            columns={columns}
            compact
          />
        )}
      </CardContent>
    </Card>
  );
}
