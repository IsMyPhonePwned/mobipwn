import { describe, expect, it } from "vitest";
import {
  iosTccServiceInfo,
  iosTccServiceLabel,
  iosTccServiceTooltip,
  normalizeTccServiceKey,
} from "@/lib/iosTccServices";
import { tccPermissionTitle, tccPermissionsFromRows } from "@/lib/iosParserData";
import { permissionChipTitle } from "@/lib/packageSnapshot";

describe("iosTccServices", () => {
  it("maps Liverpool to CloudKit with a clarifying tooltip", () => {
    expect(normalizeTccServiceKey("kTCCServiceLiverpool")).toBe("liverpool");
    expect(iosTccServiceLabel("kTCCServiceLiverpool")).toBe("CloudKit");
    expect(iosTccServiceLabel("Liverpool")).toBe("CloudKit");
    const tip = iosTccServiceTooltip("kTCCServiceLiverpool");
    expect(tip).toMatch(/CloudKit/i);
    expect(tip).toMatch(/not Location/i);
    expect(iosTccServiceInfo("kTCCServiceLiverpool").id).toBe("kTCCServiceLiverpool");
  });

  it("maps other opaque / common services", () => {
    expect(iosTccServiceLabel("kTCCServiceUbiquity")).toBe("iCloud Drive");
    expect(iosTccServiceLabel("kTCCServiceWillow")).toBe("Home / HomeKit data");
    expect(iosTccServiceLabel("kTCCServiceCamera")).toBe("Camera");
    expect(iosTccServiceLabel("kTCCServiceLocation")).toBe("Location");
  });

  it("falls back gracefully for unknown services", () => {
    expect(iosTccServiceLabel("kTCCServiceSomethingNew")).toBe("Something New");
    expect(iosTccServiceTooltip("kTCCServiceSomethingNew")).toMatch(/does not document/i);
  });
});

describe("TCC UI helpers", () => {
  it("labels permissions from rows as CloudKit for Liverpool", () => {
    const perms = tccPermissionsFromRows([
      {
        message: "App Permissions",
        ext: JSON.stringify({
          client: "com.apple.Health",
          service: "kTCCServiceLiverpool",
          allowed: "ALLOWED",
        }),
      },
    ]);
    expect(perms[0]?.service).toBe("CloudKit");
    expect(perms[0]?.serviceRaw).toBe("kTCCServiceLiverpool");
    expect(tccPermissionTitle(perms[0]!)).toMatch(/CloudKit/i);
  });

  it("uses CloudKit in package permission chip titles", () => {
    const title = permissionChipTitle({
      name: "kTCCServiceLiverpool",
      shortName: "CloudKit",
      permType: "tcc",
      granted: true,
    });
    expect(title).toMatch(/CloudKit/i);
    expect(title).toMatch(/granted/);
  });
});
