import { describe, expect, it } from "vitest";
import {
  androidBatteryDrainScore,
  androidBatteryLevelSeriesFromRows,
  androidBatteryViewFromRows,
  batteryChargingRanges,
  downsampleBatterySeries,
  flattenBatteryExtObject,
  formatIosTemperature,
  iosBatteryExtFromRow,
  iosBatteryLevelSeriesFromRows,
  iosBatterySocSeriesFromBdcRows,
  iosBatteryViewFromPowerlogsSeries,
  iosBatteryViewFromRows,
  normalizeIosBatteryFamily,
} from "@/lib/batteryPanel";

describe("iosBatteryExtFromRow", () => {
  it("merges ext.type and timestamp_desc fallback", () => {
    const ext = iosBatteryExtFromRow({
      timestamp_desc: "BDC_SBC",
      ext: JSON.stringify({ StateOfCharge: "87", Temperature: "3125" }),
    });
    expect(ext.type).toBe("BDC_SBC");
    expect(ext.StateOfCharge).toBe("87");
  });

  it("reads top-level BDC fields when search promotes them", () => {
    const ext = iosBatteryExtFromRow({
      type: "BDC_Once",
      DesignCapacity: "4325",
      CycleCount: "412",
      ext: "{}",
    });
    expect(ext.DesignCapacity).toBe("4325");
    expect(ext.CycleCount).toBe("412");
  });

  it("normalizes lowercase and nested ext keys", () => {
    const ext = iosBatteryExtFromRow({
      timestamp_desc: "BDC_SBC",
      ext: {
        properties: {
          temperature: "2850",
          voltage: "4490",
        },
      },
    });
    expect(ext.Temperature).toBe("2850");
    expect(ext.Voltage).toBe("4490");
  });
});

describe("formatIosTemperature", () => {
  it("converts centidegree integers", () => {
    expect(formatIosTemperature("2850")).toBe("28.5 °C");
    expect(formatIosTemperature("2980")).toBe("29.8 °C");
  });
});

describe("flattenBatteryExtObject", () => {
  it("flattens one-level nested maps", () => {
    expect(
      flattenBatteryExtObject({
        Temperature: 3125,
        data: { InstantAmperage: -516 },
      })
    ).toEqual({
      Temperature: "3125",
      InstantAmperage: "-516",
    });
  });
});

describe("normalizeIosBatteryFamily", () => {
  it("collapses BDC filename stems to family", () => {
    expect(normalizeIosBatteryFamily("BDC_SBC_20240101", {})).toBe("BDC_SBC");
    expect(normalizeIosBatteryFamily("20240101", { DesignCapacity: "4000" })).toBe("BDC_Once");
  });
});

describe("iosBatteryLevelSeriesFromRows", () => {
  it("builds battery level series from powerlogs message", () => {
    const series = iosBatteryLevelSeriesFromRows([
      {
        datetime: "2024-05-24T10:00:00Z",
        message: "Battery Level: LEVEL=80, RAW LEVEL=79.5, IS CHARGING=1",
        timestamp_desc: "Battery Level",
      },
      {
        datetime: "2024-05-24T11:00:00Z",
        message: "Battery Level: LEVEL=70, RAW LEVEL=69.2, IS CHARGING=0",
        ext: { raw_level: 69.2, level: 70 },
      },
    ]);
    expect(series).toHaveLength(2);
    expect(series[0].level).toBe(79.5);
    expect(series[0].charging).toBe(true);
    expect(series[1].level).toBe(69.2);
    expect(series[1].charging).toBe(false);
  });

  it("parses ClickHouse space-separated datetime", () => {
    const series = iosBatteryLevelSeriesFromRows([
      {
        datetime: "2024-05-24 10:00:00.000",
        message: "Battery Level: RAW LEVEL=55",
        timestamp_desc: "Battery Level",
      },
    ]);
    expect(series).toHaveLength(1);
    expect(series[0].level).toBe(55);
    expect(series[0].t).toBeGreaterThan(0);
  });

  it("accepts fractional 0–1 levels", () => {
    const series = iosBatteryLevelSeriesFromRows([
      {
        datetime: "2024-05-24T10:00:00Z",
        message: "Battery Level",
        timestamp_desc: "Battery Level",
        ext: { raw_level: 0.82 },
      },
    ]);
    expect(series).toHaveLength(1);
    expect(series[0].level).toBe(82);
  });
});

describe("downsampleBatterySeries and charging ranges", () => {
  it("downsamples dense series while keeping endpoints", () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({
      t: i * 1000,
      when: String(i),
      level: i % 100,
      charging: i % 10 === 0 ? true : false,
    }));
    const out = downsampleBatterySeries(points, 50);
    expect(out).toHaveLength(50);
    expect(out[0].t).toBe(0);
    expect(out[out.length - 1].t).toBe(points[points.length - 1].t);
  });

  it("builds charging ranges", () => {
    const ranges = batteryChargingRanges([
      { t: 1, when: "a", level: 50, charging: false },
      { t: 2, when: "b", level: 55, charging: true },
      { t: 3, when: "c", level: 60, charging: true },
      { t: 4, when: "d", level: 62, charging: false },
    ]);
    expect(ranges).toEqual([{ x1: 2, x2: 4 }]);
  });
});

