import { extField, strField } from "@/lib/rowExt";
import { formatWallTimestamp } from "@/lib/formatRelative";
import type { MobileInstallEvent } from "@/lib/mobileInstallTimeline";

/** Generic related-activity kinds shown beside install/delete rows. */
export type InstallEnrichmentKind = "ipa" | "sideload_tool" | string;

export type InstallEnrichmentNamePattern = {
  pattern: string;
  name: string;
};

/** Serializable rule (Settings + API). */
export type InstallEnrichmentRuleConfig = {
  id: string;
  kind: InstallEnrichmentKind;
  label: string;
  enabled: boolean;
  query_terms: string[];
  match_pattern: string;
  name_patterns: InstallEnrichmentNamePattern[];
};

export type InstallEnrichmentConfig = {
  window_minutes: number;
  rules: InstallEnrichmentRuleConfig[];
};

/** Runtime rule after compiling regexes from settings. */
export type InstallEnrichmentRule = {
  id: string;
  kind: InstallEnrichmentKind;
  label: string;
  queryTerms: string[];
  match: RegExp;
  nameFromHay: (hay: string) => string | null;
};

/** Built-in defaults — mirrors server `default_install_enrichment_config`. */
export const DEFAULT_INSTALL_ENRICHMENT_CONFIG: InstallEnrichmentConfig = {
  window_minutes: 30,
  rules: [
    {
      id: "ipa",
      kind: "ipa",
      label: "IPA",
      enabled: true,
      query_terms: ["message=*.ipa*", "path=*.ipa*", "file_path=*.ipa*"],
      match_pattern: String.raw`\.ipa\b`,
      name_patterns: [{ pattern: String.raw`([\w.-]+\.ipa)\b`, name: "$1" }],
    },
    {
      id: "sideload_tool",
      kind: "sideload_tool",
      label: "Sideload tool",
      enabled: true,
      query_terms: [
        "message=*TrollStore*",
        "message=*trolldecrypt*",
        "message=*TrollDecrypt*",
        "message=*AltStore*",
        "message=*Sideloadly*",
        "message=*Scarlet*",
        "message=*decrypted.ipa*",
        "path=*TrollDecrypt*",
        "file_path=*TrollDecrypt*",
        "process_name=*TrollStore*",
        "process_name=*TrollDecrypt*",
        "process_name=*AltStore*",
        "bundle_id=*trollstore*",
        "bundle_id=*trolldecrypt*",
        "bundle_id=*altstore*",
        'bundle_id="com.fiore.trolldecrypt"',
      ],
      match_pattern:
        String.raw`troll\s*store|trolldecrypt|com\.fiore\.trolldecrypt|alt\s*store|sideloadly|\bscarlet\b|\besign\b|\bfeather\b`,
      name_patterns: [
        { pattern: String.raw`trolldecrypt|com\.fiore\.trolldecrypt`, name: "TrollDecrypt" },
        { pattern: String.raw`troll\s*store`, name: "TrollStore" },
        { pattern: String.raw`alt\s*store`, name: "AltStore" },
        { pattern: String.raw`sideloadly`, name: "Sideloadly" },
        { pattern: String.raw`\bscarlet\b`, name: "Scarlet" },
        { pattern: String.raw`\besign\b`, name: "ESign" },
        { pattern: String.raw`\bfeather\b`, name: "Feather" },
      ],
    },
  ],
};

export const INSTALL_ENRICHMENT_WINDOW_MS = 30 * 60 * 1000;

export type InstallEnrichmentHit = {
  key: string;
  kind: InstallEnrichmentKind;
  ruleId: string;
  label: string;
  detail: string;
  timestamp: string;
  timestampMs: number;
  parser: string;
  searchTerms: string;
};

export type EnrichedMobileInstallEvent = MobileInstallEvent & {
  enrichments: InstallEnrichmentHit[];
};

function applyNameTemplate(template: string, match: RegExpMatchArray): string {
  return template.replace(/\$(\d+)/g, (_, n: string) => match[Number(n)] ?? "");
}

