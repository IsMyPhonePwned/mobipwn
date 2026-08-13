import { describe, expect, it } from "vitest";
import { formatRelativeCompact, parseApiTimestamp } from "./formatRelative";

describe("parseApiTimestamp", () => {
  it("treats naive ClickHouse UTC strings as UTC", () => {
    const d = parseApiTimestamp("2026-08-03 10:15:05");
    expect(d.toISOString()).toBe("2026-08-03T10:15:05.000Z");
  });

  it("preserves explicit Z timestamps", () => {
    const d = parseApiTimestamp("2026-08-03T10:15:05Z");
    expect(d.toISOString()).toBe("2026-08-03T10:15:05.000Z");
  });
});

describe("formatRelativeCompact", () => {
  it("does not shift naive UTC ingest times by local timezone", () => {
    // Simulate CEST (+2): if naive UTC were parsed as local, this would look ~2h old.
    const now = Date.parse("2026-08-03T10:32:00Z");
    expect(formatRelativeCompact("2026-08-03 10:15:05", now)).toBe("16m ago");
  });
});
