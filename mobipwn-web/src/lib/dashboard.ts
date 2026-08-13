import type { LayoutItem } from "react-grid-layout";
import { apiFetch } from "@/lib/api";
import { querySkipsWallClockTimeWindow } from "@/lib/mplQuery";
import {
  isBuiltInDashboardPanel,
  PLATFORM_CASE_TOPS_PANEL_ID,
} from "@/lib/platformCaseTops";
export { isBuiltInDashboardPanel, PLATFORM_CASE_TOPS_PANEL_ID } from "@/lib/platformCaseTops";
import { rangeFromPresetMinutes } from "@/lib/timeRange";

export type PanelViz = "bar" | "line" | "area" | "pie" | "table" | "single_value" | "timechart";

export type DashboardPanel = {
  id: string;
  title: string;
  query: string;
  viz: PanelViz;
  layout: LayoutItem;
};

export type DashboardDocument = {
  version: number;
  description?: string;
  refresh_sec: number;
  time_preset: string;
  panels: DashboardPanel[];
};

export type DashboardRecord = {
  id: string;
  name: string;
  layout: unknown;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
};

export const REFRESH_OPTIONS = [
  { label: "Off", sec: 0 },
  { label: "30s", sec: 30 },
  { label: "1m", sec: 60 },
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
] as const;

