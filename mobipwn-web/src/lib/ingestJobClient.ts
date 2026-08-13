import { apiFetch } from "@/lib/api";
import type { IngestParserProgress, IngestProgress } from "@/lib/ingestProgress";
import { formatBytes } from "@/lib/ingestProgress";

export type IngestJobDto = {
  id: string;
  source: string;
  platform?: string;
  status: string;
  events_count: number;
  progress_percent: number;
  stage?: string;
  stage_detail?: string;
  error?: string | null;
  progress?: {
    parsers?: IngestParserProgress[];
    timeline_events?: number;
    mudm_events?: number;
    batch?: number;
    batches?: number;
    rows_inserted?: number;
    parsers_total?: number;
    parsers_completed?: number;
    parsers_active?: string[];
    logarchive?: import("@/lib/ingestProgress").LogarchiveDecodeProgress | null;
  };
  bytes_received?: number;
  file_size?: number;
};

export function ingestJobToProgress(job: IngestJobDto): IngestProgress {
  const parsers = job.progress?.parsers;
  if (job.status === "uploading") {
    const received = job.bytes_received ?? 0;
    const size = job.file_size ?? 0;
    return {
      percent: 5 + Math.floor((job.progress_percent * 85) / 100),
      phase: "upload",
      detail:
        size > 0
          ? `${formatBytes(received)} / ${formatBytes(size)} uploaded`
          : job.stage_detail || undefined,
    };
  }
  return {
    percent: Math.max(10, job.progress_percent),
    phase: "processing",
    stage: job.stage,
    detail: job.stage_detail || undefined,
    parsers: parsers?.length ? parsers : undefined,
    parsersCompleted: job.progress?.parsers_completed,
    parsersTotal: job.progress?.parsers_total,
    parsersActive: job.progress?.parsers_active,
    logarchive: job.progress?.logarchive ?? undefined,
  };
}

export async function fetchIngestJob(jobId: string): Promise<IngestJobDto> {
  return apiFetch<IngestJobDto>(`/v1/ingest/jobs/${jobId}`);
}

export async function findActiveIngestJob(source: string): Promise<IngestJobDto | null> {
  const jobs = await apiFetch<IngestJobDto[]>(
    `/v1/ingest/jobs?source=${encodeURIComponent(source)}&limit=10`
  );
  return (
    jobs.find((j) => j.status === "running" || j.status === "pending" || j.status === "uploading") ??
    null
  );
}

const POLL_MS = 800;

/** Poll ingest job progress until `signal.stop` is true. */
export async function pollIngestJobWhile(
  source: string,
  signal: { stop: boolean },
  onProgress: (progress: IngestProgress) => void,
  opts?: { initialJobId?: string | null }
): Promise<void> {
  let jobId = opts?.initialJobId ?? null;

  while (!signal.stop) {
    try {
      if (!jobId) {
        const active = await findActiveIngestJob(source);
        if (active) {
          jobId = active.id;
          onProgress(ingestJobToProgress(active));
        }
      } else {
        const job = await fetchIngestJob(jobId);
        if (job.status === "done" || job.status === "failed") {
          onProgress(ingestJobToProgress(job));
          break;
        }
        onProgress(ingestJobToProgress(job));
      }
    } catch {
      // Keep polling — re-ingest may not have created the job row yet.
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
