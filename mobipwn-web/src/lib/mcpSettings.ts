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
