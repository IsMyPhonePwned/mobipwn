import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  applyTheme,
  applyThemeColors,
  getStoredTheme,
  getStoredThemeColors,
  nextTheme,
  persistThemeColors,
  setOverridesForTheme,
  type Theme,
} from "@/lib/theme";
import {
  applyTypographyToDocument,
  getStoredTypography,
  persistTypography,
  type FontFamilyPreset,
  type FontSizePreset,
  type ThemeTypography,
} from "@/lib/themeTypography";
import {
  DEFAULT_THEME_COLORS,
  diffThemeOverrides,
  mergeThemeColors,
  type StoredThemeColors,
  type ThemeColorOverrides,
  type ThemeTokenKey,
  type ThemeTokenMap,
} from "@/lib/themeTokens";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  themeColors: StoredThemeColors;
  colorsForTheme: (theme: Theme) => ThemeTokenMap;
  setColorForTheme: (theme: Theme, key: ThemeTokenKey, value: string) => void;
  resetColorForTheme: (theme: Theme, key: ThemeTokenKey) => void;
  resetThemeColors: (theme: Theme) => void;
  saveThemePalette: (theme: Theme, palette: ThemeTokenMap) => void;
  typography: ThemeTypography;
  setFontFamily: (preset: FontFamilyPreset) => void;
  setFontSize: (preset: FontSizePreset) => void;
  resetTypography: () => void;
  saveTypography: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [themeColors, setThemeColorsState] = useState<StoredThemeColors>(() => getStoredThemeColors());
  const [typography, setTypographyState] = useState<ThemeTypography>(() => getStoredTypography());

  useEffect(() => {
    applyTheme(theme, themeColors, typography);
  }, [theme, themeColors, typography]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((t) => nextTheme(t));
  }, []);

  const colorsForTheme = useCallback(
    (t: Theme) => mergeThemeColors(t, themeColors[t]),
    [themeColors]
  );

  const setColorForTheme = useCallback((t: Theme, key: ThemeTokenKey, value: string) => {
    setThemeColorsState((prev) => {
      const merged = mergeThemeColors(t, prev[t]);
      merged[key] = value;
      const overrides = diffThemeOverrides(t, merged);
      return setOverridesForTheme(prev, t, overrides);
    });
  }, []);

  const resetColorForTheme = useCallback((t: Theme, key: ThemeTokenKey) => {
    setThemeColorsState((prev) => {
      const current = { ...(prev[t] ?? {}) };
      delete current[key];
      return setOverridesForTheme(prev, t, current);
    });
  }, []);

  const resetThemeColors = useCallback((t: Theme) => {
    setThemeColorsState((prev) => {
      const next = setOverridesForTheme(prev, t, {});
      persistThemeColors(next);
      return next;
    });
  }, []);

  const saveThemePalette = useCallback((t: Theme, palette: ThemeTokenMap) => {
    const overrides = diffThemeOverrides(t, palette);
    setThemeColorsState((prev) => {
      const next = setOverridesForTheme(prev, t, overrides);
      persistThemeColors(next);
      applyThemeColors(next, t);
      return next;
    });
  }, []);

  const setFontFamily = useCallback((preset: FontFamilyPreset) => {
    setTypographyState((prev) => {
      const next = { ...prev, fontFamily: preset };
      persistTypography(next);
      applyTypographyToDocument(next);
      return next;
    });
  }, []);

  const setFontSize = useCallback((preset: FontSizePreset) => {
    setTypographyState((prev) => {
      const next = { ...prev, fontSize: preset };
      persistTypography(next);
      applyTypographyToDocument(next);
      return next;
    });
  }, []);

  const resetTypography = useCallback(() => {
    const next: ThemeTypography = {};
    setTypographyState(next);
    persistTypography(next);
    applyTypographyToDocument(next);
  }, []);

  const saveTypography = useCallback(() => {
    setTypographyState((prev) => {
      persistTypography(prev);
      return prev;
    });
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      themeColors,
      colorsForTheme,
      setColorForTheme,
      resetColorForTheme,
      resetThemeColors,
      saveThemePalette,
      typography,
      setFontFamily,
      setFontSize,
      resetTypography,
      saveTypography,
    }),
    [
      theme,
      setTheme,
      toggleTheme,
      themeColors,
      colorsForTheme,
      setColorForTheme,
      resetColorForTheme,
      resetThemeColors,
      saveThemePalette,
      typography,
      setFontFamily,
      setFontSize,
      resetTypography,
      saveTypography,
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}

export function useDefaultColor(theme: Theme, key: ThemeTokenKey): string {
  return DEFAULT_THEME_COLORS[theme][key];
}
