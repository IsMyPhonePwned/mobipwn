import { describe, expect, it } from "vitest";
import {
  bugreportHeaderLabel,
  parseBuildFingerprint,
} from "@/lib/bugreportHeader";

describe("parseBuildFingerprint", () => {
  it("splits a full AOSP fingerprint into identity parts", () => {
    const fp = parseBuildFingerprint(
      "google/redfin/redfin:13/TQ3A.230805.001/10316531:user/release-keys"
    );
    expect(fp).toEqual({
      brand: "google",
      product: "redfin",
      device: "redfin",
      release: "13",
      buildId: "TQ3A.230805.001",
      incremental: "10316531",
      type: "user",
      tags: "release-keys",
    });
  });

  it("strips surrounding quotes", () => {
    expect(parseBuildFingerprint("'samsung/a51/a51:12/SP1A.210812.016/A515FXX:user/release-keys'").brand).toBe(
      "samsung"
    );
  });
});

describe("bugreportHeaderLabel", () => {
  it("maps opaque dumpstate keys to readable labels", () => {
    expect(bugreportHeaderLabel("Android SDK version")).toBe("SDK level");
    expect(bugreportHeaderLabel("Command line")).toBe("Kernel command line");
    expect(bugreportHeaderLabel("timestamp")).toBe("Captured at");
    expect(bugreportHeaderLabel("Weird Custom Key")).toBe("Weird Custom Key");
  });
});
