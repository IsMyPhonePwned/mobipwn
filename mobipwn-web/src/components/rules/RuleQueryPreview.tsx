import { useMemo, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { ResultsTable } from "@/components/search/ResultsTable";
import { buildSearchHref } from "@/lib/mplQuery";
import { orderSearchResultColumns } from "@/lib/enrichment";
import type { Validation } from "./RuleEditorPanel";

type Tab = "results" | "plan" | "sql";

type Props = {
  preview: Validation | null;
  loading: boolean;
  error?: string;
  query: string;
  previewQuery?: string | null;
  minHits?: number;
  maxAlerts?: number;
  onRefresh: () => void;
  compact?: boolean;
};

function previewColumns(rows: Record<string, unknown>[]): string[] {
  if (!rows.length) return [];
  const keys = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) keys.add(k);
  }
  return orderSearchResultColumns([...keys]);
}

export function RuleQueryPreview({
  preview,
  loading,
  error,
  query,
  previewQuery,
  minHits = 1,
  maxAlerts = 50,
  onRefresh,
  compact = false,
}: Props) {
  const [tab, setTab] = useState<Tab>("results");
  const stale = !!preview && previewQuery != null && previewQuery !== query.trim();

  const columns = useMemo(
    () => (preview ? previewColumns(preview.sample_rows) : []),
    [preview]
  );

  const alertEstimate = preview
    ? Math.min(Math.max(preview.row_count, 0), maxAlerts)
    : null;
  const meetsMinHits = preview ? preview.row_count >= minHits : null;

  if (!preview && !loading && !error) {
    return (
      <div className="rules-preview rules-preview--empty">
        <p className="muted">
          {compact
            ? "Click Preview to load a sample of matching events."
            : "Click Preview to run the query and see matching events."}
        </p>
      </div>
    );
  }

  return (
    <div className={`rules-preview${compact ? " rules-preview--compact" : ""}`}>
      <div className="rules-preview-header">
        <div className="rules-preview-title-row">
          <h3 className="rules-preview-title">{compact ? "Sample matches" : "Query preview"}</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm rules-preview-refresh"
            onClick={onRefresh}
            disabled={loading || !query.trim()}
            title="Refresh preview"
          >
            {loading ? (
              <Loader2 size={14} className="spin" aria-hidden />
            ) : (
              <RefreshCw size={14} aria-hidden />
            )}
            {loading ? "Running…" : "Preview"}
          </button>
        </div>
        {stale && (
          <p className="rules-preview-stale muted">Query changed — refresh preview to see new matches.</p>
        )}
        {error && <p className="error rules-preview-error">{error}</p>}
      </div>

      {preview && (
        <>
          <div className="rules-preview-stats">
            <span className="rules-preview-stat">
              <strong>{preview.row_count.toLocaleString()}</strong> match
              {preview.row_count === 1 ? "" : "es"}
              {preview.elapsed_ms != null && (
                <span className="muted"> · {preview.elapsed_ms} ms</span>
              )}
            </span>
            <span className={`badge rules-preview-cost rules-preview-cost--${preview.cost_tier}`}>
              {preview.cost_tier} cost
            </span>
            {preview.realtime_compatible ? (
              <span className="badge badge-live">realtime OK</span>
            ) : (
              <span className="badge">scheduled only</span>
            )}
            {!compact && meetsMinHits != null && (
              <span
                className={`rules-preview-threshold${meetsMinHits ? " rules-preview-threshold--ok" : " rules-preview-threshold--warn"}`}
              >
                {meetsMinHits
                  ? `Meets min hits (${minHits})`
                  : `Below min hits (${minHits}) — no alerts on run`}
              </span>
            )}
            {!compact && alertEstimate != null && preview.row_count > 0 && (
              <span className="muted rules-preview-alerts">
                Up to {alertEstimate} alert{alertEstimate === 1 ? "" : "s"} per run
              </span>
            )}
          </div>

          {!compact && (
            <div className="rules-preview-tabs" role="tablist">
              {(["results", "plan", "sql"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={`rules-preview-tab${tab === t ? " rules-preview-tab--active" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {t === "results" ? "Results" : t === "plan" ? "Plan" : "SQL"}
                </button>
              ))}
              <a
                href={buildSearchHref(query)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm rules-preview-search-link"
              >
                <ExternalLink size={14} aria-hidden />
                Search
              </a>
            </div>
          )}

          {(compact || tab === "results") && columns.length > 0 && preview.sample_rows.length > 0 && (
            <div className="rules-preview-table-wrap">
              <ResultsTable
                columns={columns}
                rows={preview.sample_rows}
                selectedIndex={null}
                onSelectRow={() => {}}
                maxRows={compact ? 5 : 10}
              />
            </div>
          )}

          {!compact && tab === "plan" && (
            <ul className="rules-preview-plan muted">
              {preview.explain.map((line) => (
                <li key={line}>{line}</li>
              ))}
              <li>
                <strong>Cost:</strong> {preview.cost_tier} — {preview.cost_reason}
              </li>
            </ul>
          )}

          {!compact && tab === "sql" && (
            <pre className="mono rules-preview-sql">{preview.sql}</pre>
          )}

          {preview.sample_rows.length === 0 && (compact || tab === "results") && (
            <p className="muted rules-preview-empty">No matching events in the evaluated window.</p>
          )}
        </>
      )}
    </div>
  );
}
