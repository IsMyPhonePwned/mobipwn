import { describe, expect, it } from "vitest";
import {
  aggregateNetworkFlows,
  aggregateWifiScanSightings,
  wifiScanSearchQuery,
} from "@/lib/networkFlow";

describe("aggregateNetworkFlows vs wifi scans", () => {
  it("does not treat Wi-Fi scan SSIDs as connection flows", () => {
    const links = aggregateNetworkFlows([
      {
        data_type: "android:bugreport:wifi_scan_result",
        ssid: "Myrtille",
        message: "WiFi scan result: Myrtille",
        ext: JSON.stringify({ bssid: "76:89:1a:7d:59:60", rssi: -26, frequency: 5240 }),
      },
      {
        data_type: "android:bugreport:network_socket",
        message: "Socket tcp 10.0.0.2:443 -> 1.2.3.4:443",
        ext: JSON.stringify({ state: "ESTABLISHED", remote_address: "1.2.3.4:443" }),
        bundle_id: "com.example.app",
        dest_ip: "1.2.3.4",
      },
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]?.target).toBe("1.2.3.4");
    expect(links[0]?.targetKind).toBe("ip");
    expect(links[0]?.source).toBe("com.example.app");
  });
});

describe("aggregateWifiScanSightings", () => {
  it("groups scan SSIDs with strongest RSSI and clear sighting counts", () => {
    const sightings = aggregateWifiScanSightings([
      {
        data_type: "android:bugreport:wifi_scan_result",
        ssid: "Myrtille",
        ext: JSON.stringify({ bssid: "76:89:1a:7d:59:60", rssi: -54, frequency: 5240 }),
      },
      {
        data_type: "android:bugreport:wifi_scan_result",
        ssid: "Myrtille",
        ext: JSON.stringify({ bssid: "76:89:1a:7d:59:60", rssi: -26, frequency: 5240 }),
      },
      {
        data_type: "android:bugreport:wifi_scan_result",
        ssid: "Pickle",
        ext: JSON.stringify({ bssid: "2e:0d:db:6f:9a:28", rssi: -82, frequency: 2422 }),
      },
      {
        data_type: "android:bugreport:network_socket",
        dest_ip: "1.2.3.4",
        bundle_id: "com.example.app",
      },
    ]);
    expect(sightings).toHaveLength(2);
    expect(sightings[0]?.ssid).toBe("Myrtille");
    expect(sightings[0]?.count).toBe(2);
    expect(sightings[0]?.rssi).toBe(-26);
    expect(sightings[1]?.ssid).toBe("Pickle");
    expect(sightings[1]?.count).toBe(1);
  });
});
