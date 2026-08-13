import { Link } from "react-router-dom";
import { Database, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { enrichmentColumnLabel, type EnrichmentProvider } from "@/lib/enrichment";

type Props = {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  providers: EnrichmentProvider[];
  lookupFields: string[];
  enrichmentColumns: string[];
  hiddenEnrichmentColumns: Set<string>;
  onToggleEnrichmentColumn: (col: string) => void;
  onShowAllEnrichmentColumns: () => void;
  onHideAllEnrichmentColumns: () => void;
  coveragePct: number | null;
  enriching: boolean;
};

export function EnrichmentToolbar({
  enabled,
  onEnabledChange,
  providers,
  lookupFields,
  enrichmentColumns,
  hiddenEnrichmentColumns,
  onToggleEnrichmentColumn,
  onShowAllEnrichmentColumns,
  onHideAllEnrichmentColumns,
  coveragePct,
  enriching,
}: Props) {
  const { t } = useLocale();
  const active = providers.filter((p) => p.enabled);
  const visibleEnrichmentCount = enrichmentColumns.filter((c) => !hiddenEnrichmentColumns.has(c)).length;

  return (
    <div className="enrichment-toolbar">
      <label className="enrichment-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        <Sparkles size={14} />
        <span>{t("searchResults.enrichments")}</span>
      </label>
      {enabled && lookupFields.length > 0 && (
        <span className="enrichment-fields muted">
          {t("searchResults.enrichFields")}: {lookupFields.join(", ")}
        </span>
      )}
      {enabled && active.length > 0 && (
        <div className="enrichment-provider-chips">
          {active.map((p) => (
            <span key={p.id} className="enrichment-chip" title={p.covers_fields.join(", ")}>
              {p.name}
            </span>
          ))}
        </div>
      )}
      {enabled && active.length === 0 && (
        <span className="enrichment-empty muted">{t("searchResults.enrichNone")}</span>
      )}
      {enabled && enrichmentColumns.length > 0 && (
        <div className="enrichment-column-picker">
          <span className="enrichment-column-picker-label muted">{t("searchResults.enrichColumns")}</span>
          <div className="enrichment-column-toggles">
            {enrichmentColumns.map((col) => (
              <label key={col} className="enrichment-column-toggle">
                <input
                  type="checkbox"
                  checked={!hiddenEnrichmentColumns.has(col)}
                  onChange={() => onToggleEnrichmentColumn(col)}
                />
                <span title={col}>{enrichmentColumnLabel(col)}</span>
              </label>
            ))}
          </div>
          <div className="enrichment-column-actions">
            <button
              type="button"
              className="enrichment-column-action"
              disabled={visibleEnrichmentCount === enrichmentColumns.length}
              onClick={onShowAllEnrichmentColumns}
            >
              {t("searchResults.enrichShowAll")}
            </button>
            <button
              type="button"
              className="enrichment-column-action"
              disabled={visibleEnrichmentCount === 0}
              onClick={onHideAllEnrichmentColumns}
            >
              {t("searchResults.enrichHideAll")}
            </button>
          </div>
        </div>
      )}
      {coveragePct != null && (
        <span className="enrichment-coverage muted">
          {t("searchResults.enrichCoverage").replace("{{pct}}", String(Math.round(coveragePct)))}
        </span>
      )}
      {enriching && <span className="enrichment-loading muted">{t("searchResults.enriching")}</span>}
      <Button variant="ghost" size="sm" className="enrichment-marketplace-link" asChild>
        <Link to="/marketplace">
          <Database size={14} />
          {t("searchResults.marketplace")}
        </Link>
      </Button>
    </div>
  );
}
