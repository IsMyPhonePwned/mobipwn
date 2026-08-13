import { useCallback, useEffect, useState } from "react";
import { IronSiftAnomarkTab } from "@/components/ironsift/IronSiftAnomarkTab";
import { IronSiftDashboardTab } from "@/components/ironsift/IronSiftDashboardTab";
import { IronSiftFleetMemoryTab } from "@/components/ironsift/IronSiftFleetMemoryTab";
import { IronSiftIngestionTab } from "@/components/ironsift/IronSiftIngestionTab";
import { IronSiftConfigTab } from "@/components/ironsift/IronSiftConfigTab";
import { IronSiftRunsTab } from "@/components/ironsift/IronSiftRunsTab";
import { IronSiftFeedback } from "@/components/ironsift/IronSiftFeedback";
import { IronSiftActiveConfigBanner } from "@/components/ironsift/IronSiftActiveConfigBanner";
import { IronSiftTabBar } from "@/components/ironsift/IronSiftTabBar";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { hasPermission } from "@/lib/permissions";
import { parseIronSiftError } from "@/lib/ironsiftActivity";
import {
  fetchAnomarkConfig,
  fetchAnoMarkTrains,
  mergeAnomarkConfig,
  mergeEndpointIngestConfig,
  fetchAnomarkConfigProfiles,
  fetchIronSiftConfig,
  fetchIronSiftConfigProfiles,
  fetchIronSiftDashboard,
  fetchIronSiftRuns,
  fetchIronSiftScopeOptions,
  type AnoMarkPlatformConfig,
  type ConfigProfilesListResponse,
  type AnoMarkTrainRecord,
  type IronSiftDashboardStats,
  type IronSiftPlatformConfig,
  type IronSiftRun,
  type IronSiftScopeOptions,
  type IronSiftTabId,
} from "@/lib/ironsift";

const DEFAULT_CONFIG: IronSiftPlatformConfig = {
  enabled: true,
  fleet_cron: "0 0 3 * * *",
  post_ingest_temporal: true,
  min_fleet_devices: 3,
  min_score: 0.4,
  mudm_platform: "endpoint",
  detection_config: {},
  anomark_config: mergeAnomarkConfig(),
  endpoint_ingest: mergeEndpointIngestConfig(),
};

export default function IronSiftPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const canWrite = hasPermission(user, "ironsift_write");
  const canWriteCases = hasPermission(user, "cases_write");
  const [tab, setTab] = useState<IronSiftTabId>("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [config, setConfig] = useState<IronSiftPlatformConfig>(DEFAULT_CONFIG);
  const [anomarkConfig, setAnomarkConfig] = useState<AnoMarkPlatformConfig>(() =>
    mergeAnomarkConfig()
  );
  const [dashboard, setDashboard] = useState<IronSiftDashboardStats | null>(null);
  const [scopeOptions, setScopeOptions] = useState<IronSiftScopeOptions | null>(null);
  const [runs, setRuns] = useState<IronSiftRun[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [anomarkTrains, setAnomarkTrains] = useState<AnoMarkTrainRecord[]>([]);
  const [selectedAnomarkTrainId, setSelectedAnomarkTrainId] = useState<string | null>(null);
  const [ironsiftProfiles, setIronsiftProfiles] = useState<ConfigProfilesListResponse | null>(
    null
  );
  const [anomarkProfiles, setAnomarkProfiles] = useState<ConfigProfilesListResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [cfg, anomark, dash, scope, runList, trains, isProfiles, amProfiles] =
        await Promise.all([
          fetchIronSiftConfig(),
          fetchAnomarkConfig(),
          fetchIronSiftDashboard(),
          fetchIronSiftScopeOptions(),
          fetchIronSiftRuns(),
          fetchAnoMarkTrains().catch(() => ({ trains: [], selected_id: null })),
          fetchIronSiftConfigProfiles().catch(() => ({ profiles: [], selected_id: null })),
          fetchAnomarkConfigProfiles().catch(() => ({ profiles: [], selected_id: null })),
        ]);
      const mergedAnomark = mergeAnomarkConfig(anomark);
      setAnomarkConfig(mergedAnomark);
      setConfig({
        ...cfg,
        anomark_config: mergedAnomark,
        endpoint_ingest: mergeEndpointIngestConfig(cfg.endpoint_ingest),
      });
      setDashboard(dash);
      setScopeOptions(scope);
      setRuns(runList);
      setAnomarkTrains(trains.trains);
      setSelectedAnomarkTrainId(trains.selected_id);
      setIronsiftProfiles(isProfiles);
      setAnomarkProfiles(amProfiles);
      setSelectedId((prev) => (prev && runList.some((r) => r.id === prev) ? prev : ""));
    } catch (e) {
      setError(parseIronSiftError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="ironsift-page">
      <PageHeader title={t("nav.ironsift")} description={t("ironsift.pageSubtitle")} />

      {!config.enabled && (
        <p className="muted">{t("ironsift.statusDisabled")}</p>
      )}
      <IronSiftFeedback error={error} />
      {loading && tab === "dashboard" && <p className="muted">{t("common.loading")}</p>}

      <IronSiftTabBar active={tab} onChange={setTab} />

      {!loading && (
        <IronSiftActiveConfigBanner
          ironsiftProfiles={ironsiftProfiles}
          anomarkProfiles={anomarkProfiles}
          onOpenConfig={(panel) => setTab(panel ?? "config")}
        />
      )}

      <div className="ironsift-tab-panel">
        {tab === "dashboard" && (
          <IronSiftDashboardTab
            stats={dashboard}
            configEnabled={config.enabled}
            onNavigate={setTab}
          />
        )}
        {tab === "ingestion" && (
          <IronSiftIngestionTab
            scopeOptions={scopeOptions}
            config={config}
            canWrite={canWrite}
            canWriteCases={canWriteCases}
            onIngested={() => void load()}
          />
        )}
        {tab === "config" && (
          <IronSiftConfigTab
            config={config}
            anomarkConfig={anomarkConfig}
            canWrite={canWrite}
            onSaved={load}
          />
        )}
        {tab === "runs" && (
          <IronSiftRunsTab
            runs={runs}
            selectedId={selectedId}
            scopeOptions={scopeOptions}
            config={config}
            anomarkProfiles={anomarkProfiles}
            anomarkTrains={anomarkTrains}
            selectedAnomarkTrainId={selectedAnomarkTrainId}
            canWrite={canWrite}
            onSelectRun={setSelectedId}
            onRefresh={load}
            onOpenConfig={() => setTab("config")}
            onOpenAnomark={() => setTab("anomark")}
          />
        )}
        {tab === "anomark" && (
          <IronSiftAnomarkTab
            scopeOptions={scopeOptions}
            trains={anomarkTrains}
            config={config}
            anomarkProfiles={anomarkProfiles}
            canWrite={canWrite}
            configEnabled={config.enabled}
            onTrained={() => void load()}
            onNavigate={setTab}
          />
        )}
        {tab === "fleet-memory" && <IronSiftFleetMemoryTab canWrite={canWrite} />}
      </div>
    </div>
  );
}
