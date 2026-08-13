import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Download, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { IngestProgressPanel } from "@/components/ingest/IngestProgressPanel";
import { SectionHeader } from "@/components/SectionHeader";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import {
  deleteStoredBlob,
  downloadStoredBlob,
  listStoredBlobs,
  reingestStoredBlob,
  storeAndReingestBlob,
  storeCollectBlob,
  type ReingestResponse,
  type StoredBlob,
} from "@/lib/blobStorage";
import { formatBytes, reingestSteps, type IngestProgress } from "@/lib/ingestProgress";
import { hasPermission } from "@/lib/permissions";
import { runReingestWithProgress } from "@/lib/reingestWithProgress";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function originLabel(origin: string): string {
  if (origin === "public-collect") return "Collect";
  if (origin === "ingest") return "Ingest";
  if (origin === "device-pull") return "Device pull";
  return origin;
}

export function BlobStorageSection() {
  const { t } = useLocale();
  const { log } = useActivityLog();
  const { user } = useAuth();
  const canIngest = hasPermission(user, "ingest_write");
  const [blobs, setBlobs] = useState<StoredBlob[]>([]);
  const [sourceFilter, setSourceFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadSource, setUploadSource] = useState("");
  const [uploadPlatform, setUploadPlatform] = useState<"android" | "ios">("ios");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [reingestProgress, setReingestProgress] = useState<IngestProgress | null>(null);
  const [reingestStatus, setReingestStatus] = useState<string | null>(null);
  const [reingestSource, setReingestSource] = useState<string | null>(null);

  const progressLabels = useMemo(
    () => ({
      starting: t("data.blobStorageReingestStarting"),
      waiting: t("data.blobStorageReingestWaiting"),
      complete: t("data.blobStorageReingestComplete"),
    }),
    [t]
  );

  const stepLabels = useMemo(
    () => ({
      clear: t("cases.reingestStepClear"),
      parse: t("cases.reingestStepParse"),
      index: t("cases.reingestStepIndex"),
      done: t("cases.reingestStepDone"),
    }),
    [t]
  );

  const progressSteps = useMemo(
    () => reingestSteps(reingestProgress?.stage, stepLabels),
    [reingestProgress?.stage, stepLabels]
  );

  const reingestBusy = busyId !== null || uploadBusy;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listStoredBlobs({
        source: sourceFilter.trim() || undefined,
        limit: 200,
      });
      setBlobs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBlobs([]);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    setReingestStatus(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      setReingestProgress(null);
      setReingestSource(null);
    }
  };

  const formatReingestResult = (r: ReingestResponse, fileName: string) => {
    const cleared =
      r.events_cleared != null && r.events_cleared > 0
        ? t("cases.reingestCleared", { count: r.events_cleared })
        : "";
    const done = t("cases.reingestDone", { count: r.ingested });
    return `${fileName}: ${done}${cleared ? ` · ${cleared}` : ""}`;
  };

  const runReingest = async (
    id: string,
    source: string,
    fileName: string,
    action: () => Promise<ReingestResponse>
  ) => {
    setBusyId(id);
    setReingestSource(source);
    setError(null);
    setReingestStatus(null);
    setReingestProgress({
      percent: 5,
      phase: "processing",
      stage: "starting",
      detail: progressLabels.starting,
    });
    try {
      const r = await runReingestWithProgress(source, action, setReingestProgress, progressLabels);
      const msg = formatReingestResult(r, fileName);
      setReingestStatus(msg);
      log("info", `Re-ingested ${msg}${r.deduplicated ? " (deduplicated)" : ""}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      setReingestProgress(null);
      setReingestSource(null);
    }
  };

  return (
    <section className="card data-page-blob-storage mb-3">
      <div className="blob-storage__header">
        <SectionHeader
          label={t("data.blobStorageTitle")}
          meta={blobs.length ? `${blobs.length} file(s)` : undefined}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} aria-hidden />
          {t("common.refresh")}
        </button>
      </div>
      <p className="muted text-sm blob-storage__intro">{t("data.blobStorageIntro")}</p>
      <p className="muted text-xs blob-storage__intro">{t("data.blobStorageReingestCleanHint")}</p>

      {canIngest && (
        <div className="blob-storage__upload">
          <div className="blob-storage__upload-field">
            <span className="muted text-xs">{t("data.blobStorageUploadTitle")}</span>
            <span className="muted text-xs">{t("data.blobStorageUploadIntro")}</span>
          </div>
          <label className="blob-storage__upload-field">
            <span className="muted text-xs">{t("data.blobStorageUploadSource")}</span>
            <input
              type="text"
              value={uploadSource}
              onChange={(e) => setUploadSource(e.target.value)}
              placeholder="case-a1b2c3d4"
              spellCheck={false}
            />
          </label>
          <label className="blob-storage__upload-field">
            <span className="muted text-xs">{t("data.blobStorageUploadPlatform")}</span>
            <select
              value={uploadPlatform}
              onChange={(e) => setUploadPlatform(e.target.value as "android" | "ios")}
            >
              <option value="ios">iOS sysdiagnose</option>
              <option value="android">Android bugreport</option>
            </select>
          </label>
          <label className="blob-storage__upload-field">
            <span className="muted text-xs">{t("data.blobStorageUploadFile")}</span>
            <input
              type="file"
              accept={uploadPlatform === "ios" ? ".tar.gz,.tgz,.tar.xz,.xz,.zip" : ".zip,.txt"}
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="blob-storage__upload-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={uploadBusy || !uploadSource.trim() || !uploadFile}
              onClick={() => {
                if (!uploadFile) return;
                setUploadBusy(true);
                setError(null);
                void (async () => {
                  try {
                    await storeCollectBlob({
                      platform: uploadPlatform,
                      source: uploadSource.trim(),
                      fileName: uploadFile.name,
                      data: uploadFile,
                      origin: "blob-upload",
                    });
                    log("info", `Stored blob ${uploadFile.name} for ${uploadSource.trim()}`);
                    setUploadFile(null);
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setUploadBusy(false);
                  }
                })();
              }}
            >
              {t("data.blobStorageUploadStore")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={uploadBusy || !uploadSource.trim() || !uploadFile}
              onClick={() => {
                if (!uploadFile) return;
                const source = uploadSource.trim();
                const file = uploadFile;
                setUploadBusy(true);
                setReingestSource(source);
                setError(null);
                setReingestStatus(null);
                setReingestProgress({
                  percent: 5,
                  phase: "processing",
                  stage: "starting",
                  detail: progressLabels.starting,
                });
                void (async () => {
                  try {
                    const r = await runReingestWithProgress(
                      source,
                      () =>
                        storeAndReingestBlob({
                          platform: uploadPlatform,
                          source,
                          fileName: file.name,
                          data: file,
                          clean: true,
                        }),
                      setReingestProgress,
                      progressLabels
                    );
                    const msg = formatReingestResult(r, file.name);
                    setReingestStatus(msg);
                    log("info", `Stored & re-ingested ${msg}`);
                    setUploadFile(null);
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setUploadBusy(false);
                    setReingestProgress(null);
                    setReingestSource(null);
                  }
                })();
              }}
            >
              {t("data.blobStorageUploadStoreReingest")}
            </button>
          </div>
        </div>
      )}

      <div className="blob-storage__filters toolbar">
        <label className="blob-storage__filter">
          <span className="muted">{t("data.blobStorageFilterSource")}</span>
          <input
            type="text"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            placeholder="case-a1b2c3d4"
            spellCheck={false}
          />
        </label>
        <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          {t("data.blobStorageFilterApply")}
        </button>
      </div>

      {error && <p className="error text-sm">{error}</p>}

      <IngestProgressPanel
        visible={reingestBusy && reingestProgress !== null}
        title={t("data.blobStorageReingestProgress")}
        percent={reingestProgress?.percent ?? 0}
        phaseLabel={reingestProgress?.detail || t("data.blobStorageReingestProgress")}
        detail={reingestProgress?.detail}
        stage={reingestProgress?.stage}
        parsers={reingestProgress?.parsers}
        parsersCompleted={reingestProgress?.parsersCompleted}
        parsersTotal={reingestProgress?.parsersTotal}
        parsersActive={reingestProgress?.parsersActive}
        logarchive={reingestProgress?.logarchive}
        steps={progressSteps}
      />

      {reingestStatus && !reingestBusy ? (
        <p className="blob-storage__reingest-status text-sm" role="status">
          <CheckCircle2 size={14} aria-hidden />
          {reingestStatus}
          {reingestSource ? (
            <span className="muted text-xs"> · {reingestSource}</span>
          ) : null}
        </p>
      ) : null}

      {loading ? (
        <p className="muted text-sm">{t("common.loading")}</p>
      ) : blobs.length === 0 ? (
        <p className="muted text-sm">{t("data.blobStorageEmpty")}</p>
      ) : (
        <div className="results-table-wrap blob-storage__table-wrap">
          <table className="data-table blob-storage__table">
            <thead>
              <tr>
                <th>{t("data.blobStorageColWhen")}</th>
                <th>{t("data.blobStorageColFile")}</th>
                <th>{t("data.blobStorageColHash")}</th>
                <th>{t("data.blobStorageColSource")}</th>
                <th>{t("data.blobStorageColOrigin")}</th>
                <th>{t("data.blobStorageColAnalyzed")}</th>
                <th>{t("data.blobStorageColPlatform")}</th>
                <th>{t("data.blobStorageColSize")}</th>
                <th>{t("data.blobStorageColCase")}</th>
                <th>{t("data.blobStorageColActions")}</th>
              </tr>
            </thead>
            <tbody>
              {blobs.map((b) => (
                <tr key={b.id}>
                  <td className="mono blob-storage__when">{formatWhen(b.created_at)}</td>
                  <td className="blob-storage__file" title={b.file_name}>
                    {b.file_name}
                  </td>
                  <td className="mono blob-storage__hash" title={b.file_hash || undefined}>
                    {b.file_hash ? (
                      <code className="blob-storage__hash-code">{b.file_hash}</code>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="mono">{b.source}</td>
                  <td>{originLabel(b.origin)}</td>
                  <td>
                    {b.analyzed ? t("data.blobStorageAnalyzedYes") : t("data.blobStorageAnalyzedNo")}
                  </td>
                  <td>{b.platform}</td>
                  <td>{formatBytes(b.file_size)}</td>
                  <td>
                    {b.case_id ? (
                      <Link to={`/cases/${b.case_id}`}>{b.case_title ?? b.source}</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="data-actions-cell">
                    <div className="blob-storage__actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm blob-storage__action"
                        title={t("data.blobStorageDownload")}
                        disabled={busyId === b.id}
                        onClick={() =>
                          void runAction(b.id, async () => {
                            await downloadStoredBlob(b.id, b.file_name);
                            log("info", `Downloaded blob ${b.file_name}`);
                          })
                        }
                      >
                        <Download size={15} aria-hidden />
                      </button>
                      {canIngest && (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm blob-storage__action"
                            title={t("data.blobStorageReingest")}
                            disabled={busyId === b.id}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Re-ingest "${b.file_name}" for source ${b.source}? Existing events for this source will be cleared first.`
                                )
                              ) {
                                return;
                              }
                              void runReingest(b.id, b.source, b.file_name, () =>
                                reingestStoredBlob(b.id, { clean: true })
                              );
                            }}
                          >
                            <RotateCcw size={15} aria-hidden />
                            <span className="blob-storage__action-label">
                              {t("data.blobStorageReingestShort")}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm blob-storage__action delete-ingest-btn"
                            title={t("data.blobStorageDelete")}
                            disabled={busyId === b.id}
                            onClick={() => {
                              if (!window.confirm(t("data.blobStorageDeleteConfirm"))) return;
                              void runAction(b.id, async () => {
                                await deleteStoredBlob(b.id);
                                log("info", `Deleted blob ${b.file_name}`);
                              });
                            }}
                          >
                            <Trash2 size={15} aria-hidden />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
