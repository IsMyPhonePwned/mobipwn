import { apiFetch } from "@/lib/api";

export type JobsControlSummary = {
  enrichment_cancel_requested: boolean;
  enrichment_status_cleared: boolean;
  ingest_jobs_failed: number;
  ironsift_runs_failed: number;
};

export async function cancelRunningJobs(): Promise<JobsControlSummary> {
  return apiFetch<JobsControlSummary>("/v1/jobs/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel" }),
  });
}

export async function clearStuckEnrichmentSync(): Promise<JobsControlSummary> {
  return apiFetch<JobsControlSummary>("/v1/jobs/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "clear_sync_status" }),
  });
}
