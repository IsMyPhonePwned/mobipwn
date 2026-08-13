import { Circle, CircleDot, Database, RefreshCw, Trash2 } from "lucide-react";
import { ProviderConfigPanel } from "@/components/marketplace/ProviderConfigPanel";
import { ProviderSyncSchedule } from "@/components/marketplace/ProviderSyncSchedule";
import { describeSyncCron, type EnrichmentProvider } from "@/lib/enrichment";
import { useLocale } from "@/contexts/LocaleContext";

function formatLastSync(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

type Props = {
  provider: EnrichmentProvider;
  syncing: boolean;
  syncTarget: "all" | string | null;
  cleaningTarget: "all" | string | null;
  onToggle: (id: string, enabled: boolean) => void;
  onSync: (provider: EnrichmentProvider, fullResync: boolean) => void;
  onClean: (provider: EnrichmentProvider) => void;
  onSaved: () => void;
};

export function MarketplaceProviderCard({
  provider,
  syncing,
  syncTarget,
  cleaningTarget,
  onToggle,
  onSync,
  onClean,
  onSaved,
}: Props) {
  const { t } = useLocale();
  const p = provider;
  const isActive = p.enabled;
  const isSyncing = syncTarget === p.id;
  const isCleaning = cleaningTarget === p.id;
  const actionsBusy = syncing || cleaningTarget != null;

  const enrichedCount = p.enriched_field_count ?? 0;
  const totalFields = p.covers_fields.length;
  const hasData = enrichedCount > 0;
  const lastSyncWhen = formatLastSync(p.last_sync_at);
  const syncStatus = p.last_sync_status;
  const schedule = describeSyncCron(p.config);

  const syncStatusLabel =
    !isActive
      ? t("marketplace.statusInactive")
      : syncStatus === "error"
        ? t("marketplace.statusSyncError")
        : lastSyncWhen
          ? t("marketplace.statusSyncOk")
          : t("marketplace.statusNeverSynced");

  const syncStatusClass =
    !isActive
      ? "marketplace-provider-sync--inactive"
      : syncStatus === "error"
        ? "marketplace-provider-sync--error"
        : lastSyncWhen
          ? "marketplace-provider-sync--ok"
          : "marketplace-provider-sync--pending";

  const dataLabel = hasData
    ? t("marketplace.providerEnrichedFields")
        .replace("{{n}}", String(enrichedCount))
        .replace("{{total}}", String(totalFields))
        .replace("{{fields}}", (p.enriched_fields ?? []).join(", ") || p.covers_fields.join(", "))
    : t("marketplace.providerEnrichedNone").replace("{{total}}", String(totalFields));

  return (
    <li
      className={`marketplace-provider-card${isActive ? " marketplace-provider-card--active" : " marketplace-provider-card--inactive"}`}
    >
      <header className="marketplace-provider-card__header">
        <div className="marketplace-provider-card__title">
          <span
            className={`marketplace-provider-status${isActive ? " marketplace-provider-status--active" : " marketplace-provider-status--inactive"}`}
          >
            {isActive ? <CircleDot size={12} aria-hidden /> : <Circle size={12} aria-hidden />}
            {isActive ? t("marketplace.statusActive") : t("marketplace.statusDisabled")}
          </span>
          <div>
            <strong className="marketplace-provider-card__name">{p.name}</strong>
            <span className="marketplace-provider-card__kind muted">{humanizeKind(p.kind)}</span>
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-sm ${isActive ? "btn-secondary" : "btn-primary"}`}
          onClick={() => onToggle(p.id, p.enabled)}
        >
          {isActive ? t("common.disable") : t("marketplace.enableProvider")}
        </button>
      </header>

      {!isActive && (
        <p className="marketplace-provider-card__inactive-hint muted">{t("marketplace.inactiveHint")}</p>
      )}

      <div className="marketplace-provider-card__meta">
        <div className="marketplace-provider-meta-item">
          <span className="marketplace-provider-meta-label">{t("marketplace.metaSchedule")}</span>
          <span className={`marketplace-provider-meta-value${!isActive ? " muted" : ""}`}>
            {isActive ? schedule : "—"}
          </span>
        </div>
        <div className="marketplace-provider-meta-item">
          <span className="marketplace-provider-meta-label">{t("marketplace.metaLastSync")}</span>
          <span className={`marketplace-provider-meta-value marketplace-provider-sync ${syncStatusClass}`}>
            {syncStatusLabel}
            {isActive && lastSyncWhen && (
              <span className="marketplace-provider-sync-when muted"> · {lastSyncWhen}</span>
            )}
          </span>
          {isActive && syncStatus === "error" && p.last_sync_error && (
            <span className="marketplace-provider-sync-error">{p.last_sync_error}</span>
          )}
        </div>
        <div className="marketplace-provider-meta-item">
          <span className="marketplace-provider-meta-label">{t("marketplace.metaData")}</span>
          <span
            className={`marketplace-provider-meta-value${hasData ? " marketplace-provider-data--loaded" : " muted"}`}
          >
            <Database size={12} aria-hidden />
            {dataLabel}
          </span>
        </div>
      </div>

      <div className="marketplace-provider-card__covers">
        <span className="marketplace-provider-meta-label">{t("marketplace.metaCovers")}</span>
        <div className="marketplace-provider-field-chips">
          {p.covers_fields.map((field) => {
            const enriched = (p.enriched_fields ?? []).includes(field);
            return (
              <span
                key={field}
                className={`marketplace-provider-field-chip${enriched && isActive ? " marketplace-provider-field-chip--enriched" : ""}`}
                title={enriched && isActive ? t("marketplace.fieldEnriched") : undefined}
              >
                {field}
              </span>
            );
          })}
        </div>
      </div>

      {p.slug === "virustotal" && (
        <p className="provider-desc muted">
          Queries VirusTotal for public IPs, domains, and file hashes seen in recent events. Private/local
          IPs and Android interface suffixes (e.g. <code className="mono">192.168.1.1%wlan0</code>) are
          skipped automatically. Requires API key; results appear as <code className="mono">vt_*</code>{" "}
          columns in Search when Enrichments is enabled. Set delay to <strong>0</strong> for paid API tiers,
          or <strong>15000</strong> ms for free tier (~4 req/min).
        </p>
      )}

      <ProviderConfigPanel provider={p} onSaved={onSaved} />
      <ProviderSyncSchedule provider={p} onSaved={onSaved} />

      {isActive && (
        <div className="marketplace-provider-card__actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={actionsBusy}
            title={t("marketplace.syncProviderResyncHint")}
            onClick={(e) => onSync(p, e.shiftKey || e.metaKey || e.ctrlKey || e.altKey)}
          >
            <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} aria-hidden />
            {isSyncing ? t("marketplace.syncProviderButtonRunning") : t("marketplace.syncProviderButton")}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={actionsBusy}
            onClick={() => onClean(p)}
          >
            <Trash2 size={14} aria-hidden />
            {isCleaning ? t("marketplace.cleaning") : t("marketplace.cleanProviderButton")}
          </button>
        </div>
      )}
    </li>
  );
}
