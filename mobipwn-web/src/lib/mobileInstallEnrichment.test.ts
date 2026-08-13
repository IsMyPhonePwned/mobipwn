import { describe, expect, it } from "vitest";
import {
  enrichMobileInstallEvents,
  INSTALL_ENRICHMENT_RULES,
  installContextByBundleId,
} from "@/lib/mobileInstallEnrichment";
import type { MobileInstallEvent } from "@/lib/mobileInstallTimeline";

const WINDOW = 30 * 60 * 1000;

function mi(
  partial: Partial<MobileInstallEvent> & Pick<MobileInstallEvent, "kind" | "bundleId" | "timestampMs">
): MobileInstallEvent {
  return {
    key: `${partial.kind}|${partial.bundleId}|${partial.timestampMs}`,
    label: partial.label ?? partial.bundleId.split(".").slice(-1)[0]!,
    version: partial.version ?? "",
    timestamp: partial.timestamp ?? "",
    message: partial.message ?? partial.kind,
    parser: partial.parser ?? "mobileinstallation",
    ...partial,
  };
}

function trollDecryptRow(iso: string) {
  return {
    datetime: iso,
    timestamp: String(Date.parse(iso)),
    parser: "powerlogs",
    bundle_id: "com.fiore.trolldecrypt",
    message: "App Usage: approle=1, display=0, level=1.0",
  };
}

function labelsOf(ev: { enrichments: { label: string }[] }) {
  return ev.enrichments.map((h) => h.label);
}

