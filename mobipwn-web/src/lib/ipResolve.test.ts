import { describe, expect, it } from "vitest";
import { resolveDisplayHost, splitHostPort, formatIpv6ForDisplay } from "@/lib/ipResolve";
import { aggregateNetworkFlows } from "@/lib/networkFlow";

describe("splitHostPort", () => {
  it("parses bracketed IPv6 with port", () => {
    expect(splitHostPort("[2001:860:de05::1]:443")).toEqual({
      host: "2001:860:de05::1",
      port: "443",
    });
  });

  it("parses unbracketed IPv6 with port", () => {
    expect(splitHostPort("2001:860:de05::443")).toEqual({
      host: "2001:860:de05::",
      port: "443",
    });
  });

  it("parses IPv4 with port", () => {
    expect(splitHostPort("51.116.253.169:443")).toEqual({
      host: "51.116.253.169",
      port: "443",
    });
  });

  it("keeps bare IPv6 without port", () => {
    expect(splitHostPort("2001:860:de05::abcd")).toEqual({
      host: "2001:860:de05::abcd",
      port: "",
    });
  });
});

describe("formatIpv6ForDisplay", () => {
  it("expands carrier P-CSCF prefix from bugreport netstat", () => {
    expect(formatIpv6ForDisplay("2001:860:de05::")).toBe("2001:860:de05:0:0:0:0:0");
  });

  it("leaves non-compressed IPv4 unchanged", () => {
    expect(formatIpv6ForDisplay("51.116.253.169")).toBe("51.116.253.169");
  });
});

describe("resolveDisplayHost", () => {
  it("strips port from unbracketed IPv6", () => {
    expect(resolveDisplayHost("2001:860:de05::443")).toBe("2001:860:de05::");
  });

  it("keeps full bracketed IPv6 host", () => {
    expect(resolveDisplayHost("[2a00:1450:4007:80c::200a]:443")).toBe("2a00:1450:4007:80c::200a");
  });
});

describe("aggregateNetworkFlows message fallback", () => {
  it("resolves IPv6 from socket message without truncating to first hextet", () => {
    const links = aggregateNetworkFlows([
      {
        data_type: "android:bugreport:network_socket",
        message: "Socket tcp6 [::]:443 -> 2001:860:de05::abcd:443",
        ext: JSON.stringify({ state: "ESTABLISHED" }),
        bundle_id: "com.example.app",
      },
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]?.target).toBe("2001:860:de05::abcd");
    expect(links[0]?.targetKind).toBe("ip");
  });
});
