import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IronSiftRunProgressPanel } from "@/components/ironsift/IronSiftRunProgressPanel";
import { IronSiftRunReportPanel } from "@/components/ironsift/IronSiftRunReportPanel";
import { DatasetPicker, selectedSourcesFromIds } from "@/components/ironsift/DatasetPicker";
import { FindingsTable } from "@/components/ironsift/FindingsTable";
import { HoneycombGrid } from "@/components/ironsift/HoneycombGrid";
import { AnoMarkModelPicker } from "@/components/ironsift/AnoMarkModelPicker";
import { IronSiftActiveConfigNote } from "@/components/ironsift/IronSiftActiveConfigBanner";
import { IronSiftFeedback } from "@/components/ironsift/IronSiftFeedback";
import { ScopePanel, type ScopeState } from "@/components/ironsift/ScopePanel";
import { mergeScopePatch } from "@/components/ironsift/scopeTagSync";
import { useLocale } from "@/contexts/LocaleContext";
import {
  ironsiftRunPercent,
  ironsiftRunPhaseSteps,
  parseIronSiftError,
  startIronSiftRunProgress,
  type IronSiftRunPhase,
} from "@/lib/ironsiftActivity";
import {
  buildScopeFilter,
  createIronSiftRun,
  mergeAnomarkConfig,
  deleteAllIronSiftRuns,
  deleteIronSiftRun,
  fetchIronSiftFindings,
  fetchIronSiftHoneycomb,
  fetchIronSiftTriage,
  parseTagInput,
  fleetCheckToMode,
  fleetCheckUsesAnomark,
  type AnoMarkTrainRecord,
  type ConfigProfilesListResponse,
  type IronSiftFleetCheck,
  type HoneycombCell,
  type IronSiftFinding,
  type IronSiftPlatformConfig,
  type IronSiftRun,
  type IronSiftScopeOptions,
  type IronSiftTriageRecord,
} from "@/lib/ironsift";
import {
  formatIronSiftRunCompleteDetail,
  formatIronSiftRunSuccess,
} from "@/lib/ironsiftRunReport";

