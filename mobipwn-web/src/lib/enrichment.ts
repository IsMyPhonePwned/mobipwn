import { splitSearchAndPipeline } from "@/lib/mplQuery";

/** Explicit cron for the Marketplace “every 5 minutes” preset (unset `sync_cron` = manual only). */
export const DEFAULT_SYNC_CRON = "0 */5 * * *";

export function describeSyncCron(config?: Record<string, unknown>): string {
  const raw = config?.sync_cron;
  if (raw == null || raw === "") return "manual only";
  const s = String(raw).trim().toLowerCase();
  if (s === "manual" || s === "disabled" || s === "off") return "manual only";
  if (s === DEFAULT_SYNC_CRON || s === `0 ${DEFAULT_SYNC_CRON}`) return "every 5 minutes";
  if (s === "0 */15 * * *" || s === "0 0/15 * * * *") return "every 15 minutes";
  if (s === "0 * * * *" || s === "0 0 * * * *") return "every hour";
  if (s === "0 */6 * * *") return "every 6 hours";
  if (s === "0 0 * * *" || s === "0 0 0 * * *") return "daily";
  return s;
}

export type EnrichmentProvider = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  enabled: boolean;
  covers_fields: string[];
  config?: Record<string, unknown>;
  last_sync_at?: string;
  last_sync_status?: string;
  last_sync_error?: string;
  enriched_field_count?: number;
  enriched_fields?: string[];
};

export type LookupStage = {
  field: string;
  command: string;
  columns: string[];
};

const BLOCKED_PIPE_RE = /\b(timechart|dedup|join)\b/i;
const ENRICHMENT_COLS_HIDDEN_KEY = "mobipwn-search-hidden-enrichment-cols";

const GEO_FIELDS = ["src_ip", "dest_ip"] as const;
const VT_FIELDS = ["src_ip", "dest_ip", "destination_domain", "file_hash"] as const;
const PLAY_FIELDS = ["bundle_id"] as const;

export function playLookupColumns(): string[] {
  return ["play_on_play_store", "play_store_url", "play_app_title"];
}

/** VT analysis stat columns emitted per lookup field (matches ClickHouse ioc_enrichments). */
export const VT_STAT_SUFFIXES = [
  "malicious",
  "harmless",
  "undetected",
  "suspicious",
  "reputation",
] as const;

export function vtLookupColumns(field: string): string[] {
  return VT_STAT_SUFFIXES.map((s) => `vt_${field}_${s}`);
}

/** Fields checked (in order) when building the compact `vt_label` column. */
export const VT_LABEL_FIELDS = ["dest_ip", "src_ip", "destination_domain", "file_hash"] as const;

function vtNum(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** One-line VT summary from split stat columns. */
export function formatVtFieldSummary(row: Record<string, unknown>, field: string): string {
  const mal = vtNum(row[`vt_${field}_malicious`]);
  const susp = vtNum(row[`vt_${field}_suspicious`]);
  const harm = vtNum(row[`vt_${field}_harmless`]);
  const undet = vtNum(row[`vt_${field}_undetected`]);
  const rep = vtNum(row[`vt_${field}_reputation`]);

  if (mal === 0 && susp === 0 && harm === 0 && undet === 0 && rep === 0) {
    const legacy = row[`vt_${field}_malware_family`];
    if (legacy != null && String(legacy).trim()) return String(legacy);
    return "";
  }

  const parts: string[] = [];
  parts.push(`${mal} malicious`);
  if (susp > 0) parts.push(`${susp} suspicious`);
  if (harm > 0) parts.push(`${harm} harmless`);
  if (undet > 0) parts.push(`${undet} undetected`);
  if (rep !== 0) parts.push(`rep ${rep}`);
  return parts.join(" · ");
}

export function isEnrichmentColumn(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    name === "vt_label" ||
    /^(geo|ioc|lookup|vt|play)_[a-z0-9_]+$/i.test(name) ||
    lower.endsWith("_country") ||
    lower.endsWith("_city") ||
    lower.endsWith("_malware_family") ||
    lower.endsWith("_score")
  );
}

