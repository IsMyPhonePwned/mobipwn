import { useMemo, useState } from "react";
import { MarketplaceProviderCard } from "@/components/marketplace/MarketplaceProviderCard";
import type { EnrichmentProvider } from "@/lib/enrichment";
import { useLocale } from "@/contexts/LocaleContext";

type Filter = "all" | "active" | "disabled";

type Props = {
  providers: EnrichmentProvider[];
  syncing: boolean;
  syncTarget: "all" | string | null;
  cleaningTarget: "all" | string | null;
  onToggle: (id: string, enabled: boolean) => void;
  onSync: (provider: EnrichmentProvider, fullResync: boolean) => void;
  onClean: (provider: EnrichmentProvider) => void;
  onSaved: () => void;
};

function sortByName(a: EnrichmentProvider, b: EnrichmentProvider) {
  return a.name.localeCompare(b.name);
}

export function MarketplaceProviderList({
  providers,
  syncing,
  syncTarget,
  cleaningTarget,
  onToggle,
  onSync,
  onClean,
  onSaved,
}: Props) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<Filter>("all");

  const enabled = useMemo(() => providers.filter((p) => p.enabled).sort(sortByName), [providers]);
  const disabled = useMemo(() => providers.filter((p) => !p.enabled).sort(sortByName), [providers]);
  const syncErrors = useMemo(
    () => enabled.filter((p) => p.last_sync_status === "error").length,
    [enabled]
  );

  const visible =
    filter === "active" ? enabled : filter === "disabled" ? disabled : [...enabled, ...disabled];

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: t("marketplace.filterAll"), count: providers.length },
    { id: "active", label: t("marketplace.filterActive"), count: enabled.length },
    { id: "disabled", label: t("marketplace.filterDisabled"), count: disabled.length },
  ];

  return (
    <div className="marketplace-providers">
      <div className="marketplace-status-summary">
        <div className="marketplace-status-stat marketplace-status-stat--active">
          <span className="marketplace-status-count">{enabled.length}</span>
          <span>{t("marketplace.summaryActive")}</span>
        </div>
        <div className="marketplace-status-stat marketplace-status-stat--disabled">
          <span className="marketplace-status-count">{disabled.length}</span>
          <span>{t("marketplace.summaryDisabled")}</span>
        </div>
        {syncErrors > 0 && (
          <div className="marketplace-status-stat marketplace-status-stat--error">
            <span className="marketplace-status-count">{syncErrors}</span>
            <span>{t("marketplace.summarySyncErrors")}</span>
          </div>
        )}
      </div>

      <div className="marketplace-provider-filters" role="tablist" aria-label={t("marketplace.filterLabel")}>
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`marketplace-provider-filter${filter === f.id ? " marketplace-provider-filter--active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="marketplace-provider-filter-count">{f.count}</span>
          </button>
        ))}
      </div>

      {filter === "all" ? (
        <>
          {enabled.length > 0 && (
            <section className="marketplace-provider-section">
              <h3 className="marketplace-provider-section-title">
                <span className="marketplace-provider-section-dot marketplace-provider-section-dot--active" />
                {t("marketplace.sectionActive")}
                <span className="muted">({enabled.length})</span>
              </h3>
              <ul className="provider-list">
                {enabled.map((p) => (
                  <MarketplaceProviderCard
                    key={p.id}
                    provider={p}
                    syncing={syncing}
                    syncTarget={syncTarget}
                    cleaningTarget={cleaningTarget}
                    onToggle={onToggle}
                    onSync={onSync}
                    onClean={onClean}
                    onSaved={onSaved}
                  />
                ))}
              </ul>
            </section>
          )}
          {disabled.length > 0 && (
            <section className="marketplace-provider-section">
              <h3 className="marketplace-provider-section-title">
                <span className="marketplace-provider-section-dot marketplace-provider-section-dot--inactive" />
                {t("marketplace.sectionDisabled")}
                <span className="muted">({disabled.length})</span>
              </h3>
              <ul className="provider-list">
                {disabled.map((p) => (
                  <MarketplaceProviderCard
                    key={p.id}
                    provider={p}
                    syncing={syncing}
                    syncTarget={syncTarget}
                    cleaningTarget={cleaningTarget}
                    onToggle={onToggle}
                    onSync={onSync}
                    onClean={onClean}
                    onSaved={onSaved}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <ul className="provider-list">
          {visible.map((p) => (
            <MarketplaceProviderCard
              key={p.id}
              provider={p}
              syncing={syncing}
              syncTarget={syncTarget}
              cleaningTarget={cleaningTarget}
              onToggle={onToggle}
              onSync={onSync}
              onClean={onClean}
              onSaved={onSaved}
            />
          ))}
        </ul>
      )}

      {visible.length === 0 && (
        <p className="marketplace-providers-empty muted">{t("marketplace.noProvidersInFilter")}</p>
      )}
    </div>
  );
}
