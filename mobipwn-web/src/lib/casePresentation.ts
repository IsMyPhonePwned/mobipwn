import type { CaseRecord } from "@/lib/cases";
import { inferCasePlatform, normalizeCasePlatform, type CasePlatform } from "@/lib/caseDashboard";
import { parseApiTimestamp } from "@/lib/formatRelative";

export type CaseOrigin = "collector" | "ingest" | "endpoint" | "demo";

const COLLECTOR_TAGS = new Set(["public-collect", "webusb", "collector"]);

const HIDDEN_TAGS = new Set([
  "ingested",
  "android",
  "ios",
  "endpoint",
  "vector",
  "linux",
  "ironsift",
  "bugreport",
  "sysdiagnose",
  "apk",
  "iphone",
  "ipad",
]);

export const PLATFORM_LABELS: Record<CasePlatform, string> = {
  android: "Android",
  ios: "iOS",
  endpoint: "Endpoint",
};

export const ORIGIN_LABELS: Record<CaseOrigin, string> = {
  collector: "Collector",
  ingest: "Ingest",
  endpoint: "Endpoint",
  demo: "Sample",
};

export function inferCaseOrigin(caseRec: Pick<CaseRecord, "tags" | "event_count">): CaseOrigin {
  const tags = caseRec.tags ?? [];
  if (tags.some((t) => COLLECTOR_TAGS.has(t.trim().toLowerCase()))) {
    return "collector";
  }
  if (tags.includes("ingested") || (caseRec.event_count ?? 0) > 0) {
    const platform = inferCasePlatform(caseRec);
    if (platform === "endpoint") return "endpoint";
    return "ingest";
  }
  return "demo";
}

/** User-facing tags (hide platform/system labels duplicated elsewhere). */
export function displayCaseTags(caseRec: Pick<CaseRecord, "tags" | "ingest_source">): string[] {
  const sourceKey = caseRec.ingest_source?.trim().toLowerCase();
  return (caseRec.tags ?? []).filter((tag) => {
    const lower = tag.trim().toLowerCase();
    if (!lower || HIDDEN_TAGS.has(lower) || COLLECTOR_TAGS.has(lower)) return false;
    if (sourceKey && lower === sourceKey) return false;
    if (normalizeCasePlatform(tag)) return false;
    return true;
  });
}

export function caseIngestSource(caseRec: Pick<CaseRecord, "ingest_source" | "title">): string {
  return caseRec.ingest_source?.trim() || caseRec.title;
}

export type CaseSortKey = "updated" | "created" | "events" | "alerts" | "title";

export const ORIGIN_FILTER_OPTIONS: Array<{ id: CaseOrigin | "all"; label: string }> = [
  { id: "all", label: "All origins" },
  { id: "collector", label: "Collector" },
  { id: "ingest", label: "Ingest" },
  { id: "endpoint", label: "Endpoint" },
  { id: "demo", label: "Sample" },
];

export const PLATFORM_FILTER_OPTIONS: Array<{ id: CasePlatform | "all"; label: string }> = [
  { id: "all", label: "All platforms" },
  { id: "android", label: "Android" },
  { id: "ios", label: "iOS" },
  { id: "endpoint", label: "Endpoint" },
];

export const STATUS_FILTER_OPTIONS = [
  { id: "all", label: "All statuses" },
  { id: "open", label: "Open" },
  { id: "investigating", label: "Investigating" },
  { id: "closed", label: "Closed" },
] as const;

export const SORT_OPTIONS: Array<{ id: CaseSortKey; label: string }> = [
  { id: "updated", label: "Last ingest" },
  { id: "created", label: "First ingest" },
  { id: "events", label: "Most events" },
  { id: "alerts", label: "Most alerts" },
  { id: "title", label: "Title A–Z" },
];

/** Strip boilerplate ingest description suffixes. */
export function caseDescriptionSummary(description: string): string {
  const d = description.trim();
  if (!d) return "";
  const cut = d.split(" — search with ")[0]?.split(" — Search with ")[0];
  return (cut ?? d).trim();
}

