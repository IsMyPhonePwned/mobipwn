import { describe, expect, it } from "vitest";
import { apkDailyEvents, parseApkDailyEvent } from "./apkDaily";

describe("parseApkDailyEvent", () => {
  it("parses a downgrade row", () => {
    const ev = parseApkDailyEvent({
      parser: "Battery",
      data_type: "android:bugreport:battery_daily_downgrade",
      bundle_id: "com.example.app",
      action: "downgrade",
      message: "APK downgrade: com.example.app vers 100 -> 50 (battery daily 2026-01-10)",
      timestamp: "2026-01-10T00:00:00Z",
      ext: JSON.stringify({
        package_name: "com.example.app",
        vers: "50",
        previous_vers: "100",
        from: "2026-01-10",
        to: "2026-01-11",
        action: "downgrade",
      }),
    });
    expect(ev).not.toBeNull();
    expect(ev!.action).toBe("downgrade");
    expect(ev!.packageName).toBe("com.example.app");
    expect(ev!.vers).toBe("50");
    expect(ev!.previousVers).toBe("100");
    expect(ev!.from).toBe("2026-01-10");
  });
});

describe("apkDailyEvents", () => {
  it("orders downgrades before uninstalls", () => {
    const rows = apkDailyEvents(
      [
        {
          parser: "Battery",
          data_type: "battery_daily_uninstall",
          action: "uninstall",
          bundle_id: "com.a",
          message: "APK uninstall",
          ext: JSON.stringify({ vers: "0", from: "2026-01-02", action: "uninstall" }),
        },
        {
          parser: "Battery",
          data_type: "battery_daily_downgrade",
          action: "downgrade",
          bundle_id: "com.b",
          message: "APK downgrade",
          ext: JSON.stringify({
            vers: "1",
            previous_vers: "9",
            from: "2026-01-01",
            action: "downgrade",
          }),
        },
      ],
      10,
      { actions: ["downgrade", "uninstall"] }
    );
    expect(rows.map((r) => r.packageName)).toEqual(["com.b", "com.a"]);
  });
});
