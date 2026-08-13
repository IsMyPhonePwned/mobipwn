import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EndpointDeviceRuleFields } from "@/components/ironsift/EndpointDeviceRuleFields";
import { CaseTagsEditor } from "@/components/cases/CaseTagsEditor";
import { IngestProgressPanel } from "@/components/ingest/IngestProgressPanel";
import { IronSiftFeedback } from "@/components/ironsift/IronSiftFeedback";
import { useLocale } from "@/contexts/LocaleContext";
import { apiFetch } from "@/lib/api";
import { parseCaseTagInput } from "@/lib/cases";
import { parseIronSiftError } from "@/lib/ironsiftActivity";
import { pickUnusedCaseSource, randomCaseSource } from "@/lib/caseSource";
import { DEMO_ENDPOINT_JSONL } from "@/lib/endpointDemoData";
import {
  endpointDeviceRuleQuery,
  uploadEndpointJsonl,
  uploadEndpointZip,
} from "@/lib/ingestEndpoint";
import { endpointIngestSteps, type IngestProgress } from "@/lib/ingestProgress";
import {
  applyIronSiftTagScopeChange,
  mergeEndpointIngestConfig,
  saveIronSiftConfig,
  type EndpointIngestConfig,
  type IronSiftPlatformConfig,
  type IronSiftScopeOptions,
} from "@/lib/ironsift";
import { IronSiftConfigSaveBar } from "@/components/ironsift/IronSiftConfigSaveBar";
import { DatasetPicker } from "./DatasetPicker";
import { TagScopeChips } from "./TagScopeChips";

type DataSummary = { sources: { source: string }[] };