describe("iosBatterySocSeriesFromBdcRows", () => {
  it("builds series from BDC StateOfCharge", () => {
    const series = iosBatterySocSeriesFromBdcRows([
      {
        datetime: "2024-05-24T10:00:00Z",
        ext: { type: "BDC_SBC", StateOfCharge: "71", IsCharging: "1" },
      },
    ]);
    expect(series).toHaveLength(1);
    expect(series[0].level).toBe(71);
    expect(series[0].charging).toBe(true);
  });
});

describe("iosBatteryViewFromRows", () => {
  it("builds hero and sections from BDC rows", () => {
    const view = iosBatteryViewFromRows([
      {
        datetime: "2026-01-01T12:00:00Z",
        timestamp_desc: "BDC_SBC",
        ext: {
          type: "BDC_SBC",
          StateOfCharge: "72",
          IsCharging: "1",
          Temperature: "2980",
          Voltage: "4100",
          InstantAmperage: "-120",
        },
      },
      {
        datetime: "2026-01-01T12:00:00Z",
        timestamp_desc: "BDC_Once",
        ext: {
          type: "BDC_Once",
          DesignCapacity: "4000",
          MaxCapacity: "3850",
          CycleCount: "220",
        },
      },
      {
        datetime: "2026-01-01T12:00:00Z",
        timestamp_desc: "BDC_OBC",
        ext: {
          type: "BDC_OBC",
          ExternalConnected: "1",
        },
      },
    ]);

    expect(view).not.toBeNull();
    expect(view?.stateOfCharge).toBe("72%");
    expect(view?.healthPercent).toBe("96%");
    expect(view?.isCharging).toBe(true);
    expect(view?.externalConnected).toBe(true);
    expect(view?.statusBadges).toContain("Charging");
    expect(view?.heroStats.temperature).toBe("29.8 °C");
    expect(view?.heroStats.voltage).toBe("4.10 V");
    expect(view?.heroStats.amperage).toBe("-120 mA");
    expect(view?.heroStats.designCapacity).toBe("4000 mAh");
    expect(view?.sections.length).toBeGreaterThanOrEqual(2);
  });
});

describe("iosBatteryViewFromPowerlogsSeries", () => {
  it("builds a fallback view when BatteryBDC is absent", () => {
    const series = iosBatteryLevelSeriesFromRows([
      {
        timestamp: "2023-05-24T19:56:02Z",
        message: "Battery Level: level=100.0, raw level=98.7, is charging=1, fully charged=0",
        timestamp_desc: "Battery Level",
        ext: { level: 100, raw_level: 98.7, is_charging: 1 },
      },
      {
        timestamp: "2023-05-25T08:10:00Z",
        message: "Battery Level: level=72.0, raw level=71.5, is charging=0, fully charged=0",
        timestamp_desc: "Battery Level",
        ext: { level: 72, raw_level: 71.5, is_charging: 0 },
      },
    ]);
    const view = iosBatteryViewFromPowerlogsSeries(series);
    expect(view).not.toBeNull();
    expect(view?.stateOfCharge).toBe("72%");
    expect(view?.isCharging).toBe(false);
    expect(view?.statusBadges).toContain("Powerlogs");
    expect(view?.statusBadges).toContain("On battery");
    expect(view?.recentSamples.length).toBeGreaterThan(0);
    expect(view?.highlightFields.some((f) => f.key === "ObservedRange")).toBe(true);
  });
});

describe("androidBatteryLevelSeriesFromRows", () => {
  it("builds a SoC timeline from history rows with MM-DD stamps", () => {
    const series = androidBatteryLevelSeriesFromRows([
      {
        data_type: "android:bugreport:battery_history",
        datetime: "2025-11-09T09:32:54Z",
        timestamp: "2025-11-09T09:32:54Z",
        message: "Battery history: status=charging",
        ext: {
          timestamp: "11-08 10:00:00.000",
          status: "charging",
          charge: 80,
          flags: ["+charging", "+plugged"],
        },
      },
      {
        data_type: "android:bugreport:battery_history",
        datetime: "2025-11-09T09:32:54Z",
        timestamp: "2025-11-09T09:32:54Z",
        message: "Battery history: status=discharging",
        ext: {
          timestamp: "11-08 18:00:00.000",
          status: "discharging",
          charge: 55,
        },
      },
      {
        data_type: "android:bugreport:battery_hardware",
        datetime: "2025-11-09T09:32:54Z",
        message: "Battery kernel hardware: soc=55%",
        ext: { soc_percent: 55 },
      },
    ]);
    expect(series.length).toBeGreaterThanOrEqual(2);
    expect(series[0]!.level).toBe(80);
    expect(series[0]!.charging).toBe(true);
    expect(series[1]!.level).toBe(55);
    expect(series[1]!.charging).toBe(false);
    expect(series[1]!.t).toBeGreaterThan(series[0]!.t);
  });
});

