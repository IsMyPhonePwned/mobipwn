import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EnrichmentProvider } from "@/lib/enrichment";
import {
  formatSyncStats,
  isVerboseSyncEvent,
  syncEventClass,
  syncEventKindLabel,
  tallySyncStats,
  type SyncProgressEvent,
  type SyncStats,
} from "@/lib/marketplaceSync";

export type ProviderSyncResult = {
  slug: string;
  name: string;
  status: "ok" | "error" | "skipped" | string;
  rows_written: number;
  error?: string | null;
  duration_ms: number;
  stats?: SyncStats | null;
};

export type SyncSummary = {
  synced: number;
  failed: number;
  skipped: number;
  rows_written: number;
  elapsed_ms: number;
  dictionaries_reloaded: boolean;
  mode?: string;
  providers: ProviderSyncResult[];
};

type SyncLabels = {
  running: string;
  runningHint: string;
  elapsed: string;
  syncingProviders: string;
  complete: string;
  failed: string;
  rowsWritten: string;
  dictReloaded: string;
  dictReloadFailed: string;
  statusOk: string;
  statusError: string;
  statusSkipped: string;
  lastSync: string;
  neverSynced: string;
  syncLogTitle: string;
  syncStop: string;
  syncCancelled: string;
  syncModeFull: string;
  syncModeIncremental: string;
  syncLiveStats: string;
  syncShowVerbose: string;
  syncHideVerbose: string;
  statsModeFull: string;
  statsModeIncremental: string;
  statsQueued: string;
  statsApiRequests: string;
  statsSkipped: string;
  statsRowsWritten: string;
  statsNoActivity: string;
};

