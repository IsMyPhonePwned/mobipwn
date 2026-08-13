import type { ReingestResponse } from "@/lib/blobStorage";
import { pollIngestJobWhile } from "@/lib/ingestJobClient";
import type { IngestProgress } from "@/lib/ingestProgress";

export type ReingestProgressLabels = {
  starting: string;
  waiting: string;
  complete: string;
};

/** Run a blocking re-ingest POST while polling ingest_jobs for live progress. */
export async function runReingestWithProgress(
  source: string,
  action: () => Promise<ReingestResponse>,
  onProgress: (progress: IngestProgress) => void,
  labels: ReingestProgressLabels
): Promise<ReingestResponse> {
  const signal = { stop: false };

  onProgress({
    percent: 5,
    phase: "processing",
    stage: "starting",
    detail: labels.starting,
  });

  const poll = pollIngestJobWhile(source, signal, (p) => onProgress(p), {
    initialJobId: null,
  }).catch(() => {
    /* polling is best-effort */
  });

  // If job row is slow to appear, show a waiting hint.
  const waitingTimer = window.setTimeout(() => {
    if (!signal.stop) {
      onProgress({
        percent: 8,
        phase: "processing",
        stage: "waiting",
        detail: labels.waiting,
      });
    }
  }, 1500);

  try {
    const result = await action();
    signal.stop = true;
    await poll;
    onProgress({
      percent: 100,
      phase: "processing",
      stage: "done",
      detail: labels.complete,
    });
    return result;
  } finally {
    window.clearTimeout(waitingTimer);
    signal.stop = true;
  }
}
