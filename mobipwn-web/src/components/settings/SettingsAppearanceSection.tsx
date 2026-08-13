import { useCallback, useMemo, useState } from "react";
import { Palette, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useTheme } from "@/contexts/ThemeContext";
import { persistThemeColors, themeLabelKey, type Theme } from "@/lib/theme";
import {
  DEFAULT_THEME_COLORS,
  THEME_TOKEN_GROUPS,
  THEME_TOKEN_LABELS,
  normalizeHexColor,
  type ThemeTokenKey,
} from "@/lib/themeTokens";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  FONT_FAMILY_OPTIONS,
  FONT_FAMILY_PRESETS,
  FONT_SIZE_OPTIONS,
  FONT_SIZE_PRESETS,
  resolvedFontFamily,
  resolvedFontSize,
} from "@/lib/themeTypography";

const EDITABLE_THEMES: Theme[] = ["light", "dark", "focus", "matrix"];

export function SettingsAppearanceSection() {
  const { t } = useLocale();
  const { log } = useActivityLog();
  const {
    theme,
    setTheme,
    themeColors,
    colorsForTheme,
    setColorForTheme,
    resetColorForTheme,
    resetThemeColors,
    typography,
    setFontFamily,
    setFontSize,
    resetTypography,
    saveTypography,
  } = useTheme();

  const activeFontFamily = resolvedFontFamily(typography);
  const activeFontSize = resolvedFontSize(typography);

  const [editingTheme, setEditingTheme] = useState<Theme>(theme);
  const [msg, setMsg] = useState("");

  const palette = useMemo(() => colorsForTheme(editingTheme), [colorsForTheme, editingTheme]);

  const themeName = useCallback(
    (id: Theme) => t(themeLabelKey(id)),
    [t]
  );

  const onColorChange = (key: ThemeTokenKey, raw: string) => {
    const normalized = normalizeHexColor(raw);
    if (!normalized) return;
    setColorForTheme(editingTheme, key, normalized);
    setMsg("");
  };

  const onSave = () => {
    persistThemeColors(themeColors);
    saveTypography();
    setMsg(t("settings.appearance.saved"));
    log("info", `Appearance: saved ${editingTheme} palette + typography`);
  };

  const onResetPalette = () => {
    if (!window.confirm(t("settings.appearance.resetConfirm"))) return;
    resetThemeColors(editingTheme);
    setMsg(t("settings.appearance.resetDone"));
    log("info", `Appearance: reset ${editingTheme} palette`);
  };

  const isCustomized = (key: ThemeTokenKey) =>
    palette[key] !== DEFAULT_THEME_COLORS[editingTheme][key];

  return (
    <section className="settings-panel card editor theme-editor">
      <header className="settings-panel__header">
        <h2>{t("settings.appearance.title")}</h2>
        <p className="muted text-sm">{t("settings.appearance.subtitle")}</p>
      </header>

      {msg && <p className="settings-panel__msg muted text-xs">{msg}</p>}

      <div className="settings-panel__block">
        <h3 className="settings-panel__subhead">{t("settings.appearance.activeTheme")}</h3>
        <div className="theme-editor__theme-row" role="radiogroup" aria-label={t("settings.appearance.activeTheme")}>
          {EDITABLE_THEMES.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              className={`theme-editor__theme-btn${theme === id ? " theme-editor__theme-btn--active" : ""}${id === "matrix" ? " theme-editor__theme-btn--matrix" : ""}`}
              onClick={() => {
                setTheme(id);
                setEditingTheme(id);
                log("info", `Theme: ${id}`);
              }}
            >
              <span className="theme-editor__theme-swatch" data-theme={id} aria-hidden />
              {themeName(id)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-panel__block">
        <h3 className="settings-panel__subhead">{t("settings.appearance.typography")}</h3>
        <p className="muted text-xs theme-editor__hint">{t("settings.appearance.typographyHint")}</p>
        <div className="theme-editor__typography">
          <label className="theme-editor__typography-field">
            <span className="theme-editor__typography-label">{t("settings.appearance.fontFamily")}</span>
            <select
              className="theme-editor__select"
              value={activeFontFamily}
              style={{ fontFamily: FONT_FAMILY_PRESETS[activeFontFamily].sans }}
              onChange={(e) => {
                setFontFamily(e.target.value as typeof activeFontFamily);
                setMsg("");
              }}
            >
              {FONT_FAMILY_OPTIONS.map((preset) => (
                <option key={preset.id} value={preset.id} style={{ fontFamily: preset.sans }}>
                  {t(preset.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="theme-editor__typography-field">
            <span className="theme-editor__typography-label">{t("settings.appearance.fontSize")}</span>
            <select
              className="theme-editor__select"
              value={activeFontSize}
              onChange={(e) => {
                setFontSize(e.target.value as typeof activeFontSize);
                setMsg("");
              }}
            >
              {FONT_SIZE_OPTIONS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {t(preset.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <p
            className="theme-editor__typography-preview"
            style={{ fontFamily: FONT_FAMILY_PRESETS[activeFontFamily].sans }}
          >
            {t("settings.appearance.typographyPreview")}
          </p>
          {(activeFontFamily !== DEFAULT_FONT_FAMILY || activeFontSize !== DEFAULT_FONT_SIZE) && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                resetTypography();
                setMsg(t("settings.appearance.typographyReset"));
              }}
            >
              <RotateCcw size={14} aria-hidden />
              {t("settings.appearance.resetTypography")}
            </Button>
          )}
        </div>
      </div>

      <div className="settings-panel__block">
        <h3 className="settings-panel__subhead">{t("settings.appearance.editPalette")}</h3>
        <p className="muted text-xs theme-editor__hint">{t("settings.appearance.editHint")}</p>
        {editingTheme !== theme && (
          <p className="muted text-xs theme-editor__preview-note">
            Editing <strong>{themeName(editingTheme)}</strong> — switch active theme to preview changes.
          </p>
        )}
        <div className="theme-editor__theme-row">
          {EDITABLE_THEMES.map((id) => (
            <button
              key={id}
              type="button"
              className={`btn btn-secondary btn-sm${editingTheme === id ? " theme-editor__edit-active" : ""}`}
              onClick={() => setEditingTheme(id)}
            >
              <Palette size={14} aria-hidden />
              {themeName(id)}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-editor__groups">
        {THEME_TOKEN_GROUPS.map((group) => (
          <details key={group.id} className="theme-editor__group" open={group.id === "surface" || group.id === "brand"}>
            <summary>{t(group.labelKey)}</summary>
            <ul className="theme-editor__token-list">
              {group.tokens.map((key) => {
                const value = palette[key];
                const customized = isCustomized(key);
                return (
                  <li key={key} className="theme-editor__token">
                    <label className="theme-editor__token-label" htmlFor={`theme-${editingTheme}-${key}`}>
                      {THEME_TOKEN_LABELS[key]}
                      {customized && <span className="theme-editor__custom-dot" title="Customized" />}
                    </label>
                    <input
                      id={`theme-${editingTheme}-${key}`}
                      type="color"
                      className="theme-editor__color-input"
                      value={value}
                      onChange={(e) => onColorChange(key, e.target.value)}
                    />
                    <input
                      type="text"
                      className="theme-editor__hex-input mono"
                      value={value}
                      spellCheck={false}
                      onChange={(e) => onColorChange(key, e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm theme-editor__reset-token"
                      disabled={!customized}
                      title={t("settings.appearance.resetToken")}
                      onClick={() => resetColorForTheme(editingTheme, key)}
                    >
                      <RotateCcw size={14} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>

      <footer className="theme-editor__footer">
        <Button type="button" onClick={onSave}>
          <Save size={14} aria-hidden />
          {t("settings.appearance.save")}
        </Button>
        <Button type="button" variant="secondary" onClick={onResetPalette}>
          <RotateCcw size={14} aria-hidden />
          {t("settings.appearance.resetPalette")}
        </Button>
      </footer>
    </section>
  );
}
