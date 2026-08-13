import { describe, expect, it } from "vitest";
import {
  formatUsbDuration,
  iosUsbDevicesFromRows,
  iosUsbLockdownFromRows,
  iosUsbPowerFromRows,
  iosUsbViewFromRows,
  isLowValueUsbLockdownMessage,
  summarizeUsbLockdownMessage,
} from "@/lib/iosUsbPanel";

describe("iosUsbDevicesFromRows", () => {
  it("reads summary and device rows", () => {
    const { deviceCount, devices } = iosUsbDevicesFromRows([
      {
        message: "IOUSB plane: 2 device node(s)",
        ext: { usb_kind: "summary", device_count: 2, event_type: "iousb_summary" },
      },
      {
        action: "USB2.0 Hub",
        app_name: "Apple Inc.",
        message: "USB2.0 Hub · by Apple Inc. · vid=0x05ac pid=0x8001",
        ext: {
          usb_kind: "device",
          usb_product: "USB2.0 Hub",
          usb_vendor: "Apple Inc.",
          id_vendor: "0x05ac",
          id_product: "0x8001",
          usb_class: "IOUSBHostDevice",
        },
      },
    ]);
    expect(deviceCount).toBe(2);
    expect(devices).toHaveLength(1);
    expect(devices[0].product).toBe("USB2.0 Hub");
    expect(devices[0].idVendor).toBe("0x05ac");
  });
});

describe("iosUsbLockdownFromRows", () => {
  it("classifies attach and pair events with short titles", () => {
    const events = iosUsbLockdownFromRows([
      {
        datetime: "2026-07-08T12:21:26Z",
        message: "com.apple.iokit.matching event: com.apple.lockdown.USB2.Device",
      },
      {
        datetime: "2026-07-08T12:21:50Z",
        message: "Preparing to pair for iphone-wasm .",
      },
      {
        datetime: "2026-07-08T12:21:51Z",
        message: "remotepairingdeviced attempting to get [com.apple.mobile.wireless_lockdown]:[EnableWifiPairing]",
      },
      {
        datetime: "2026-07-08T12:22:00Z",
        message: "Pair for iphone-wasm succeeded .",
      },
    ]);
    expect(events).toHaveLength(3);
    expect(events[0].kind).toBe("attach");
    expect(events[0].title).toBe("USB host attached");
    expect(events[1].kind).toBe("pair");
    expect(events[1].host).toBe("iphone-wasm");
    expect(events[2].title).toContain("Pair succeeded");
  });

  it("filters low-value noise", () => {
    expect(isLowValueUsbLockdownMessage("hostMayPairWithOptions said yes with prompt")).toBe(true);
    expect(summarizeUsbLockdownMessage("Host client com.apple.InternetTethering is trusted.").host).toBe(
      "com.apple.InternetTethering"
    );
  });
});

describe("iosUsbPowerFromRows", () => {
  it("builds cable sessions and transitions", () => {
    const { sessions, lastExternalConnected, power } = iosUsbPowerFromRows([
      {
        datetime: "2026-07-08T12:54:16Z",
        ext: { type: "BDC_OBC", ExternalConnected: "1" },
      },
      {
        datetime: "2026-07-08T12:54:14Z",
        ext: { type: "BDC_OBC", ExternalConnected: "0" },
      },
      {
        datetime: "2026-07-08T12:50:36Z",
        ext: { type: "BDC_OBC", ExternalConnected: "1", IsCharging: "1" },
      },
      {
        datetime: "2026-07-08T12:50:32Z",
        ext: { type: "BDC_OBC", ExternalConnected: "0" },
      },
    ]);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.some((s) => s.chargingSeen)).toBe(true);
    expect(lastExternalConnected).toBe(true);
    expect(power.length).toBeGreaterThan(0);
    expect(formatUsbDuration(2000)).toBe("2s");
  });
});

describe("iosUsbViewFromRows", () => {
  it("returns null when empty", () => {
    expect(iosUsbViewFromRows([], [], [])).toBeNull();
  });

  it("merges device, lockdown, and power", () => {
    const view = iosUsbViewFromRows(
      [
        {
          action: "iPhone",
          ext: { usb_kind: "device", usb_product: "iPhone", id_vendor: "0x5ac" },
        },
      ],
      [{ datetime: "2026-07-08T12:00:00Z", message: "USB or proxy host no longer connected." }],
      [
        {
          datetime: "2026-07-08T12:00:00Z",
          ext: { type: "BDC_OBC", ExternalConnected: "1", IsCharging: "1", StateOfCharge: "40" },
        },
      ]
    );
    expect(view).not.toBeNull();
    expect(view?.devices[0].product).toBe("iPhone");
    expect(view?.lockdown[0].kind).toBe("detach");
    expect(view?.lockdown[0].title).toBe("USB host disconnected");
    expect(view?.sessions.length).toBe(1);
    expect(view?.sessions[0].chargingSeen).toBe(true);
    expect(view?.lastExternalConnected).toBe(true);
    expect(view?.chargingCount).toBe(1);
  });
});
