import { apiFetch } from "@/lib/api";

export const IRONSIFT_PLUGIN_ID = "ironsift";
export const CASE_COMPARISON_PLUGIN_ID = "case_comparison";
/** @deprecated Use CASE_COMPARISON_PLUGIN_ID */
export const BUGREPORT_COMPARISON_PLUGIN_ID = CASE_COMPARISON_PLUGIN_ID;
export const COLLECTOR_PLUGIN_ID = "collector";
export const ALERT_TO_SIEM_PLUGIN_ID = "alert_to_siem";
export const DEVICE_ADVANCED_PLUGIN_ID = "device_advanced";
/** @deprecated Use COLLECTOR_PLUGIN_ID */
export const PUBLIC_COLLECT_PLUGIN_ID = COLLECTOR_PLUGIN_ID;

export type PluginInfo = {
  id: string;
  name: string;
  description: string;
  version: string;
  routes: string[];
  nav_path: string | null;
  enabled: boolean;
};

export async function fetchPlugins() {
  return apiFetch<PluginInfo[]>("/v1/plugins");
}

export async function setPluginEnabled(id: string, enabled: boolean) {
  return apiFetch<PluginInfo>(`/v1/plugins/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export function isPluginRouteEnabled(plugins: PluginInfo[] | null, path: string): boolean {
  if (!plugins) return false;
  const match = plugins.find((p) => p.nav_path === path || p.routes.includes(path));
  if (!match) return false;
  return match.enabled;
}
