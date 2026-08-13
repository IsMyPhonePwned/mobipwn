import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { IngestProgressPanel } from "@/components/ingest/IngestProgressPanel";
import { AnoMarkCommandTestPanel } from "@/components/ironsift/AnoMarkCommandTestPanel";
import { AnoMarkInspectPanel } from "@/components/ironsift/AnoMarkInspectPanel";
import { DatasetPicker } from "@/components/ironsift/DatasetPicker";
import { IronSiftActiveConfigNote } from "@/components/ironsift/IronSiftActiveConfigBanner";
import { IronSiftFeedback } from "@/components/ironsift/IronSiftFeedback";
import { ScopePanel, type ScopeState } from "@/components/ironsift/ScopePanel";
import { mergeScopePatch } from "@/components/ironsift/scopeTagSync";
import { useLocale } from "@/contexts/LocaleContext";
import {
  anomarkTrainPercent,
  anomarkTrainSteps,
  formatAnoMarkTrainSuccess,
  parseIronSiftError,
  startAnoMarkTrainProgress,
  type AnoMarkTrainPhase,
} from "@/lib/ironsiftActivity";
import {
  buildScopeFilter,
  deleteAllAnoMarkTrains,
  deleteAnoMarkTrain,
  inspectAnoMarkTrain,
  parseTagInput,
  trainAnoMark,
  mergeAnomarkConfig,
  type AnoMarkTrainInspectResult,
  type AnoMarkTrainRecord,
  type ConfigProfilesListResponse,
  type IronSiftPlatformConfig,
  type IronSiftScopeOptions,
  type IronSiftTabId,
} from "@/lib/ironsift";

