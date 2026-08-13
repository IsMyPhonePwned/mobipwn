import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, RotateCcw, Upload } from "lucide-react";
import { IngestProgressPanel } from "@/components/ingest/IngestProgressPanel";
import { Button } from "@/components/ui/button";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { reingestCase } from "@/lib/cases";
import type { CasePlatform } from "@/lib/caseDashboard";
import {
  listStoredBlobs,
  reingestStoredBlob,
  storeAndReingestBlob,
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

function reingestSummary(
  r: { ingested: number; events_cleared?: number | null },
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  const cleared =
    r.events_cleared != null && r.events_cleared > 0
      ? t("cases.reingestCleared", { count: r.events_cleared })
      : "";
  return `${t("cases.reingestDone", { count: r.ingested })}${cleared ? ` · ${cleared}` : ""}`;
}

export type CaseReingestPanelHandle = {
  reingestLatest: () => void;
};

export const CaseReingestPanel = forwardRef<
  CaseReingestPanelHandle,
  {
    caseId: string;
    ingestSource: string;
    platform: CasePlatform;
    caseUser?: string;
    onComplete?: () => void;
  }
>(function CaseReingestPanel(
  { caseId, ingestSource, platform, caseUser, onComplete },
  ref
) {
  const { t } = useLocale();
  const { log } = useActivityLog();
  const { user } = useAuth();
  const canIngest = hasPermission(user, "ingest_write");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [blobs, setBlobs] = useState<StoredBlob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<IngestProgress | null>(null);

  const ingestPlatform = platform === "ios" ? "ios" : platform === "android" ? "android" : null;

  const progressLabels = useMemo(
    () => ({
      starting: t("cases.reingestStarting"),
      waiting: t("cases.reingestWaitingJob"),
      complete: t("cases.reingestComplete"),
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
    () => reingestSteps(progress?.stage, stepLabels),
    [progress?.stage, stepLabels]
  );

  const phaseLabel =
    progress?.detail ||
    (busy ? t("cases.reingestProgressTitle") : "");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listStoredBlobs({ source: ingestSource, limit: 1 });
      setBlobs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBlobs([]);
    } finally {
      setLoading(false);
    }
  }, [ingestSource]);

  useEffect(() => {
    void load();
  }, [load]);

  const runReingest = useCallback(
    async (
      label: string,
      action: () => Promise<ReingestResponse>
    ) => {
      setBusy(label);
      setError(null);
      setStatus(null);
      setProgress({
        percent: 5,
        phase: "processing",
        stage: "starting",
        detail: progressLabels.starting,
      });
      try {
        const result = await runReingestWithProgress(
          ingestSource,
          action,
          setProgress,
          progressLabels
        );
        const msg = reingestSummary(result, t);
        setStatus(msg);
        log("info", `Case re-ingest (${ingestSource}): ${msg}`);
        await load();
        onComplete?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        log("error", `Case re-ingest failed (${ingestSource})`, msg);
      } finally {
        setBusy(null);
        setProgress(null);
      }
    },
    [ingestSource, load, log, onComplete, progressLabels, t]
  );

  useImperativeHandle(
    ref,
    () => ({
      reingestLatest: () => {
        if (busy || loading || blobs.length === 0) return;
        void runReingest("latest", () => reingestCase(caseId, { clean: true }));
      },
    }),
    [blobs.length, busy, caseId, loading, runReingest]
  );

  const onUploadFile = async (file: File) => {
    if (!ingestPlatform) {
      setError(t("cases.reingestEndpointUnsupported"));
      return;
    }
    await runReingest(`upload:${file.name}`, () =>
      storeAndReingestBlob({
        platform: ingestPlatform,
        source: ingestSource,
        fileName: file.name,
        data: file,
        user: caseUser,
        clean: true,
      })
    );
  };

  if (!canIngest) return null;

  return (
    <section id="case-reingest" className="card case-reingest mb-3">
      <header className="case-reingest__header">
        <div>
          <h2 className="case-reingest__title">{t("cases.reingestTitle")}</h2>
          <p className="muted text-xs case-reingest__intro">{t("cases.reingestIntro")}</p>
        </div>
        <div className="case-reingest__header-actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={!!busy || loading || blobs.length === 0}
            onClick={() =>
              void runReingest("latest", () => reingestCase(caseId, { clean: true }))
            }
          >
            {busy === "latest" ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <RotateCcw size={14} aria-hidden />
            )}
            {t("cases.reingestLatest")}
          </Button>
          {ingestPlatform ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                accept={ingestPlatform === "ios" ? ".tar.gz,.tgz,.tar.xz,.xz,.zip" : ".zip,.txt"}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void onUploadFile(file);
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={!!busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {busy?.startsWith("upload:") ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <Upload size={14} aria-hidden />
                )}
                {t("cases.reingestUpload")}
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <IngestProgressPanel
        visible={!!busy && progress !== null}
        title={t("cases.reingestProgressTitle")}
        percent={progress?.percent ?? 0}
        phaseLabel={phaseLabel}
        detail={progress?.detail}
        stage={progress?.stage}
        parsers={progress?.parsers}
        parsersCompleted={progress?.parsersCompleted}
        parsersTotal={progress?.parsersTotal}
        parsersActive={progress?.parsersActive}
        logarchive={progress?.logarchive}
        steps={progressSteps}
      />

      {status && !busy ? (
        <p className="case-reingest__status text-sm case-reingest__status--ok" role="status">
          <CheckCircle2 size={14} aria-hidden />
          {status}
        </p>
      ) : null}
      {error ? <p className="error text-sm">{error}</p> : null}

      {loading ? (
        <p className="muted text-sm">{t("common.loading")}</p>
      ) : blobs.length === 0 ? (
        <p className="muted text-sm">
          {t("cases.reingestNoBlobs")}{" "}
          <Link to="/data">{t("cases.reingestDataLink")}</Link>
          {ingestPlatform ? (
            <>
              {" "}
              {t("cases.reingestOrUpload")}
            </>
          ) : null}
        </p>
      ) : (
        <ul className="case-reingest__list">
          {blobs.map((blob) => (
            <li key={blob.id} className="case-reingest__item">
              <div className="case-reingest__item-main">
                <span className="case-reingest__file" title={blob.file_name}>
                  {blob.file_name}
                </span>
                <span className="muted text-xs case-reingest__meta">
                  {formatWhen(blob.created_at)} · {formatBytes(blob.file_size)} · {blob.platform}
                  {blob.file_hash ? (
                    <>
                      {" · "}
                      <code className="mono case-reingest__hash" title={blob.file_hash}>
                        sha256:{blob.file_hash}
                      </code>
                    </>
                  ) : null}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  void runReingest(blob.id, () =>
                    reingestStoredBlob(blob.id, { clean: true })
                  )
                }
              >
                {busy === blob.id ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <RotateCcw size={14} aria-hidden />
                )}
                {t("cases.reingestBlob")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
