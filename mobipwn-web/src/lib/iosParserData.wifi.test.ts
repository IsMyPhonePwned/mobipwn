import { describe, expect, it } from "vitest";
import {
  wifiNetworksFromRows,
  wifiScanBand,
  wifiScanSummary,
} from "./iosParserData";

describe("wifiNetworksFromRows", () => {
  it("parses structured scan rows and skips summary totals", () => {
    const rows = [
      {
        message: "Wifi scan: total=12",
        ext: JSON.stringify({ total: "12", scanned: "12" }),
      },
      {
        ssid: "CafeWiFi",
        message: "CafeWiFi wpa2 6",
        ext: JSON.stringify({
          ssid: "CafeWiFi",
          ssid_hex: "4361666557694669",
          security: "wpa2",
          channel: "6",
          rssi: "-48",
          bssid: "aa:bb:cc:dd:ee:ff",
          phy: "11n",
          cc: "US",
          wasConnectedDuringSleep: "1",
          age: "12",
        }),
      },
      {
        ssid: "<HIDDEN>",
        message: "<HIDDEN> none 36",
        ext: JSON.stringify({
          ssid: "<HIDDEN>",
          security: "none",
          channel: "36",
          rssi: "-72",
          phy: "11ac",
        }),
      },
    ];

    const nets = wifiNetworksFromRows(rows);
    expect(nets).toHaveLength(2);
    expect(nets[0].ssid).toBe("CafeWiFi");
    expect(nets[0].bssid).toBe("aa:bb:cc:dd:ee:ff");
    expect(nets[0].rssiDbm).toBe(-48);
    expect(nets[0].band).toBe("2.4 GHz");
    expect(nets[0].connectedInSleep).toBe(true);
    expect(nets[0].securityKind).toBe("wpa");
    expect(nets[1].hidden).toBe(true);
    expect(nets[1].securityKind).toBe("open");
    expect(nets[1].band).toBe("5 GHz");

    const summary = wifiScanSummary(nets);
    expect(summary.open).toBe(1);
    expect(summary.hidden).toBe(1);
    expect(summary.sleep).toBe(1);
    expect(summary.strong).toBe(1);
  });

  it("maps channel strings to bands", () => {
    expect(wifiScanBand("6")).toBe("2.4 GHz");
    expect(wifiScanBand("149,+1")).toBe("5 GHz");
    expect(wifiScanBand("6g5")).toBe("6 GHz");
  });
});
