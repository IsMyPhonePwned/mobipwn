import type { SyncSummary } from "@/components/marketplace/MarketplaceSyncPanel";

export type SyncStats = {
  queued?: number;
  api_requests?: number;
  api_ok?: number;
  api_miss?: number;
  api_errors?: number;
  skipped_already_enriched?: number;
  skipped_invalid?: number;
  skipped_duplicate?: number;
  rows_written?: number;
  mode?: string;
};

export type SyncProgressEvent = {
  kind: string;
  message: string;
  slug?: string;
  field?: string;
  indicator?: string;
  stats?: SyncStats;
};

export type CleanSummary = {
  scope: string;
  tables_truncated: string[];
  dictionaries_reloaded: boolean;
};

export class SyncCancelledError extends Error {
  constructor() {
    super("sync cancelled");
    this.name = "SyncCancelledError";
  }
}

type DoneLine = {
  kind: "done";
  summary: SyncSummary;
};

function isDoneLine(parsed: SyncProgressEvent | DoneLine): parsed is DoneLine {
  return parsed.kind === "done";
}

function parseStats(raw: unknown): SyncStats | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const num = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : undefined);
  const stats: SyncStats = {
    queued: num("queued"),
    api_requests: num("api_requests"),
    api_ok: num("api_ok"),
    api_miss: num("api_miss"),
    api_errors: num("api_errors"),
    skipped_already_enriched: num("skipped_already_enriched"),
    skipped_invalid: num("skipped_invalid"),
    skipped_duplicate: num("skipped_duplicate"),
    rows_written: num("rows_written"),
    mode: typeof o.mode === "string" ? o.mode : undefined,
  };
  return Object.values(stats).some((v) => v !== undefined) ? stats : undefined;
}

function parseLine(line: string): SyncProgressEvent | DoneLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const obj = JSON.parse(trimmed) as Record<string, unknown>;
  if (obj.kind === "done" && obj.summary && typeof obj.summary === "object") {
    return { kind: "done", summary: obj.summary as SyncSummary };
  }
  if (typeof obj.kind === "string" && typeof obj.message === "string") {
    return {
      kind: obj.kind,
      message: obj.message,
      slug: typeof obj.slug === "string" ? obj.slug : undefined,
      field: typeof obj.field === "string" ? obj.field : undefined,
      indicator: typeof obj.indicator === "string" ? obj.indicator : undefined,
      stats: parseStats(obj.stats),
    };
  }
  return null;
}

