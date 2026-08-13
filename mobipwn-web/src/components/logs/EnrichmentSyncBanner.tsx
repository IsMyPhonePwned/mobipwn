import { Loader2, OctagonX } from "lucide-react";
import type { SyncStats } from "@/lib/marketplaceSync";
import { Button } from "@/components/ui/button";

export type EnrichmentSyncStatus = {
  running: boolean;
  source?: string;
  started_at?: string;
  updated_at?: string;
  provider_slug?: string;
  provider_name?: string;
  message?: string;
  stats?: SyncStats | null;
  stale?: boolean;
};

function StatChip({ label, value }: { label: string; value: number | string | undefined }) {
  if (value == null || value === 0 || value === "") return null;
  return (
    <div className="enrichment-banner__stat">
      <span className="enrichment-banner__stat-label">{label}</span>
      <span className="enrichment-banner__stat-value mono">{value}</span>
    </div>
  );
}

type Props = {
  status: EnrichmentSyncStatus;
  onCancel?: () => void;
  onDismiss?: () => void;
  busy?: boolean;
};

export function EnrichmentSyncBanner({ status, onCancel, onDismiss, busy }: Props) {
  if (!status.running) return null;

  const stats = status.stats;
  const started = status.started_at
    ? new Date(status.started_at).toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "medium",
      })
    : null;
  const isJobs = status.source === "jobs";
  const scheduleNote =
    isJobs && !status.stale
      ? "Scheduled sync from mobipwn-jobs — set provider schedule to Manual only on Marketplace to disable."
      : null;

  return (
    <div
      className={`enrichment-banner${status.stale ? " enrichment-banner--stale" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="enrichment-banner__head">
        <Loader2 size={18} className="enrichment-banner__spinner" aria-hidden />
        <div className="enrichment-banner__head-text">
          <strong className="enrichment-banner__title">
            {status.stale ? "Enrichment sync may be stuck" : "Enrichment sync in progress"}
          </strong>
          <p className="enrichment-banner__subtitle muted">
            {status.provider_name ?? status.provider_slug ?? "Providers"}
            {status.source ? ` · via ${status.source}` : ""}
            {started ? ` · started ${started}` : ""}
          </p>
        </div>
        <div className="enrichment-banner__actions">
          {onCancel && (
            <Button variant="secondary" size="sm" className="enrichment-banner__cancel" onClick={onCancel} disabled={busy}>
              <OctagonX size={14} aria-hidden />
              Cancel jobs
            </Button>
          )}
          {onDismiss && (
            <Button variant="secondary" size="sm" onClick={onDismiss} disabled={busy}>
              Dismiss
            </Button>
          )}
        </div>
      </div>
      {status.message && <p className="enrichment-banner__message">{status.message}</p>}
      {scheduleNote && <p className="enrichment-banner__schedule-note muted">{scheduleNote}</p>}
      {status.stale && (
        <p className="enrichment-banner__stale-note muted">
          No progress for over 2 hours — the worker may have crashed. Cancel or dismiss to clear.
        </p>
      )}
      {stats && (
        <div className="enrichment-banner__stats">
          <StatChip label="Mode" value={stats.mode} />
          <StatChip label="Queued" value={stats.queued} />
          <StatChip label="API req" value={stats.api_requests} />
          <StatChip label="OK" value={stats.api_ok} />
          <StatChip label="Miss" value={stats.api_miss} />
          <StatChip label="Errors" value={stats.api_errors} />
          <StatChip label="Skipped" value={stats.skipped_already_enriched} />
          <StatChip label="Written" value={stats.rows_written} />
        </div>
      )}
      <p className="enrichment-banner__tip muted">
        Per-request lines appear in the <strong>API</strong> or <strong>Jobs</strong> log below.
      </p>
    </div>
  );
}
