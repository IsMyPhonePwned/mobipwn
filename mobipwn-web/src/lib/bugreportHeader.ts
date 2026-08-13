/** One key/value pair from a bugreport `Header` parser message. */
export type BugreportHeaderField = {
  key: string;
  value: string;
};

const BUGREPORT_PREFIX = /^Bugreport header:\s*/i;

/** Split `Bugreport header: Key=value, Key2=value2` on key boundaries (values may contain commas). */
export function parseBugreportHeaderMessage(raw: string): BugreportHeaderField[] {
  let text = raw.trim();
  if (!text) return [];
  text = text.replace(BUGREPORT_PREFIX, "");

  const fields: BugreportHeaderField[] = [];
  const parts = text.split(/,\s*(?=[A-Za-z][A-Za-z0-9 /_-]*=)/);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    if (key) fields.push({ key, value: normalizeHeaderFieldValue(value) });
  }
  return fields;
}

/** Clean dumpstate header values (trailing commas, lone ","). */
export function normalizeHeaderFieldValue(value: string): string {
  let v = value.trim();
  while (v.endsWith(",") && v.length > 1) {
    v = v.slice(0, -1).trimEnd();
  }
  if (v === "," || !v) return "";
  return v;
}

export function bugreportHeaderMap(fields: BugreportHeaderField[]): Map<string, string> {
  return new Map(fields.map((f) => [f.key.toLowerCase(), f.value]));
}

export function isBugreportHeaderMessage(message: string): boolean {
  return BUGREPORT_PREFIX.test(message.trim());
}

const HEADER_EXT_SKIP = new Set([
  "event_type",
  "function",
  "file_path",
  "destination_domain",
  "remote_ip",
  "email",
  "installer",
]);

function extValueToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => extValueToString(v)).filter(Boolean).join("\n");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Parse `ext` JSON from a Header parser search row. */
export function parseHeaderExt(row: Record<string, unknown>): Record<string, string> {
  const raw = row.ext;
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (HEADER_EXT_SKIP.has(key)) continue;
    const text = extValueToString(value);
    if (text) out[key] = text;
  }
  return out;
}

/** Merge Header row `ext` and parsed `message` into display fields (ext wins). */
export function headerFieldsFromRow(row: Record<string, unknown>): BugreportHeaderField[] {
  const fromExt = parseHeaderExt(row);
  const message = typeof row.message === "string" ? row.message : "";
  const fromMessage = isBugreportHeaderMessage(message) ? parseBugreportHeaderMessage(message) : [];

  const map = new Map<string, string>();
  for (const f of fromMessage) {
    const value = normalizeHeaderFieldValue(f.value);
    if (value) map.set(f.key.toLowerCase(), value);
  }
  for (const [key, value] of Object.entries(fromExt)) {
    const cleaned = normalizeHeaderFieldValue(value);
    if (cleaned) map.set(key.toLowerCase(), cleaned);
  }

  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  const pushKey = (key: string) => {
    const lower = key.toLowerCase();
    if (!map.has(lower) || seen.has(lower)) return;
    seen.add(lower);
    orderedKeys.push(key);
  };

  for (const key of [...BUGREPORT_HEADER_PRIMARY, ...BUGREPORT_HEADER_DETAILS, "Build", "Build fingerprint"]) {
    pushKey(key);
  }
  for (const f of fromMessage) pushKey(f.key);
  for (const key of Object.keys(fromExt)) pushKey(key);

  return orderedKeys.map((key) => ({
    key,
    value: map.get(key.toLowerCase()) ?? "",
  }));
}

export function parseBuildFingerprint(fingerprint: string): {
  brand?: string;
  product?: string;
  device?: string;
  release?: string;
  buildId?: string;
  incremental?: string;
  type?: string;
  tags?: string;
} {
  const trimmed = fingerprint.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return {};
  // brand/product/device:release/id/incremental:type/tags
  const firstColon = trimmed.indexOf(":");
  if (firstColon < 0) return {};
  const left = trimmed.slice(0, firstColon);
  const rest = trimmed.slice(firstColon + 1);
  const lastColon = rest.lastIndexOf(":");
  const releasePart = lastColon >= 0 ? rest.slice(0, lastColon) : rest;
  const typePart = lastColon >= 0 ? rest.slice(lastColon + 1) : "";
  const [brand, product, device] = left.split("/");
  const [release, buildId, incremental] = releasePart.split("/");
  const [type, tags] = typePart.split("/");
  return {
    brand: brand || undefined,
    product: product || undefined,
    device: device || undefined,
    release: release || undefined,
    buildId: buildId || undefined,
    incremental: incremental || undefined,
    type: type || undefined,
    tags: tags || undefined,
  };
}