export function countCasesByOrigin(
  cases: Array<Pick<CaseRecord, "tags" | "event_count">>
): Record<CaseOrigin, number> {
  const counts: Record<CaseOrigin, number> = {
    collector: 0,
    ingest: 0,
    endpoint: 0,
    demo: 0,
  };
  for (const c of cases) {
    counts[inferCaseOrigin(c)] += 1;
  }
  return counts;
}

export function matchesOriginFilter(
  caseRec: Pick<CaseRecord, "tags" | "event_count">,
  origin: CaseOrigin | "all"
): boolean {
  return origin === "all" || inferCaseOrigin(caseRec) === origin;
}

export function matchesPlatformFilter(
  caseRec: Pick<CaseRecord, "tags">,
  platform: CasePlatform | "all"
): boolean {
  if (platform === "all") return true;
  return inferCasePlatform(caseRec) === platform;
}

/** Prefer last ClickHouse ingest / re-ingest; fall back to first ingest or case timestamps. */
export function caseLastActivityAt(
  caseRec: Pick<CaseRecord, "last_ingest_at" | "first_ingest_at" | "updated_at" | "created_at">
): string {
  return (
    caseRec.last_ingest_at?.trim() ||
    caseRec.first_ingest_at?.trim() ||
    caseRec.updated_at ||
    caseRec.created_at
  );
}

function caseTimeMs(raw: string | null | undefined): number {
  if (!raw?.trim()) return 0;
  const ms = parseApiTimestamp(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function sortCases(cases: CaseRecord[], sort: CaseSortKey): CaseRecord[] {
  const out = [...cases];
  out.sort((a, b) => {
    switch (sort) {
      case "created": {
        const diff =
          caseTimeMs(caseFirstIngestAt(b)) - caseTimeMs(caseFirstIngestAt(a));
        if (diff !== 0) return diff;
        return b.title.localeCompare(a.title, undefined, { sensitivity: "base" });
      }
      case "events":
        return (b.event_count ?? 0) - (a.event_count ?? 0);
      case "alerts":
        return b.alert_count - a.alert_count;
      case "title":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      case "updated":
      default: {
        const diff =
          caseTimeMs(caseLastActivityAt(b)) - caseTimeMs(caseLastActivityAt(a));
        if (diff !== 0) return diff;
        return b.title.localeCompare(a.title, undefined, { sensitivity: "base" });
      }
    }
  });
  return out;
}

export type CaseQuickLink = { to: string; label: string };

export function caseOriginQuickLink(
  caseRec: Pick<CaseRecord, "tags" | "event_count">
): CaseQuickLink | null {
  const origin = inferCaseOrigin(caseRec);
  if (origin === "collector") return { to: "/collector", label: "Collector" };
  if (origin === "endpoint") return { to: "/ironsift", label: "IronSift" };
  if (origin === "ingest") return { to: "/ingest", label: "Ingest" };
  return null;
}

/** True when the source has more than one completed ingest job (includes re-ingest). */
export function caseWasReingested(
  caseRec: Pick<CaseRecord, "ingest_run_count">
): boolean {
  return (caseRec.ingest_run_count ?? 0) > 1;
}

/** Prefer ClickHouse first ingest; fall back to case creation time. */
export function caseFirstIngestAt(
  caseRec: Pick<CaseRecord, "first_ingest_at" | "created_at">
): string {
  const first = caseRec.first_ingest_at?.trim();
  if (first) return first;
  return caseRec.created_at;
}

/** True when last ingest is meaningfully later than first (or multiple runs). */
export function caseHasDistinctLastIngest(
  caseRec: Pick<CaseRecord, "first_ingest_at" | "last_ingest_at" | "created_at" | "ingest_run_count">
): boolean {
  const last = caseRec.last_ingest_at?.trim();
  if (!last) return false;
  if (caseWasReingested(caseRec)) return true;
  const first = caseFirstIngestAt(caseRec);
  const ta = parseApiTimestamp(first).getTime();
  const tb = parseApiTimestamp(last).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return last !== first;
  return Math.abs(tb - ta) > 60_000;
}

export { inferCasePlatform, type CasePlatform } from "@/lib/caseDashboard";