export function IronSiftAnomarkTab({
  scopeOptions,
  trains,
  config,
  anomarkProfiles,
  canWrite,
  configEnabled,
  onTrained,
  onNavigate,
}: {
  scopeOptions: IronSiftScopeOptions | null;
  trains: AnoMarkTrainRecord[];
  config: IronSiftPlatformConfig;
  anomarkProfiles: ConfigProfilesListResponse | null;
  canWrite: boolean;
  configEnabled: boolean;
  onTrained: () => void;
  onNavigate: (tab: IronSiftTabId) => void;
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
  const [label, setLabel] = useState("");
  const [trainTags, setTrainTags] = useState("");
  const anomarkCfg = mergeAnomarkConfig(config.anomark_config);
  const [order, setOrder] = useState(anomarkCfg.default_order);

  useEffect(() => {
    setOrder(mergeAnomarkConfig(config.anomark_config).default_order);
  }, [config.anomark_config]);
  const [busy, setBusy] = useState(false);
  const [inspectBusy, setInspectBusy] = useState("");
  const [trainPhase, setTrainPhase] = useState<AnoMarkTrainPhase | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [warning, setWarning] = useState("");
  const [inspect, setInspect] = useState<AnoMarkTrainInspectResult | null>(null);

  const filter = buildScopeFilter({
    caseId: scope.selectedCaseId || undefined,
    source: scope.selectedSource || undefined,
    scopeTags: parseTagInput(scope.scopeTags),
    machineIds: scope.selectedMachines,
  });

  function phaseLabel(phase: AnoMarkTrainPhase): string {
    switch (phase) {
      case "scope":
        return t("ironsift.anomarkPhaseScope");
      case "extract":
        return t("ironsift.anomarkPhaseExtract");
      case "train":
        return t("ironsift.anomarkPhaseTrain", { order });
      case "persist":
        return t("ironsift.anomarkPhasePersist");
      case "done":
        return t("ironsift.anomarkTrainSuccess", {
          label: label.trim() || "baseline model",
          lines: "…",
          machines: "…",
          order,
          logs: "…",
        });
    }
  }

  async function runTrain() {
    setBusy(true);
    setError("");
    setSuccess("");
    setWarning("");
    setTrainPhase("scope");
    const stopProgress = startAnoMarkTrainProgress(setTrainPhase);
    try {
      const result = await trainAnoMark({
        label: label.trim() || "baseline model",
        filter,
        tags: parseTagInput(trainTags),
        order,
      });
      setTrainPhase("done");
      const copy = formatAnoMarkTrainSuccess(result, t);
      setSuccess(copy.message);
      if (copy.warning) setWarning(copy.warning);
      onTrained();
    } catch (e) {
      setError(parseIronSiftError(e));
      setTrainPhase(null);
    } finally {
      stopProgress();
      setBusy(false);
      window.setTimeout(() => setTrainPhase(null), 2500);
    }
  }

  async function inspectTrain(id: string) {
    setError("");
    setInspectBusy(id);
    try {
      setInspect(await inspectAnoMarkTrain(id));
    } catch (e) {
      setError(parseIronSiftError(e));
    } finally {
      setInspectBusy("");
    }
  }

  async function removeTrain(id: string, trainLabel: string) {
    const name = trainLabel || id.slice(0, 8);
    if (!window.confirm(t("ironsift.anomarkDeleteConfirm", { label: name }))) return;
    setError("");
    setSuccess("");
    try {
      await deleteAnoMarkTrain(id);
      if (inspect?.record.id === id) setInspect(null);
      setSuccess(t("ironsift.anomarkDeleted", { label: name }));
      onTrained();
    } catch (e) {
      setError(parseIronSiftError(e));
    }
  }

  async function removeAllTrains() {
    if (!window.confirm(t("ironsift.anomarkPurgeConfirm"))) return;
    setError("");
    setSuccess("");
    try {
      const { removed } = await deleteAllAnoMarkTrains();
      setInspect(null);
      setSuccess(t("ironsift.anomarkPurged", { count: removed }));
      onTrained();
    } catch (e) {
      setError(parseIronSiftError(e));
    }
  }

  const progressSteps = trainPhase
    ? anomarkTrainSteps(trainPhase === "done" ? "persist" : trainPhase, {
        scope: t("ironsift.anomarkStepScope"),
        extract: t("ironsift.anomarkStepExtract"),
        train: t("ironsift.anomarkStepTrain"),
        persist: t("ironsift.anomarkStepPersist"),
      }).map((step) =>
        trainPhase === "done" ? { ...step, status: "done" as const } : step
      )
    : [];

  return (
    <>
      <IronSiftFeedback error={error} success={success} warning={warning} />

      <AnoMarkCommandTestPanel
        trains={trains}
        config={config}
        defaultTrainId={inspect?.record.id}
      />

      <section className="card">
        <h2>{t("ironsift.anomarkTitle")}</h2>
        <IronSiftActiveConfigNote
          kind="anomark"
          profiles={anomarkProfiles}
          onOpenConfig={() => onNavigate("config")}
        />
        <p className="muted text-xs">{t("ironsift.anomarkHint")}</p>
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
        />
        <DatasetPicker
          scopeOptions={scopeOptions}
          selectedIds={datasetIds}
          onChange={setDatasetIds}
        />
        <div className="ironsift-anomark-train-form">
          <input
            className="mono"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("ironsift.anomarkLabelPlaceholder")}
          />
          <input
            className="mono"
            value={trainTags}
            onChange={(e) => setTrainTags(e.target.value)}
            placeholder={t("ironsift.anomarkTrainTags")}
          />
          <label>
            <span className="muted text-xs">{t("ironsift.anomarkOrderLabel")}</span>
            <input
              type="number"
              min={1}
              max={8}
              value={order}
              onChange={(e) => setOrder(Number(e.target.value))}
            />
          </label>
          <p className="muted text-xs">
            {t("ironsift.anomarkConfigDefaultsHint", {
              order: anomarkCfg.default_order,
              suspect: anomarkCfg.default_suspect_percent,
            })}{" "}
            <button type="button" className="ironsift-inline-link" onClick={() => onNavigate("config")}>
              {t("ironsift.tabConfig")}
            </button>
          </p>
          {canWrite && (
            <Button disabled={busy || !configEnabled} onClick={() => void runTrain()}>
              {busy ? t("ironsift.running") : t("ironsift.anomarkTrain")}
            </Button>
          )}
        </div>
        <IngestProgressPanel
          visible={busy && trainPhase !== null}
          title={t("ironsift.anomarkProgressTitle")}
          percent={trainPhase ? anomarkTrainPercent(trainPhase) : 0}
          phaseLabel={trainPhase ? phaseLabel(trainPhase) : ""}
          steps={progressSteps}
        />
      </section>

      <section className="card">
        <div className="ironsift-runs-toolbar">
          <h2>{t("ironsift.anomarkSavedTitle")}</h2>
          {canWrite && trains.length > 0 && (
            <Button variant="secondary" onClick={() => void removeAllTrains()}>
              {t("ironsift.anomarkPurgeAll")}
            </Button>
          )}
        </div>
        {trains.length === 0 ? (
          <p className="muted">{t("ironsift.anomarkNoTrains")}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("ironsift.colLabel")}</th>
                <th>{t("ironsift.colLines")}</th>
                <th>{t("ironsift.colCreated")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trains.map((tr) => (
                <tr key={tr.id} className={inspect?.record.id === tr.id ? "ironsift-row-active" : ""}>
                  <td>{tr.label || tr.id.slice(0, 8)}</td>
                  <td>{tr.training_line_count}</td>
                  <td className="mono">{tr.created_at.slice(0, 19)}</td>
                  <td className="ironsift-anomark-row-actions">
                    <Button
                      variant={inspect?.record.id === tr.id ? "default" : "secondary"}
                      disabled={inspectBusy === tr.id}
                      onClick={() => void inspectTrain(tr.id)}
                    >
                      {inspectBusy === tr.id ? t("ironsift.running") : t("ironsift.inspectModel")}
                    </Button>
                    {canWrite && (
                      <Button variant="secondary" onClick={() => void removeTrain(tr.id, tr.label)}>
                        {t("common.delete")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {inspect && (
          <AnoMarkInspectPanel data={inspect} onClose={() => setInspect(null)} />
        )}
      </section>
    </>
  );
}