export function normalizeInstallEnrichmentConfig(
  raw: Partial<InstallEnrichmentConfig> | null | undefined
): InstallEnrichmentConfig {
  const window =
    typeof raw?.window_minutes === "number" && raw.window_minutes > 0
      ? Math.min(Math.max(Math.floor(raw.window_minutes), 1), 24 * 60)
      : DEFAULT_INSTALL_ENRICHMENT_CONFIG.window_minutes;
  const rulesIn = Array.isArray(raw?.rules) ? raw!.rules! : [];
  const rules: InstallEnrichmentRuleConfig[] = rulesIn
    .map((r, i) => ({
      id: String(r?.id ?? "").trim() || `rule-${i + 1}`,
      kind: String(r?.kind ?? "sideload_tool").trim().toLowerCase() || "sideload_tool",
      label: String(r?.label ?? "").trim() || String(r?.id ?? "rule"),
      enabled: r?.enabled !== false,
      query_terms: (Array.isArray(r?.query_terms) ? r.query_terms : [])
        .map((t) => String(t).trim())
        .filter(Boolean),
      match_pattern: String(r?.match_pattern ?? "").trim(),
      name_patterns: (Array.isArray(r?.name_patterns) ? r.name_patterns : [])
        .map((p) => ({
          pattern: String(p?.pattern ?? "").trim(),
          name: String(p?.name ?? "").trim(),
        }))
        .filter((p) => p.pattern && p.name),
    }))
    .filter((r) => r.match_pattern);
  return {
    window_minutes: window,
    rules: rules.length ? rules : DEFAULT_INSTALL_ENRICHMENT_CONFIG.rules.map((r) => ({ ...r })),
  };
}

export function compileInstallEnrichmentRules(
  configs: InstallEnrichmentRuleConfig[]
): InstallEnrichmentRule[] {
  const out: InstallEnrichmentRule[] = [];
  for (const cfg of configs) {
    if (cfg.enabled === false) continue;
    let match: RegExp;
    try {
      match = new RegExp(cfg.match_pattern, "i");
    } catch {
      continue;
    }
    const namePatterns = cfg.name_patterns
      .map((p) => {
        try {
          return { re: new RegExp(p.pattern, "i"), name: p.name };
        } catch {
          return null;
        }
      })
      .filter((p): p is { re: RegExp; name: string } => p != null);

    out.push({
      id: cfg.id,
      kind: cfg.kind,
      label: cfg.label,
      queryTerms: cfg.query_terms,
      match,
      nameFromHay: (hay) => {
        for (const p of namePatterns) {
          const m = hay.match(p.re);
          if (m) {
            const named = applyNameTemplate(p.name, m).trim();
            if (named) return named;
          }
        }
        return null;
      },
    });
  }
  return out;
}

/** Compiled default rules (enabled entries from DEFAULT_INSTALL_ENRICHMENT_CONFIG). */
export const INSTALL_ENRICHMENT_RULES: InstallEnrichmentRule[] = compileInstallEnrichmentRules(
  DEFAULT_INSTALL_ENRICHMENT_CONFIG.rules
);

export async function fetchInstallEnrichmentConfig(): Promise<InstallEnrichmentConfig> {
  try {
    const res = await fetch("/api/v1/settings/install_enrichment");
    if (!res.ok) return normalizeInstallEnrichmentConfig(DEFAULT_INSTALL_ENRICHMENT_CONFIG);
    const body = (await res.json()) as Partial<InstallEnrichmentConfig>;
    return normalizeInstallEnrichmentConfig(body);
  } catch {
    return normalizeInstallEnrichmentConfig(DEFAULT_INSTALL_ENRICHMENT_CONFIG);
  }
}

function rowTimeMs(row: Record<string, unknown>): number {
  const datetime = strField(row, "datetime");
  if (datetime) {
    const t = Date.parse(datetime);
    if (!Number.isNaN(t)) return t;
  }
  const ts = strField(row, "timestamp");
  if (!ts) return 0;
  const asDate = Date.parse(
    ts.includes("T") ? ts : ts.replace(" ", "T") + (ts.endsWith("Z") ? "" : "Z")
  );
  if (!Number.isNaN(asDate)) return asDate;
  const n = Number(ts);
  if (!Number.isNaN(n) && n > 0) return n > 1e14 ? Math.floor(n / 1000) : n;
  return 0;
}

