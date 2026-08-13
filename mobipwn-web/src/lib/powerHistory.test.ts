import { describe, expect, it } from "vitest";
import {
  powerAllHistoryEvents,
  powerPanelViewFromRows,
  powerResetView,
} from "@/lib/powerHistory";

describe("powerAllHistoryEvents", () => {
  it("merges standalone history and nested reset-block events", () => {
    const rows = [
      {
        data_type: "android:bugreport:power",
        action: "SHUTDOWN",
        ext: {
          event_type: "SHUTDOWN",
          timestamp: "2025-02-20 10:07:32+0100",
          flags: "0",
          details: "battery",
        },
      },
      {
        data_type: "android:bugreport:reset_reason",
        action: "kernel panic",
        ext: {
          reason: "kernel panic",
          entry_timestamp: "25/12/08 22:41:50",
          stack_trace: ["#0 pc 0xdead", "#1 pc 0xbeef"],
          history_events: [
            {
              event_type: "ON",
              timestamp: "10:00:24+0100",
              flags: "wake",
              details: "power button",
            },
          ],
          other_lines: ["extra context line"],
        },
      },
    ];

    const events = powerAllHistoryEvents(rows);
    expect(events.length).toBe(2);

    const view = powerPanelViewFromRows(rows);
    expect(view?.summary.reset).toBe(1);
    expect(view?.summary.history).toBe(1);
    expect(view?.history.length).toBe(2);

    const reset = powerResetView(rows[1]);
    expect(reset.stackTrace).toHaveLength(2);
    expect(reset.otherLines).toEqual(["extra context line"]);
    expect(reset.nestedHistory).toHaveLength(1);
    expect(reset.nestedHistory[0]?.eventType).toBe("ON");
  });
});
