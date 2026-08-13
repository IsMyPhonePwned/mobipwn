import { describe, expect, it } from "vitest";
import {
  bluetoothDevices,
  looksLikeBluetoothServiceBlob,
  parseBluetoothDevice,
  splitBluetoothServices,
} from "./bluetoothDevices";

describe("looksLikeBluetoothServiceBlob", () => {
  it("detects profile dumps mistaken for device names", () => {
    expect(
      looksLikeBluetoothServiceBlob(
        ": SPP HSP AudioSink Avrcp Handsfree 66666666-6666-6666-6666-666666666666"
      )
    ).toBe(true);
    expect(looksLikeBluetoothServiceBlob("OpenFit 2+ by Shokz")).toBe(false);
    expect(looksLikeBluetoothServiceBlob("MY_CAR")).toBe(false);
  });
});

describe("splitBluetoothServices", () => {
  it("separates profiles from UUIDs", () => {
    const { profiles, uuids } = splitBluetoothServices([
      "SPP",
      "HSP",
      "AudioSink",
      "66666666-6666-6666-6666-666666666666",
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(profiles).toEqual(["SPP", "HSP", "AudioSink"]);
    expect(uuids).toEqual(["66666666-6666-6666-6666-666666666666"]);
  });
});

describe("parseBluetoothDevice", () => {
  it("does not use service blobs as the device title", () => {
    const device = parseBluetoothDevice({
      parser: "Bluetooth",
      app_name: ": SPP HSP AudioSink Avrcp Handsfree 66666666-6666-6666-6666-666666666666",
      device_id: "XX:XX:XX:XX:53:25",
      ext: {
        mac_address: "A0:0C:E2:1E:53:25",
        masked_address: "XX:XX:XX:XX:53:25",
        connected: false,
        transport_type: "DUAL",
      },
    });
    expect(device).not.toBeNull();
    expect(device!.name).toContain("A0:0C:E2:1E:53:25");
    expect(device!.name).not.toMatch(/AudioSink/);
    expect(device!.services).toEqual(
      expect.arrayContaining(["SPP", "HSP", "AudioSink", "Avrcp", "Handsfree"])
    );
    expect(device!.serviceUuids).toContain("66666666-6666-6666-6666-666666666666");
  });

  it("keeps friendly names and maps mac_address", () => {
    const device = parseBluetoothDevice({
      parser: "Bluetooth",
      app_name: "OpenFit 2+ by Shokz",
      ext: {
        mac_address: "A0:0C:E2:1E:53:25",
        services: ["SPP", "HSP", "AudioSink", "66666666-6666-6666-6666-666666666666"],
        connected: true,
      },
    });
    expect(device!.name).toBe("OpenFit 2+ by Shokz");
    expect(device!.address).toBe("A0:0C:E2:1E:53:25");
    expect(device!.services).toEqual(["SPP", "HSP", "AudioSink"]);
    expect(device!.connected).toBe(true);
  });
});

describe("bluetoothDevices", () => {
  it("dedupes by address", () => {
    const devices = bluetoothDevices([
      {
        parser: "Bluetooth",
        app_name: "OpenFit 2+ by Shokz",
        datetime: "2026-01-21T11:00:00Z",
        ext: { mac_address: "A0:0C:E2:1E:53:25", services: ["SPP"] },
      },
      {
        parser: "Bluetooth",
        app_name: "OpenFit 2+ by Shokz",
        datetime: "2026-01-21T10:00:00Z",
        ext: {
          mac_address: "A0:0C:E2:1E:53:25",
          services: ["SPP", "AudioSink"],
          connected: true,
        },
      },
    ]);
    expect(devices).toHaveLength(1);
    expect(devices[0]!.services).toEqual(expect.arrayContaining(["SPP", "AudioSink"]));
    expect(devices[0]!.connected).toBe(true);
  });
});
