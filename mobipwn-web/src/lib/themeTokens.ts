import type { Theme } from "@/lib/theme";

export type ThemeTokenKey =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "card-2"
  | "muted"
  | "muted-foreground"
  | "primary"
  | "primary-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "severity-critical"
  | "severity-high"
  | "severity-medium"
  | "severity-low"
  | "severity-info"
  | "border"
  | "border-2"
  | "input"
  | "input-border"
  | "ring"
  | "sidebar"
  | "sidebar-foreground"
  | "sidebar-border"
  | "sidebar-accent"
  | "outer"
  | "panel"
  | "inspector"
  | "brand"
  | "brand-1000"
  | "success"
  | "accent-purple"
  | "accent-green"
  | "accent-blue"
  | "accent-orange"
  | "accent-cyan"
  | "accent-yellow"
  | "accent-pink"
  | "accent-teal";

export type ThemeTokenMap = Record<ThemeTokenKey, string>;
export type ThemeColorOverrides = Partial<ThemeTokenMap>;
export type StoredThemeColors = Partial<Record<Theme, ThemeColorOverrides>>;

export const THEME_TOKEN_KEYS: ThemeTokenKey[] = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "card-2",
  "muted",
  "muted-foreground",
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "severity-critical",
  "severity-high",
  "severity-medium",
  "severity-low",
  "severity-info",
  "border",
  "border-2",
  "input",
  "input-border",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-border",
  "sidebar-accent",
  "outer",
  "panel",
  "inspector",
  "brand",
  "brand-1000",
  "success",
  "accent-purple",
  "accent-green",
  "accent-blue",
  "accent-orange",
  "accent-cyan",
  "accent-yellow",
  "accent-pink",
  "accent-teal",
];

export const THEME_TOKEN_GROUPS: Array<{
  id: string;
  labelKey: string;
  tokens: ThemeTokenKey[];
}> = [
  {
    id: "surface",
    labelKey: "settings.appearance.groupSurface",
    tokens: ["background", "card", "card-2", "panel", "inspector", "outer", "muted"],
  },
  {
    id: "text",
    labelKey: "settings.appearance.groupText",
    tokens: ["foreground", "card-foreground", "muted-foreground"],
  },
  {
    id: "brand",
    labelKey: "settings.appearance.groupBrand",
    tokens: ["primary", "primary-foreground", "brand", "brand-1000", "ring", "success"],
  },
  {
    id: "severity",
    labelKey: "settings.appearance.groupSeverity",
    tokens: [
      "destructive",
      "severity-critical",
      "severity-high",
      "severity-medium",
      "severity-low",
      "severity-info",
    ],
  },
  {
    id: "chrome",
    labelKey: "settings.appearance.groupChrome",
    tokens: [
      "sidebar",
      "sidebar-foreground",
      "sidebar-border",
      "sidebar-accent",
      "border",
      "border-2",
      "input",
      "input-border",
      "accent",
      "accent-foreground",
    ],
  },
  {
    id: "accents",
    labelKey: "settings.appearance.groupAccents",
    tokens: [
      "accent-purple",
      "accent-green",
      "accent-blue",
      "accent-orange",
      "accent-cyan",
      "accent-yellow",
      "accent-pink",
      "accent-teal",
    ],
  },
];

export const THEME_TOKEN_LABELS: Record<ThemeTokenKey, string> = {
  background: "Background",
  foreground: "Foreground text",
  card: "Card",
  "card-foreground": "Card text",
  "card-2": "Card alt",
  muted: "Muted surface",
  "muted-foreground": "Muted text",
  primary: "Primary",
  "primary-foreground": "Primary text",
  accent: "Accent surface",
  "accent-foreground": "Accent text",
  destructive: "Destructive",
  "severity-critical": "Severity critical",
  "severity-high": "Severity high",
  "severity-medium": "Severity medium",
  "severity-low": "Severity low",
  "severity-info": "Severity info",
  border: "Border",
  "border-2": "Border alt",
  input: "Input background",
  "input-border": "Input border",
  ring: "Focus ring",
  sidebar: "Sidebar",
  "sidebar-foreground": "Sidebar text",
  "sidebar-border": "Sidebar border",
  "sidebar-accent": "Sidebar accent",
  outer: "Outer shell",
  panel: "Panel",
  inspector: "Inspector",
  brand: "Brand",
  "brand-1000": "Brand dark",
  success: "Success",
  "accent-purple": "Accent purple",
  "accent-green": "Accent green",
  "accent-blue": "Accent blue",
  "accent-orange": "Accent orange",
  "accent-cyan": "Accent cyan",
  "accent-yellow": "Accent yellow",
  "accent-pink": "Accent pink",
  "accent-teal": "Accent teal",
};

