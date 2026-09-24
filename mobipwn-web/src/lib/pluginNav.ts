import type { LucideIcon } from "lucide-react";
import { GitCompare, Puzzle, Radio, ScanSearch, Share2 } from "lucide-react";
import {
  ALERT_TO_SIEM_PLUGIN_ID,
  CASE_COMPARISON_PLUGIN_ID,
  COLLECTOR_PLUGIN_ID,
  type PluginInfo,
} from "@/lib/plugins";

export type PluginNavMeta = {
  labelKey: string;
  icon: LucideIcon;
};

/** Sidebar icon + i18n label for each integrated plugin. */
export const PLUGIN_NAV: Record<string, PluginNavMeta> = {
  [CASE_COMPARISON_PLUGIN_ID]: {
    labelKey: "nav.caseComparison",
    icon: GitCompare,
  },
  [COLLECTOR_PLUGIN_ID]: {
    labelKey: "nav.collector",
    icon: Radio,
  },
  [ALERT_TO_SIEM_PLUGIN_ID]: {
    labelKey: "nav.alertToSiem",
    icon: Share2,
  },
};

export function pluginNavMeta(pluginId: string): PluginNavMeta {
  return (
    PLUGIN_NAV[pluginId] ?? {
      labelKey: "",
      icon: Puzzle,
    }
  );
}

/** Enabled plugins that expose a primary nav route. */
export function enabledPluginsWithNav(plugins: PluginInfo[]): PluginInfo[] {
  return plugins.filter((p) => p.enabled && p.nav_path);
}
