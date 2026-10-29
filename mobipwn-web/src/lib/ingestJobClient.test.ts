import { describe, expect, it } from "vitest";
import { ingestJobToProgress, type IngestJobDto } from "@/lib/ingestJobClient";
import { mobileIngestSteps } from "@/lib/ingestProgress";

function job(partial: Partial<IngestJobDto>): IngestJobDto {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    source: "case-test",
    status: "pending",
    events_count: 0,
    progress_percent: 90,
    ...partial,
  };
}

describe("ingestJobToProgress", () => {
  it("maps uploading jobs to upload phase with byte detail", () => {
    const progress = ingestJobToProgress(
      job({
        status: "uploading",
        progress_percent: 50,
        bytes_received: 1024,
        file_size: 2048,
      })
    );
    expect(progress.phase).toBe("upload");
    expect(progress.detail).toContain("KB");
    expect(progress.percent).toBeGreaterThan(5);
  });

  it("maps pending jobs to queued stage for worker-pool wait UI", () => {
    const progress = ingestJobToProgress(
      job({
        status: "pending",
        stage: "queued",
        stage_detail: "Queued for server processing…",
        progress_percent: 90,
      })
    );
    expect(progress.phase).toBe("processing");
    expect(progress.stage).toBe("queued");
    expect(progress.detail).toContain("Queued");
    expect(progress.percent).toBeGreaterThanOrEqual(88);
  });

  it("infers queued stage when pending job omits stage", () => {
    const progress = ingestJobToProgress(job({ status: "pending", stage: undefined }));
    expect(progress.stage).toBe("queued");
    expect(progress.detail).toContain("Waiting for an ingest worker");
  });

  it("infers opening stage for running jobs without stage", () => {
    const progress = ingestJobToProgress(
      job({ status: "running", stage: undefined, progress_percent: 91 })
    );
    expect(progress.stage).toBe("opening");
    expect(progress.phase).toBe("processing");
  });

  it("passes through parsing parsers progress", () => {
    const progress = ingestJobToProgress(
      job({
        status: "running",
        stage: "parsing",
        progress_percent: 93,
        progress: {
          parsers_completed: 2,
          parsers_total: 10,
          parsers_active: ["wifi", "logarchive"],
        },
      })
    );
    expect(progress.stage).toBe("parsing");
    expect(progress.parsersCompleted).toBe(2);
    expect(progress.parsersTotal).toBe(10);
    expect(progress.parsersActive).toEqual(["wifi", "logarchive"]);
  });
});

describe("mobileIngestSteps", () => {
  const labels = {
    hash: "Hash",
    upload: "Upload",
    processing: "Process",
  };

  it("marks hash active then upload/processing pending", () => {
    const steps = mobileIngestSteps("hash", labels);
    expect(steps.map((s) => s.status)).toEqual(["active", "pending", "pending"]);
  });

  it("marks processing active after upload", () => {
    const steps = mobileIngestSteps("processing", labels);
    expect(steps.map((s) => s.status)).toEqual(["done", "done", "active"]);
  });
});