describe("androidBatteryViewFromRows", () => {
  it("parses history and app stats", () => {
    const view = androidBatteryViewFromRows([
      {
        data_type: "android:bugreport:battery_history",
        message: "Battery history: status=charging",
        ext: {
          timestamp: "12-14 15:30:00.000",
          status: "charging",
          charge: 78,
          temp: 234,
          volt: 4100,
          plug: "usb",
          health: "good",
        },
      },
      {
        data_type: "android:bugreport:battery_app_stats",
        message: "Battery stats app: com.example.app",
        bundle_id: "com.example.app",
        ext: {
          package_name: "com.example.app",
          total_wakelock_time_ms: 120_000,
          total_network_bytes: 2048,
          cpu_user_time_ms: 5000,
          cpu_system_time_ms: 2000,
          total_job_count: 3,
        },
      },
    ]);

    expect(view).not.toBeNull();
    expect(view?.charge).toBe("78%");
    expect(view?.status).toBe("Charging");
    expect(view?.temp).toBe("23.4 °C");
    expect(view?.heroStats.temperature).toBe("23.4 °C");
    expect(view?.heroStats.voltage).toBe("4.10 V");
    expect(view?.heroStats.plug).toBe("usb");
    expect(view?.heroStats.health).toBe("good");
    expect(view?.isCharging).toBe(true);
    expect(view?.statusBadges).toContain("Charging");
    expect(view?.topApps[0]?.package).toBe("com.example.app");
    expect(view?.topApps[0]?.wakelock).toBe("2m");
  });

  it("uses skin_temp when temp is missing and parses kernel hardware rows", () => {
    const view = androidBatteryViewFromRows([
      {
        data_type: "android:bugreport:battery_history",
        action: "discharging",
        ext: {
          timestamp: "12-14 16:00:00.000",
          status: "discharging",
          charge: 55,
          skin_temp: 301,
          volt: 3900,
          current: -220,
          plug: "none",
          health: "good",
        },
      },
      {
        data_type: "android:bugreport:battery_hardware",
        message: "Battery kernel hardware: soc=55%",
        ext: {
          timestamp: "12-14 16:00:01.000",
          soc_percent: 55,
          vm_mv: 3900,
          inow_ma: -180,
          tbat: 298,
          tchg: 310,
        },
      },
    ]);

    expect(view?.heroStats.temperature).toBe("30.1 °C");
    expect(view?.hardwareCount).toBe(1);
    expect(view?.hardware[0]?.soc).toBe("55%");
    expect(view?.hardware[0]?.chargerTemp).toBe("31.0 °C");
    expect(view?.status).toBe("Discharging");
  });

  it("ignores mV-like junk in charge and falls back to soc_percent", () => {
    const view = androidBatteryViewFromRows([
      {
        data_type: "android:bugreport:battery_history",
        message: "Battery history: status=charging",
        ext: {
          timestamp: "12-14 15:30:00.000",
          status: "charging",
          charge: 3175,
          soc_percent: 64,
          volt: 4100,
        },
      },
    ]);
    expect(view?.charge).toBe("64%");
    expect(view?.status).toBe("Charging");
    expect(view?.charge).not.toBe("3175");
  });

  it("matches android:bugreport:battery_app timeline data_type", () => {
    const view = androidBatteryViewFromRows([
      {
        data_type: "android:bugreport:battery_app",
        message: "Battery stats app: com.example.app",
        ext: {
          package_name: "com.example.app",
          total_wakelock_time_ms: 1000,
        },
      },
    ]);

    expect(view?.appCount).toBe(1);
  });

  it("orders apps by composite battery drain score", () => {
    const view = androidBatteryViewFromRows([
      {
        data_type: "android:bugreport:battery_app_stats",
        bundle_id: "com.heavy.wakelock",
        ext: {
          package_name: "com.heavy.wakelock",
          total_wakelock_time_ms: 300_000,
          cpu_user_time_ms: 1_000,
          cpu_system_time_ms: 0,
        },
      },
      {
        data_type: "android:bugreport:battery_app_stats",
        bundle_id: "com.heavy.cpu",
        ext: {
          package_name: "com.heavy.cpu",
          total_wakelock_time_ms: 0,
          cpu_user_time_ms: 400_000,
          cpu_system_time_ms: 50_000,
        },
      },
    ]);

    expect(view?.topApps.map((a) => a.package)).toEqual(["com.heavy.cpu", "com.heavy.wakelock"]);
    expect(androidBatteryDrainScore({ wakelockMs: 0, cpuMs: 450_000, jobTimeMs: 0, fgServiceMs: 0, networkBytes: 0 }))
      .toBeGreaterThan(
        androidBatteryDrainScore({ wakelockMs: 300_000, cpuMs: 1_000, jobTimeMs: 0, fgServiceMs: 0, networkBytes: 0 })
      );
  });
});
