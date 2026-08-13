import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { apiFetch, apiPost } from "@/lib/api";
import EventInspector from "@/components/EventInspector";
import { BlobStorageSection } from "@/components/data/BlobStorageSection";
import { SectionHeader } from "@/components/SectionHeader";
import { ResultsTable } from "@/components/search/ResultsTable";
import { defaultSearchVisibleColumns } from "@/lib/searchColumns";

type SourceParserStat = {
  name: string;
  event_count: number;
};

type SourceIngestOptions = {
  build_features?: string[];
  logarchive_decode?: string | null;
  logarchive_decode_max_lines?: number | null;
  ioservice_full_tree?: boolean | null;
  logarchive_uncapped?: boolean | null;
  max_entry_mb?: number | null;
  magpie?: boolean | null;
};

type SourceSummary = {
  source: string;
  platform: string;
  source_type: string;
  event_count: number;
  first_seen: string | null;
  last_seen: string | null;
  first_ingest?: string | null;
  last_ingest: string | null;
  case_user?: string | null;
  parsers?: SourceParserStat[];
  ingest_options?: SourceIngestOptions | null;
};

type DataSummary = {
  total_events: number;
  sources: SourceSummary[];
  build_features?: string[];
};

type IngestJob = {
  id: string;
  source: string;
  platform: string;
  status: string;
  events_count: number;
  case_user?: string | null;
  created_at: string;
  finished_at: string | null;
};

type SearchRow = Record<string, unknown>;

function escapeMplString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatTs(s: string | null | undefined): string {
  if (!s) return "—";
  return s.slice(0, 19).replace("T", " ");
}

function formatIngestOptionLabels(opts: SourceIngestOptions): string[] {
  const labels: string[] = [];
  for (const f of opts.build_features ?? []) {
    labels.push(f);
  }
  if (opts.logarchive_decode) {
    labels.push(`logarchive-decode: ${opts.logarchive_decode}`);
  }
  if (opts.logarchive_decode_max_lines != null) {
    labels.push(
      opts.logarchive_decode_max_lines === 0
        ? "logarchive max lines: unlimited"
        : `logarchive max lines: ${opts.logarchive_decode_max_lines.toLocaleString()}`,
    );
  }
  if (opts.logarchive_uncapped) {
    labels.push("logarchive uncapped");
  }
  if (opts.max_entry_mb != null) {
    labels.push(
      opts.max_entry_mb === 0
        ? "max entry: unlimited"
        : `max entry: ${opts.max_entry_mb} MiB`,
    );
  }
  if (opts.ioservice_full_tree) {
    labels.push("ioservice full tree");
  }
  if (opts.magpie) {
    labels.push("magpie");
  }
  return labels;
}

function MetaChips({ items, empty = "—" }: { items: string[]; empty?: string }) {
  if (!items.length) {
    return <span className="muted">{empty}</span>;
  }
  return (
    <div className="data-page-meta-chips" onClick={(e) => e.stopPropagation()}>
      {items.map((item) => (
        <span key={item} className="data-page-meta-chip mono" title={item}>
          {item}
        </span>
      ))}
    </div>
  );
}

function previewQuery(source: string): string {
  const src = escapeMplString(source);
  const fields = [
    "id",
    "timestamp",
    "parser",
    "data_type",
    "severity",
    "action",
    "bundle_id",
    "message",
    "ext",
  ].join(", ");
  return `source="${src}" | fields ${fields} | sort -timestamp | head 40`;
}

function previewColumns(rows: SearchRow[]): string[] {
  if (!rows.length) return [];
  const keys = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) keys.add(k);
  }
  return defaultSearchVisibleColumns([...keys], null);
}

