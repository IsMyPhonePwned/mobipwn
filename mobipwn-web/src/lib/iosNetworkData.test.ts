import { describe, expect, it } from "vitest";
import {
  connectedDomainsFromSources,
  hostFromUrlOrDomain,
  interactionUrlsFromRows,
  knowledgeWebUsageFromRows,
  quarantineUrlsFromRows,
  safariHistoryFromRows,
  screentimeDomainsFromRows,
} from "./iosNetworkData";

describe("hostFromUrlOrDomain", () => {
  it("parses hosts from URLs and bare domains", () => {
    expect(hostFromUrlOrDomain("https://evil.example/path")).toBe("evil.example");
    expect(hostFromUrlOrDomain("evil.example")).toBe("evil.example");
    expect(hostFromUrlOrDomain("10.0.0.1")).toBe("");
  });
});

describe("knowledgeWebUsageFromRows", () => {
  it("reads DIGITAL HEALTH DOMAIN / URL fields", () => {
    const rows = [
      {
        message: "Application Web Usage",
        ext: JSON.stringify({
          apollo_module: "knowledge_app_webusage",
          "APP NAME": "Safari",
          "DIGITAL HEALTH DOMAIN": "news.ycombinator.com",
          "DIGITAL HEALTH URL": "https://news.ycombinator.com/item?id=1",
          "USAGE IN SECONDS": "12",
        }),
      },
    ];
    const out = knowledgeWebUsageFromRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].domain).toBe("news.ycombinator.com");
    expect(out[0].url).toContain("news.ycombinator.com");
  });

  it("includes Safari browsing KnowledgeC modules", () => {
    const rows = [
      {
        message: "Safari Browsing",
        ext: JSON.stringify({
          apollo_module: "knowledge_safari_browsing",
          URL: "https://example.org/a",
          TITLE: "Example",
        }),
      },
    ];
    const out = knowledgeWebUsageFromRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].domain).toBe("example.org");
  });
});

describe("safariHistoryFromRows", () => {
  it("extracts domain from URL", () => {
    const rows = [
      {
        message: "Safari Browsing",
        ext: JSON.stringify({
          apollo_module: "safari_history",
          URL: "https://support.apple.com/kb",
          TITLE: "Support",
          "VISIT COUNT": "3",
        }),
      },
    ];
    const out = safariHistoryFromRows(rows);
    expect(out[0].domain).toBe("support.apple.com");
  });
});

describe("quarantine / screentime / interaction extractors", () => {
  it("reads quarantine origin and data URLs", () => {
    const out = quarantineUrlsFromRows([
      {
        message: "Quarantine",
        ext: JSON.stringify({
          "ORIGIN URL STRING": "https://cdn.evil/pkg.zip",
          "DATA URL STRING": "file:///tmp/pkg.zip",
          "AGENT BUNDLE ID": "com.apple.Safari",
        }),
      },
    ]);
    expect(out[0].originUrl).toContain("cdn.evil");
    expect(out[0].agentBundleId).toBe("com.apple.Safari");
  });

  it("aggregates Screen Time domains", () => {
    const out = screentimeDomainsFromRows([
      { ext: JSON.stringify({ DOMAIN: "maps.google.com", "BUNDLE ID": "com.google.Maps" }) },
      { ext: JSON.stringify({ DOMAIN: "maps.google.com", "BUNDLE ID": "com.google.Maps" }) },
      { ext: JSON.stringify({ DOMAIN: "youtube.com" }) },
    ]);
    expect(out[0].domain).toBe("maps.google.com");
    expect(out[0].hits).toBe(2);
  });

  it("reads interaction content URLs", () => {
    const out = interactionUrlsFromRows([
      {
        ext: JSON.stringify({
          "CONTENT URL": "https://shared.example/doc",
          "DOMAIN IDENTIFIER": "shared.example",
          "CONTEXT TEXT": "Shared link",
        }),
      },
    ]);
    expect(out[0].contentUrl).toContain("shared.example");
  });
});

describe("connectedDomainsFromSources", () => {
  it("merges hosts across parsers", () => {
    const out = connectedDomainsFromSources({
      iocs: [{ kind: "domain", value: "ioc.example", sourceParser: "plists", jsonPath: "" }],
      safari: [
        {
          url: "https://safari.example/",
          domain: "safari.example",
          title: "",
          visitCount: "1",
          timestamp: "",
        },
      ],
      screentime: [
        { domain: "ioc.example", bundleId: "", category: "", timestamp: "", hits: 2 },
      ],
    });
    const ioc = out.find((d) => d.domain === "ioc.example");
    expect(ioc?.sources).toEqual(expect.arrayContaining(["plists", "screentime"]));
    expect(out.some((d) => d.domain === "safari.example")).toBe(true);
  });
});
