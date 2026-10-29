import { describe, expect, it } from "vitest";

/** Mirror of server-side queue_is_saturated / IngestPoolConfig.normalized clamps used by the admin UI. */
function queueIsSaturated(pending: number, maxQueue: number): boolean {
  return maxQueue > 0 && pending >= maxQueue;
}

function normalizeIngestPoolConfig(raw: {
  workers: number;
  max_queue: number;
  insert_chunk_size: number;
}) {
  return {
    workers: Math.min(16, Math.max(1, Math.round(raw.workers))),
    max_queue: Math.min(10_000, Math.max(0, Math.round(raw.max_queue))),
    insert_chunk_size: Math.min(500_000, Math.max(1_000, Math.round(raw.insert_chunk_size))),
  };
}

describe("ingest pool settings helpers", () => {
  it("treats max_queue 0 as unlimited", () => {
    expect(queueIsSaturated(0, 0)).toBe(false);
    expect(queueIsSaturated(999, 0)).toBe(false);
  });

  it("saturates at and above the cap", () => {
    expect(queueIsSaturated(1, 2)).toBe(false);
    expect(queueIsSaturated(2, 2)).toBe(true);
    expect(queueIsSaturated(5, 2)).toBe(true);
  });

  it("clamps admin form values like the API normalized()", () => {
    expect(
      normalizeIngestPoolConfig({ workers: 0, max_queue: 99_999, insert_chunk_size: 10 })
    ).toEqual({ workers: 1, max_queue: 10_000, insert_chunk_size: 1_000 });

    expect(
      normalizeIngestPoolConfig({ workers: 40, max_queue: 8, insert_chunk_size: 1_000_000 })
    ).toEqual({ workers: 16, max_queue: 8, insert_chunk_size: 500_000 });
  });
});
