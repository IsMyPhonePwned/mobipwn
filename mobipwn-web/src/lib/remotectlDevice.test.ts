import { describe, expect, it } from "vitest";
import {
  remotectlDetailSections,
  remotectlDeviceFields,
  remotectlHeroStats,
  remotectlHeroSubtitle,
  remotectlHeroTitle,
} from "@/lib/remotectlDevice";

describe("remotectl device panel helpers", () => {
  const row = {
    parser: "remotectl_dumpstate",
    action: "device_metadata",
    device_model: "iPhone18,3",
    os_version: "26.5.1",
    device_id: "KXKW2NH09M",
    ext: JSON.stringify({
      ProductType: "iPhone18,3",
      ProductName: "iPhone",
      BuildVersion: "23F81",
      SerialNumber: "KXKW2NH09M",
      UniqueDeviceID: "00008140-001A2B3C4D5E6F70",
      HardwareModel: "V57AP",
      CPUArchitecture: "arm64e",
      HasSEP: "true",
      EthernetMacAddress: "aa:bb:cc:dd:ee:ff",
      RegionInfo: "LL/A",
      ChipID: "33090",
    }),
  };

  it("builds a readable hero and snapshot stats", () => {
    const map = remotectlDeviceFields(row);
    expect(remotectlHeroTitle(map)).toBe("iPhone18,3");
    expect(remotectlHeroSubtitle(map)).toContain("iOS 26.5.1");
    expect(remotectlHeroSubtitle(map)).toContain("23F81");

    const stats = remotectlHeroStats(map);
    expect(stats.map((s) => s.label)).toEqual(
      expect.arrayContaining(["Serial", "UDID", "Build", "Hardware", "CPU"])
    );
    expect(stats.find((s) => s.label === "Serial")?.value).toBe("KXKW2NH09M");
  });

  it("groups remaining fields without repeating hero stats", () => {
    const map = remotectlDeviceFields(row);
    const sections = remotectlDetailSections(map);
    const labels = sections.flatMap((s) => s.fields.map((f) => f.label));
    expect(labels).not.toContain("Serial");
    expect(labels).not.toContain("UDID");
    expect(labels).not.toContain("Build");
    expect(labels).toEqual(expect.arrayContaining(["Secure Enclave", "Ethernet MAC", "Chip ID"]));
    expect(sections.some((s) => s.title === "Security")).toBe(true);
    expect(sections.some((s) => s.title === "Hardware" || s.title === "Network & region")).toBe(
      true
    );
  });
});