export function IronSiftIngestionTab({
  scopeOptions,
  config,
  canWrite,
  canWriteCases,
  onIngested,
}: {
  scopeOptions: IronSiftScopeOptions | null;
  config: IronSiftPlatformConfig;
  canWrite: boolean;
  canWriteCases: boolean;
  onIngested: () => void;
}) {
  const { t } = useLocale();
  const [source, setSource] = useState("");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [inspectId, setInspectId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [endpointIngest, setEndpointIngest] = useState<EndpointIngestConfig>(() =>
    mergeEndpointIngestConfig(config.endpoint_ingest)
  );
  const [configBusy, setConfigBusy] = useState(false);

  useEffect(() => {
    setEndpointIngest(mergeEndpointIngestConfig(config.endpoint_ingest));
  }, [config.endpoint_ingest]);

  useEffect(() => {
    apiFetch<DataSummary>("/v1/data/summary")
      .then((s) => setSource(pickUnusedCaseSource(s.sources.map((x) => x.source))))
      .catch(() => setSource(randomCaseSource()));
  }, []);

  const inspectSource = scopeOptions?.sources.find((s) => s.source === inspectId);
  const inspectCase = scopeOptions?.cases.find((c) => c.id === inspectId);
  const tagCaseId = inspectCase?.id ?? inspectSource?.case_id ?? null;
  const tagCase = tagCaseId
    ? scopeOptions?.cases.find((c) => c.id === tagCaseId)
    : undefined;
  const tagCaseTags = tagCase?.tags ?? inspectSource?.tags ?? [];
  const knownTags = scopeOptions?.tags ?? [];

  function applyIngestTags(nextTags: string) {
    setTags(nextTags);
    const auto = applyIronSiftTagScopeChange(scopeOptions, nextTags);
    setSelectedIds(auto.datasetIds);
    if (auto.datasetIds.length === 1) {
      setInspectId(auto.datasetIds[0]);
    } else if (auto.selectedCaseId) {
      setInspectId(auto.selectedCaseId);
    } else if (auto.selectedSource) {
      setInspectId(auto.selectedSource);
    }
  }

  async function upload() {
    if (!file || !source.trim()) return;
    setBusy(true);
    setError("");
    setStatus("");
    const uploadTags = parseCaseTagInput(tags);
    try {
      const isZip = file.name.toLowerCase().endsWith(".zip");
      if (isZip) {
        await uploadEndpointZip({
          source: source.trim(),
          file,
          tags: uploadTags,
          deviceRule: endpointDeviceRuleQuery(endpointIngest),
          onProgress: setProgress,
        });
      } else {
        const text = await file.text();
        await uploadEndpointJsonl({
          source: source.trim(),
          jsonl: text,
          fileName: file.name,
          tags: uploadTags,
          onProgress: setProgress,
        });
      }
      setStatus(t("ironsift.ingestSuccessDetail", { source: source.trim() }));
      onIngested();
    } catch (e) {
      setError(parseIronSiftError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const savedEndpointIngest = useMemo(
    () => mergeEndpointIngestConfig(config.endpoint_ingest),
    [config.endpoint_ingest]
  );
  const endpointIngestDirty = useMemo(
    () => JSON.stringify(endpointIngest) !== JSON.stringify(savedEndpointIngest),
    [endpointIngest, savedEndpointIngest]
  );

  async function saveEndpointIngest() {
    setConfigBusy(true);
    setError("");
    try {
      await saveIronSiftConfig({ ...config, endpoint_ingest: endpointIngest });
      setStatus(t("ironsift.ingestDeviceRuleSaved"));
      onIngested();
    } catch (e) {
      setError(parseIronSiftError(e));
    } finally {
      setConfigBusy(false);
    }
  }

  async function loadDemo() {
    setBusy(true);
    setError("");
    const uploadTags = parseCaseTagInput(tags);
    try {
      const demoSource = source.trim() || "endpoint-demo";
      await uploadEndpointJsonl({
        source: demoSource,
        jsonl: DEMO_ENDPOINT_JSONL,
        fileName: "demo-fleet.jsonl",
        tags: uploadTags,
        onProgress: setProgress,
      });
      setStatus(t("ironsift.ingestSuccessDetail", { source: demoSource }));
      onIngested();
    } catch (e) {
      setError(parseIronSiftError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const progressSteps = progress
    ? endpointIngestSteps(progress.phase, {
        read: t("ingest.readingFile"),
        post: t("ingest.sendingToApi"),
        indexed: t("ingest.stepIndexed"),
      })
    : [];

  return (
    <>
      <IronSiftFeedback error={error} success={status} />

      <section className="card">
        <h2>{t("ironsift.ingestUploadTitle")}</h2>
        <p className="muted text-xs">{t("ironsift.ingestUploadHint")}</p>
        <div className="ironsift-ingest-form">
          <input type="file" accept=".csv,.json,.jsonl,.zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <input
            className="mono"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t("ironsift.ingestSourcePlaceholder")}
          />
          <input
            className="mono"
            value={tags}
            onChange={(e) => applyIngestTags(e.target.value)}
            placeholder={t("ironsift.ingestTagsPlaceholder")}
          />
          {knownTags.length > 0 && (
            <TagScopeChips
              knownTags={knownTags}
              selectedTags={tags}
              onChange={applyIngestTags}
            />
          )}
          <details className="ironsift-ingest-device-rule" open={Boolean(endpointIngest.zip_device_rule?.parent_dir_field)}>
            <summary>{t("ironsift.ingestDeviceRuleTitle")}</summary>
            <IronSiftConfigSaveBar
              canWrite={canWrite}
              isDirty={endpointIngestDirty}
              busy={configBusy}
              saveLabel={t("ironsift.ingestDeviceRuleSave")}
              onSave={() => void saveEndpointIngest()}
            />
            <EndpointDeviceRuleFields
              value={endpointIngest}
              canEdit={canWrite}
              onChange={setEndpointIngest}
            />
          </details>
          {canWrite && (
            <>
              <Button disabled={busy || !file} onClick={() => void upload()}>
                {busy ? t("ironsift.running") : t("ironsift.ingestUploadBtn")}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void loadDemo()}>
                {t("ironsift.demoIngestRun")}
              </Button>
            </>
          )}
        </div>
        <IngestProgressPanel
          visible={busy && progress !== null}
          title={t("ironsift.progressTitle")}
          percent={progress?.percent ?? 0}
          phaseLabel={progress?.phase ?? ""}
          detail={progress?.detail}
          steps={progressSteps}
        />
      </section>

      <section className="card">
        <h2>{t("ironsift.ingestDatasetsTitle")}</h2>
        <p className="muted text-xs">{t("ironsift.ingestDatasetsHint")}</p>
        <div className="ironsift-ingest-inspect-row">
          <label>
            <span className="muted text-xs">{t("ironsift.ingestInspect")}</span>
            <select className="mono" value={inspectId} onChange={(e) => setInspectId(e.target.value)}>
              <option value="">{t("ironsift.ingestInspectNone")}</option>
              {(scopeOptions?.cases ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} {c.ingest_source ? `(${c.ingest_source})` : ""}
                </option>
              ))}
              {(scopeOptions?.sources ?? []).map((s) => (
                <option key={s.source} value={s.source}>
                  {s.source}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(inspectSource || inspectCase) && (
          <div className="ironsift-dataset-inspect">
            <p>
              <strong>{inspectSource?.source ?? inspectCase?.title}</strong>
            </p>
            <p className="muted text-xs">
              {t("ironsift.ingestInspectHosts", {
                count: inspectSource?.device_ids.length ?? inspectCase?.device_ids.length ?? 0,
              })}
            </p>
            {tagCaseId && (
              <CaseTagsEditor
                caseId={tagCaseId}
                tags={tagCaseTags}
                canWrite={canWriteCases}
                onUpdated={() => onIngested()}
                onSuccess={() => setStatus(t("ironsift.tagsUpdated"))}
                onError={(msg) => setError(msg)}
              />
            )}
            {!tagCaseId && tagCaseTags.length > 0 && (
              <div className="ironsift-dataset-row__tags">
                {tagCaseTags.map((tag) => (
                  <span key={tag} className="pill">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <DatasetPicker
          scopeOptions={scopeOptions}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
        />
      </section>
    </>
  );
}
