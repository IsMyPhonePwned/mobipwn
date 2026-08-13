import { describe, expect, it } from "vitest";
import { mobileInstallEvents } from "@/lib/mobileInstallTimeline";

describe("mobileInstallEvents", () => {
  it("classifies Staging MIInstallable as installed", () => {
    const events = mobileInstallEvents([
      {
        parser: "mobileinstallation",
        bundle_id: "com.cbouvat.saracroche",
        message:
          "Staging <MIInstallableBundle ID=com.cbouvat.saracroche; Persona=FEEDEEEE, Version=1, ShortVersion=4.12.0>",
        timestamp: "2026-06-25T12:37:45.000Z",
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("installed");
    expect(events[0]?.bundleId).toBe("com.cbouvat.saracroche");
    expect(events[0]?.version).toBe("4.12.0");
  });

  it("does not scrape prose 'version does' as a version", () => {
    const events = mobileInstallEvents([
      {
        parser: "mobileinstallation",
        bundle_id: "org.whispersystems.signal",
        message: "Install requested; version does not match existing container metadata",
        timestamp: "2025-04-07T14:47:00.000Z",
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.version).toBe("");
  });

  it("classifies uninstall wording as deleted", () => {
    const events = mobileInstallEvents([
      {
        parser: "mobileinstallation",
        bundle_id: "com.example.sideload",
        message: "Uninstalling com.example.sideload",
        timestamp: "2026-06-26T08:00:00.000Z",
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("deleted");
  });

  it("skips unrelated rows", () => {
    expect(
      mobileInstallEvents([
        {
          parser: "mobileinstallation",
          bundle_id: "com.example.app",
          message: "Looking up container for persona",
          timestamp: "2026-06-26T08:00:00.000Z",
        },
      ])
    ).toHaveLength(0);
  });
});
