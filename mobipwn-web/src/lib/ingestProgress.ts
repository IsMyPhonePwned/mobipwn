export type IngestProgressPhase =
  | "hash"
  | "upload"
  | "processing"
  | "read"
  | "post"
  | "analysis"
  | "refresh";

export type IngestParserProgress = {
  name: string;
  ok: boolean;
  events: number;
  duration_ms: number;
  error?: string | null;
  status?: "running" | "done" | "failed" | string;
};

export type LogarchiveDecodeProgress = {
  phase: string;
  detail?: string | null;
  max_lines?: number | null;
  events_decoded?: number | null;
  files_materialized?: number | null;
  tracev3_files?: number | null;
  current_file?: string | null;
  elapsed_ms?: number | null;
  uncapped?: boolean | null;
};

export type IngestProgress = {
  percent: number;
  phase: IngestProgressPhase;
  detail?: string;
  stage?: string;
  parsers?: IngestParserProgress[];
  parsersCompleted?: number;
  parsersTotal?: number;
  parsersActive?: string[];
  logarchive?: LogarchiveDecodeProgress | null;
};

export type IngestProgressStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function countJsonlLines(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

/** Mobile archive ingest: hash → upload → parse/index. */
export function mobileIngestSteps(
  phase: IngestProgressPhase | null,
  labels: { hash: string; upload: string; processing: string }
): IngestProgressStep[] {
  const order: IngestProgressPhase[] = ["hash", "upload", "processing"];
  const stepLabels = [labels.hash, labels.upload, labels.processing];
  const idx = phase ? order.indexOf(phase) : -1;
  return stepLabels.map((label, i) => ({
    id: order[i],
    label,
    status: idx < 0 ? "pending" : i < idx ? "done" : i === idx ? "active" : "pending",
  }));
}

/** Endpoint JSONL ingest: read → post → indexed. */
export function endpointIngestSteps(
  phase: IngestProgressPhase | null,
  labels: { read: string; post: string; indexed: string }
): IngestProgressStep[] {
  const phases: IngestProgressPhase[] = ["read", "post", "processing"];
  const stepLabels = [labels.read, labels.post, labels.indexed];
  const idx = phase ? phases.indexOf(phase) : -1;
  return stepLabels.map((label, i) => ({
    id: phases[i],
    label,
    status: idx < 0 ? "pending" : i < idx ? "done" : i === idx ? "active" : "pending",
  }));
}

/** Re-ingest: clear → parse → index. */
export function reingestSteps(
  stage: string | undefined,
  labels: { clear: string; parse: string; index: string; done: string }
): IngestProgressStep[] {
  const order = ["clear", "parse", "index", "done"] as const;
  const stepLabels = [labels.clear, labels.parse, labels.index, labels.done];
  let activeIdx = 0;
  if (stage === "waiting" || stage === "starting") activeIdx = 0;
  else if (stage === "opening") activeIdx = 0;
  else if (stage === "parsing" || stage === "logarchive" || stage === "parsed") activeIdx = 1;
  else if (stage === "inserting") activeIdx = 2;
  else if (stage === "done") activeIdx = 3;
  return stepLabels.map((label, i) => ({
    id: order[i],
    label,
    status: stage === "done" ? "done" : i < activeIdx ? "done" : i === activeIdx ? "active" : "pending",
  }));
}