function enrichmentHaystack(row: Record<string, unknown>): string {
  return [
    strField(row, "message"),
    strField(row, "path"),
    strField(row, "file_path"),
    extField(row, "path"),
    extField(row, "file_path"),
    strField(row, "process_name"),
    strField(row, "bundle_id"),
    strField(row, "command"),
    strField(row, "command_line"),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Tokens used to link an install row to nearby enrichment activity. */
export function appMatchTokens(bundleId: string, label = ""): string[] {
  const skip = new Set([
    "com",
    "net",
    "org",
    "app",
    "ios",
    "apple",
    "android",
    "mobile",
    "the",
  ]);
  const fromBundle = bundleId
    .toLowerCase()
    .split(".")
    .filter((p) => p.length >= 3 && !skip.has(p));
  const fromLabel = label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !skip.has(t));
  const preferred = fromBundle.slice(-2);
  return [...new Set([...preferred, ...fromLabel, ...fromBundle])];
}

function hayMentionsApp(hay: string, bundleId: string, tokens: string[]): boolean {
  const h = hay.toLowerCase();
  if (bundleId && h.includes(bundleId.toLowerCase())) return true;
  return tokens.some((t) => t.length >= 3 && h.includes(t));
}

type ClassifiedEnrichment = {
  hit: InstallEnrichmentHit;
  hay: string;
};

/** Classify raw search rows into enrichment hits (may emit multiple kinds per row). */
export function classifyInstallEnrichmentRows(
  rows: Record<string, unknown>[],
  rules: InstallEnrichmentRule[] = INSTALL_ENRICHMENT_RULES
): ClassifiedEnrichment[] {
  const out: ClassifiedEnrichment[] = [];
  for (const row of rows) {
    const hay = enrichmentHaystack(row);
    if (!hay.trim()) continue;
    const timestampMs = rowTimeMs(row);
    const parser = strField(row, "parser") || "unknown";
    for (const rule of rules) {
      if (!rule.match.test(hay)) continue;
      const name = rule.nameFromHay(hay)?.trim() || null;
      const label = name || rule.label;
      const detail = strField(row, "message") || strField(row, "path") || strField(row, "file_path");
      const searchTerms =
        rule.kind === "ipa" && name
          ? `message=*${name}*`
          : name
            ? `(message=*${name}* OR process_name=*${name}* OR bundle_id=*${name.toLowerCase()}*)`
            : rule.queryTerms[0] || `message=*${rule.label}*`;
      out.push({
        hay,
        hit: {
          key: `${rule.id}|${timestampMs}|${label}|${detail.slice(0, 40)}`,
          kind: rule.kind,
          ruleId: rule.id,
          label,
          detail,
          timestamp: timestampMs > 0 ? formatWallTimestamp(new Date(timestampMs).toISOString()) : "",
          timestampMs,
          parser,
          searchTerms,
        },
      });
    }
  }
  return out;
}

/**
 * Attach nearby IPA / sideload-tool activity to install/delete events.
 *
 * Heuristics (any may attach):
 * 1. Time proximity + bundle/app token overlap in the enrichment haystack
 * 2. Sideload tools near a reinstall that follows a same-bundle delete
 *    (TrollDecrypt dump → uninstall → TrollStore reinstall)
 * 3. Sideload tools near a **delete** without requiring app tokens
 *    (dump-then-uninstall: tool usage often has no target bundle in the log)
 * 4. Sideload tools between an install and a later same-bundle delete
 *    (tool used against an app that is later removed)
 */
export function enrichMobileInstallEvents(
  events: MobileInstallEvent[],
  enrichmentRows: Record<string, unknown>[],
  opts?: {
    windowMs?: number;
    rules?: InstallEnrichmentRule[];
  }
): EnrichedMobileInstallEvent[] {
  const windowMs = opts?.windowMs ?? INSTALL_ENRICHMENT_WINDOW_MS;
  const classified = classifyInstallEnrichmentRows(enrichmentRows, opts?.rules);

  const nextDeleteAfter = (ev: MobileInstallEvent): MobileInstallEvent | null => {
    if (ev.kind !== "installed" || ev.timestampMs <= 0) return null;
    let best: MobileInstallEvent | null = null;
    for (const other of events) {
      if (other.kind !== "deleted" || other.bundleId !== ev.bundleId) continue;
      if (other.timestampMs <= ev.timestampMs) continue;
      if (!best || other.timestampMs < best.timestampMs) best = other;
    }
    return best;
  };

  return events.map((ev) => {
    const tokens = appMatchTokens(ev.bundleId, ev.label);
    const nearby = classified.filter(
      (c) =>
        ev.timestampMs > 0 &&
        c.hit.timestampMs > 0 &&
        Math.abs(c.hit.timestampMs - ev.timestampMs) <= windowMs
    );

    const direct = nearby.filter((c) => hayMentionsApp(c.hay, ev.bundleId, tokens));
    const hasDirectIpa = direct.some((c) => c.hit.kind === "ipa");
    const reinstallAfterDelete =
      ev.kind === "installed" &&
      events.some(
        (other) =>
          other.kind === "deleted" &&
          other.bundleId === ev.bundleId &&
          other.timestampMs > 0 &&
          ev.timestampMs >= other.timestampMs &&
          ev.timestampMs - other.timestampMs <= windowMs
      );

    const toolsViaContext =
      hasDirectIpa || reinstallAfterDelete
        ? nearby.filter(
            (c) =>
              c.hit.kind === "sideload_tool" &&
              !direct.some((d) => d.hit.key === c.hit.key)
          )
        : [];

    // Dump-then-uninstall: TrollDecrypt / TrollStore usage rarely names the target app.
    const toolsNearDelete =
      ev.kind === "deleted"
        ? nearby.filter(
            (c) =>
              c.hit.kind === "sideload_tool" &&
              !direct.some((d) => d.hit.key === c.hit.key)
          )
        : [];

    // Tool activity between this install and a later same-bundle delete.
    const laterDelete = nextDeleteAfter(ev);
    const toolsBetweenInstallAndDelete =
      laterDelete && laterDelete.timestampMs > 0
        ? classified.filter(
            (c) =>
              c.hit.kind === "sideload_tool" &&
              c.hit.timestampMs > 0 &&
              c.hit.timestampMs >= ev.timestampMs &&
              c.hit.timestampMs <= laterDelete.timestampMs + windowMs &&
              !direct.some((d) => d.hit.key === c.hit.key)
          )
        : [];

    const picked = [
      ...direct,
      ...toolsViaContext,
      ...toolsNearDelete,
      ...toolsBetweenInstallAndDelete,
    ];
    const seen = new Set<string>();
    const enrichments: InstallEnrichmentHit[] = [];
    for (const c of picked) {
      const dedupe = `${c.hit.kind}|${c.hit.label.toLowerCase()}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      enrichments.push(c.hit);
    }
    enrichments.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
    return { ...ev, enrichments };
  });
}

/** Bounded mPL query used by the Installed/deleted apps panel enrichment pass. */
export function installEnrichmentQuery(
  sourceEscaped: string,
  rules: InstallEnrichmentRule[] = INSTALL_ENRICHMENT_RULES
): string {
  const terms = rules.flatMap((r) => r.queryTerms);
  const unique = [...new Set(terms)];
  if (!unique.length) {
    return `source="${sourceEscaped}" message=__no_enrichment_rules__ | head 1`;
  }
  return (
    `source="${sourceEscaped}" (${unique.join(" OR ")}) ` +
    `| fields timestamp, datetime, parser, process_name, bundle_id, message, path, file_path, command, command_line, ext ` +
    `| sort -timestamp | head 500`
  );
}

export function installEnrichmentSearchQuery(scope: string, hit: InstallEnrichmentHit): string {
  return `${scope} ${hit.searchTerms} | fields timestamp, parser, process_name, bundle_id, message, path, file_path | sort timestamp | head 40`;
}

/** Map install-timeline enrichments onto package rows by bundle id. */
export function installContextByBundleId(
  enrichedEvents: EnrichedMobileInstallEvent[]
): Map<string, InstallEnrichmentHit[]> {
  const map = new Map<string, InstallEnrichmentHit[]>();
  for (const ev of enrichedEvents) {
    if (!ev.enrichments.length) continue;
    const prev = map.get(ev.bundleId) ?? [];
    const seen = new Set(prev.map((h) => `${h.kind}|${h.label.toLowerCase()}`));
    const merged = [...prev];
    for (const hit of ev.enrichments) {
      const k = `${hit.kind}|${hit.label.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(hit);
    }
    map.set(ev.bundleId, merged);
  }
  return map;
}

/** @deprecated Prefer {@link installContextByBundleId}. */
export const relatedByBundleId = installContextByBundleId;

export function newEmptyInstallEnrichmentRule(): InstallEnrichmentRuleConfig {
  const id = `rule-${Date.now().toString(36)}`;
  return {
    id,
    kind: "sideload_tool",
    label: "New rule",
    enabled: true,
    query_terms: ["message=*example*"],
    match_pattern: "example",
    name_patterns: [],
  };
}
