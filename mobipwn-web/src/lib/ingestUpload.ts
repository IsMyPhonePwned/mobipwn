import { parseApiResponse } from "@/lib/response";
import {
  formatBytes,
  type IngestParserProgress,
  type IngestProgress,
  type LogarchiveDecodeProgress,
} from "@/lib/ingestProgress";
import {
  logIngestComplete,
  logIngestFailed,
  logIngestHash,
  logIngestInit,
  logIngestParsing,
  logIngestStarted,
  logIngestUploadProgress,
} from "@/lib/ingestActivity";

const CHUNK_SIZE = 4 * 1024 * 1024;

export type IngestUploadOptions = {
  source: string;
  platform: "android" | "ios";
  user?: string;
  tags?: string[];
  file: File;
  /** Per-upload iOS sysdiagnose options (overrides Settings for this job). */
  sysdiagnose?: {
    logarchive_uncapped?: boolean;
    logarchive_decode_max_lines?: number;
    max_entry_mb?: number;
    ioservice_full_tree?: boolean;
  };
  onProgress?: (progress: IngestProgress) => void;
};

type UploadInitResponse = {
  job_id: string;
  deduplicated: boolean;
  ingested?: number;
  status: string;
};

type IngestJobResponse = {
  id: string;
  status: string;
  events_count: number;
  progress_percent: number;
  bytes_received: number;
  file_size: number;
  stage?: string;
  stage_detail?: string;
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
    logarchive?: LogarchiveDecodeProgress | null;
  };
  error?: string | null;
};

function jobProgressUpdate(job: IngestJobResponse): IngestProgress {
  const parsers = job.progress?.parsers;
  if (job.status === "uploading") {
    return {
      percent: 5 + Math.floor((job.progress_percent * 85) / 100),
      phase: "upload",
      detail: `${formatBytes(job.bytes_received)} / ${formatBytes(job.file_size)} uploaded`,
    };
  }
  return {
    percent: Math.max(90, job.progress_percent),
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

type CompleteResponse = {
  ingested: number;
  job_id?: string;
  status?: string;
  deduplicated: boolean;
};

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pollJob(
  jobId: string,
  source: string,
  onProgress?: IngestUploadOptions["onProgress"]
): Promise<number> {
  const deadline = Date.now() + 2 * 60 * 60 * 1000; // up to 2h for uncapped logarchive
  let lastStatus = "";
  while (Date.now() < deadline) {
    const res = await fetch(`/api/v1/ingest/jobs/${jobId}`);
    const job = await parseApiResponse<IngestJobResponse>(res);
    if (job.status !== lastStatus) {
      lastStatus = job.status;
      if (job.status === "running") {
        logIngestParsing(jobId, source);
      }
    }
    if (job.status === "uploading" || job.status === "pending" || job.status === "running") {
      onProgress?.(jobProgressUpdate(job));
    }
    if (job.status === "done") {
      return job.events_count;
    }
    if (job.status === "failed") {
      throw new Error(job.error ?? "ingest job failed");
    }
    const pollMs = job.stage === "logarchive" ? 500 : 800;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("ingest timed out waiting for background job");
}

export async function uploadIngestArchive(opts: IngestUploadOptions): Promise<{
  ingested: number;
  jobId: string;
  deduplicated: boolean;
}> {
  const { source, platform, user, tags, file, sysdiagnose, onProgress } = opts;
  const started = performance.now();
  let fileHash = "";

  logIngestStarted({
    source,
    platform,
    fileName: file.name,
    fileSize: file.size,
    user,
  });

  try {
    onProgress?.({ percent: 0, phase: "hash", detail: `${file.name} · ${formatBytes(file.size)}` });
    fileHash = await sha256Hex(file);
    logIngestHash(fileHash);
    onProgress?.({
      percent: 5,
      phase: "hash",
      detail: `SHA-256 ${fileHash.slice(0, 12)}…`,
    });

    const initRes = await fetch("/api/v1/ingest/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        platform,
        user: user?.trim() || undefined,
        tags: tags?.length ? tags : undefined,
        file_name: file.name,
        file_size: file.size,
        file_hash: fileHash,
        ...(platform === "ios" && sysdiagnose ? { sysdiagnose } : {}),
      }),
    });
    const init = await parseApiResponse<UploadInitResponse>(initRes);

    logIngestInit({
      jobId: init.job_id,
      source,
      platform,
      deduplicated: init.deduplicated,
      ingested: init.ingested,
    });

    if (init.deduplicated) {
      onProgress?.({
        percent: 100,
        phase: "processing",
        detail: `${init.ingested ?? 0} events (duplicate file hash)`,
      });
      logIngestComplete({
        source,
        platform,
        jobId: init.job_id,
        events: init.ingested ?? 0,
        deduplicated: true,
        fileName: file.name,
        fileSize: file.size,
        fileHash,
        durationMs: Math.round(performance.now() - started),
      });
      return {
        ingested: init.ingested ?? 0,
        jobId: init.job_id,
        deduplicated: true,
      };
    }

    let offset = 0;
    let lastLoggedPct = -1;
    while (offset < file.size) {
      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      const body = await chunk.arrayBuffer();
      const res = await fetch(`/api/v1/ingest/upload/${init.job_id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Upload-Offset": String(offset),
        },
        body,
      });
      const job = await parseApiResponse<IngestJobResponse>(res);
      const uploadPct = 5 + Math.floor((job.progress_percent * 90) / 100);
      onProgress?.({
        percent: uploadPct,
        phase: "upload",
        detail: `${formatBytes(job.bytes_received)} / ${formatBytes(job.file_size)} uploaded`,
      });
      const milestone = [25, 50, 75, 100].find(
        (m) => job.progress_percent >= m && lastLoggedPct < m
      );
      if (milestone != null) {
        lastLoggedPct = milestone;
        logIngestUploadProgress({
          jobId: init.job_id,
          percent: job.progress_percent,
          bytesReceived: job.bytes_received,
          fileSize: job.file_size,
        });
      }
      offset += body.byteLength;
    }

    const completeRes = await fetch(`/api/v1/ingest/upload/${init.job_id}/complete`, {
      method: "POST",
    });
    await parseApiResponse<CompleteResponse>(completeRes);

    logIngestParsing(init.job_id, source);
    onProgress?.({
      percent: 92,
      phase: "processing",
      detail: `Parsing ${platform} archive on server…`,
    });
    const ingested = await pollJob(init.job_id, source, onProgress);
    onProgress?.({
      percent: 100,
      phase: "processing",
      detail: `${ingested} events indexed in ClickHouse`,
    });

    logIngestComplete({
      source,
      platform,
      jobId: init.job_id,
      events: ingested,
      deduplicated: false,
      fileName: file.name,
      fileSize: file.size,
      fileHash,
      durationMs: Math.round(performance.now() - started),
    });

    return { ingested, jobId: init.job_id, deduplicated: false };
  } catch (e) {
    const msg = String(e);
    logIngestFailed({ source, platform, message: msg });
    throw e;
  }
}
