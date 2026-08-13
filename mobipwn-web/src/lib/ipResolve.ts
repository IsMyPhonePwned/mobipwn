export type IpResolveKind = "ipv4" | "nat64" | "ipv4_mapped" | "ipv6" | "invalid";

export type IpResolveResult = {
  input: string;
  kind: IpResolveKind;
  resolved: string | null;
  enrichable: boolean;
  note: string | null;
};

const NAT64_WKP_PREFIX = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0] as const;

function stripZone(raw: string): string {
  const i = raw.indexOf("%");
  return (i >= 0 ? raw.slice(0, i) : raw).trim();
}

function parseIpv4Dotted(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function expandIpv6Groups(host: string): number[] | null {
  const lower = host.toLowerCase();
  if (!/^[0-9a-f:.]+$/i.test(lower)) return null;
  const [head, tail] = lower.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail !== undefined ? tail.split(":").filter(Boolean) : [];
  if (tail === undefined && headParts.length !== 8) return null;
  const missing = 8 - headParts.length - tailParts.length;
  if (tail !== undefined && missing < 0) return null;
  const groups = [
    ...headParts,
    ...(tail !== undefined ? Array(missing).fill("0") : []),
    ...tailParts,
  ];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    const n = Number.parseInt(g, 16);
    if (!Number.isFinite(n) || n < 0 || n > 0xffff) return null;
    out.push((n >> 8) & 0xff, n & 0xff);
  }
  return out;
}

function nat64PrefixMatch(octets: number[]): boolean {
  return NAT64_WKP_PREFIX.every((b, i) => octets[i] === b);
}

function ipv4MappedMatch(octets: number[]): boolean {
  return (
    octets.slice(0, 10).every((b) => b === 0) &&
    octets[10] === 0xff &&
    octets[11] === 0xff
  );
}

function octetsToIpv4(octets: number[]): string {
  return `${octets[0]}.${octets[1]}.${octets[2]}.${octets[3]}`;
}

function isLikelyPort(s: string): boolean {
  if (!/^\d{1,5}$/.test(s)) return false;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 && n <= 65535;
}

/** Host part of `host:port`, `[ipv6]:port`, or unbracketed `ipv6:port`. */
export function splitHostPort(addr: string): { host: string; port: string } {
  const value = addr.trim();
  if (!value) return { host: "", port: "" };

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end > 0) {
      const host = value.slice(1, end);
      const rest = value.slice(end + 1);
      const port = rest.startsWith(":") ? rest.slice(1).split(/[\s/]/)[0] ?? "" : "";
      return { host: host || "*", port };
    }
  }

  const colonCount = (value.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const colon = value.indexOf(":");
    return { host: value.slice(0, colon), port: value.slice(colon + 1) };
  }

  if (colonCount > 1) {
    const portMatch = value.match(/^(.+):(\d{1,5})$/);
    if (portMatch && isLikelyPort(portMatch[2])) {
      let host = portMatch[1];
      const port = portMatch[2];
      if (!expandIpv6Groups(host) && host.endsWith(":") && value.includes("::")) {
        host = `${host}:`;
      }
      if (expandIpv6Groups(host) || host === "::") {
        return { host, port };
      }
    }
  }

  return { host: value, port: "" };
}

/** Expand compressed IPv6 (`2001:860:de05::` → `2001:860:de05:0:0:0:0:0`). */
export function expandIpv6Literal(host: string): string | null {
  const octets = expandIpv6Groups(stripZone(host.trim()));
  if (!octets) return null;
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((octets[i] << 8) | octets[i + 1]).toString(16));
  }
  return groups.join(":");
}

/** Prefer full IPv6 literal in UI when bugreport uses trailing `::` compression. */
export function formatIpv6ForDisplay(host: string): string {
  const value = host.trim();
  if (!value.includes(":") || value.startsWith("::ffff:")) return value;
  if (!value.includes("::")) return value;
  return expandIpv6Literal(value) ?? value;
}

/** Host part of `host:port`, `[ipv6]:port`, preferring embedded IPv4. */
export function resolveDisplayHost(raw: string): string {
  const value = raw.trim();
  if (!value) return "";

  const { host } = splitHostPort(value);
  const resolved = resolveIpAddress(host);
  return resolved.resolved ?? host;
}

/** Resolve NAT64 WKP, IPv4-mapped, or plain IPv4 for enrichment preview. */
export function resolveIpAddress(raw: string): IpResolveResult {
  const input = raw.trim();
  if (!input || input === "::") {
    return { input, kind: "invalid", resolved: null, enrichable: false, note: null };
  }

  let host = stripZone(input);
  let kind: IpResolveKind = "ipv6";

  if (host.startsWith("::ffff:")) {
    const rest = host.slice("::ffff:".length);
    const dotted = parseIpv4Dotted(rest);
    if (dotted) {
      const resolved = octetsToIpv4(dotted);
      const enrichable = !isPrivateIpv4(dotted);
      return {
        input,
        kind: "ipv4_mapped",
        resolved,
        enrichable,
        note: enrichable ? null : "private or non-routable IPv4",
      };
    }
    host = rest;
    kind = "ipv4_mapped";
  }

  const dotted = parseIpv4Dotted(host);
  if (dotted) {
    const resolved = octetsToIpv4(dotted);
    return {
      input,
      kind: "ipv4",
      resolved,
      enrichable: !isPrivateIpv4(dotted),
      note: isPrivateIpv4(dotted) ? "private or non-routable IPv4" : null,
    };
  }

  const v6 = expandIpv6Groups(host);
  if (!v6) {
    return { input, kind: "invalid", resolved: null, enrichable: false, note: "unparseable address" };
  }

  if (nat64PrefixMatch(v6)) {
    const embedded = v6.slice(12, 16);
    const resolved = octetsToIpv4(embedded);
    return {
      input,
      kind: "nat64",
      resolved,
      enrichable: !isPrivateIpv4(embedded),
      note: isPrivateIpv4(embedded) ? "embedded IPv4 is private" : "NAT64 well-known prefix (64:ff9b::/96)",
    };
  }

  if (ipv4MappedMatch(v6)) {
    const embedded = v6.slice(12, 16);
    const resolved = octetsToIpv4(embedded);
    return {
      input,
      kind: "ipv4_mapped",
      resolved,
      enrichable: !isPrivateIpv4(embedded),
      note: isPrivateIpv4(embedded) ? "embedded IPv4 is private" : null,
    };
  }

  if (host.startsWith("fe80:") || host === "::1") {
    return { input, kind: "ipv6", resolved: null, enrichable: false, note: "link-local or loopback" };
  }

  return { input, kind, resolved: null, enrichable: false, note: "native IPv6 — GeoIP/VT use IPv4 only" };
}

export function splitIpInputs(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
