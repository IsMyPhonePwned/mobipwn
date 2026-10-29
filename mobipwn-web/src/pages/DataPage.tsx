import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Archive, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { apiFetch, apiPost } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import EventInspector from "@/components/EventInspector";
import { BlobStorageSection } from "@/components/data/BlobStorageSection";
import { SectionHeader } from "@/components/SectionHeader";
import { ResultsTable } from "@/components/search/ResultsTable";
import { defaultSearchVisibleColumns } from "@/lib/searchColumns";
import { formatBytes } from "@/lib/ingestProgress";

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
  blob_count?: number;
  blob_bytes?: number;
  estimated_events_bytes?: number | null;
  cold_archived?: boolean;
};

type PlatformBreakdown = {
  platform: string;
  source_count: number;
  event_count: number;
  blob_bytes: number;
};

type DataStorageSummary = {
  clickhouse_status: string;
  clickhouse_bytes: number;
  clickhouse_rows: number;
  events_bytes: number;
  events_rows: number;
  detection_signals_bytes: number;
  detection_signals_rows: number;
  postgres_status: string;
  postgres_bytes: number;
  blob_count: number;
  blob_bytes: number;
  blob_analyzed_count: number;
  blob_cold_count: number;
};

type DataSummary = {
  total_events: number;
  sources: SourceSummary[];
  build_features?: string[];
  storage?: DataStorageSummary | null;
  platforms?: PlatformBreakdown[];
  hot_source_count?: number;
  cold_source_count?: number;
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

function formatSpan(first: string | null | undefined, last: string | null | undefined): string {
  if (!first && !last) return "—";
  if (!first) return formatTs(last);
  if (!last) return formatTs(first);
  const a = formatTs(first);
  const b = formatTs(last);
  if (a === b) return a;
  return `${a} → ${b}`;
}

function formatAvgBytesPerEvent(events: number, bytes: number | null | undefined): string {
  if (!events || bytes == null || bytes <= 0) return "—";
  return formatBytes(bytes / events);
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
  const { user } = useAuth();
  const canDataAdmin = hasPermission(user, "data_admin");
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
  const [archivingSource, setArchivingSource] = useState<string | null>(null);
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

  const archiveSource = async (src: SourceSummary) => {
    const label = src.source;
    const ok = window.confirm(
      `Archive ingest "${label}"?\n\n` +
        `• Clears ${src.event_count.toLocaleString()} ClickHouse events (and related alerts)\n` +
        `• Keeps the stored archive blob(s) and investigation case\n` +
        `• You can re-ingest later from Blob storage or the case page\n`
    );
    if (!ok) {
      log("info", `Archive cancelled: ${label}`);
      return;
    }

    setArchivingSource(label);
    try {
      const result = await apiPost<{
        events_deleted: number;
        blobs_retained: number;
        cases_tagged: number;
        alerts_removed?: number;
      }>("/v1/data/sources/archive", { source: label });
      log(
        "info",
        `Archived ingest "${label}"`,
        `${result.events_deleted} events cleared, ${result.blobs_retained} blob(s) kept` +
          (result.cases_tagged ? `, ${result.cases_tagged} case(s) tagged` : "") +
          (result.alerts_removed != null ? `, ${result.alerts_removed} alert(s) removed` : "")
      );
      if (selectedSource?.source === label) {
        setSelectedSource(null);
        setPreviewRows([]);
        setInspectorRow(null);
      }
      await load();
    } catch (e) {
      log("error", `Archive failed: ${label}`, String(e));
      setError(String(e));
    } finally {
      setArchivingSource(null);
    }
  };

  return (
    <div className="data-page">
      <PageHeader
        title="Data"
        description="ClickHouse events, estimated storage, and retained archive blobs — by source and platform."
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
          <div className="stat-grid ops-stat-grid data-page-stat-grid">
            <div className="stat-card">
              <div className="stat-value">{summary.total_events.toLocaleString()}</div>
              <div className="muted">Events in ClickHouse</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {(summary.hot_source_count ?? summary.sources.filter((s) => s.event_count > 0).length).toLocaleString()}
                {(summary.cold_source_count ?? 0) > 0 && (
                  <span className="data-page-stat-sub muted">
                    {" "}/ {(summary.cold_source_count ?? 0).toLocaleString()} cold
                  </span>
                )}
              </div>
              <div className="muted">Hot sources</div>
            </div>
            {summary.storage && (
              <>
                <div className="stat-card">
                  <div className="stat-value">{formatBytes(summary.storage.clickhouse_bytes)}</div>
                  <div className="muted">
                    ClickHouse DB
                    <span className="data-page-stat-hint">
                      {" "}
                      · {summary.storage.clickhouse_rows.toLocaleString()} rows
                    </span>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatBytes(summary.storage.events_bytes)}</div>
                  <div className="muted">
                    Events table
                    <span className="data-page-stat-hint">
                      {" "}
                      · avg{" "}
                      {formatAvgBytesPerEvent(
                        summary.storage.events_rows || summary.total_events,
                        summary.storage.events_bytes,
                      )}
                      /evt
                    </span>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatBytes(summary.storage.detection_signals_bytes)}</div>
                  <div className="muted">
                    Detection signals
                    <span className="data-page-stat-hint">
                      {" "}
                      · {summary.storage.detection_signals_rows.toLocaleString()} rows
                    </span>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatBytes(summary.storage.blob_bytes)}</div>
                  <div className="muted">
                    Archive blobs
                    <span className="data-page-stat-hint">
                      {" "}
                      · {summary.storage.blob_count.toLocaleString()} files
                      {summary.storage.blob_cold_count > 0
                        ? ` · ${summary.storage.blob_cold_count} cold`
                        : ""}
                    </span>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatBytes(summary.storage.postgres_bytes)}</div>
                  <div className="muted">Postgres DB</div>
                </div>
              </>
            )}
            {summary.platforms && summary.platforms.length > 0 && (
              <div className="stat-card data-page-platform-card">
                <div className="data-page-meta-chips">
                  {summary.platforms.map((p) => (
                    <span
                      key={p.platform}
                      className="data-page-meta-chip mono"
                      title={`${p.event_count.toLocaleString()} events · ${formatBytes(p.blob_bytes)} blobs · ${p.source_count} sources`}
                    >
                      {p.platform}: {p.event_count.toLocaleString()} evt · {formatBytes(p.blob_bytes)}
                    </span>
                  ))}
                </div>
                <div className="muted">By platform</div>
              </div>
            )}
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
          meta={
            summary
              ? `${summary.sources.length} total · ${(
                  summary.hot_source_count ??
                  summary.sources.filter((s) => s.event_count > 0).length
                ).toLocaleString()} hot · ${(
                  summary.cold_source_count ??
                  summary.sources.filter((s) => s.cold_archived).length
                ).toLocaleString()} cold`
              : undefined
          }
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
                  <th>Status</th>
                  <th>Events</th>
                  <th>Est. CH size</th>
                  <th>Blob size</th>
                  <th>Parsers</th>
                  <th>Event span</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summary.sources.map((s) => (
                  <tr
                    key={`${s.source}-${s.platform}-${s.source_type}-${s.cold_archived ? "cold" : "hot"}`}
                    className={
                      (selectedSource?.source === s.source &&
                      selectedSource?.platform === s.platform
                        ? "selected "
                        : "") + (s.cold_archived ? "data-page-row--cold" : "")
                    }
                    onClick={() => {
                      if (s.cold_archived || s.event_count === 0) {
                        setSelectedSource(s);
                        setPreviewRows([]);
                        setInspectorRow(null);
                        setPreviewError("");
                        return;
                      }
                      loadPreview(s);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="mono">{s.source}</td>
                    <td className="muted">{s.case_user || "—"}</td>
                    <td>{s.platform || s.source_type || "—"}</td>
                    <td>
                      <span
                        className={`settings-status-badge ${
                          s.cold_archived
                            ? "settings-status-badge--ended"
                            : "settings-status-badge--active"
                        }`}
                      >
                        {s.cold_archived ? "Cold" : "Hot"}
                      </span>
                    </td>
                    <td>{s.event_count.toLocaleString()}</td>
                    <td className="mono muted" title="Proportional share of events table on disk">
                      {s.estimated_events_bytes != null
                        ? formatBytes(s.estimated_events_bytes)
                        : "—"}
                    </td>
                    <td className="mono muted" title={`${(s.blob_count ?? 0).toLocaleString()} file(s)`}>
                      {(s.blob_bytes ?? 0) > 0 ? formatBytes(s.blob_bytes ?? 0) : "—"}
                      {(s.blob_count ?? 0) > 1 ? (
                        <span className="data-page-stat-hint"> ×{s.blob_count}</span>
                      ) : null}
                    </td>
                    <td className="data-page-parsers-cell">
                      <MetaChips
                        items={(s.parsers ?? []).map(
                          (p) => `${p.name} (${p.event_count.toLocaleString()})`
                        )}
                        empty={s.cold_archived ? "—" : "—"}
                      />
                    </td>
                    <td className="muted text-xs">{formatSpan(s.first_seen, s.last_seen)}</td>
                    <td className="data-actions-cell">
                      {!s.cold_archived && (
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
                      )}
                      {canDataAdmin && !s.cold_archived && s.event_count > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="Archive ingest (clear ClickHouse, keep blob)"
                          disabled={
                            archivingSource === s.source || deletingSource === s.source
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            archiveSource(s);
                          }}
                        >
                          <Archive className="h-3 w-3" />
                        </Button>
                      )}
                      {canDataAdmin && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="delete-ingest-btn"
                          title="Delete all events for this source"
                          disabled={
                            deletingSource === s.source || archivingSource === s.source
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSource(s);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
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
              ? selectedSource.cold_archived
                ? `Cold archive · ${formatBytes(selectedSource.blob_bytes ?? 0)} blob`
                : `${previewRows.length} sample · ${selectedSource.event_count.toLocaleString()} events · ${
                    selectedSource.estimated_events_bytes != null
                      ? formatBytes(selectedSource.estimated_events_bytes)
                      : "—"
                  } est.`
              : "Select a source"
          }
        />
        {selectedSource && (
          <div className="data-page-preview-toolbar">
            <div className="data-page-preview-actions">
              {!selectedSource.cold_archived && (
                <Button size="sm" onClick={() => openInSearch(selectedSource.source)}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in Search
                </Button>
              )}
              {canDataAdmin && !selectedSource.cold_archived && selectedSource.event_count > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    archivingSource === selectedSource.source ||
                    deletingSource === selectedSource.source
                  }
                  onClick={() => archiveSource(selectedSource)}
                >
                  <Archive className="h-3.5 w-3.5" />
                  {archivingSource === selectedSource.source ? "Archiving…" : "Archive"}
                </Button>
              )}
              {canDataAdmin && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="delete-ingest-btn"
                  disabled={
                    deletingSource === selectedSource.source ||
                    archivingSource === selectedSource.source
                  }
                  onClick={() => deleteSource(selectedSource)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingSource === selectedSource.source ? "Deleting…" : "Delete ingest"}
                </Button>
              )}
            </div>
            <p className="data-page-preview-meta muted text-xs">
              <span className="mono">{selectedSource.source}</span>
              {selectedSource.case_user ? ` · ${selectedSource.case_user}` : ""}
              {selectedSource.cold_archived
                ? ` · cold · ${(selectedSource.blob_count ?? 0).toLocaleString()} blob(s) · ${formatBytes(selectedSource.blob_bytes ?? 0)}`
                : ` · ${formatSpan(selectedSource.first_seen, selectedSource.last_seen)}`}
              {selectedSource.ingest_options
                ? ` · ${formatIngestOptionLabels(selectedSource.ingest_options).join(" · ")}`
                : ""}
            </p>
          </div>
        )}

        {!selectedSource && (
          <p className="muted text-sm data-page-preview-empty">
            Click a source row above to load a sample of recent events.
          </p>
        )}

        {selectedSource?.cold_archived && (
          <p className="muted text-sm data-page-preview-empty">
            Events were archived out of ClickHouse. Re-ingest from Blob storage below to restore
            searchable rows.
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