type Props = {
  syncing: boolean;
  elapsedSec: number;
  enabledProviders: EnrichmentProvider[];
  progressLog: SyncProgressEvent[];
  summary: SyncSummary | null;
  error: string | null;
  labels: SyncLabels;
  cancelled?: boolean;
  onStop?: () => void;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

function formatLastSync(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function statsLabels(labels: SyncLabels) {
  return {
    modeFull: labels.statsModeFull,
    modeIncremental: labels.statsModeIncremental,
    queued: labels.statsQueued,
    apiRequests: labels.statsApiRequests,
    skipped: labels.statsSkipped,
    rowsWritten: labels.statsRowsWritten,
    noActivity: labels.statsNoActivity,
  };
}

function providerStatsLine(p: ProviderSyncResult, labels: SyncLabels): string | null {
  if (p.stats) {
    return formatSyncStats(p.stats, statsLabels(labels));
  }
  if (p.status === "ok" && p.rows_written > 0) {
    return labels.statsRowsWritten.replace("{{n}}", String(p.rows_written));
  }
  return null;
}

export function MarketplaceSyncPanel({
  syncing,
  elapsedSec,
  enabledProviders,
  progressLog,
  summary,
  error,
  labels,
  cancelled,
  onStop,
}: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const [showVerbose, setShowVerbose] = useState(false);

  const statsLabelSet = useMemo(() => statsLabels(labels), [labels]);

  const liveBySlug = useMemo(() => {
    const slugs = new Set(progressLog.map((e) => e.slug).filter(Boolean) as string[]);
    const map = new Map<string, SyncStats>();
    for (const slug of slugs) {
      map.set(slug, tallySyncStats(progressLog, slug));
    }
    return map;
  }, [progressLog]);

  const visibleLog = useMemo(
    () =>
      showVerbose
        ? progressLog
        : progressLog.filter((ev) => !isVerboseSyncEvent(ev.kind)),
    [progressLog, showVerbose]
  );

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleLog.length, syncing]);

  if (!syncing && !summary && !error && !cancelled && progressLog.length === 0) return null;

  const modeLabel =
    summary?.mode === "full"
      ? labels.syncModeFull
      : summary?.mode === "incremental"
        ? labels.syncModeIncremental
        : null;

  return (
    <div
      className={`marketplace-sync-panel${syncing ? " marketplace-sync-panel--running" : ""}${
        error
          ? " marketplace-sync-panel--error"
          : cancelled
            ? " marketplace-sync-panel--warn"
            : summary?.failed
              ? " marketplace-sync-panel--warn"
              : ""
      }`}
      role="status"
      aria-live="polite"
    >
      {syncing && (
        <div className="marketplace-sync-running">
          <Loader2 size={16} className="marketplace-sync-spinner" aria-hidden />
          <div className="marketplace-sync-running-body">
            <div className="marketplace-sync-running-header">
              <strong>{labels.running}</strong>
              {onStop && (
                <button type="button" className="btn btn-sm marketplace-sync-stop" onClick={onStop}>
                  {labels.syncStop}
                </button>
              )}
            </div>
            <p className="marketplace-sync-hint muted">{labels.runningHint}</p>
            {enabledProviders.length > 0 && (
              <p className="marketplace-sync-providers muted">
                {labels.syncingProviders}: {enabledProviders.map((p) => p.name).join(", ")}
              </p>
            )}
            <p className="marketplace-sync-elapsed muted">
              {labels.elapsed.replace("{{elapsed}}", formatElapsed(elapsedSec))}
            </p>
            {liveBySlug.size > 0 && (
              <div className="marketplace-sync-live-stats">
                <span className="marketplace-sync-live-stats-title muted">{labels.syncLiveStats}</span>
                <ul className="marketplace-sync-live-stats-list">
                  {[...liveBySlug.entries()].map(([slug, stats]) => (
                    <li key={slug}>
                      <span className="marketplace-sync-log__slug">[{slug}]</span>{" "}
                      {formatSyncStats(stats, statsLabelSet)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {progressLog.length > 0 && (
        <div className="marketplace-sync-log-wrap">
          <div className="marketplace-sync-log-header">
            <div className="marketplace-sync-log-title muted">{labels.syncLogTitle}</div>
            <button
              type="button"
              className="btn btn-sm btn-ghost marketplace-sync-log-toggle"
              onClick={() => setShowVerbose((v) => !v)}
            >
              {showVerbose ? labels.syncHideVerbose : labels.syncShowVerbose}
            </button>
          </div>
          <div className="marketplace-sync-log" ref={logRef}>
            {visibleLog.map((ev, i) => (
              <div
                key={`${i}-${ev.kind}-${ev.message}`}
                className={`marketplace-sync-log__line ${syncEventClass(ev.kind)}`.trim()}
              >
                <span className="marketplace-sync-log__kind">{syncEventKindLabel(ev.kind)}</span>
                {ev.slug && <span className="marketplace-sync-log__slug">[{ev.slug}]</span>}
                {ev.field && (
                  <span className="marketplace-sync-log__field mono">{ev.field}</span>
                )}
                {ev.indicator && (
                  <span className="marketplace-sync-log__indicator mono">{ev.indicator}</span>
                )}
                <span className="marketplace-sync-log__msg">{ev.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {syncing && progressLog.length === 0 && (
        <div className="marketplace-sync-log-wrap">
          <div className="marketplace-sync-log-title muted">{labels.syncLogTitle}</div>
          <div className="marketplace-sync-log">
            <div className="marketplace-sync-log__line marketplace-sync-log__line--muted">
              Waiting for sync events…
            </div>
          </div>
        </div>
      )}

      {!syncing && cancelled && !summary && (
        <div className="marketplace-sync-result marketplace-sync-result--warn">
          <XCircle size={16} aria-hidden />
          <div>
            <strong>{labels.syncCancelled}</strong>
          </div>
        </div>
      )}

      {!syncing && error && (
        <div className="marketplace-sync-result marketplace-sync-result--error">
          <XCircle size={16} aria-hidden />
          <div>
            <strong>{labels.failed}</strong>
            <p className="muted">{error}</p>
          </div>
        </div>
      )}

      {!syncing && summary && (
        <div className="marketplace-sync-result marketplace-sync-result--done">
          <CheckCircle2 size={16} aria-hidden />
          <div className="marketplace-sync-result-body">
            <strong>{labels.complete}</strong>
            <p className="muted">
              {modeLabel && <span className="marketplace-sync-mode">{modeLabel} · </span>}
              {labels.rowsWritten.replace("{{n}}", String(summary.rows_written))}
              {" · "}
              {formatDuration(summary.elapsed_ms)}
              {summary.dictionaries_reloaded
                ? ` · ${labels.dictReloaded}`
                : summary.rows_written > 0
                  ? ` · ${labels.dictReloadFailed}`
                  : ""}
            </p>
            <ul className="marketplace-sync-provider-results">
              {summary.providers.map((p) => {
                const statsLine = providerStatsLine(p, labels);
                return (
                  <li
                    key={p.slug}
                    className={`marketplace-sync-provider-result marketplace-sync-provider-result--${p.status}`}
                  >
                    <span className="marketplace-sync-provider-name">{p.name}</span>
                    <span className="marketplace-sync-provider-meta muted">
                      {p.status === "ok" && (
                        <>
                          {labels.statusOk} · {formatDuration(p.duration_ms)}
                          {statsLine && (
                            <span className="marketplace-sync-provider-stats">{statsLine}</span>
                          )}
                        </>
                      )}
                      {p.status === "error" && (
                        <>
                          {labels.statusError}
                          {p.error ? `: ${p.error}` : ""}
                        </>
                      )}
                      {p.status === "skipped" && labels.statusSkipped}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProviderLastSync({
  provider,
  labels,
}: {
  provider: EnrichmentProvider;
  labels: Pick<SyncLabels, "lastSync" | "neverSynced">;
}) {
  if (!provider.enabled) return null;
  const when = formatLastSync(provider.last_sync_at);
  const status = provider.last_sync_status;
  const err = provider.last_sync_error;
  return (
    <p className="provider-last-sync muted">
      {when ? labels.lastSync.replace("{{when}}", when) : labels.neverSynced}
      {status === "error" && err && <span className="provider-last-sync-error"> — {err}</span>}
    </p>
  );
}