describe("enrichMobileInstallEvents", () => {
  it("attaches IPA when the haystack names the app", () => {
    const installMs = Date.parse("2025-04-07T13:13:50Z");
    const events = [
      mi({
        kind: "installed",
        bundleId: "org.whispersystems.signal",
        timestampMs: installMs,
        message: "Installing org.whispersystems.signal",
      }),
    ];
    const enriched = enrichMobileInstallEvents(
      events,
      [
        {
          datetime: "2025-04-07T13:14:00.000Z",
          timestamp: String(installMs + 10_000),
          parser: "logarchive",
          message: "Copied Signal.ipa for org.whispersystems.signal",
        },
      ],
      { rules: INSTALL_ENRICHMENT_RULES, windowMs: WINDOW }
    );
    expect(labelsOf(enriched[0]!)).toEqual(expect.arrayContaining(["Signal.ipa"]));
  });

  it("attaches sideload tools on reinstall-after-delete without app tokens", () => {
    const deleteMs = Date.parse("2025-04-07T12:00:00Z");
    const installMs = Date.parse("2025-04-07T12:10:00Z");
    const events = [
      mi({
        kind: "deleted",
        bundleId: "org.whispersystems.signal",
        timestampMs: deleteMs,
        message: "Uninstalling identifier org.whispersystems.signal",
      }),
      mi({
        kind: "installed",
        bundleId: "org.whispersystems.signal",
        timestampMs: installMs,
        message: "Installing org.whispersystems.signal",
      }),
    ];
    const enriched = enrichMobileInstallEvents(
      events,
      [trollDecryptRow("2025-04-07T12:05:00.000Z")],
      { rules: INSTALL_ENRICHMENT_RULES, windowMs: WINDOW }
    );
    // Tool is within window of the reinstall; reinstall-after-delete attaches tools.
    expect(labelsOf(enriched.find((e) => e.kind === "installed")!)).toContain("TrollDecrypt");
  });

  it("attaches TrollDecrypt near a delete without app tokens (dump-then-uninstall)", () => {
    const deleteMs = Date.parse("2025-04-07T14:40:47Z");
    const events = [
      mi({
        kind: "deleted",
        bundleId: "org.whispersystems.signal",
        label: "whispersystems.signal",
        timestampMs: deleteMs,
        message: "Uninstalling identifier org.whispersystems.signal",
      }),
    ];
    const enriched = enrichMobileInstallEvents(events, [trollDecryptRow("2025-04-07T14:22:00.000Z")], {
      rules: INSTALL_ENRICHMENT_RULES,
      windowMs: WINDOW,
    });
    expect(labelsOf(enriched[0]!)).toContain("TrollDecrypt");
    const byBundle = installContextByBundleId(enriched);
    expect(byBundle.get("org.whispersystems.signal")?.some((h) => h.label === "TrollDecrypt")).toBe(
      true
    );
  });

  it("attaches TrollDecrypt between Signal install and a later delete", () => {
    const installMs = Date.parse("2025-04-07T13:13:50Z");
    const deleteMs = Date.parse("2025-04-07T14:40:47Z");
    const events = [
      mi({
        kind: "installed",
        bundleId: "org.whispersystems.signal",
        version: "7.53",
        timestampMs: installMs,
        message: "Installing <MIInstallableBundle ID=org.whispersystems.signal; ShortVersion=7.53>",
      }),
      mi({
        kind: "deleted",
        bundleId: "org.whispersystems.signal",
        timestampMs: deleteMs,
        message: "Uninstalling identifier org.whispersystems.signal",
      }),
    ];
    const enriched = enrichMobileInstallEvents(events, [trollDecryptRow("2025-04-07T14:22:00.000Z")], {
      rules: INSTALL_ENRICHMENT_RULES,
      windowMs: WINDOW,
    });
    expect(labelsOf(enriched.find((e) => e.kind === "installed")!)).toContain("TrollDecrypt");
    expect(labelsOf(enriched.find((e) => e.kind === "deleted")!)).toContain("TrollDecrypt");
  });

  it("does not attach a sideload tool outside the correlation window of a lone delete", () => {
    const deleteMs = Date.parse("2025-04-07T14:40:47Z");
    const events = [
      mi({
        kind: "deleted",
        bundleId: "org.whispersystems.signal",
        timestampMs: deleteMs,
        message: "Uninstalling identifier org.whispersystems.signal",
      }),
    ];
    // 2h earlier — outside ±30m
    const enriched = enrichMobileInstallEvents(events, [trollDecryptRow("2025-04-07T12:40:00.000Z")], {
      rules: INSTALL_ENRICHMENT_RULES,
      windowMs: WINDOW,
    });
    expect(labelsOf(enriched[0]!)).not.toContain("TrollDecrypt");
  });

  it("does not attach a nearby tool to an install with no later delete and no app tokens", () => {
    const installMs = Date.parse("2025-04-07T13:13:50Z");
    const events = [
      mi({
        kind: "installed",
        bundleId: "org.whispersystems.signal",
        timestampMs: installMs,
        message: "Installing org.whispersystems.signal",
      }),
    ];
    const enriched = enrichMobileInstallEvents(events, [trollDecryptRow("2025-04-07T13:20:00.000Z")], {
      rules: INSTALL_ENRICHMENT_RULES,
      windowMs: WINDOW,
    });
    expect(labelsOf(enriched[0]!)).toEqual([]);
  });

  it("does not cross-link a tool between install and delete of a different bundle", () => {
    const installMs = Date.parse("2025-04-07T13:13:50Z");
    const deleteMs = Date.parse("2025-04-07T14:40:47Z");
    const events = [
      mi({
        kind: "installed",
        bundleId: "org.whispersystems.signal",
        timestampMs: installMs,
        message: "Installing org.whispersystems.signal",
      }),
      mi({
        kind: "deleted",
        bundleId: "com.example.other",
        timestampMs: deleteMs,
        message: "Uninstalling com.example.other",
      }),
    ];
    const enriched = enrichMobileInstallEvents(events, [trollDecryptRow("2025-04-07T14:22:00.000Z")], {
      rules: INSTALL_ENRICHMENT_RULES,
      windowMs: WINDOW,
    });
    expect(labelsOf(enriched.find((e) => e.bundleId.includes("signal"))!)).toEqual([]);
    // Other app's delete still gets nearby tools (dump-then-uninstall heuristic).
    expect(labelsOf(enriched.find((e) => e.bundleId.includes("other"))!)).toContain("TrollDecrypt");
  });

  it("dedupes the same tool label across multiple evidence rows", () => {
    const deleteMs = Date.parse("2025-04-07T14:40:47Z");
    const events = [
      mi({
        kind: "deleted",
        bundleId: "org.whispersystems.signal",
        timestampMs: deleteMs,
        message: "Uninstalling identifier org.whispersystems.signal",
      }),
    ];
    const enriched = enrichMobileInstallEvents(
      events,
      [trollDecryptRow("2025-04-07T14:22:00.000Z"), trollDecryptRow("2025-04-07T14:25:00.000Z")],
      { rules: INSTALL_ENRICHMENT_RULES, windowMs: WINDOW }
    );
    expect(labelsOf(enriched[0]!).filter((l) => l === "TrollDecrypt")).toHaveLength(1);
  });
});