/** Best-effort VT label from per-field enrichment columns on a result row. */
export function pickVtLabel(row: Record<string, unknown>): string {
  for (const field of VT_LABEL_FIELDS) {
    const summary = formatVtFieldSummary(row, field);
    if (summary) return summary;
  }
  return "";
}

export function enrichRowsWithVtLabel<T extends Record<string, unknown>>(rows: T[]): T[] {
  let changed = false;
  const next = rows.map((row) => {
    const label = pickVtLabel(row);
    if (!label) return row;
    changed = true;
    return { ...row, vt_label: label };
  });
  return changed ? next : rows;
}

/** Build lookup pipeline stages from enabled marketplace providers. */
export function enrichmentLookupStages(providers: EnrichmentProvider[]): LookupStage[] {
  const stages: LookupStage[] = [];
  const seen = new Set<string>();

  const push = (field: string, command: string, columns: string[]) => {
    const key = command.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    stages.push({ field, command, columns });
  };

  for (const p of providers) {
    if (!p.enabled) continue;
    if (p.slug === "geo_lite") {
      if (p.covers_fields.includes("src_ip")) {
        push("src_ip", "lookup src_ip", ["lookup_country", "lookup_city"]);
      }
      if (p.covers_fields.includes("dest_ip")) {
        push("dest_ip", "lookup geo dest_ip", ["geo_country", "geo_city"]);
      }
    }
    if (p.slug === "virustotal") {
      for (const field of VT_FIELDS) {
        if (p.covers_fields.includes(field)) {
          push(field, `lookup vt ${field}`, vtLookupColumns(field));
        }
      }
    }
    if (p.slug === "threatfox" && p.covers_fields.includes("file_hash")) {
      push("file_hash", "lookup file_hash", ["lookup_malware_family", "lookup_score"]);
    }
    if (p.slug === "google_play") {
      for (const field of PLAY_FIELDS) {
        if (p.covers_fields.includes(field)) {
          push(field, `lookup play ${field}`, playLookupColumns());
        }
      }
    }
  }

  return stages;
}

export function enrichableLookupFields(providers: EnrichmentProvider[]): string[] {
  const fields = new Set<string>();
  for (const stage of enrichmentLookupStages(providers)) {
    fields.add(stage.field);
  }
  return [...fields];
}

export function lookupColumnsForStages(stages: LookupStage[], field: string): string[] {
  const cols: string[] = [];
  for (const s of stages) {
    if (s.field === field) cols.push(...s.columns);
  }
  return cols;
}