export const DEFAULT_MOBILE_DASHBOARD: DashboardDocument = {
  version: 2,
  description: "Mobile SOC overview — parser volume, sources, and high-severity events.",
  refresh_sec: 60,
  time_preset: "24h",
  panels: [
    {
      id: "events_total",
      title: "Events",
      query: "last 24h * | stats count",
      viz: "single_value",
      layout: { i: "events_total", x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    },
    {
      id: "alerts_link",
      title: "New alerts",
      query: "",
      viz: "single_value",
      layout: { i: "alerts_link", x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    },
    {
      id: "parser_bar",
      title: "Events by parser",
      query: 'platform="android" | stats count by parser | head 8',
      viz: "bar",
      layout: { i: "parser_bar", x: 6, y: 0, w: 6, h: 3, minW: 4, minH: 2 },
    },
    {
      id: "timeline",
      title: "Activity timeline",
      query: 'platform="android" | timechart span=1h count by parser limit=6',
      viz: "timechart",
      layout: { i: "timeline", x: 0, y: 2, w: 8, h: 3, minW: 6, minH: 2 },
    },
    {
      id: "sources",
      title: "Top sources",
      query: "last 24h * | stats count by source | head 10",
      viz: "bar",
      layout: { i: "sources", x: 8, y: 2, w: 4, h: 3, minW: 3, minH: 2 },
    },
    {
      id: "high_sev",
      title: "High severity (sample)",
      query: 'last 24h severity="high" | head 12',
      viz: "table",
      layout: { i: "high_sev", x: 0, y: 5, w: 12, h: 3, minW: 6, minH: 2 },
    },
    {
      id: PLATFORM_CASE_TOPS_PANEL_ID,
      title: "Case highlights by platform",
      query: "",
      viz: "table",
      layout: {
        i: PLATFORM_CASE_TOPS_PANEL_ID,
        x: 0,
        y: 8,
        w: 12,
        h: 7,
        minW: 8,
        minH: 5,
      },
    },
  ],
};

export function newPanelId(): string {
  return `panel_${crypto.randomUUID().slice(0, 8)}`;
}

/** Place new panels below existing tiles (not y=99 off-screen). */
export function nextPanelLayout(panels: DashboardPanel[], id: string): LayoutItem {
  let maxY = 0;
  for (const p of panels) {
    const y = p.layout?.y ?? 0;
    const h = p.layout?.h ?? 2;
    maxY = Math.max(maxY, y + h);
  }
  return { i: id, x: 0, y: maxY, w: 6, h: 3, minW: 3, minH: 2 };
}

const GRID_COLS = 12;

/** Keep panel layout within the 12-column dashboard grid. */
export function clampPanelLayout(layout: LayoutItem): LayoutItem {
  const minW = layout.minW ?? 2;
  const minH = layout.minH ?? 2;
  const maxW = layout.maxW ?? GRID_COLS;
  const maxH = layout.maxH ?? 24;
  const w = Math.min(maxW, Math.max(minW, layout.w));
  const h = Math.min(maxH, Math.max(minH, layout.h));
  const x = Math.min(GRID_COLS - w, Math.max(0, layout.x));
  const y = Math.max(0, layout.y);
  return { ...layout, i: layout.i, w, h, x, y };
}

export function updatePanelLayout(
  panel: DashboardPanel,
  patch: Partial<Pick<LayoutItem, "x" | "y" | "w" | "h">>
): DashboardPanel {
  return {
    ...panel,
    layout: clampPanelLayout({ ...panel.layout, ...patch, i: panel.id }),
  };
}

export function createPanel(opts: {
  title: string;
  query: string;
  viz: PanelViz;
  panels: DashboardPanel[];
}): DashboardPanel {
  const id = newPanelId();
  return {
    id,
    title: opts.title,
    query: normalizeDashboardQuery(opts.query),
    viz: opts.viz,
    layout: nextPanelLayout(opts.panels, id),
  };
}

function dashboardPath(dashboardId: string): string {
  return dashboardId === "default" ? "/v1/dashboards/default" : `/v1/dashboards/${dashboardId}`;
}

export async function fetchDashboardDocument(dashboardId = "default"): Promise<DashboardDocument> {
  try {
    const d = await apiFetch<DashboardRecord>(dashboardPath(dashboardId));
    return parseDashboardDocument(d.layout);
  } catch {
    return { ...DEFAULT_MOBILE_DASHBOARD, panels: [...DEFAULT_MOBILE_DASHBOARD.panels] };
  }
}

export async function saveDashboardDocument(
  doc: DashboardDocument,
  dashboardId = "default"
): Promise<DashboardRecord> {
  const toSave: DashboardDocument = {
    ...doc,
    version: 2,
    panels: doc.panels.map((p) => ({
      ...p,
      layout: { ...p.layout, i: p.id },
      query: normalizeDashboardQuery(p.query),
    })),
  };
  return apiFetch<DashboardRecord>(dashboardPath(dashboardId), {
    method: "PUT",
    body: JSON.stringify({ layout: toSave }),
  });
}

export async function addPanelToDashboard(
  panel: DashboardPanel,
  dashboardId = "default"
): Promise<DashboardRecord> {
  const doc = await fetchDashboardDocument(dashboardId);
  doc.panels.push(panel);
  return saveDashboardDocument(doc, dashboardId);
}

export function parseDashboardDocument(raw: unknown): DashboardDocument {
  let doc: DashboardDocument;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.panels)) {
      doc = {
        version: 2,
        description: typeof o.description === "string" ? o.description : undefined,
        refresh_sec: typeof o.refresh_sec === "number" ? o.refresh_sec : 60,
        time_preset: typeof o.time_preset === "string" ? o.time_preset : "24h",
        panels: (o.panels as DashboardPanel[]).map((p) => ({
          ...p,
          layout: p.layout ? { ...p.layout, i: p.id } : nextPanelLayout([], p.id),
          query: normalizeDashboardQuery(p.query ?? ""),
        })),
      };
    } else {
      doc = { ...DEFAULT_MOBILE_DASHBOARD, panels: [...DEFAULT_MOBILE_DASHBOARD.panels] };
    }
  } else if (Array.isArray(raw)) {
    doc = migrateLegacyLayout(raw as LayoutItem[]);
  } else {
    doc = { ...DEFAULT_MOBILE_DASHBOARD, panels: [...DEFAULT_MOBILE_DASHBOARD.panels] };
  }
  return mergeMissingDefaultPanels(doc);
}

