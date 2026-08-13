import { describe, expect, it } from "vitest";
import {
  androidUsbViewFromRows,
  parseAndroidUsbDevice,
  usbIdsFromRawLine,
} from "./androidUsbDevices";

describe("usbIdsFromRawLine", () => {
  it("parses PRODUCT vid/pid", () => {
    expect(
      usbIdsFromRawLine(
        "onUEvent(Host Interface): {ACTION=add, PRODUCT=1d6b/2/606, INTERFACE=9/0/0}"
      )
    ).toEqual({ vid: "1d6b", pid: "2" });
  });

  it("parses MODALIAS when PRODUCT is absent", () => {
    expect(
      usbIdsFromRawLine(
        "MODALIAS=usb:v1D6Bp0002d0606dc09dsc00dp01ic09isc00ip00in00, ACTION=add"
      )
    ).toEqual({ vid: "1d6b", pid: "2" });
  });
});

describe("parseAndroidUsbDevice", () => {
  it("reads VID/PID/driver/interface/seen fields from ext", () => {
    const device = parseAndroidUsbDevice({
      parser: "Usb",
      data_type: "android:bugreport:usb_device",
      message: "USB device: 1d6b:2 (hub)",
      action: "remove",
      ext: {
        vid: "1d6b",
        product_id: "2",
        driver: "hub",
        interface: "9/0/0",
        first_seen: "08-03 12:06:36.337",
        last_seen: "08-03 12:07:07.121",
        last_action: "remove",
      },
    });
    expect(device).toMatchObject({
      vid: "1d6b",
      pid: "2",
      driver: "hub",
      interface: "9/0/0",
      firstSeen: "08-03 12:06:36.337",
      lastSeen: "08-03 12:07:07.121",
      lastAction: "remove",
    });
  });

  it("recovers pid from events when MUDM stripped legacy pid", () => {
    const device = parseAndroidUsbDevice({
      parser: "Usb",
      data_type: "android:bugreport:usb_device",
      message: "USB device:",
      ext: {
        vid: "1d6b",
        driver: "hub",
        interface: "9/0/0",
        first_seen: "08-03 12:06:36.337",
        last_seen: "08-03 12:07:07.121",
        last_action: "remove",
        events: [
          {
            timestamp: "08-03 12:06:36.337",
            action: "add",
            raw_line:
              "08-03 12:06:36.337 D UsbUI : onUEvent(Host Interface): {PRODUCT=1d6b/2/606, INTERFACE=9/0/0}",
          },
        ],
      },
    });
    expect(device?.pid).toBe("2");
  });
});

describe("androidUsbViewFromRows", () => {
  it("splits ports and devices", () => {
    const view = androidUsbViewFromRows([
      {
        parser: "Usb",
        data_type: "android:bugreport:usb_port",
        message: "USB port: usb_otg",
        ext: { id: "usb_otg", connected: false, first_seen: "08-03 12:06:36.317" },
      },
      {
        parser: "Usb",
        data_type: "android:bugreport:usb_device",
        message: "USB device: 1d6b:2 (hub)",
        ext: {
          vid: "1d6b",
          product_id: "2",
          driver: "hub",
          interface: "9/0/0",
          first_seen: "08-03 12:06:36.337",
          last_seen: "08-03 12:07:07.121",
          last_action: "remove",
        },
      },
    ]);
    expect(view.ports).toHaveLength(1);
    expect(view.ports[0]?.id).toBe("usb_otg");
    expect(view.devices).toHaveLength(1);
    expect(view.devices[0]?.pid).toBe("2");
  });
});
