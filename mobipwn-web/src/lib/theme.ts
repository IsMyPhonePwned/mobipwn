import {
  applyTypographyToDocument,
  getStoredTypography,
  type ThemeTypography,
} from "@/lib/themeTypography";
import {
  DEFAULT_THEME_COLORS,
  THEME_TOKEN_KEYS,
  type StoredThemeColors,
  type ThemeColorOverrides,
  type ThemeTokenMap,
} from "@/lib/themeTokens";

export type Theme = "light" | "dark" | "focus" | "matrix";

export const THEMES: Theme[] = ["light", "dark", "focus", "matrix"];

const THEME_STORAGE_KEY = "mobipwn-theme";
const COLORS_STORAGE_KEY = "mobipwn-theme-colors";

export function getStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "focus" || raw === "matrix") return raw;
  } catch {
    /* private browsing */
  }
  return "dark";
}

export function getStoredThemeColors(): StoredThemeColors {
  try {
    const raw = localStorage.getItem(COLORS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredThemeColors;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private browsing */
  }
}

export function persistThemeColors(colors: StoredThemeColors): void {
  try {
    localStorage.setItem(COLORS_STORAGE_KEY, JSON.stringify(colors));
  } catch {
    /* private browsing */
  }
}

export function applyThemeToDocument(
  theme: Theme,
  colorOverrides?: StoredThemeColors,
  typography?: ThemeTypography
): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark", "focus", "matrix");
  root.classList.add(theme);

  const overrides = colorOverrides?.[theme] ?? getStoredThemeColors()[theme];
  for (const key of THEME_TOKEN_KEYS) {
    const custom = overrides?.[key];
    if (custom) {
      root.style.setProperty(`--${key}`, custom);
    } else {
      root.style.removeProperty(`--${key}`);
    }
  }

  applyTypographyToDocument(typography ?? getStoredTypography());
}

export function applyTheme(
  theme: Theme,
  colorOverrides?: StoredThemeColors,
  typography?: ThemeTypography
): void {
  persistTheme(theme);
  applyThemeToDocument(theme, colorOverrides, typography);
}

export function applyThemeColors(colorOverrides: StoredThemeColors, activeTheme?: Theme): void {
  persistThemeColors(colorOverrides);
  const theme = activeTheme ?? getStoredTheme();
  applyThemeToDocument(theme, colorOverrides);
}

export function getOverridesForTheme(
  theme: Theme,
  stored?: StoredThemeColors
): ThemeColorOverrides {
  return (stored ?? getStoredThemeColors())[theme] ?? {};
}

export function setOverridesForTheme(
  stored: StoredThemeColors,
  theme: Theme,
  overrides: ThemeColorOverrides
): StoredThemeColors {
  const next = { ...stored };
  if (Object.keys(overrides).length === 0) {
    delete next[theme];
  } else {
    next[theme] = overrides;
  }
  return next;
}

export function nextTheme(theme: Theme): Theme {
  const i = THEMES.indexOf(theme);
  return THEMES[(i + 1) % THEMES.length]!;
}

export function themeLabelKey(theme: Theme): `theme.${Theme}` {
  return `theme.${theme}`;
}

export function resolvedThemeColors(
  theme: Theme,
  stored?: StoredThemeColors
): ThemeTokenMap {
  const base = DEFAULT_THEME_COLORS[theme];
  const overrides = getOverridesForTheme(theme, stored);
  return { ...base, ...overrides };
}

if (typeof document !== "undefined") {
  applyThemeToDocument(getStoredTheme(), getStoredThemeColors(), getStoredTypography());
}
