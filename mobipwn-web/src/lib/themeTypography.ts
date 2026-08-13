export const FONT_FAMILY_PRESETS = {
  geist: {
    id: "geist",
    labelKey: "settings.appearance.fontGeist",
    sans: '"Geist Variable", system-ui, sans-serif',
    mono: '"Geist Mono Variable", ui-monospace, Menlo, monospace',
  },
  inter: {
    id: "inter",
    labelKey: "settings.appearance.fontInter",
    sans: '"Inter Variable", system-ui, sans-serif',
    mono: '"Geist Mono Variable", ui-monospace, Menlo, monospace',
  },
  ibmPlex: {
    id: "ibmPlex",
    labelKey: "settings.appearance.fontIbmPlex",
    sans: '"IBM Plex Sans", system-ui, sans-serif',
    mono: '"JetBrains Mono Variable", ui-monospace, Menlo, monospace',
  },
  system: {
    id: "system",
    labelKey: "settings.appearance.fontSystem",
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  serif: {
    id: "serif",
    labelKey: "settings.appearance.fontSerif",
    sans: 'Georgia, "Times New Roman", Times, serif',
    mono: '"Geist Mono Variable", ui-monospace, Menlo, monospace',
  },
  mono: {
    id: "mono",
    labelKey: "settings.appearance.fontMono",
    sans: '"Geist Mono Variable", ui-monospace, Menlo, monospace',
    mono: '"Geist Mono Variable", ui-monospace, Menlo, monospace',
  },
  jetbrains: {
    id: "jetbrains",
    labelKey: "settings.appearance.fontJetBrains",
    sans: '"JetBrains Mono Variable", ui-monospace, Menlo, monospace',
    mono: '"JetBrains Mono Variable", ui-monospace, Menlo, monospace',
  },
} as const;

/** Base UI size in px at the default (medium) preset — used for rem scaling. */
export const FONT_SIZE_BASE_PX = 13;

export const FONT_SIZE_PRESETS = {
  xs: { id: "xs", labelKey: "settings.appearance.sizeXs", px: 11 },
  small: { id: "small", labelKey: "settings.appearance.sizeSmall", px: 12 },
  medium: { id: "medium", labelKey: "settings.appearance.sizeMedium", px: 13 },
  large: { id: "large", labelKey: "settings.appearance.sizeLarge", px: 14 },
  xl: { id: "xl", labelKey: "settings.appearance.sizeXlarge", px: 15 },
  xxl: { id: "xxl", labelKey: "settings.appearance.sizeXxl", px: 16 },
  xxxl: { id: "xxxl", labelKey: "settings.appearance.sizeXxxl", px: 18 },
} as const;

export type FontFamilyPreset = keyof typeof FONT_FAMILY_PRESETS;
export type FontSizePreset = keyof typeof FONT_SIZE_PRESETS;

export type ThemeTypography = {
  fontFamily?: FontFamilyPreset;
  fontSize?: FontSizePreset;
};

export const DEFAULT_FONT_FAMILY: FontFamilyPreset = "geist";
export const DEFAULT_FONT_SIZE: FontSizePreset = "medium";

const TYPOGRAPHY_STORAGE_KEY = "mobipwn-theme-typography";

export const FONT_FAMILY_OPTIONS = Object.values(FONT_FAMILY_PRESETS);
export const FONT_SIZE_OPTIONS = Object.values(FONT_SIZE_PRESETS);

export function getStoredTypography(): ThemeTypography {
  try {
    const raw = localStorage.getItem(TYPOGRAPHY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ThemeTypography;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ThemeTypography = {};
    if (parsed.fontFamily && parsed.fontFamily in FONT_FAMILY_PRESETS) {
      out.fontFamily = parsed.fontFamily;
    }
    if (parsed.fontSize && parsed.fontSize in FONT_SIZE_PRESETS) {
      out.fontSize = parsed.fontSize;
    }
    return out;
  } catch {
    return {};
  }
}

export function persistTypography(typography: ThemeTypography): void {
  try {
    const hasFamily = typography.fontFamily && typography.fontFamily !== DEFAULT_FONT_FAMILY;
    const hasSize = typography.fontSize && typography.fontSize !== DEFAULT_FONT_SIZE;
    if (!hasFamily && !hasSize) {
      localStorage.removeItem(TYPOGRAPHY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(typography));
  } catch {
    /* private browsing */
  }
}

export function resolvedFontFamily(typography?: ThemeTypography): FontFamilyPreset {
  return typography?.fontFamily ?? DEFAULT_FONT_FAMILY;
}

export function resolvedFontSize(typography?: ThemeTypography): FontSizePreset {
  return typography?.fontSize ?? DEFAULT_FONT_SIZE;
}

export function applyTypographyToDocument(typography?: ThemeTypography): void {
  const root = document.documentElement;
  const familyKey = resolvedFontFamily(typography);
  const size = FONT_SIZE_PRESETS[resolvedFontSize(typography)];
  const family = FONT_FAMILY_PRESETS[familyKey];
  const scale = size.px / FONT_SIZE_BASE_PX;

  root.style.setProperty("--font-sans", family.sans);
  root.style.setProperty("--font-mono", family.mono);
  root.style.setProperty("--font-size-base", `${size.px}px`);
  root.style.setProperty("--font-scale", String(scale));
  root.style.fontSize = `${size.px}px`;
  root.dataset.fontFamily = familyKey;
  root.dataset.fontSize = size.id;
}

export function resetTypographyOnDocument(): void {
  const root = document.documentElement;
  root.style.removeProperty("--font-sans");
  root.style.removeProperty("--font-mono");
  root.style.removeProperty("--font-size-base");
  root.style.removeProperty("--font-scale");
  root.style.fontSize = "";
  delete root.dataset.fontFamily;
  delete root.dataset.fontSize;
}
