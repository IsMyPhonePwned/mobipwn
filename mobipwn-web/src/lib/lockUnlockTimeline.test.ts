import { describe, expect, it } from "vitest";
import {
  buildLockUnlockDensityOverview,
  buildLockUnlockPreciseTimeline,
  clampLockUnlockDomain,
  formatLockUnlockTimestamp,
  lockUnlockTimelineBuckets,
  nearbyLockUnlockEvents,
  presentLockUnlockSeries,
} from "@/lib/lockUnlockTimeline";
import { authEventsToTimelinePoints, parseAuthEvent } from "@/lib/authenticationEvents";

describe("lockUnlockTimeline", () => {
  it("places each event at its exact second (no coarse buckets)", () => {
    const base = Date.parse("2025-04-07T10:00:00Z");
    const timeline = buildLockUnlockPreciseTimeline([
      { t: base, kind: "unlocked" },
      { t: base + 1_000, kind: "locked" },
      { t: base + 1_500, kind: "failed" },
      { t: base + 3_000, kind: "unlocked" },
      { t: base + 3_000, kind: "autolock" },
    ]);

    expect(timeline.events.map((e) => e.t)).toEqual([
      base,
      base + 1_000,
      base + 1_500,
      base + 3_000,
      base + 3_000,
    ]);
    // Same-second events sort by kind name (autolock before unlocked).
    expect(timeline.events.map((e) => e.kind)).toEqual([
      "unlocked",
      "locked",
      "failed",
      "autolock",
      "unlocked",
    ]);
    expect(timeline.events.filter((e) => e.t === base + 3_000).map((e) => e.kind)).toEqual([
      "autolock",
      "unlocked",
    ]);
    expect(timeline.series).toEqual(["unlocked", "locked", "failed", "autolock"]);
    expect(timeline.spanMs).toBe(3_000);
    expect(timeline.stateSteps.length).toBeGreaterThan(0);
    expect(timeline.stateSteps.every((s) => s.kind !== "failed")).toBe(true);
  });

  it("formats tooltips with seconds", () => {
    const ms = Date.parse("2025-04-07T10:00:42Z");
    expect(formatLockUnlockTimestamp(ms)).toMatch(/:42/);
  });

  it("keeps 1s bucket shim for compatibility", () => {
    const base = Date.parse("2025-04-07T10:00:00Z");
    const buckets = lockUnlockTimelineBuckets([
      { t: base, kind: "unlocked" },
      { t: base + 500, kind: "unlocked" },
      { t: base + 60_000, kind: "locked" },
    ]);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.unlocked).toBe(2);
    expect(presentLockUnlockSeries(buckets)).toEqual(["unlocked", "locked"]);
  });

  it("builds a density overview and finds nearby events", () => {
    const base = Date.parse("2025-04-07T10:00:00Z");
    const timeline = buildLockUnlockPreciseTimeline(
      Array.from({ length: 20 }, (_, i) => ({
        t: base + i * 30_000,
        kind: i % 2 === 0 ? ("unlocked" as const) : ("locked" as const),
      }))
    );
    const density = buildLockUnlockDensityOverview(timeline.events, {
      minT: timeline.minT,
      maxT: timeline.maxT,
      buckets: 10,
    });
    expect(density).toHaveLength(10);
    expect(density.reduce((n, b) => n + b.count, 0)).toBe(20);
    const near = nearbyLockUnlockEvents(timeline.events, base + 60_000, 90_000);
    expect(near.length).toBeGreaterThan(1);
    const [from, to] = clampLockUnlockDomain(base, base + 1000, base, base + 600_000);
    expect(to - from).toBeGreaterThanOrEqual(5_000);
  });
});

describe("android auth timestamps", () => {
  it("parses ClickHouse-style timestamp strings", () => {
    const ev = parseAuthEvent({
      parser: "Authentication",
      timestamp: "2025-04-07 08:10:00.000000",
      action: "fingerprint",
      user: "0",
      message: "unlock success",
      ext: JSON.stringify({ success: true, auth_type: "fingerprint" }),
    });
    expect(ev.date).toMatch(/2025/);
    expect(ev.time.length).toBeGreaterThan(0);
    expect(ev.timestampMs).toBeGreaterThan(0);
    expect(ev.timestampRaw).toContain("2025");
  });

  it("maps auth events to timeline points", () => {
    const ok = parseAuthEvent({
      timestamp: "2025-04-07T08:10:00Z",
      action: "unlock",
      ext: JSON.stringify({ success: true }),
    });
    const fail = parseAuthEvent({
      timestamp: "2025-04-07T08:11:00Z",
      action: "unlock",
      ext: JSON.stringify({ success: false, status: "failed" }),
    });
    const points = authEventsToTimelinePoints([ok, fail]);
    expect(points.map((p) => p.kind).sort()).toEqual(["failed", "unlocked"]);
  });

  it("prefers ext.auth_type over generic authentication_event action", () => {
    const ev = parseAuthEvent({
      timestamp: "2025-12-18T10:31:13.784Z",
      action: "authentication_event",
      message: "Authentication success: user 0 (biometric)",
      ext: JSON.stringify({
        auth_type: "biometric",
        success: true,
        raw_message: "Successfully unlocked user 0 with biometric 3704621293814964787",
      }),
    });
    expect(ev.authType).toBe("biometric");
    expect(ev.message).toContain("Successfully unlocked user 0");
  });
});