/** Friendly display labels for dumpstate header keys. */
export const BUGREPORT_HEADER_LABELS: Record<string, string> = {
  network: "Network",
  radio: "Radio baseband",
  bootloader: "Bootloader",
  uptime: "Uptime",
  timestamp: "Captured at",
  "bugreport format version": "Bugreport format",
  "android sdk version": "SDK level",
  kernel: "Kernel",
  bootconfig: "Boot config",
  "command line": "Kernel command line",
  "dumpstate info": "Dumpstate info",
  "module metadata version": "Module metadata",
  "sdk extensions": "SDK extensions",
  build: "Build",
  "build fingerprint": "Build fingerprint",
};

export function bugreportHeaderLabel(key: string): string {
  const lower = key.toLowerCase();
  return BUGREPORT_HEADER_LABELS[lower] ?? key;
}

/** Primary fields shown in the device summary grid. */
export const BUGREPORT_HEADER_PRIMARY: string[] = [
  "Network",
  "Radio",
  "Bootloader",
  "Bugreport format version",
];

/** Long values shown in a collapsible section. */
export const BUGREPORT_HEADER_DETAILS: string[] = [
  "Kernel",
  "Bootconfig",
  "Command line",
  "Dumpstate info",
  "Module Metadata version",
  "SDK extensions",
];

export type ParsedLinuxKernel = {
  version: string;
  versionBase: string;
  androidRelease: string;
  androidPatch: string;
  buildId: string;
  suffix: string;
  buildHost: string;
  androidBuild: string;
  toolchainFlags: string;
  clangVersion: string;
  lldVersion: string;
  toolchainRevision: string;
  buildNumber: string;
  kernelFlags: string;
  buildDate: string;
  raw: string;
};

export type KeyValueToken = {
  key: string;
  value: string;
};