/** Built-in palette per theme (mirrors nano-theme.css). */
export const DEFAULT_THEME_COLORS: Record<Theme, ThemeTokenMap> = {
  light: {
    background: "#f4f5f7",
    foreground: "#111827",
    card: "#ffffff",
    "card-foreground": "#111827",
    muted: "#eef0f3",
    "muted-foreground": "#6b7280",
    primary: "#0e7490",
    "primary-foreground": "#ffffff",
    accent: "#e8eaed",
    "accent-foreground": "#111827",
    destructive: "#dc2626",
    "severity-critical": "#b91c1c",
    "severity-high": "#c2410c",
    "severity-medium": "#1d4ed8",
    "severity-low": "#57534e",
    "severity-info": "#0e7490",
    border: "#d1d5db",
    "border-2": "#e5e7eb",
    input: "#ffffff",
    "input-border": "#d1d5db",
    ring: "#0e7490",
    sidebar: "#ffffff",
    "sidebar-foreground": "#111827",
    "sidebar-border": "#e5e7eb",
    "sidebar-accent": "#f3f4f6",
    outer: "#e5e7eb",
    panel: "#ffffff",
    "card-2": "#f3f4f6",
    inspector: "#f9fafb",
    brand: "#0e7490",
    "brand-1000": "#155e75",
    success: "#059669",
    "accent-purple": "#6d28d9",
    "accent-green": "#15803d",
    "accent-blue": "#1d4ed8",
    "accent-orange": "#c2410c",
    "accent-cyan": "#0e7490",
    "accent-yellow": "#a16207",
    "accent-pink": "#be185d",
    "accent-teal": "#0f766e",
  },
  dark: {
    background: "#0b0e12",
    foreground: "#e5e7eb",
    card: "#11151b",
    "card-foreground": "#e5e7eb",
    muted: "#0f1319",
    "muted-foreground": "#a8acb4",
    primary: "#5ee7f0",
    "primary-foreground": "#06080b",
    accent: "#161b23",
    "accent-foreground": "#e5e7eb",
    destructive: "#ef4444",
    "severity-critical": "#f87171",
    "severity-high": "#fb923c",
    "severity-medium": "#60a5fa",
    "severity-low": "#a8acb4",
    "severity-info": "#22d3ee",
    border: "#1a1f27",
    "border-2": "#272c35",
    input: "#0e1319",
    "input-border": "#272c35",
    ring: "#5ee7f0",
    sidebar: "#06080b",
    "sidebar-foreground": "#e5e7eb",
    "sidebar-border": "#1a1f27",
    "sidebar-accent": "#161b23",
    outer: "#06080b",
    panel: "#0f1319",
    "card-2": "#161b23",
    inspector: "#0e1218",
    brand: "#5ee7f0",
    "brand-1000": "#1c9cf0",
    success: "#34d399",
    "accent-purple": "#c084fc",
    "accent-green": "#4ade80",
    "accent-blue": "#60a5fa",
    "accent-orange": "#fdba74",
    "accent-cyan": "#22d3ee",
    "accent-yellow": "#facc15",
    "accent-pink": "#f472b6",
    "accent-teal": "#2dd4bf",
  },
  focus: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    card: "#24243a",
    "card-foreground": "#cdd6f4",
    muted: "#313244",
    "muted-foreground": "#a6adc8",
    primary: "#89b4fa",
    "primary-foreground": "#1e1e2e",
    accent: "#2a2a3c",
    "accent-foreground": "#cdd6f4",
    destructive: "#f38ba8",
    "severity-critical": "#f38ba8",
    "severity-high": "#fab387",
    "severity-medium": "#89b4fa",
    "severity-low": "#a6adc8",
    "severity-info": "#94e2d5",
    border: "#3b3b52",
    "border-2": "#45475a",
    input: "#24243a",
    "input-border": "#45475a",
    ring: "#89b4fa",
    sidebar: "#181825",
    "sidebar-foreground": "#bac2de",
    "sidebar-border": "#313244",
    "sidebar-accent": "#24243a",
    outer: "#181825",
    panel: "#24243a",
    "card-2": "#2a2a3c",
    inspector: "#1f1f31",
    brand: "#89b4fa",
    "brand-1000": "#74a0e8",
    success: "#a6e3a1",
    "accent-purple": "#cba6f7",
    "accent-green": "#a6e3a1",
    "accent-blue": "#89b4fa",
    "accent-orange": "#fab387",
    "accent-cyan": "#94e2d5",
    "accent-yellow": "#f9e2af",
    "accent-pink": "#f5c2e7",
    "accent-teal": "#94e2d5",
  },
  matrix: {
    background: "#020b05",
    foreground: "#39ff14",
    card: "#041408",
    "card-foreground": "#5dff3a",
    muted: "#031006",
    "muted-foreground": "#1f9a2f",
    primary: "#00ff41",
    "primary-foreground": "#001a06",
    accent: "#062010",
    "accent-foreground": "#7dff68",
    destructive: "#ff3333",
    "severity-critical": "#ff4d4d",
    "severity-high": "#ffb347",
    "severity-medium": "#66ff99",
    "severity-low": "#1f9a2f",
    "severity-info": "#00ff41",
    border: "#0d3d18",
    "border-2": "#145c22",
    input: "#031006",
    "input-border": "#0d3d18",
    ring: "#00ff41",
    sidebar: "#010804",
    "sidebar-foreground": "#39ff14",
    "sidebar-border": "#0d3d18",
    "sidebar-accent": "#062010",
    outer: "#010804",
    panel: "#031006",
    "card-2": "#062010",
    inspector: "#041408",
    brand: "#00ff41",
    "brand-1000": "#00cc33",
    success: "#39ff14",
    "accent-purple": "#7dff68",
    "accent-green": "#00ff41",
    "accent-blue": "#33ffaa",
    "accent-orange": "#aaff00",
    "accent-cyan": "#00ff99",
    "accent-yellow": "#ccff00",
    "accent-pink": "#66ff66",
    "accent-teal": "#00ff66",
  },
};

export function mergeThemeColors(theme: Theme, overrides?: ThemeColorOverrides): ThemeTokenMap {
  const base = DEFAULT_THEME_COLORS[theme];
  if (!overrides) return { ...base };
  return { ...base, ...overrides };
}

export function diffThemeOverrides(theme: Theme, colors: ThemeTokenMap): ThemeColorOverrides {
  const defaults = DEFAULT_THEME_COLORS[theme];
  const out: ThemeColorOverrides = {};
  for (const key of THEME_TOKEN_KEYS) {
    if (colors[key] !== defaults[key]) {
      out[key] = colors[key];
    }
  }
  return out;
}

export function normalizeHexColor(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const r = v[1];
    const g = v[2];
    const b = v[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  return null;
}
