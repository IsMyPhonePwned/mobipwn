import { describe, expect, it } from "vitest";
import { formatPlatformTopLabel, formatTopDestIpLabel } from "@/lib/platformCaseTops";

describe("formatTopDestIpLabel", () => {
  it("names unspecified IPv6", () => {
    expect(formatTopDestIpLabel("::")).toBe(":: — unspecified IPv6");
    expect(formatTopDestIpLabel(" ::0 ")).toBe(":: — unspecified IPv6");
  });

  it("names unspecified IPv4", () => {
    expect(formatTopDestIpLabel("0.0.0.0")).toBe("0.0.0.0 — unspecified IPv4");
  });

  it("leaves normal IPs unchanged", () => {
    expect(formatTopDestIpLabel("8.8.8.8")).toBe("8.8.8.8");
  });
});

describe("formatPlatformTopLabel", () => {
  it("only rewrites dest_ip", () => {
    expect(formatPlatformTopLabel("dest_ip", "::")).toContain("unspecified");
    expect(formatPlatformTopLabel("bundle_id", "::")).toBe("::");
  });
});
