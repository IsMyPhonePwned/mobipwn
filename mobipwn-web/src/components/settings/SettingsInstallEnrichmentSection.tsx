import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  DEFAULT_INSTALL_ENRICHMENT_CONFIG,
  newEmptyInstallEnrichmentRule,
  normalizeInstallEnrichmentConfig,
  type InstallEnrichmentConfig,
  type InstallEnrichmentRuleConfig,
} from "@/lib/mobileInstallEnrichment";

type Props = {
  disabled?: boolean;
  onMessage?: (msg: string) => void;
};

function termsToText(terms: string[]): string {
  return terms.join("\n");
}

function textToTerms(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function namePatternsToText(patterns: InstallEnrichmentRuleConfig["name_patterns"]): string {
  return patterns.map((p) => `${p.pattern} => ${p.name}`).join("\n");
}

function textToNamePatterns(text: string): InstallEnrichmentRuleConfig["name_patterns"] {
  const out: InstallEnrichmentRuleConfig["name_patterns"] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.includes("=>") ? "=>" : trimmed.includes("->") ? "->" : null;
    if (!sep) continue;
    const [pattern, ...rest] = trimmed.split(sep);
    const name = rest.join(sep).trim();
    if (pattern?.trim() && name) {
      out.push({ pattern: pattern.trim(), name });
    }
  }
  return out;
}

export function SettingsInstallEnrichmentSection({ disabled = false, onMessage }: Props) {
  const { t } = useLocale();
  const [config, setConfig] = useState<InstallEnrichmentConfig>(DEFAULT_INSTALL_ENRICHMENT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/settings/install_enrichment");
      if (res.ok) {
        const body = (await res.json()) as Partial<InstallEnrichmentConfig>;
        setConfig(normalizeInstallEnrichmentConfig(body));
      } else {
        setConfig(normalizeInstallEnrichmentConfig(DEFAULT_INSTALL_ENRICHMENT_CONFIG));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRule = (index: number, patch: Partial<InstallEnrichmentRuleConfig>) => {
    setConfig((c) => ({
      ...c,
      rules: c.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  };

  const removeRule = (index: number) => {
    setConfig((c) => ({ ...c, rules: c.rules.filter((_, i) => i !== index) }));
  };

  const addRule = () => {
    setConfig((c) => ({ ...c, rules: [...c.rules, newEmptyInstallEnrichmentRule()] }));
  };

  const resetDefaults = () => {
    setConfig(normalizeInstallEnrichmentConfig(DEFAULT_INSTALL_ENRICHMENT_CONFIG));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = normalizeInstallEnrichmentConfig(config);
      const res = await fetch("/api/v1/settings/install_enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        onMessage?.(await res.text());
        return;
      }
      setConfig(payload);
      onMessage?.(t("installEnrichment.saved"));
    } catch (e) {
      onMessage?.(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="muted text-xs">{t("installEnrichment.loading")}</p>;
  }

  return (
    <div className="settings-panel__block settings-install-enrichment">
      <h3 className="settings-panel__subhead">{t("installEnrichment.title")}</h3>
      <p className="muted text-xs">{t("installEnrichment.subtitle")}</p>

      <label className="settings-field">
        <span className="settings-field__label">{t("installEnrichment.windowLabel")}</span>
        <input
          type="number"
          min={1}
          max={1440}
          step={1}
          disabled={disabled || saving}
          value={config.window_minutes}
          onChange={(e) =>
            setConfig((c) => ({
              ...c,
              window_minutes: Number(e.target.value) || DEFAULT_INSTALL_ENRICHMENT_CONFIG.window_minutes,
            }))
          }
        />
        <span className="muted text-xs">{t("installEnrichment.windowHint")}</span>
      </label>

      <div className="settings-install-enrichment__rules">
        {config.rules.map((rule, index) => (
          <div key={`${rule.id}-${index}`} className="settings-install-enrichment__rule">
            <div className="settings-install-enrichment__rule-head">
              <label className="settings-row settings-row--checkbox">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={disabled || saving}
                  onChange={(e) => updateRule(index, { enabled: e.target.checked })}
                />
                <span className="settings-row__label">{t("installEnrichment.enabled")}</span>
              </label>
              <button
                type="button"
                className="btn btn-ghost settings-install-enrichment__remove"
                disabled={disabled || saving}
                onClick={() => removeRule(index)}
                title={t("installEnrichment.removeRule")}
              >
                <Trash2 size={14} />
                {t("installEnrichment.removeRule")}
              </button>
            </div>

            <div className="settings-install-enrichment__grid">
              <label className="settings-field">
                <span className="settings-field__label">{t("installEnrichment.idLabel")}</span>
                <input
                  type="text"
                  disabled={disabled || saving}
                  value={rule.id}
                  onChange={(e) => updateRule(index, { id: e.target.value })}
                />
              </label>
              <label className="settings-field">
                <span className="settings-field__label">{t("installEnrichment.kindLabel")}</span>
                <select
                  disabled={disabled || saving}
                  value={rule.kind === "ipa" ? "ipa" : "sideload_tool"}
                  onChange={(e) => updateRule(index, { kind: e.target.value })}
                >
                  <option value="ipa">{t("installEnrichment.kindIpa")}</option>
                  <option value="sideload_tool">{t("installEnrichment.kindTool")}</option>
                </select>
              </label>
              <label className="settings-field">
                <span className="settings-field__label">{t("installEnrichment.labelLabel")}</span>
                <input
                  type="text"
                  disabled={disabled || saving}
                  value={rule.label}
                  onChange={(e) => updateRule(index, { label: e.target.value })}
                />
              </label>
            </div>

            <label className="settings-field">
              <span className="settings-field__label">{t("installEnrichment.matchLabel")}</span>
              <input
                type="text"
                className="mono"
                disabled={disabled || saving}
                value={rule.match_pattern}
                onChange={(e) => updateRule(index, { match_pattern: e.target.value })}
              />
              <span className="muted text-xs">{t("installEnrichment.matchHint")}</span>
            </label>

            <label className="settings-field">
              <span className="settings-field__label">{t("installEnrichment.queryTermsLabel")}</span>
              <textarea
                rows={4}
                className="mono"
                disabled={disabled || saving}
                value={termsToText(rule.query_terms)}
                onChange={(e) => updateRule(index, { query_terms: textToTerms(e.target.value) })}
              />
              <span className="muted text-xs">{t("installEnrichment.queryTermsHint")}</span>
            </label>

            <label className="settings-field">
              <span className="settings-field__label">{t("installEnrichment.namePatternsLabel")}</span>
              <textarea
                rows={3}
                className="mono"
                disabled={disabled || saving}
                value={namePatternsToText(rule.name_patterns)}
                onChange={(e) =>
                  updateRule(index, { name_patterns: textToNamePatterns(e.target.value) })
                }
              />
              <span className="muted text-xs">{t("installEnrichment.namePatternsHint")}</span>
            </label>
          </div>
        ))}
      </div>

      <div className="settings-install-enrichment__actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled || saving}
          onClick={addRule}
        >
          <Plus size={14} />
          {t("installEnrichment.addRule")}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled || saving}
          onClick={resetDefaults}
        >
          {t("installEnrichment.resetDefaults")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || saving || config.rules.length === 0}
          onClick={() => void save()}
        >
          {saving ? t("installEnrichment.saving") : t("installEnrichment.save")}
        </button>
      </div>
    </div>
  );
}
