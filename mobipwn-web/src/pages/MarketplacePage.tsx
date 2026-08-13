import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import { MarketplaceProviderList } from "@/components/marketplace/MarketplaceProviderList";
import { MarketplaceIpResolver } from "@/components/marketplace/MarketplaceIpResolver";
import { MarketplaceSyncPanel, type SyncSummary } from "@/components/marketplace/MarketplaceSyncPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import type { EnrichmentProvider } from "@/lib/enrichment";
import {
  cleanMarketplaceEnrichments,
  cleanProviderEnrichments,
  streamMarketplaceSync,
  streamProviderSync,
  SyncCancelledError,
  type SyncProgressEvent,
} from "@/lib/marketplaceSync";

export default function MarketplacePage() {
  const { log } = useActivityLog();
  const { t } = useLocale();
  const [providers, setProviders] = useState<EnrichmentProvider[]>([]);
  const [coveragePct, setCoveragePct] = useState<number | null>(null);
  const [syncTarget, setSyncTarget] = useState<"all" | string | null>(null);
  const syncing = syncTarget !== null;
  const [cleaningTarget, setCleaningTarget] = useState<"all" | string | null>(null);
  const [syncElapsedSec, setSyncElapsedSec] = useState(0);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncCancelled, setSyncCancelled] = useState(false);
  const [cleanMsg, setCleanMsg] = useState("");
  const [syncProgressLog, setSyncProgressLog] = useState<SyncProgressEvent[]>([]);
  const syncStartedRef = useRef<number | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);

  const syncLabels = useMemo(
    () => ({
      running: t("marketplace.syncRunning"),
      runningHint: t("marketplace.syncRunningHint"),
      elapsed: t("marketplace.syncElapsed"),
      syncingProviders: t("marketplace.syncSyncingProviders"),
      complete: t("marketplace.syncComplete"),
      failed: t("marketplace.syncFailed"),
      rowsWritten: t("marketplace.syncRowsWritten"),
      dictReloaded: t("marketplace.syncDictReloaded"),
      dictReloadFailed: t("marketplace.syncDictReloadFailed"),
      statusOk: t("marketplace.syncStatusOk"),
      statusError: t("marketplace.syncStatusError"),
      statusSkipped: t("marketplace.syncStatusSkipped"),
      lastSync: t("marketplace.lastSync"),
      neverSynced: t("marketplace.neverSynced"),
      syncLogTitle: t("marketplace.syncLogTitle"),
      syncStop: t("marketplace.syncStop"),
      syncCancelled: t("marketplace.syncCancelled"),
      syncModeFull: t("marketplace.syncModeFull"),
      syncModeIncremental: t("marketplace.syncModeIncremental"),
      syncLiveStats: t("marketplace.syncLiveStats"),
      syncShowVerbose: t("marketplace.syncShowVerbose"),
      syncHideVerbose: t("marketplace.syncHideVerbose"),
      statsModeFull: t("marketplace.statsModeFull"),
      statsModeIncremental: t("marketplace.statsModeIncremental"),
      statsQueued: t("marketplace.statsQueued"),
      statsApiRequests: t("marketplace.statsApiRequests"),
      statsSkipped: t("marketplace.statsSkipped"),
      statsRowsWritten: t("marketplace.statsRowsWritten"),
      statsNoActivity: t("marketplace.statsNoActivity"),
    }),
    [t]
  );

  const loadCoverage = useCallback(async () => {
    const c = await fetch("/api/v1/marketplace/coverage");
    if (c.ok) setCoveragePct((await c.json()).coverage_percent ?? null);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/marketplace/providers");
    if (res.ok) setProviders(await res.json());
    await loadCoverage();
  }, [loadCoverage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!syncing) return;
    const tick = () => {
      if (syncStartedRef.current != null) {
        setSyncElapsedSec(Math.floor((Date.now() - syncStartedRef.current) / 1000));
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [syncing]);

  const stopSync = useCallback(() => {
    log("info", "Stop enrichment sync requested");
    syncAbortRef.current?.abort();
  }, [log]);

  const runSync = async (fullResync: boolean) => {
    if (fullResync && !window.confirm(t("marketplace.syncResyncConfirm"))) return;
    setSyncSummary(null);
    setSyncError(null);
    setSyncCancelled(false);
    setCleanMsg("");
    setSyncProgressLog([]);
    setSyncElapsedSec(0);
    syncStartedRef.current = Date.now();
    const ac = new AbortController();
    syncAbortRef.current = ac;
    setSyncTarget("all");
    log(
      "info",
      fullResync ? "Full resync marketplace enrichments" : "Incremental sync marketplace enrichments"
    );
    try {
      const data = await streamMarketplaceSync(
        (event: SyncProgressEvent) => {
          setSyncProgressLog((prev) => [...prev, event]);
        },
        ac.signal,
        { fullResync }
      );
      setSyncSummary(data);
      log(
        "info",
        `Sync complete — ${data.synced} provider(s), ${data.rows_written} row(s), ${Math.round(data.elapsed_ms / 1000)}s`
      );
      await load();
    } catch (e) {
      if (e instanceof SyncCancelledError) {
        setSyncCancelled(true);
        log("info", "Enrichment sync cancelled");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setSyncError(msg);
        log("error", "Sync marketplace enrichments failed", msg);
      }
    } finally {
      setSyncTarget(null);
      syncStartedRef.current = null;
      syncAbortRef.current = null;
    }
  };

  const runProviderSync = async (provider: EnrichmentProvider, fullResync: boolean) => {
    if (fullResync) {
      const confirm = t("marketplace.syncProviderResyncConfirm").replace("{{name}}", provider.name);
      if (!window.confirm(confirm)) return;
    }
    setSyncSummary(null);
    setSyncError(null);
    setSyncCancelled(false);
    setCleanMsg("");
    setSyncProgressLog([]);
    setSyncElapsedSec(0);
    syncStartedRef.current = Date.now();
    const ac = new AbortController();
    syncAbortRef.current = ac;
    setSyncTarget(provider.id);
    log(
      "info",
      fullResync
        ? `Full resync enrichments: ${provider.name}`
        : `Incremental sync enrichments: ${provider.name}`
    );
    try {
      const data = await streamProviderSync(
        provider.id,
        (event: SyncProgressEvent) => {
          setSyncProgressLog((prev) => [...prev, event]);
        },
        ac.signal,
        { fullResync }
      );
      setSyncSummary(data);
      log(
        "info",
        `Sync complete — ${provider.name}: ${data.rows_written} row(s), ${Math.round(data.elapsed_ms / 1000)}s`
      );
      await load();
    } catch (e) {
      if (e instanceof SyncCancelledError) {
        setSyncCancelled(true);
        log("info", `Enrichment sync cancelled: ${provider.name}`);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setSyncError(msg);
        log("error", `Sync enrichments failed for ${provider.name}`, msg);
      }
    } finally {
      setSyncTarget(null);
      syncStartedRef.current = null;
      syncAbortRef.current = null;
    }
  };

  const formatCleanMsg = (tableCount: number, providerName?: string) => {
    if (providerName) {
      return t("marketplace.cleanProviderComplete")
        .replace("{{name}}", providerName)
        .replace("{{n}}", String(tableCount));
    }
    return t("marketplace.cleanComplete").replace("{{n}}", String(tableCount));
  };

  const cleanAll = async () => {
    if (!window.confirm(t("marketplace.cleanConfirm"))) return;
    if (syncing) stopSync();
    setCleaningTarget("all");
    setCleanMsg("");
    setSyncSummary(null);
    setSyncError(null);
    setSyncCancelled(false);
    log("info", "Clear all marketplace enrichments");
    try {
      const data = await cleanMarketplaceEnrichments();
      setCleanMsg(formatCleanMsg(data.tables_truncated.length));
      await load();
      log("info", `Cleared enrichment tables (${data.tables_truncated.join(", ")})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSyncError(msg);
      log("error", "Clear enrichments failed", msg);
    } finally {
      setCleaningTarget(null);
    }
  };

  const cleanProvider = async (provider: EnrichmentProvider) => {
    const confirm = t("marketplace.cleanProviderConfirm").replace("{{name}}", provider.name);
    if (!window.confirm(confirm)) return;
    if (syncing) stopSync();
    setCleaningTarget(provider.id);
    setCleanMsg("");
    setSyncSummary(null);
    setSyncError(null);
    setSyncCancelled(false);
    log("info", `Clear enrichments for provider: ${provider.name}`);
    try {
      const data = await cleanProviderEnrichments(provider.id);
      setCleanMsg(formatCleanMsg(data.tables_truncated.length, provider.name));
      await load();
      log(
        "info",
        `Cleared ${provider.name} enrichment data (${data.tables_truncated.join(", ")})`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSyncError(msg);
      log("error", `Clear enrichments failed for ${provider.name}`, msg);
    } finally {
      setCleaningTarget(null);
    }
  };

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      const name = providers.find((p) => p.id === id)?.name ?? id;
      log("info", `${enabled ? "Disable" : "Enable"} provider: ${name}`);
      await fetch(`/api/v1/marketplace/providers/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      await load();
    },
    [load, log, providers]
  );

  const enabled = providers.filter((p) => p.enabled);
  const covered = new Set(enabled.flatMap((p) => p.covers_fields));
  const syncingProviders =
    syncTarget === "all"
      ? enabled
      : syncTarget
        ? providers.filter((p) => p.id === syncTarget)
        : enabled;

  return (
    <>
      <PageHeader title={t("pages.marketplace")} description={
        t("marketplace.pageSubtitle")
          .replace("{{pct}}", coveragePct != null ? `${coveragePct.toFixed(0)}` : "—")
          .replace("{{fields}}", String(covered.size))
          .replace("{{active}}", String(enabled.length))
          .replace("{{total}}", String(providers.length))
      } />
      <section className="card">
        <div className="marketplace-sync-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={syncing || cleaningTarget != null}
            onClick={() => void runSync(false)}
          >
            {syncing ? t("marketplace.syncButtonRunning") : t("marketplace.syncButton")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={syncing || cleaningTarget != null}
            onClick={() => void runSync(true)}
            title={t("marketplace.syncResyncHint")}
          >
            {t("marketplace.syncResyncButton")}
          </button>
          {syncing && (
            <button type="button" className="btn" onClick={stopSync}>
              {t("marketplace.syncStop")}
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={syncing || cleaningTarget != null}
            onClick={() => void cleanAll()}
          >
            {cleaningTarget === "all" ? t("marketplace.cleaning") : t("marketplace.cleanButton")}
          </button>
        </div>
        {cleanMsg && <p className="marketplace-clean-msg muted">{cleanMsg}</p>}
        <MarketplaceSyncPanel
          syncing={syncing}
          elapsedSec={syncElapsedSec}
          enabledProviders={syncingProviders}
          progressLog={syncProgressLog}
          summary={syncSummary}
          error={syncError}
          cancelled={syncCancelled}
          onStop={stopSync}
          labels={syncLabels}
        />
        <MarketplaceProviderList
          providers={providers}
          syncing={syncing}
          syncTarget={syncTarget}
          cleaningTarget={cleaningTarget}
          onToggle={(id, enabled) => void toggle(id, enabled)}
          onSync={(p, full) => void runProviderSync(p, full)}
          onClean={(p) => void cleanProvider(p)}
          onSaved={() => void load()}
        />
      </section>
      <MarketplaceIpResolver />
    </>
  );
}
