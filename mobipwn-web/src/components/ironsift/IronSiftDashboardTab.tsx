import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import type { IronSiftDashboardStats, IronSiftTabId } from "@/lib/ironsift";

export function IronSiftDashboardTab({
  stats,
  configEnabled,
  onNavigate,
}: {
  stats: IronSiftDashboardStats | null;
  configEnabled: boolean;
  onNavigate: (tab: IronSiftTabId) => void;
}) {
  const { t } = useLocale();
  const latest = stats?.latest_run;

  return (
    <>
      <section className="card ironsift-card">
        <p className="muted">{t("ironsift.dashIntro")}</p>
        <h2>{t("ironsift.dashOverview")}</h2>
        <div className="ironsift-kpis">
          <div className="ironsift-kpi ironsift-kpi--sources">
            <div className="ironsift-kpi__label">{t("ironsift.kpiSources")}</div>
            <div className="ironsift-kpi__value">{stats?.source_count ?? 0}</div>
            <p className="muted text-xs">{t("ironsift.kpiSourcesHint")}</p>
          </div>
          <div className="ironsift-kpi ironsift-kpi--runs">
            <div className="ironsift-kpi__label">{t("ironsift.kpiRuns")}</div>
            <div className="ironsift-kpi__value">{stats?.run_count ?? 0}</div>
            <p className="muted text-xs">{t("ironsift.kpiRunsHint")}</p>
          </div>
          <div className="ironsift-kpi ironsift-kpi--findings">
            <div className="ironsift-kpi__label">{t("ironsift.kpiFindings")}</div>
            <div className="ironsift-kpi__value">{stats?.latest_findings_count ?? 0}</div>
            <p className="muted text-xs">{t("ironsift.kpiFindingsHint")}</p>
          </div>
          <div className="ironsift-kpi ironsift-kpi--anomark">
            <div className="ironsift-kpi__label">{t("ironsift.kpiAnomark")}</div>
            <div className="ironsift-kpi__value">{stats?.anomark_train_count ?? 0}</div>
            <p className="muted text-xs">{t("ironsift.kpiAnomarkHint")}</p>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>{t("ironsift.dashWorkflow")}</h3>
        <ol className="ironsift-workflow">
          <li>{t("ironsift.dashStep1")}</li>
          <li>{t("ironsift.dashStep2")}</li>
          <li>{t("ironsift.dashStep3")}</li>
          <li>{t("ironsift.dashStep4")}</li>
        </ol>
      </section>

      <section className="card">
        <h3>{t("ironsift.dashStatus")}</h3>
        <ul className="ironsift-status-list">
          <li>
            {configEnabled ? t("ironsift.statusEnabled") : t("ironsift.statusDisabled")}
          </li>
          <li>
            {latest
              ? t("ironsift.statusLatestRun", {
                  mode: latest.mode,
                  findings: latest.anomaly_count,
                  when: latest.started_at.slice(0, 19),
                })
              : t("ironsift.statusNoRuns")}
          </li>
        </ul>
      </section>

      <section className="card">
        <h3>{t("ironsift.dashQuick")}</h3>
        <div className="ironsift-quick-actions">
          <Button variant="secondary" onClick={() => onNavigate("ingestion")}>
            {t("ironsift.tabIngestion")}
          </Button>
          <Button variant="secondary" onClick={() => onNavigate("runs")}>
            {t("ironsift.tabRuns")}
          </Button>
          <Button variant="secondary" onClick={() => onNavigate("anomark")}>
            {t("ironsift.tabAnomark")}
          </Button>
          <Button variant="secondary" onClick={() => onNavigate("fleet-memory")}>
            {t("ironsift.tabFleetMemory")}
          </Button>
        </div>
      </section>
    </>
  );
}
