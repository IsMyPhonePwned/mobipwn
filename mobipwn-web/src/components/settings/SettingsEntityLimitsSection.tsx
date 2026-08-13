import { useCallback, useEffect, useState } from "react";

export type EntityLimitsConfig = {
  default_limit: number;
  process_limit: number;
};

const DEFAULT_CONFIG: EntityLimitsConfig = {
  default_limit: 50,
  process_limit: 500,
};

type Props = {
  disabled?: boolean;
  onMessage?: (msg: string) => void;
};

export function SettingsEntityLimitsSection({ disabled = false, onMessage }: Props) {
  const [config, setConfig] = useState<EntityLimitsConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/settings/entity_limits");
      if (!res.ok) return;
      const body = (await res.json()) as Partial<EntityLimitsConfig>;
      setConfig({
        default_limit:
          typeof body.default_limit === "number" ? body.default_limit : DEFAULT_CONFIG.default_limit,
        process_limit:
          typeof body.process_limit === "number" ? body.process_limit : DEFAULT_CONFIG.process_limit,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/settings/entity_limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        onMessage?.(await res.text());
        return;
      }
      onMessage?.("Saved entity limits");
    } catch (e) {
      onMessage?.(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="muted text-xs">Loading entity limits…</p>;
  }

  return (
    <div className="settings-panel__block">
      <h3 className="settings-panel__subhead">Entity limits</h3>
      <p className="muted text-xs">
        Cap how many entities are shown per type in case entities. Use a higher process limit for iOS
        sysdiagnose cases with many services and binaries.
      </p>

      <label className="settings-field">
        <span className="settings-field__label">Default entity cap</span>
        <input
          type="number"
          min={1}
          max={5000}
          step={1}
          disabled={disabled || saving}
          value={config.default_limit}
          onChange={(e) =>
            setConfig((c) => ({
              ...c,
              default_limit: Number(e.target.value) || DEFAULT_CONFIG.default_limit,
            }))
          }
        />
        <span className="muted text-xs">Applies to IPs, domains, bundles, users, hashes, URLs, files, and emails.</span>
      </label>

      <label className="settings-field">
        <span className="settings-field__label">Process entity cap</span>
        <input
          type="number"
          min={1}
          max={20000}
          step={1}
          disabled={disabled || saving}
          value={config.process_limit}
          onChange={(e) =>
            setConfig((c) => ({
              ...c,
              process_limit: Number(e.target.value) || DEFAULT_CONFIG.process_limit,
            }))
          }
        />
        <span className="muted text-xs">Processes often need a higher cap than other entity types.</span>
      </label>

      <button type="button" className="btn btn-primary" disabled={disabled || saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save entity limits"}
      </button>
    </div>
  );
}
