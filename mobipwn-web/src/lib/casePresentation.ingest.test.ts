import { describe, expect, it } from "vitest";
import {
  caseFirstIngestAt,
  caseHasDistinctLastIngest,
  caseLastActivityAt,
  sortCases,
} from "@/lib/casePresentation";
import type { CaseRecord } from "@/lib/cases";

function stubCase(partial: Partial<CaseRecord>): CaseRecord {
  return {
    id: partial.id ?? "00000000-0000-0000-0000-000000000001",
    title: partial.title ?? "case",
    description: "",
    status: "open",
    priority: "normal",
    user: "",
    tags: ["android", "ingested"],
    ingest_source: partial.ingest_source ?? "case-1",
    event_count: partial.event_count ?? 1,
    first_ingest_at: partial.first_ingest_at ?? null,
    last_ingest_at: partial.last_ingest_at ?? null,
    ingest_run_count: partial.ingest_run_count ?? 1,
    device_model: null,
    os_version: null,
    alert_count: partial.alert_count ?? 0,
    created_at: partial.created_at ?? "2026-07-01T10:00:00Z",
    updated_at: partial.updated_at ?? "2026-07-01T10:00:00Z",
  };
}

describe("case ingest timeline helpers", () => {
  it("prefers first_ingest_at over created_at", () => {
    expect(
      caseFirstIngestAt({
        created_at: "2026-07-01T10:00:00Z",
        first_ingest_at: "2026-07-08T12:00:00Z",
      })
    ).toBe("2026-07-08T12:00:00Z");
  });

  it("shows last ingest only when distinct or re-ingested", () => {
    expect(
      caseHasDistinctLastIngest({
        created_at: "2026-07-08T12:00:00Z",
        first_ingest_at: "2026-07-08T12:00:00Z",
        last_ingest_at: "2026-07-08T12:00:30Z",
        ingest_run_count: 1,
      })
    ).toBe(false);

    expect(
      caseHasDistinctLastIngest({
        created_at: "2026-07-08T12:00:00Z",
        first_ingest_at: "2026-07-08T12:00:00Z",
        last_ingest_at: "2026-07-09T15:00:00Z",
        ingest_run_count: 1,
      })
    ).toBe(true);

    expect(
      caseHasDistinctLastIngest({
        created_at: "2026-07-08T12:00:00Z",
        first_ingest_at: "2026-07-08T12:00:00Z",
        last_ingest_at: "2026-07-08T12:00:10Z",
        ingest_run_count: 2,
      })
    ).toBe(true);

    expect(
      caseHasDistinctLastIngest({
        created_at: "2026-07-08T12:00:00Z",
        first_ingest_at: null,
        last_ingest_at: null,
        ingest_run_count: 1,
      })
    ).toBe(false);
  });
});

describe("sortCases by last ingest", () => {
  it("orders by last_ingest_at, not stale updated_at", () => {
    const olderUpdatedButFreshIngest = stubCase({
      id: "a",
      title: "fresh-reingest",
      updated_at: "2026-07-01T10:00:00Z",
      last_ingest_at: "2026-08-03T10:15:05Z",
      first_ingest_at: "2026-07-01T10:00:00Z",
    });
    const newerUpdatedButOldIngest = stubCase({
      id: "b",
      title: "stale-ingest",
      updated_at: "2026-08-02T18:00:00Z",
      last_ingest_at: "2026-08-02T13:35:00Z",
      first_ingest_at: "2026-08-02T13:35:00Z",
    });
    expect(caseLastActivityAt(olderUpdatedButFreshIngest)).toBe("2026-08-03T10:15:05Z");
    const sorted = sortCases(
      [newerUpdatedButOldIngest, olderUpdatedButFreshIngest],
      "updated"
    );
    expect(sorted.map((c) => c.title)).toEqual(["fresh-reingest", "stale-ingest"]);
  });
});
