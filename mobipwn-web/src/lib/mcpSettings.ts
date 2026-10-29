import { apiFetch } from "@/lib/api";

export type McpConfig = {
  auto_start: boolean;
  api_url: string;
  api_key?: string;
  api_key_set?: boolean;
  binary_path?: string;
};

export type McpStatus = {
  running: boolean;
  pid: number | null;
  auto_start: boolean;
  binary_path: string;
  binary_found: boolean;
  api_url: string;
  api_key_set: boolean;
  started_at: string | null;
  last_error: string | null;
  cursor_config: Record<string, unknown>;
};

export async function fetchMcpStatus(): Promise<McpStatus> {
  return apiFetch<McpStatus>("/v1/mcp/status");
}

export async function fetchMcpConfig(): Promise<McpConfig> {
  const res = await fetch("/api/v1/settings/mcp_config");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveMcpConfig(body: McpConfig): Promise<void> {
  const res = await fetch("/api/v1/settings/mcp_config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function startMcp(): Promise<McpStatus> {
  return apiFetch<McpStatus>("/v1/mcp/start", { method: "POST" });
}

export async function stopMcp(): Promise<McpStatus> {
  return apiFetch<McpStatus>("/v1/mcp/stop", { method: "POST" });
}

export async function restartMcp(): Promise<McpStatus> {
  return apiFetch<McpStatus>("/v1/mcp/restart", { method: "POST" });
}

/** Tool catalog mirrored from `mobipwn-mcp` / docs/MCP.md — keep in sync when adding tools. */
export const MCP_TOOL_CATALOG: { group: string; tools: { name: string; summary: string }[] }[] = [
  {
    group: "Search & fields",
    tools: [
      { name: "search_run", summary: "Execute mPL" },
      { name: "search_compile", summary: "mPL → SQL" },
      { name: "search_histogram", summary: "Counts over time" },
      { name: "mudm_list_fields", summary: "Field catalog" },
      { name: "search_field_stats", summary: "Top field values" },
      { name: "search_fields_in_scope", summary: "Fields in filter" },
      { name: "prevalence_scatter", summary: "Rarity / noise cut" },
      { name: "get_event", summary: "Single event row" },
    ],
  },
  {
    group: "Cases & alerts",
    tools: [
      { name: "cases_list / get / create / patch", summary: "Investigation cases" },
      { name: "cases_entities / wall / comment", summary: "Graph, wall, notes" },
      { name: "cases_link_alert", summary: "Link alert to case" },
      { name: "alerts_list / get / patch", summary: "Triage" },
      { name: "alerts_groups", summary: "Grouped summary" },
    ],
  },
  {
    group: "Detections",
    tools: [
      { name: "rules_list / get / create / update", summary: "Detection rules" },
      { name: "rules_validate_query / run", summary: "Validate & run now" },
      { name: "saved_queries_list / create", summary: "Hunt library" },
    ],
  },
  {
    group: "Data & ingest",
    tools: [
      { name: "overview / data_summary", summary: "Platform & sources" },
      { name: "data_sources_archive", summary: "Cold-archive (keep blobs)" },
      { name: "data_sources_delete", summary: "Full source delete" },
      { name: "ingest_jobs_list / get", summary: "Job progress" },
      { name: "collect_blobs_list / reingest", summary: "Stored archives" },
      { name: "health_detail", summary: "DB + ingest pool" },
      { name: "llm_status", summary: "Server LLM config" },
    ],
  },
];