function toIso(local: string): string | undefined {
  if (!local.trim()) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function IronSiftRunsTab({
  runs,
  selectedId,
  scopeOptions,
  config,
  anomarkProfiles,
  anomarkTrains,
  selectedAnomarkTrainId,
  canWrite,
  onSelectRun,
  onRefresh,
  onOpenConfig,
  onOpenAnomark,
}: {
  runs: IronSiftRun[];
  selectedId: string;
  scopeOptions: IronSiftScopeOptions | null;
  config: IronSiftPlatformConfig;
  anomarkProfiles: ConfigProfilesListResponse | null;
  anomarkTrains: AnoMarkTrainRecord[];
  selectedAnomarkTrainId: string | null;
  canWrite: boolean;
  onSelectRun: (id: string) => void;
  onRefresh: () => Promise<void>;
  onOpenConfig?: () => void;
  onOpenAnomark?: () => void;
}) {
  const { t } = useLocale();
  const [scope, setScope] = useState<ScopeState>({
    selectedCaseId: "",
    selectedSource: "",
    scopeTags: "",
    selectedMachines: [],
    baselineFrom: "",
    baselineTo: "",
    currentFrom: "",
    currentTo: "",
  });
  const [datasetIds, setDatasetIds] = useState<string[]>([]);
  const [fleetCheck, setFleetCheck] = useState<IronSiftFleetCheck>("process");
  const [temporalMode, setTemporalMode] = useState(false);
  const [anomarkTrainId, setAnomarkTrainId] = useState("");
  const anomarkCfg = mergeAnomarkConfig(config.anomark_config);
  const [anomarkSuspectPct, setAnomarkSuspectPct] = useState(anomarkCfg.default_suspect_percent);

  useEffect(() => {
    setAnomarkSuspectPct(mergeAnomarkConfig(config.anomark_config).default_suspect_percent);
  }, [config.anomark_config]);

  useEffect(() => {
    if (selectedAnomarkTrainId) setAnomarkTrainId(selectedAnomarkTrainId);
  }, [selectedAnomarkTrainId]);
  const [syncAlerts, setSyncAlerts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runPhase, setRunPhase] = useState<IronSiftRunPhase | null>(null);
  const [runPhaseDetail, setRunPhaseDetail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [findings, setFindings] = useState<IronSiftFinding[]>([]);
  const [honeycomb, setHoneycomb] = useState<HoneycombCell[]>([]);
  const [triage, setTriage] = useState<IronSiftTriageRecord[]>([]);
  const [focusRequest, setFocusRequest] = useState<{ machineId: string; at: number } | null>(
    null
  );
  const findingsPanelRef = useRef<HTMLElement>(null);

  const selected = runs.find((r) => r.id === selectedId);

  const loadRunDetails = useCallback(
    async (id: string) => {
      const [f, h, tr] = await Promise.all([
        fetchIronSiftFindings(id),
        fetchIronSiftHoneycomb(id, config.min_score),
        fetchIronSiftTriage(id),
      ]);
      setFindings(f);
      setHoneycomb(h);
      setTriage(tr);
    },
    [config.min_score]
  );

  useEffect(() => {
    if (!selectedId) {
      setFindings([]);
      setHoneycomb([]);
      setTriage([]);
      setFocusRequest(null);
      return;
    }
    setFocusRequest(null);
    void loadRunDetails(selectedId).catch((e) => setError(parseIronSiftError(e)));
  }, [selectedId, loadRunDetails]);

  function openFindingFromHoneycomb(machineId: string) {
    setFocusRequest({ machineId, at: Date.now() });
    window.requestAnimationFrame(() => {
      findingsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const scopeFilter = useMemo(() => {
    const picked = selectedSourcesFromIds(scopeOptions, datasetIds);
    return buildScopeFilter({
      caseId: scope.selectedCaseId || picked.caseId,
      source: scope.selectedSource || picked.sources[0],
      sources: picked.sources.length > 1 ? picked.sources : undefined,
      scopeTags: parseTagInput(scope.scopeTags),
      machineIds: scope.selectedMachines,
      baselineFrom: toIso(scope.baselineFrom),
      baselineTo: toIso(scope.baselineTo),
      currentFrom: toIso(scope.currentFrom),
      currentTo: toIso(scope.currentTo),
    });
  }, [scope, datasetIds, scopeOptions]);

  async function selectRun(id: string) {
    onSelectRun(id);
  }

  const includeAnomarkProgress = !temporalMode && fleetCheckUsesAnomark(fleetCheck);

  async function startRun() {
    if (temporalMode) {
      if (!scope.baselineFrom || !scope.baselineTo || !scope.currentFrom) {
        setError(t("ironsift.temporalWindowsRequired"));
        return;
      }
    } else if (fleetCheckUsesAnomark(fleetCheck) && !anomarkTrainId) {
      setError(t("ironsift.runAnomarkModelRequired"));
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    setRunPhase("scope");
    setRunPhaseDetail(t("ironsift.runPhaseScopeDetail"));
    const stopProgress = startIronSiftRunProgress(
      (phase) => {
        setRunPhase(phase);
        if (phase === "scope") setRunPhaseDetail(t("ironsift.runPhaseScopeDetail"));
        else if (phase === "extract") setRunPhaseDetail(t("ironsift.runPhaseExtractDetail"));
        else if (phase === "cluster") setRunPhaseDetail(t("ironsift.analysisDetail"));
        else if (phase === "anomark") setRunPhaseDetail(t("ironsift.runPhaseAnomarkDetail"));
        else if (phase === "findings") setRunPhaseDetail(t("ironsift.runPhaseFindingsDetail"));
      },
      includeAnomarkProgress
    );
    try {
      const run = await createIronSiftRun(
        temporalMode
          ? {
              mode: "temporal",
              scope: scope.selectedCaseId
                ? "case"
                : scope.selectedMachines.length
                  ? "device"
                  : "fleet",
              filter: scopeFilter,
              sync_alerts: syncAlerts,
            }
          : {
              fleet_check: fleetCheck,
              scope: scope.selectedCaseId
                ? "case"
                : scope.selectedMachines.length
                  ? "device"
                  : "fleet",
              filter: scopeFilter,
              enable_anomark: fleetCheckUsesAnomark(fleetCheck),
              anomark_train_id: fleetCheckUsesAnomark(fleetCheck) ? anomarkTrainId : null,
              anomark_suspect_percent: anomarkSuspectPct,
              sync_alerts: syncAlerts,
            }
      );
      setRunPhase("done");
      setRunPhaseDetail(formatIronSiftRunCompleteDetail(run, t));
      setSuccess(formatIronSiftRunSuccess(run, t));
      onSelectRun(run.id);
      await onRefresh();
      await loadRunDetails(run.id);
    } catch (e) {
      setError(parseIronSiftError(e));
      setRunPhase(null);
    } finally {
      stopProgress();
      setBusy(false);
      window.setTimeout(() => setRunPhase(null), 3000);
    }
  }

  async function removeRun(id: string) {
    if (!window.confirm(t("ironsift.deleteRunConfirm"))) return;
    setError("");
    setSuccess("");
    try {
      await deleteIronSiftRun(id);
      if (id === selectedId) onSelectRun("");
      setSuccess(t("ironsift.runDeleted"));
      await onRefresh();
    } catch (e) {
      setError(parseIronSiftError(e));
    }
  }

  async function removeAllRuns() {
    if (!window.confirm(t("ironsift.deleteAllRunsConfirm"))) return;
    setError("");
    setSuccess("");
    try {
      const { deleted } = await deleteAllIronSiftRuns();
      onSelectRun("");
      setSuccess(t("ironsift.runsDeletedAll", { count: deleted }));
      await onRefresh();
    } catch (e) {
      setError(parseIronSiftError(e));
    }
  }

  function runPhaseLabel(phase: IronSiftRunPhase): string {
    switch (phase) {
      case "scope":
        return t("ironsift.runPhaseScope");
      case "extract":
        return t("ironsift.runPhaseExtract");
      case "cluster":
        return t("ironsift.phaseAnalysis");
      case "anomark":
        return t("ironsift.runPhaseAnomark");
      case "findings":
        return t("ironsift.runPhaseFindings");
      case "done":
        return t("ironsift.runPhaseDone");
    }
  }

  const progressSteps = runPhase
    ? ironsiftRunPhaseSteps(runPhase, includeAnomarkProgress, {
        scope: t("ironsift.runStepScope"),
        extract: t("ironsift.runStepExtract"),
        cluster: t("ironsift.stepAnalysis"),
        anomark: t("ironsift.runStepAnomark"),
        findings: t("ironsift.stepResults"),
      })
    : [];

  return (
    <>
      <IronSiftFeedback error={error} success={success} />

      <section className="card ironsift-card ironsift-card--create">
        <details open>
          <summary>{t("ironsift.createRunTitle")}</summary>
          <p className="muted text-xs">{t("ironsift.createRunHint")}</p>
          <label className="ironsift-config-check ironsift-temporal-toggle">
            <input
              type="checkbox"
              checked={temporalMode}
              onChange={(e) => setTemporalMode(e.target.checked)}
            />
            <span>{t("ironsift.temporalMode")}</span>
          </label>
          {!temporalMode && (
            <div className="ironsift-run-mode-row">
              <span className="muted text-xs">{t("ironsift.fleetCheckLabel")}</span>
              {(
                ["process", "process_anomark", "file", "both", "anomark"] as IronSiftFleetCheck[]
              ).map((m) => (
                <label key={m} className="btn btn-secondary">
                  <input
                    type="radio"
                    name="fleetCheck"
                    checked={fleetCheck === m}
                    onChange={() => setFleetCheck(m)}
                  />
                  {t(`ironsift.fleetCheck_${m}`)}
                </label>
              ))}
            </div>
          )}
          <h3 className="text-sm">{t("ironsift.scopeTitle")}</h3>
          <ScopePanel
            scopeOptions={scopeOptions}
            state={scope}
            onChange={(patch) => {
              if ("scopeTags" in patch) {
                setScope((prev) => {
                  const { next, datasetIds: tagDatasetIds } = mergeScopePatch(
                    scopeOptions,
                    prev,
                    patch
                  );
                  if (tagDatasetIds !== undefined) setDatasetIds(tagDatasetIds);
                  return next;
                });
                return;
              }
              setScope((prev) => ({ ...prev, ...patch }));
            }}
            showTemporal={temporalMode}
          />
          <h3 className="text-sm">{t("ironsift.datasetsForRun")}</h3>
          <DatasetPicker
            scopeOptions={scopeOptions}
            selectedIds={datasetIds}
            onChange={setDatasetIds}
          />
          {!temporalMode && fleetCheckUsesAnomark(fleetCheck) && (
            <>
              <h3 className="text-sm">{t("ironsift.runAnomarkTitle")}</h3>
              <IronSiftActiveConfigNote
                kind="anomark"
                profiles={anomarkProfiles}
                onOpenConfig={onOpenConfig}
              />
              <p className="muted text-xs">
                {fleetCheck === "anomark"
                  ? t("ironsift.runAnomarkRequiredHint")
                  : fleetCheck === "process_anomark"
                    ? t("ironsift.runAnomarkProcessHint")
                    : t("ironsift.runAnomarkBothHint")}
              </p>
              <AnoMarkModelPicker
                trains={anomarkTrains}
                selectedTrainId={selectedAnomarkTrainId}
                trainId={anomarkTrainId}
                suspectPercent={anomarkSuspectPct}
                canWrite={canWrite}
                onTrainIdChange={setAnomarkTrainId}
                onSuspectPercentChange={setAnomarkSuspectPct}
                onSelectionSaved={onRefresh}
                onError={setError}
                onSuccess={setSuccess}
                onOpenAnomark={onOpenAnomark}
              />
            </>
          )}
          <label className="ironsift-config-check ironsift-run-sync-alerts">
            <input
              type="checkbox"
              checked={syncAlerts}
              onChange={(e) => setSyncAlerts(e.target.checked)}
            />
            <span>{t("ironsift.runSyncAlerts")}</span>
          </label>
          <p className="muted text-xs ironsift-run-sync-alerts-hint">
            {t("ironsift.runSyncAlertsHint")}
          </p>
          {canWrite && (
            <Button disabled={busy || !config.enabled} onClick={() => void startRun()}>
              {busy
                ? t("ironsift.running")
                : temporalMode
                  ? t("ironsift.startRun")
                  : t("ironsift.runFleetCheck", {
                      check: t(`ironsift.fleetCheck_${fleetCheck}`),
                    })}
            </Button>
          )}
        </details>
        <IronSiftRunProgressPanel
          visible={runPhase !== null}
          title={t("ironsift.progressTitle")}
          percent={runPhase ? ironsiftRunPercent(runPhase) : 0}
          phaseLabel={runPhase ? runPhaseLabel(runPhase) : ""}
          detail={runPhaseDetail}
          steps={progressSteps}
          mode={temporalMode ? "temporal" : fleetCheckToMode(fleetCheck)}
        />
      </section>

      <div className="ironsift-runs-split">
        <section className="card ironsift-card ironsift-card--history ironsift-runs-sidebar">
          <div className="ironsift-runs-toolbar">
            <h2>{t("ironsift.runsTitle")}</h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void onRefresh()
                  .then(() => setSuccess(t("ironsift.refreshDone")))
                  .catch((e) => setError(parseIronSiftError(e)))
              }
            >
              {t("common.refresh")}
            </Button>
            {canWrite && (
              <Button variant="secondary" size="sm" onClick={() => void removeAllRuns()}>
                {t("ironsift.deleteAllRuns")}
              </Button>
            )}
          </div>
          {runs.length === 0 ? (
            <p className="muted">{t("ironsift.noRuns")}</p>
          ) : (
            <ul className="ironsift-run-list">
              {runs.map((r) => (
                <li key={r.id} className="ironsift-run-card">
                  <button
                    type="button"
                    className={`ironsift-run-card__body${r.id === selectedId ? " ironsift-run-active" : ""}`}
                    onClick={() => void selectRun(r.id)}
                  >
                    <span className="mono ironsift-run-card__when">{r.started_at.slice(0, 19)}</span>
                    <span className="ironsift-run-card__tags">
                      <span className={`ironsift-mode-badge ironsift-mode-badge--${r.mode}`}>
                        {r.mode}
                      </span>
                      <span className={`ironsift-status-badge ironsift-status-badge--${r.status}`}>
                        {r.status}
                      </span>
                      <span className="muted ironsift-run-card__count">
                        {r.anomaly_count} findings
                      </span>
                    </span>
                    {(r.ironsift_config_name || r.anomark_config_name) && (
                      <span className="muted text-xs ironsift-run-configs">
                        {[
                          r.ironsift_config_name &&
                            `${t("ironsift.reportIronSiftConfig")}: ${r.ironsift_config_name}`,
                          r.anomark_config_name &&
                            `${t("ironsift.reportAnomarkConfig")}: ${r.anomark_config_name}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </button>
                  {canWrite && (
                    <Button
                      className="ironsift-run-card__delete"
                      variant="ghost"
                      size="sm"
                      title={t("ironsift.deleteRun")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeRun(r.id);
                      }}
                    >
                      {t("common.delete")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="ironsift-runs-detail">
          {!selected ? (
            <section className="card ironsift-runs-empty">
              <p className="muted">{t("ironsift.selectRunHint")}</p>
            </section>
          ) : (
            <div className="ironsift-layout">
              <section className="card">
                <div className="ironsift-runs-toolbar">
                  <h2>{t("ironsift.summaryTitle")}</h2>
                  {canWrite && (
                    <Button variant="secondary" size="sm" onClick={() => void removeRun(selected.id)}>
                      {t("ironsift.deleteRun")}
                    </Button>
                  )}
                </div>
                <IronSiftRunReportPanel run={selected} />
              </section>
              <section className="card">
                <h2>{t("ironsift.honeycombTitle")}</h2>
                <HoneycombGrid cells={honeycomb} onCellClick={openFindingFromHoneycomb} />
              </section>
              <section ref={findingsPanelRef} className="card ironsift-findings-panel">
                <h2>{t("ironsift.findingsTitle")}</h2>
                <FindingsTable
                  runId={selected.id}
                  findings={findings}
                  triage={triage}
                  scopeFilter={selected.scope_filter}
                  scopeOptions={scopeOptions}
                  canWrite={canWrite}
                  focusRequest={focusRequest}
                  onTriageSaved={() => void loadRunDetails(selected.id)}
                  onTriageMessage={(msg) => setSuccess(msg)}
                  onTriageError={(msg) => setError(msg)}
                />
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