/** Append built-in panels shipped in DEFAULT_MOBILE_DASHBOARD when missing from saved layout. */
export function mergeMissingDefaultPanels(doc: DashboardDocument): DashboardDocument {
  const ids = new Set(doc.panels.map((p) => p.id));
  const missing = DEFAULT_MOBILE_DASHBOARD.panels.filter((p) => !ids.has(p.id));
  if (missing.length === 0) return doc;
  return { ...doc, panels: [...doc.panels, ...missing] };
}

function migrateLegacyLayout(items: LayoutItem[]): DashboardDocument {
  const doc = { ...DEFAULT_MOBILE_DASHBOARD, panels: [...DEFAULT_MOBILE_DASHBOARD.panels] };
  const legacy = new Set(items.map((i) => i.i));
  if (legacy.has("events_24h")) {
    const p = doc.panels.find((x) => x.id === "events_total");
    if (p) p.layout = items.find((i) => i.i === "events_24h") ?? p.layout;
  }
  return doc;
}

export function presetMinutes(preset: string): number {
  const map: Record<string, number> = {
    "15m": 15,
    "1h": 60,
    "4h": 4 * 60,
    "12h": 12 * 60,
    "24h": 24 * 60,
    "7d": 7 * 24 * 60,
    "30d": 30 * 24 * 60,
  };
  return map[preset] ?? 24 * 60;
}

export function timeBoundsForPreset(preset: string): { time_from?: string; time_to?: string } {
  const minutes = presetMinutes(preset);
  const range = rangeFromPresetMinutes(minutes);
  const from = range.from ? new Date(range.from).toISOString() : undefined;
  const to = range.to ? new Date(range.to).toISOString() : undefined;
  return { time_from: from, time_to: to };
}

/** mPL requires a search clause before the first `|`; insert `*` when only a time modifier is present. */
export function normalizeDashboardQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  const timeRe = /^(last\s+\d+[smhdw]|now-\d+[smhdw])\s+/i;
  const m = trimmed.match(timeRe);
  if (!m) return trimmed;
  const rest = trimmed.slice(m[0].length);
  if (rest.startsWith("|")) {
    return `${m[0]}* ${rest}`;
  }
  return trimmed;
}

const PRESET_PREFIX: Record<string, string> = {
  "15m": "last 15m ",
  "1h": "last 1h ",
  "4h": "last 4h ",
  "12h": "last 12h ",
  "24h": "last 24h ",
  "7d": "last 7d ",
  "30d": "last 30d ",
};

export function applyTimePresetToQuery(query: string, preset: string): string {
  if (!query.trim()) return "";
  const presetToken = PRESET_PREFIX[preset] ?? "last 24h ";
  const normalized = normalizeDashboardQuery(query);

  if (/^\s*last\s+\d+[smhdw]/i.test(normalized)) {
    const replaced = normalized.replace(/^\s*last\s+\d+[smhdw]\s+/i, presetToken);
    return normalizeDashboardQuery(replaced);
  }

  // platform/source/parser hunts use device timestamps — match Search (no wall-clock window).
  if (querySkipsWallClockTimeWindow(query)) {
    return normalized;
  }

  return normalizeDashboardQuery(`${presetToken}${normalized.trim()}`);
}

export function inferViz(query: string, columns: string[]): PanelViz {
  if (/\|\s*timechart\b/i.test(query)) return "timechart";
  if (/\|\s*head\b/i.test(query) && !/\bstats\b/i.test(query)) return "table";
  if (/\bstats\s+count\s*$/i.test(query) || (columns.length === 1 && columns[0]?.match(/count|c|cnt/i)))
    return "single_value";
  if (/\bstats\b.*\bby\b/i.test(query)) return "bar";
  return "table";
}

export function drilldownSearchUrl(query: string, field: string, value: string): string {
  const filter = `${field}="${String(value).replace(/"/g, '\\"')}"`;
  const base = query.includes("|") ? query.split("|")[0].trim() : query.trim();
  const params = new URLSearchParams({ q: `${base} ${filter} | head 100` });
  return `/search?${params.toString()}`;
}