export default function DataPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceSummary | null>(null);
  const [previewRows, setPreviewRows] = useState<SearchRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [inspectorRow, setInspectorRow] = useState<SearchRow | null>(null);
  const [deletingSource, setDeletingSource] = useState<string | null>(null);
  const { log } = useActivityLog();

  const previewCols = useMemo(() => previewColumns(previewRows), [previewRows]);

  const inspectorIndex = useMemo(() => {
    if (!inspectorRow) return null;
    const idx = previewRows.indexOf(inspectorRow);
    return idx >= 0 ? idx : null;
  }, [inspectorRow, previewRows]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    log("info", "Refresh data summary");
    try {
      const [data, jobList] = await Promise.all([
        apiFetch<DataSummary>("/v1/data/summary"),
        apiFetch<IngestJob[]>("/v1/ingest/jobs").catch(() => [] as IngestJob[]),
      ]);
      setSummary(data);
      setJobs(jobList);
    } catch (e) {
      setError(String(e));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [log]);

  useEffect(() => {
    load();
  }, [load]);

  const loadPreview = useCallback(async (src: SourceSummary) => {
    log("info", `Preview source: ${src.source}`);
    setSelectedSource(src);
    setPreviewLoading(true);
    setPreviewError("");
    setInspectorRow(null);
    const q = previewQuery(src.source);
    try {
      const data = await apiPost<{
        rows?: SearchRow[];
      }>("/v1/search/run", { query: q, limit: 40 });
      const rows = data.rows || [];
      setPreviewRows(rows);
      setInspectorRow(rows[0] ?? null);
    } catch (e) {
      setPreviewError(String(e));
      setPreviewRows([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [log]);

  const openInSearch = (source: string) => {
    log("info", `Open source in search: ${source}`);
    navigate(`/search?source=${encodeURIComponent(source)}`);
  };

  const deleteSource = async (src: SourceSummary) => {
    const label = src.source;
    const ok = window.confirm(
      `Delete all ingested data for source "${label}"?\n\n` +
        `• ${src.event_count.toLocaleString()} events in ClickHouse\n` +
        `• Investigation case(s) for this source (Case search)\n` +
        `• Ingest job metadata in Postgres\n\n` +
        "This cannot be undone."
    );
    if (!ok) {
      log("info", `Delete cancelled: ${label}`);
      return;
    }

    setDeletingSource(label);
    try {
      const result = await apiPost<{
        events_deleted: number;
        cases_removed: number;
        ingest_jobs_removed: number;
        collect_blobs_removed?: number;
        alerts_removed?: number;
      }>("/v1/data/sources/delete", { source: label });
      log(
        "info",
        `Deleted ingest "${label}"`,
        `${result.events_deleted} events, ${result.cases_removed} case(s), ${result.ingest_jobs_removed} job(s)` +
          (result.alerts_removed != null ? `, ${result.alerts_removed} alert(s)` : "") +
          (result.collect_blobs_removed != null ? `, ${result.collect_blobs_removed} blob(s)` : "")
      );
      if (selectedSource?.source === label) {
        setSelectedSource(null);
        setPreviewRows([]);
        setInspectorRow(null);
      }
      await load();
    } catch (e) {
      log("error", `Delete failed: ${label}`, String(e));
      setError(String(e));
    } finally {
      setDeletingSource(null);
    }
  };

  return (
    <div className="data-page">
      <PageHeader
        title="Data"
        description="Ingested events in ClickHouse — browse by source label (case id) and device owner."
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {error && <p className="error mb-3">{error}</p>}

      {jobs.some(
        (j) =>
          j.status === "done" &&
          j.events_count > 0 &&
          !summary?.sources.some((s) => s.source === j.source && s.event_count > 0)
      ) && (
        <p className="error mb-3 text-sm">
          Ingest job(s) report completed events, but ClickHouse has no rows for that source.
          Re-upload the bugreport on{" "}
          <Link to="/ingest">Ingest</Link>, or run{" "}
          <code className="mono">./scripts/ch-migrate.sh</code> then restart{" "}
          <code className="mono">./dev.sh</code>. Avoid <code className="mono">./dev.sh --clean</code>{" "}
          unless you intend to wipe all data.
        </p>
      )}

      {summary && (
        <section className="card mb-3">
          <div className="stat-grid ops-stat-grid">
            <div className="stat-card">
              <div className="stat-value">{summary.total_events.toLocaleString()}</div>
              <div className="muted">Total events</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{summary.sources.length.toLocaleString()}</div>
              <div className="muted">Sources</div>
            </div>
            {summary.build_features && summary.build_features.length > 0 && (
              <div className="stat-card data-page-build-features">
                <div className="data-page-meta-chips">
                  {summary.build_features.map((f) => (
                    <span key={f} className="data-page-meta-chip mono">
                      {f}
                    </span>
                  ))}
                </div>
                <div className="muted">Server build features</div>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="card data-page-sources mb-3">
        <SectionHeader
          label="Sources"
          meta={summary ? `${summary.sources.length} in ClickHouse` : undefined}
        />
        {!summary?.sources.length && !loading && (
          <p className="muted text-sm">
            No events yet.{" "}
            <Link to="/ingest">Ingest a bugreport</Link> or use{" "}
            <code className="mono">mobipwn-ingest</code> from the CLI.
          </p>
        )}
        {summary && summary.sources.length > 0 && (
          <div className="results-table-wrap data-page-sources-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>User</th>
                  <th>Platform</th>
                  <th>Parsers</th>
                  <th>Options</th>
                  <th>Events</th>
                  <th>Last event</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summary.sources.map((s) => (
                  <tr
                    key={`${s.source}-${s.platform}-${s.source_type}`}
                    className={
                      selectedSource?.source === s.source &&
                      selectedSource?.platform === s.platform
                        ? "selected"
                        : ""
                    }
                    onClick={() => loadPreview(s)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="mono">{s.source}</td>
                    <td className="muted">{s.case_user || "—"}</td>
                    <td>{s.platform || s.source_type || "—"}</td>
                    <td className="data-page-parsers-cell">
                      <MetaChips
                        items={(s.parsers ?? []).map(
                          (p) => `${p.name} (${p.event_count.toLocaleString()})`
                        )}
                      />
                    </td>
                    <td className="data-page-options-cell">
                      <MetaChips
                        items={
                          s.ingest_options ? formatIngestOptionLabels(s.ingest_options) : []
                        }
                      />
                    </td>
                    <td>{s.event_count.toLocaleString()}</td>
                    <td className="muted">{formatTs(s.last_seen)}</td>
                    <td className="data-actions-cell">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="Open in Search"
                        onClick={(e) => {
                          e.stopPropagation();
                          openInSearch(s.source);
                        }}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="delete-ingest-btn"
                        title="Delete all events for this source"
                        disabled={deletingSource === s.source}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSource(s);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card data-page-preview mb-3">
        <SectionHeader
          label="Preview"
          meta={
            selectedSource
              ? `${previewRows.length} sample · ${selectedSource.event_count.toLocaleString()} total`
              : "Select a source"
          }
        />
        {selectedSource && (
          <div className="data-page-preview-toolbar">
            <div className="data-page-preview-actions">
              <Button size="sm" onClick={() => openInSearch(selectedSource.source)}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Search
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="delete-ingest-btn"
                disabled={deletingSource === selectedSource.source}
                onClick={() => deleteSource(selectedSource)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deletingSource === selectedSource.source ? "Deleting…" : "Delete ingest"}
              </Button>
            </div>
            <p className="data-page-preview-meta muted text-xs">
              <span className="mono">{selectedSource.source}</span>
              {selectedSource.case_user ? ` · ${selectedSource.case_user}` : ""}
              {" · "}
              {formatTs(selectedSource.first_seen)} → {formatTs(selectedSource.last_seen)}
            </p>
          </div>
        )}

        {!selectedSource && (
          <p className="muted text-sm data-page-preview-empty">
            Click a source row above to load a sample of recent events.
          </p>
        )}

        {previewLoading && (
          <p className="muted text-sm data-page-preview-loading">
            <Loader2 className="inline h-3.5 w-3.5 animate-spin" aria-hidden />
            Loading sample events…
          </p>
        )}
        {previewError && <p className="error text-sm">{previewError}</p>}

        {selectedSource && !previewLoading && previewRows.length === 0 && !previewError && (
          <p className="muted text-sm">No events returned for this source.</p>
        )}

        {previewRows.length > 0 && previewCols.length > 0 && (
          <div
            className={`results-split data-page-preview-split${
              inspectorRow ? " results-split--inspector" : ""
            }`}
          >
            <div className="results-table-wrap search-results-panel data-page-preview-table">
              <ResultsTable
                columns={previewCols}
                rows={previewRows}
                selectedIndex={inspectorIndex}
                onSelectRow={(row) => setInspectorRow(row)}
              />
            </div>
            {inspectorRow && (
              <aside className="inspector-panel search-inspector-panel data-page-preview-inspector">
                <SectionHeader label="Event" />
                <EventInspector row={inspectorRow} />
              </aside>
            )}
          </div>
        )}
      </section>

      <BlobStorageSection />

      {jobs.length > 0 && (
        <section className="card">
          <SectionHeader label="Ingest jobs" meta="Postgres metadata" />
          <div className="results-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>User</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Events</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {jobs.slice(0, 20).map((j) => (
                  <tr key={j.id}>
                    <td className="mono">{j.source}</td>
                    <td className="muted">{j.case_user || "—"}</td>
                    <td>{j.platform}</td>
                    <td>{j.status}</td>
                    <td>{j.events_count}</td>
                    <td className="muted">{formatTs(j.finished_at ?? j.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
