export type LogLevel = "debug" | "info" | "warn" | "error";

export type ActivityEntry = {
  id: string;
  ts: number;
  level: LogLevel;
  source: "api" | "app" | "server";
  message: string;
  detail?: string;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
};

const MAX_ENTRIES = 300;
let entries: ActivityEntry[] = [];
const listeners = new Set<() => void>();

function emit() {
  // Defer so pushActivity never synchronously updates React context during another component's render.
  queueMicrotask(() => {
    listeners.forEach((l) => l());
  });
}

export function subscribeActivityLog(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getActivityEntries(): readonly ActivityEntry[] {
  return entries;
}

export function clearActivityLog() {
  entries = [];
  emit();
}

export function pushActivity(
  level: LogLevel,
  source: ActivityEntry["source"],
  message: string,
  extra?: Partial<Omit<ActivityEntry, "id" | "ts" | "level" | "source" | "message">>
) {
  const entry: ActivityEntry = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    level,
    source,
    message,
    ...extra,
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  emit();
}

export function countErrors(): number {
  return entries.filter((e) => e.level === "error").length;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let fetchPatched = false;

export function installFetchLogger() {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const isApi = url.includes("/api/") || url.startsWith("/api");
    const start = performance.now();

    try {
      const res = await original(input, init);
      if (isApi) {
        const path = stripApi(url).replace(/^\/api/, "");
        const ingestNoise = isIngestNoiseLog(method, path);
        const streaming = isStreamingResponse(path, res);
        let bodyText = "";
        if (!streaming) {
          try {
            bodyText = await res.clone().text();
          } catch {
            bodyText = "";
          }
        }
        const trimmed = bodyText.trim();
        let level: LogLevel = res.ok ? "info" : "error";
        let detail: string | undefined;
        if (streaming && res.ok) {
          detail = "Streaming response — live progress shown in Marketplace sync panel";
        } else if (!res.ok) {
          detail = trimmed
            ? bodyText.slice(0, 2000)
            : `${res.statusText || "HTTP error"} (empty body, status ${res.status})`;
        } else if (!trimmed && (method === "POST" || method === "PUT" || method === "PATCH")) {
          level = "warn";
          detail = `HTTP ${res.status}: empty response body`;
        } else if (res.ok && trimmed) {
          const ingestDetail = formatIngestApiDetail(method, path, bodyText);
          if (ingestDetail) {
            detail = ingestDetail;
          }
        }
        if (!ingestNoise) {
          const apiMsg =
            streaming && res.ok
              ? `${method} ${stripApi(url)} → ${res.status} (streaming)`
              : ingestDetailMessage(method, path, res.status, bodyText) ??
                `${method} ${stripApi(url)} → ${res.status}`;
          pushActivity(level, "api", apiMsg, {
            method,
            url,
            status: res.status,
            durationMs: Math.round(performance.now() - start),
            detail,
          });
        }
        if (
          res.ok &&
          MUTATING_METHODS.has(method) &&
          !ingestNoise &&
          !streaming &&
          !isIngestRichAppLog(path)
        ) {
          pushActivity("info", "app", describeApiAction(method, url), {
            method,
            url,
            status: res.status,
            durationMs: Math.round(performance.now() - start),
            detail: trimmed ? bodyText.slice(0, 500) : undefined,
          });
        } else if (res.ok && method === "GET" && isSettingsActivityPath(path) && !ingestNoise) {
          pushActivity("info", "app", describeApiAction(method, url), {
            method,
            url,
            status: res.status,
            durationMs: Math.round(performance.now() - start),
          });
        }
      }
      return res;
    } catch (err) {
      if (isApi) {
        pushActivity("error", "api", `${method} ${stripApi(url)} failed`, {
          method,
          url,
          durationMs: Math.round(performance.now() - start),
          detail: String(err),
        });
      }
      throw err;
    }
  };
}

/** Responses that must not be buffered by the fetch logger (NDJSON/SSE streams). */
function isStreamingApiPath(path: string): boolean {
  return /^\/v1\/marketplace\/sync\/stream$/.test(path);
}

function isStreamingResponse(path: string, res: Response): boolean {
  if (isStreamingApiPath(path)) return true;
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/x-ndjson") || ct.includes("text/event-stream");
}

/** Chunk uploads and job polls are logged explicitly from ingestUpload.ts. */
function isIngestNoiseLog(method: string, path: string): boolean {
  if (method === "PUT" && /^\/v1\/ingest\/upload\/[0-9a-f-]{36}$/i.test(path)) {
    return true;
  }
  if (method === "GET" && /^\/v1\/ingest\/jobs\/[0-9a-f-]{36}$/i.test(path)) {
    return true;
  }
  return false;
}

/** Ingest flows emit detailed app-level entries from ingestActivity.ts. */
function isIngestRichAppLog(path: string): boolean {
  return (
    /^\/v1\/ingest\/upload\/init$/.test(path) ||
    /^\/v1\/ingest\/upload\/[0-9a-f-]{36}\/complete$/.test(path) ||
    /^\/v1\/ingest\/(bugreport|sysdiagnose|jsonl)/.test(path)
  );
}

function ingestDetailMessage(
  method: string,
  path: string,
  status: number,
  bodyText: string
): string | null {
  if (!bodyText.trim()) return null;
  try {
    const data = JSON.parse(bodyText) as Record<string, unknown>;
    if (path === "/v1/ingest/upload/init" && method === "POST") {
      const dedup = data.deduplicated === true;
      const job = String(data.job_id ?? "?").slice(0, 8);
      if (dedup) {
        return `Ingest init (dedup) — ${data.ingested ?? 0} events, job ${job}…`;
      }
      return `Ingest init — job ${job}… (${data.status ?? "uploading"})`;
    }
    if (/^\/v1\/ingest\/upload\/[0-9a-f-]{36}\/complete$/.test(path) && method === "POST") {
      return `Ingest upload complete — job ${String(data.job_id ?? "?").slice(0, 8)}… queued`;
    }
    if (/^\/v1\/ingest\/jobs\//.test(path)) {
      const st = String(data.status ?? "?");
      const job = data.job as Record<string, unknown> | undefined;
      const ev = data.events_count ?? job?.events_count;
      return `Ingest job ${st}${ev != null ? ` — ${ev} events` : ""}`;
    }
    if (/^\/v1\/ingest\/(bugreport|sysdiagnose)/.test(path)) {
      const n = data.ingested;
      return n != null ? `Ingest legacy — ${n} events` : null;
    }
  } catch {
    /* not JSON */
  }
  if (status >= 400 && /\/v1\/ingest\//.test(path)) {
    return `Ingest error: ${method} ${path}`;
  }
  return null;
}

function formatIngestApiDetail(method: string, path: string, bodyText: string): string | undefined {
  if (!/\/v1\/ingest\//.test(path)) return undefined;
  try {
    const data = JSON.parse(bodyText) as Record<string, unknown>;
    const lines: string[] = [];
    const pick = (key: string, label = key) => {
      const v = data[key];
      if (v != null && v !== "") lines.push(`${label}: ${v}`);
    };
    pick("source");
    pick("platform");
    pick("job_id", "job");
    pick("status");
    pick("ingested", "events");
    pick("events_count", "events");
    pick("deduplicated", "dedup");
    pick("progress_percent", "progress %");
    pick("bytes_received", "bytes received");
    pick("file_size", "file size");
    pick("error");
    if (data.job && typeof data.job === "object") {
      const job = data.job as Record<string, unknown>;
      if (job.source) lines.push(`source: ${job.source}`);
      if (job.platform) lines.push(`platform: ${job.platform}`);
      if (job.events_count != null) lines.push(`events: ${job.events_count}`);
      if (job.status) lines.push(`status: ${job.status}`);
      if (job.bytes_received != null && job.file_size != null) {
        lines.push(`upload: ${job.bytes_received} / ${job.file_size} bytes`);
      }
    }
    if (lines.length) return lines.join("\n");
  } catch {
    /* ignore */
  }
  return bodyText.slice(0, 800);
}

function stripApi(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Settings-related API paths (reads and writes) for the activity log. */
function isSettingsActivityPath(path: string): boolean {
  return (
    /^\/v1\/settings\//.test(path) ||
    /^\/v1\/suppressions/.test(path) ||
    /^\/v1\/notifications\//.test(path) ||
    /^\/v1\/mcp\//.test(path) ||
    /^\/v1\/auth\/(users|api-keys|totp|me)/.test(path)
  );
}

/** Human-readable label for API mutations (Logs page client activity). */
function describeApiAction(method: string, url: string): string {
  const path = stripApi(url).replace(/^\/api/, "");
  const labels: [RegExp, string][] = [
    [/^\/v1\/search\/run/, "Run search"],
    [/^\/v1\/search\/field-stats/, "Field statistics"],
    [/^\/v1\/search\/histogram/, "Search histogram"],
    [/^\/v1\/ingest\/bugreport/, "Ingest bugreport"],
    [/^\/v1\/ingest\/sysdiagnose/, "Ingest sysdiagnose"],
    [/^\/v1\/ingest\/upload\/init/, "Start chunked ingest upload"],
    [/^\/v1\/ingest\/upload\/[^/]+\/complete/, "Complete ingest upload"],
    [/^\/v1\/ingest\/upload\//, "Ingest upload chunk"],
    [/^\/v1\/ingest\/jobs\//, "Poll ingest job"],
    [/^\/v1\/data\/sources\/delete/, "Delete ingest source"],
    [/^\/v1\/rules\/[^/]+\/run/, "Run detection rule"],
    [/^\/v1\/rules\/[^/]+\/validate/, "Validate detection rule"],
    [/^\/v1\/rules\/import-sigma/, "Import Sigma rule"],
    [/^\/v1\/rules\/[^/]+\/enabled/, "Toggle rule enabled"],
    [/^\/v1\/rules\/[^/]+\/mute/, "Mute detection rule"],
    [/^\/v1\/rules/, "Save detection rule"],
    [/^\/v1\/alerts\/[^/]+\/status/, "Update alert status"],
    [/^\/v1\/alerts/, "Delete alert(s)"],
    [/^\/v1\/cases\/[^/]+$/, "Update case"],
    [/^\/v1\/cases/, "Create case"],
    [/^\/v1\/auth\/api-keys\/[^/]+\/reveal$/, "Reveal API key"],
    [/^\/v1\/auth\/api-keys\/[^/]+\/suspend$/, "Suspend API key"],
    [/^\/v1\/auth\/api-keys\/[^/]+\/unsuspend$/, "Unsuspend API key"],
    [/^\/v1\/auth\/api-keys\/suspend-user\//, "Suspend user API keys"],
    [/^\/v1\/auth\/api-keys\/mine$/, "Load my API keys"],
    [/^\/v1\/auth\/api-keys\/usage-by-user$/, "Load API key usage"],
    [/^\/v1\/auth\/api-keys\/[^/]+$/, method === "DELETE" ? "Revoke API key" : "API key action"],
    [/^\/v1\/auth\/api-keys$/, method === "GET" ? "Load API keys" : "Create API key"],
    [/^\/v1\/auth\/users\/directory$/, "Load user directory"],
    [/^\/v1\/auth\/users\/[^/]+$/, method === "DELETE" ? "Delete user" : "Update user"],
    [/^\/v1\/auth\/users$/, method === "GET" ? "Load users" : "Create user"],
    [/^\/v1\/auth\/totp\/setup$/, "Start MFA setup"],
    [/^\/v1\/auth\/totp\/enable$/, "Enable MFA"],
    [/^\/v1\/auth\/totp\/disable$/, "Disable MFA"],
    [/^\/v1\/auth\/me$/, "Load account profile"],
    [/^\/v1\/mcp\/status$/, "Load MCP status"],
    [/^\/v1\/mcp\/start$/, "Start MCP server"],
    [/^\/v1\/mcp\/stop$/, "Stop MCP server"],
    [/^\/v1\/mcp\/restart$/, "Restart MCP server"],
    [/^\/v1\/suppressions\/[^/]+$/, "Delete maintenance window"],
    [/^\/v1\/suppressions$/, method === "GET" ? "Load maintenance windows" : "Create maintenance window"],
    [/^\/v1\/settings\/llm_config$/, method === "GET" ? "Load LLM settings" : "Save LLM settings"],
    [/^\/v1\/settings\/mcp_config$/, method === "GET" ? "Load MCP settings" : "Save MCP settings"],
    [/^\/v1\/settings\/retention_by_source_type$/, method === "GET" ? "Load retention settings" : "Save retention settings"],
    [/^\/v1\/settings\/search_limits$/, method === "GET" ? "Load search limits" : "Save search limits"],
    [
      /^\/v1\/settings\/sysdiagnose_ingest$/,
      method === "GET" ? "Load iOS sysdiagnose ingest settings" : "Save iOS sysdiagnose ingest settings",
    ],
    [/^\/v1\/settings\//, method === "GET" ? "Load settings" : "Save settings"],
    [/^\/v1\/dashboards\/default/, "Save dashboard layout"],
    [/^\/v1\/marketplace\/sync/, "Sync marketplace enrichments"],
    [/^\/v1\/marketplace\/providers\//, "Toggle enrichment provider"],
    [/^\/v1\/llm\/chat/, "LLM chat"],
    [/^\/v1\/saved-queries/, "Save search query"],
  ];
  for (const [re, label] of labels) {
    if (re.test(path)) return label;
  }
  return `${method} ${path}`;
}