function pipelineParts(pipeline: string): string[] {
  if (!pipeline.trim()) return [];
  return pipeline
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseFieldsList(fieldsPart: string): string[] {
  const match = fieldsPart.match(/^fields\s+(.+)$/i);
  if (!match) return [];
  return match[1]
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function augmentFieldsPart(fieldsPart: string, stages: LookupStage[]): string {
  const names = parseFieldsList(fieldsPart);
  if (!names.length) return fieldsPart;
  const have = new Set(names.map((n) => n.toLowerCase()));
  const extra: string[] = [];
  for (const stage of stages) {
    if (!have.has(stage.field.toLowerCase())) {
      extra.push(stage.field);
      have.add(stage.field.toLowerCase());
    }
    for (const col of stage.columns) {
      if (!have.has(col.toLowerCase())) {
        extra.push(col);
        have.add(col.toLowerCase());
      }
    }
  }
  if (!extra.length) return fieldsPart;
  return `fields ${[...names, ...extra].join(", ")}`;
}

function insertIndexForLookups(parts: string[]): number {
  const fieldsIdx = parts.findIndex((p) => /^fields\b/i.test(p));
  if (fieldsIdx >= 0) return fieldsIdx;
  const headIdx = parts.findIndex((p) => /^(head|sort)\b/i.test(p));
  if (headIdx >= 0) return headIdx;
  return parts.length;
}

function existingLookupCommands(parts: string[]): Set<string> {
  return new Set(parts.filter((p) => /^lookup\b/i.test(p)).map((p) => p.toLowerCase()));
}

export function augmentStatsByClause(statsPart: string, stages: LookupStage[]): string {
  const byM = statsPart.match(/\bby\s+(.+)$/i);
  if (!byM) return statsPart;

  const byFields = byM[1].split(",").map((s) => s.trim()).filter(Boolean);
  const have = new Set(byFields.map((f) => f.toLowerCase()));
  const extra: string[] = [];

  for (const f of byFields) {
    for (const col of lookupColumnsForStages(stages, f)) {
      if (!have.has(col.toLowerCase())) {
        extra.push(col);
        have.add(col.toLowerCase());
      }
    }
  }

  if (!extra.length) return statsPart;
  const newBy = [...byFields, ...extra].join(", ");
  return statsPart.replace(/\bby\s+.+$/i, `by ${newBy}`);
}

/** Apply marketplace lookup stages when enrichments are enabled and providers are known. */
export function buildEnrichedQuery(
  query: string,
  providers: EnrichmentProvider[],
  enabled = true
): string {
  if (!enabled) return query;
  return applyEnrichmentLookups(query, providers);
}

/** Column order for search results: core fields first, VT summary next to dest_ip, then other enrichments. */
export function orderSearchResultColumns(colKeys: string[]): string[] {
  if (!colKeys.length) return colKeys;
  const have = new Set(colKeys);
  const enrich = colKeys.filter(isEnrichmentColumn);
  const core = colKeys.filter((c) => !isEnrichmentColumn(c));

  const priorityEnrich = [
    "vt_label",
    ...vtLookupColumns("dest_ip"),
    ...vtLookupColumns("src_ip"),
    "lookup_country",
    "lookup_city",
    "geo_country",
    "geo_city",
    ...vtLookupColumns("destination_domain"),
    ...vtLookupColumns("file_hash"),
  ];
  const sortedEnrich = [
    ...priorityEnrich.filter((c) => have.has(c)),
    ...enrich.filter((c) => !priorityEnrich.includes(c)),
  ];

  const destIdx = core.indexOf("dest_ip");
  if (destIdx >= 0) {
    const besideDest = sortedEnrich.filter((c) => c === "vt_label" || c.startsWith("vt_dest_ip"));
    const restEnrich = sortedEnrich.filter((c) => !besideDest.includes(c));
    return [
      ...core.slice(0, destIdx + 1),
      ...besideDest,
      ...core.slice(destIdx + 1),
      ...restEnrich,
    ];
  }

  return [...core.slice(0, 12), ...sortedEnrich];
}

export function applyEnrichmentLookups(query: string, providers: EnrichmentProvider[]): string {
  const stages = enrichmentLookupStages(providers);
  if (!stages.length) return query;

  const { search, pipeline } = splitSearchAndPipeline(query);
  const parts = pipelineParts(pipeline);
  if (parts.some((p) => BLOCKED_PIPE_RE.test(p))) return query;

  const have = existingLookupCommands(parts);
  const toAdd = stages.map((s) => s.command).filter((c) => !have.has(c.toLowerCase()));

  const statsIdx = parts.findIndex((p) => /^stats\b/i.test(p));

  if (statsIdx >= 0) {
    const statsPart = parts[statsIdx];
    const byM = statsPart.match(/\bby\s+(.+)$/i);
    const byFields = byM
      ? byM[1].split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const relevant = stages.filter((s) => byFields.includes(s.field));
    const statsLookups = relevant
      .map((s) => s.command)
      .filter((c) => !have.has(c.toLowerCase()));
    if (statsLookups.length) parts.splice(statsIdx, 0, ...statsLookups);
    const statsPartIdx = statsIdx + statsLookups.length;
    const augmented = augmentStatsByClause(parts[statsPartIdx], relevant.length ? relevant : stages);
    if (!statsLookups.length && augmented === statsPart) return query;
    parts[statsPartIdx] = augmented;
  } else if (toAdd.length) {
    const insertIdx = insertIndexForLookups(parts);
    parts.splice(insertIdx, 0, ...toAdd);
    const addedStages = stages.filter((s) => toAdd.includes(s.command));
    const fieldsIdx = parts.findIndex((p) => /^fields\b/i.test(p));
    if (fieldsIdx >= 0 && addedStages.length) {
      parts[fieldsIdx] = augmentFieldsPart(parts[fieldsIdx], addedStages);
    }
  } else {
    return query;
  }

  const pipe = parts.map((p) => `| ${p}`).join(" ");
  return search ? `${search} ${pipe}` : pipe.trim();
}

export function enrichmentColumnLabel(col: string): string {
  if (col === "vt_label") return "VT summary";
  const vtStat = col.match(/^vt_(.+)_((?:malicious|harmless|undetected|suspicious|reputation))$/);
  if (vtStat) {
    const field = vtStat[1].replace(/_/g, " ");
    const stat = vtStat[2];
    return `VT ${field} ${stat}`;
  }
  const vtField = col.match(/^vt_(.+)_malware_family$/);
  if (vtField) return `VT ${vtField[1].replace(/_/g, " ")} label`;
  if (col.match(/^vt_.+_score$/)) return col.replace(/^vt_(.+)_score$/, "VT $1 score").replace(/_/g, " ");
  if (col.startsWith("vt_")) return col.replace(/^vt_/, "VT ");
  if (col.startsWith("geo_")) return col.replace(/^geo_/, "Geo ");
  if (col.startsWith("lookup_")) return col.replace(/^lookup_/, "");
  if (col.startsWith("ioc_")) return col.replace(/^ioc_/, "IOC ");
  return col;
}

/** Enrichment columns present in a result set. */
export function enrichmentColumnsIn(columns: string[]): string[] {
  return columns.filter(isEnrichmentColumn);
}

export function loadHiddenEnrichmentColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(ENRICHMENT_COLS_HIDDEN_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}

export function saveHiddenEnrichmentColumns(hidden: Set<string>): void {
  try {
    localStorage.setItem(ENRICHMENT_COLS_HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    /* ignore */
  }
}

/** Config fields to show in marketplace UI per provider slug. */
export function providerConfigFields(slug: string): Array<{
  key: string;
  label: string;
  type: "text" | "password" | "number";
  placeholder?: string;
}> {
  if (slug === "virustotal") {
    return [
      { key: "api_key", label: "API key", type: "password", placeholder: "VirusTotal API key" },
      { key: "max_indicators_per_type", label: "Max indicators per type", type: "number" },
      { key: "lookback_days", label: "Lookback (days)", type: "number", placeholder: "90 (matches event retention)" },
      { key: "request_delay_ms", label: "Delay between requests (ms)", type: "number", placeholder: "15000 free tier, 0 to disable" },
    ];
  }
  if (slug === "geo_lite") {
    return [
      { key: "csv_path", label: "GeoIP CSV path", type: "text", placeholder: "/path/to/geoip.csv" },
    ];
  }
  if (slug === "google_play") {
    return [
      { key: "max_packages", label: "Max packages per sync", type: "number", placeholder: "50" },
      { key: "lookback_days", label: "Lookback (days)", type: "number", placeholder: "90" },
      { key: "request_delay_ms", label: "Delay between requests (ms)", type: "number", placeholder: "500" },
      {
        key: "test_package",
        label: "Test package (optional)",
        type: "text",
        placeholder: "com.ubergeek42.WeechatAndroid.dev",
      },
    ];
  }
  return [];
}

export function maskConfigForDisplay(
  slug: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...config };
  if (slug === "virustotal" && typeof out.api_key === "string" && out.api_key.length > 4) {
    out.api_key = `${"•".repeat(8)}${out.api_key.slice(-4)}`;
  }
  return out;
}