function extractBalancedParen(input: string, openIndex: number): { inner: string; end: number } | null {
  if (input[openIndex] !== "(") return null;
  let depth = 0;
  for (let i = openIndex; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return { inner: input.slice(openIndex + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

/** Split `6.6.50-android15-8-abA346BXXSBDYI1-4k` into display-friendly parts. */
export function parseKernelVersionParts(version: string): {
  base: string;
  androidRelease: string;
  androidPatch: string;
  buildId: string;
  suffix: string;
} {
  const trimmed = version.trim();
  const match = trimmed.match(/^([\d.]+)-android(\d+)-(\d+)-([A-Za-z0-9]+)(?:-(.+))?$/);
  if (!match) {
    return { base: trimmed, androidRelease: "", androidPatch: "", buildId: "", suffix: "" };
  }
  return {
    base: match[1],
    androidRelease: match[2],
    androidPatch: match[3],
    buildId: match[4],
    suffix: match[5] ?? "",
  };
}

function parseToolchainBlock(toolchain: string): {
  androidBuild: string;
  toolchainFlags: string;
  clangVersion: string;
  lldVersion: string;
  toolchainRevision: string;
} {
  const androidMatch = toolchain.match(/Android\s*\(([^)]+)\)/i);
  const androidInner = androidMatch?.[1] ?? "";
  const androidBuild = androidInner.match(/^(\d+)/)?.[1] ?? "";
  const flags = androidInner
    .replace(/^\d+,?\s*/, "")
    .replace(/,?\s*based on\s+r\d+$/i, "")
    .trim();
  const revision = androidInner.match(/based on\s+(r\d+)/i)?.[1] ?? "";
  const clangVersion = toolchain.match(/clang version\s+([\d.]+)/i)?.[1] ?? "";
  const lldVersion = toolchain.match(/LLD\s+([\d.]+)/i)?.[1] ?? "";
  return {
    androidBuild,
    toolchainFlags: flags,
    clangVersion,
    lldVersion,
    toolchainRevision: revision,
  };
}

function parseKernelTail(tail: string): { buildNumber: string; kernelFlags: string; buildDate: string } {
  const trimmed = tail.trim();
  const buildNumber = trimmed.match(/^(#\d+)/)?.[1] ?? "";
  const dateMatch = trimmed.match(
    /((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\w+\s+\d{4})\s*$/
  );
  const buildDate = dateMatch?.[1] ?? "";
  let kernelFlags = trimmed;
  if (buildNumber) kernelFlags = kernelFlags.slice(buildNumber.length).trim();
  if (buildDate) kernelFlags = kernelFlags.slice(0, kernelFlags.length - buildDate.length).trim();
  return { buildNumber, kernelFlags, buildDate };
}

/** Parse a dumpstate `Linux version …` uname string into structured fields. */
export function parseLinuxKernelString(raw: string): ParsedLinuxKernel | null {
  const value = raw.trim();
  if (!/^Linux version\s+/i.test(value)) return null;

  let rest = value.replace(/^Linux version\s+/i, "").trim();
  const versionEnd = rest.search(/\s+\(/);
  const version = versionEnd >= 0 ? rest.slice(0, versionEnd).trim() : rest;
  const versionParts = parseKernelVersionParts(version);

  const empty: ParsedLinuxKernel = {
    version,
    versionBase: versionParts.base,
    androidRelease: versionParts.androidRelease,
    androidPatch: versionParts.androidPatch,
    buildId: versionParts.buildId,
    suffix: versionParts.suffix,
    buildHost: "",
    androidBuild: "",
    toolchainFlags: "",
    clangVersion: "",
    lldVersion: "",
    toolchainRevision: "",
    buildNumber: "",
    kernelFlags: "",
    buildDate: "",
    raw: value,
  };

  if (versionEnd < 0) return empty;

  rest = rest.slice(versionEnd).trim();
  const hostGroup = extractBalancedParen(rest, 0);
  if (!hostGroup) return empty;
  empty.buildHost = hostGroup.inner.trim();

  rest = rest.slice(hostGroup.end).trim();
  const toolchainGroup = extractBalancedParen(rest, 0);
  if (!toolchainGroup) return empty;

  const toolchain = parseToolchainBlock(toolchainGroup.inner);
  empty.androidBuild = toolchain.androidBuild;
  empty.toolchainFlags = toolchain.toolchainFlags;
  empty.clangVersion = toolchain.clangVersion;
  empty.lldVersion = toolchain.lldVersion;
  empty.toolchainRevision = toolchain.toolchainRevision;

  const tail = rest.slice(toolchainGroup.end).trim();
  const tailParts = parseKernelTail(tail);
  empty.buildNumber = tailParts.buildNumber;
  empty.kernelFlags = tailParts.kernelFlags;
  empty.buildDate = tailParts.buildDate;
  return empty;
}

/** Short label for a kernel string (used in collapsed summary). */
export function kernelSummaryLabel(raw: string): string {
  const parsed = parseLinuxKernelString(raw);
  if (!parsed) return raw.length > 48 ? `${raw.slice(0, 48)}…` : raw;
  const parts = [parsed.versionBase || parsed.version];
  if (parsed.androidRelease) parts.push(`Android ${parsed.androidRelease}`);
  if (parsed.buildId) parts.push(parsed.buildId);
  return parts.join(" · ");
}

/** Split boot args / dumpstate tokens on whitespace, respecting quotes. */
export function splitShellTokens(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Parse `key=value` tokens from command line or dumpstate info strings. */
export function parseKeyValueTokens(raw: string): KeyValueToken[] {
  const text = raw.trim().replace(/^(Command line|Bootconfig|Dumpstate info):\s*/i, "");
  if (!text) return [];
  return splitShellTokens(text)
    .map((token) => {
      const eq = token.indexOf("=");
      if (eq <= 0) return { key: token, value: "" };
      return { key: token.slice(0, eq), value: token.slice(eq + 1) };
    })
    .filter((token) => token.key);
}
