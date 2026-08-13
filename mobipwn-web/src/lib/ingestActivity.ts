import { pushActivity } from "@/lib/activity-log";

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function hashShort(hex: string): string {
  return hex.length >= 12 ? `${hex.slice(0, 12)}…` : hex;
}

export function logIngestStarted(opts: {
  source: string;
  platform: string;
  fileName: string;
  fileSize: number;
  user?: string;
}): void {
  const owner = opts.user?.trim();
  pushActivity("info", "app", `Ingest started: ${opts.source} (${opts.platform})`, {
    detail: [
      `source: ${opts.source}`,
      `platform: ${opts.platform}`,
      `file: ${opts.fileName}`,
      `size: ${mb(opts.fileSize)}`,
      owner ? `owner: ${owner}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export function logIngestHash(fileHash: string): void {
  pushActivity("info", "app", "Ingest: file hash computed", {
    detail: `sha256: ${fileHash}`,
  });
}

export function logIngestInit(opts: {
  jobId: string;
  source: string;
  platform: string;
  deduplicated: boolean;
  ingested?: number;
}): void {
  if (opts.deduplicated) {
    pushActivity("info", "app", `Ingest deduplicated: ${opts.source} (${opts.ingested ?? 0} events)`, {
      detail: `job: ${opts.jobId}\nplatform: ${opts.platform}\nsame file hash already ingested`,
    });
    return;
  }
  pushActivity("info", "app", `Ingest upload job created: ${opts.source}`, {
    detail: `job: ${opts.jobId}\nplatform: ${opts.platform}`,
  });
}

export function logIngestUploadProgress(opts: {
  jobId: string;
  percent: number;
  bytesReceived: number;
  fileSize: number;
}): void {
  pushActivity("info", "app", `Ingest upload ${opts.percent}%: ${mb(opts.bytesReceived)} / ${mb(opts.fileSize)}`, {
    detail: `job: ${opts.jobId}`,
  });
}

export function logIngestParsing(jobId: string, source: string): void {
  pushActivity("info", "app", `Ingest parsing: ${source}`, {
    detail: `job: ${jobId}\nbackground parse + ClickHouse insert`,
  });
}

export function logIngestComplete(opts: {
  source: string;
  platform: string;
  jobId: string;
  events: number;
  deduplicated: boolean;
  fileName?: string;
  fileSize?: number;
  fileHash?: string;
  durationMs?: number;
}): void {
  const headline = opts.deduplicated
    ? `Ingest skipped (duplicate): ${opts.source}`
    : `Ingest complete: ${opts.events.toLocaleString()} events → ${opts.source}`;
  pushActivity("info", "app", headline, {
    detail: [
      `source: ${opts.source}`,
      `platform: ${opts.platform}`,
      `events: ${opts.events}`,
      `job: ${opts.jobId}`,
      opts.fileName ? `file: ${opts.fileName}` : null,
      opts.fileSize != null ? `size: ${mb(opts.fileSize)}` : null,
      opts.fileHash ? `hash: ${hashShort(opts.fileHash)}` : null,
      opts.durationMs != null ? `duration: ${(opts.durationMs / 1000).toFixed(1)}s` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export function logIngestFailed(opts: {
  source: string;
  platform?: string;
  message: string;
  jobId?: string;
}): void {
  pushActivity("error", "app", `Ingest failed: ${opts.source}`, {
    detail: [
      opts.platform ? `platform: ${opts.platform}` : null,
      opts.jobId ? `job: ${opts.jobId}` : null,
      opts.message,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}