function isAbortError(e: unknown): boolean {
  return (
    e instanceof SyncCancelledError ||
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

/** Stream marketplace sync progress as NDJSON lines from the API. */
export async function streamMarketplaceSync(
  onEvent: (event: SyncProgressEvent) => void,
  signal?: AbortSignal,
  opts?: { fullResync?: boolean }
): Promise<SyncSummary> {
  return streamEnrichmentSync("/api/v1/marketplace/sync/stream", onEvent, signal, opts);
}

/** Stream sync progress for a single enrichment provider. */
export async function streamProviderSync(
  providerId: string,
  onEvent: (event: SyncProgressEvent) => void,
  signal?: AbortSignal,
  opts?: { fullResync?: boolean }
): Promise<SyncSummary> {
  return streamEnrichmentSync(
    `/api/v1/marketplace/providers/${providerId}/sync/stream`,
    onEvent,
    signal,
    opts
  );
}

async function streamEnrichmentSync(
  url: string,
  onEvent: (event: SyncProgressEvent) => void,
  signal?: AbortSignal,
  opts?: { fullResync?: boolean }
): Promise<SyncSummary> {
  const res = await fetch(url, {
    method: "POST",
    headers: opts?.fullResync ? { "Content-Type": "application/json" } : undefined,
    body: opts?.fullResync ? JSON.stringify({ full_resync: true }) : undefined,
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error("No response body from sync stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let summary: SyncSummary | null = null;

  try {
    for (;;) {
      if (signal?.aborted) throw new SyncCancelledError();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseLine(line);
        if (!parsed) continue;
        if (isDoneLine(parsed)) {
          summary = parsed.summary;
        } else {
          onEvent(parsed);
        }
      }
    }

    if (buffer.trim()) {
      const parsed = parseLine(buffer);
      if (parsed && isDoneLine(parsed)) summary = parsed.summary;
      else if (parsed) onEvent(parsed);
    }
  } catch (e) {
    if (isAbortError(e)) throw new SyncCancelledError();
    throw e;
  } finally {
    reader.releaseLock();
  }

  if (signal?.aborted) throw new SyncCancelledError();

  if (!summary) {
    throw new Error("Sync stream ended without a completion summary");
  }
  return summary;
}

export async function cleanMarketplaceEnrichments(slug?: string): Promise<CleanSummary> {
  const res = await fetch("/api/v1/marketplace/clean", {
    method: "POST",
    headers: slug ? { "Content-Type": "application/json" } : undefined,
    body: slug ? JSON.stringify({ slug }) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as CleanSummary;
}

export async function cleanProviderEnrichments(providerId: string): Promise<CleanSummary> {
  const res = await fetch(`/api/v1/marketplace/providers/${providerId}/clean`, {
    method: "POST",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as CleanSummary;
}

const VERBOSE_KINDS = new Set(["skip", "query_miss", "wait", "collect", "collect_done"]);

export function isVerboseSyncEvent(kind: string): boolean {
  return VERBOSE_KINDS.has(kind);
}

export function syncEventKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    mode: "mode",
    start: "start",
    plan: "plan",
    collect: "scan",
    collect_done: "scan",
    query: "API",
    query_ok: "OK",
    query_miss: "miss",
    query_err: "err",
    write: "write",
    skip: "skip",
    wait: "wait",
    stats: "stats",
    provider_start: "start",
    provider_done: "done",
    provider_error: "err",
    skipped: "skip",
    dict_reload: "dict",
    complete: "done",
    cancelled: "stop",
    error: "err",
  };
  return labels[kind] ?? kind;
}

export function syncEventClass(kind: string): string {
  if (
    kind === "query_ok" ||
    kind === "write" ||
    kind === "provider_done" ||
    kind === "complete" ||
    kind === "stats"
  ) {
    return "marketplace-sync-log__line--ok";
  }
  if (kind === "query_err" || kind === "provider_error" || kind === "error") {
    return "marketplace-sync-log__line--err";
  }
  if (kind === "cancelled") return "marketplace-sync-log__line--warn";
  if (kind === "wait") return "marketplace-sync-log__line--wait";
  if (kind === "query" || kind === "collect" || kind === "provider_start") {
    return "marketplace-sync-log__line--active";
  }
  if (kind === "query_miss" || kind === "skip" || kind === "skipped") {
    return "marketplace-sync-log__line--muted";
  }
  return "";
}

export function tallySyncStats(events: SyncProgressEvent[], slug?: string): SyncStats {
  const tally: Required<
    Pick<
      SyncStats,
      | "api_requests"
      | "api_ok"
      | "api_miss"
      | "api_errors"
      | "skipped_already_enriched"
      | "skipped_invalid"
      | "skipped_duplicate"
      | "rows_written"
    >
  > = {
    api_requests: 0,
    api_ok: 0,
    api_miss: 0,
    api_errors: 0,
    skipped_already_enriched: 0,
    skipped_invalid: 0,
    skipped_duplicate: 0,
    rows_written: 0,
  };

  for (const ev of events) {
    if (slug && ev.slug !== slug) continue;
    if (ev.stats) {
      tally.api_requests = Math.max(tally.api_requests, ev.stats.api_requests ?? 0);
      tally.api_ok = Math.max(tally.api_ok, ev.stats.api_ok ?? 0);
      tally.api_miss = Math.max(tally.api_miss, ev.stats.api_miss ?? 0);
      tally.api_errors = Math.max(tally.api_errors, ev.stats.api_errors ?? 0);
      tally.skipped_already_enriched = Math.max(
        tally.skipped_already_enriched,
        ev.stats.skipped_already_enriched ?? 0
      );
      tally.skipped_invalid = Math.max(tally.skipped_invalid, ev.stats.skipped_invalid ?? 0);
      tally.skipped_duplicate = Math.max(tally.skipped_duplicate, ev.stats.skipped_duplicate ?? 0);
      tally.rows_written = Math.max(tally.rows_written, ev.stats.rows_written ?? 0);
      continue;
    }
    if (ev.kind === "query") tally.api_requests += 1;
    else if (ev.kind === "query_ok") tally.api_ok += 1;
    else if (ev.kind === "query_miss") tally.api_miss += 1;
    else if (ev.kind === "query_err") tally.api_errors += 1;
    else if (ev.kind === "write") tally.rows_written += 1;
    else if (ev.kind === "skip") {
      if (ev.message.includes("Already enriched")) tally.skipped_already_enriched += 1;
      else if (ev.message.includes("invalid")) tally.skipped_invalid += 1;
      else if (ev.message.includes("duplicate")) tally.skipped_duplicate += 1;
    }
  }
  return tally;
}

export function formatSyncStats(stats: SyncStats, labels: SyncStatsLabels): string {
  const parts: string[] = [];
  if (stats.mode) {
    parts.push(stats.mode === "full" ? labels.modeFull : labels.modeIncremental);
  }
  if (stats.queued != null && stats.queued > 0) {
    parts.push(labels.queued.replace("{{n}}", String(stats.queued)));
  }
  if (stats.api_requests != null && stats.api_requests > 0) {
    parts.push(
      labels.apiRequests
        .replace("{{n}}", String(stats.api_requests))
        .replace("{{ok}}", String(stats.api_ok ?? 0))
        .replace("{{miss}}", String(stats.api_miss ?? 0))
        .replace("{{err}}", String(stats.api_errors ?? 0))
    );
  }
  const skipped =
    (stats.skipped_already_enriched ?? 0) +
    (stats.skipped_invalid ?? 0) +
    (stats.skipped_duplicate ?? 0);
  if (skipped > 0) {
    parts.push(labels.skipped.replace("{{n}}", String(skipped)));
  }
  if (stats.rows_written != null && stats.rows_written > 0) {
    parts.push(labels.rowsWritten.replace("{{n}}", String(stats.rows_written)));
  }
  return parts.length ? parts.join(" · ") : labels.noActivity;
}

export type SyncStatsLabels = {
  modeFull: string;
  modeIncremental: string;
  queued: string;
  apiRequests: string;
  skipped: string;
  rowsWritten: string;
  noActivity: string;
};
