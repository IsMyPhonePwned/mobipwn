import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { SysdiagnoseIngestOptionsFields } from "@/components/ingest/SysdiagnoseIngestOptionsFields";

export type SysdiagnoseIngestConfig = {
  logarchive_decode_max_lines: number;
  ioservice_full_tree: boolean;
  logarchive_uncapped: boolean;
  max_entry_mb: number;
};

export const DEFAULT_SYSDIAGNOSE_INGEST_CONFIG: SysdiagnoseIngestConfig = {
  logarchive_decode_max_lines: 2500,
  ioservice_full_tree: false,
  logarchive_uncapped: false,
  max_entry_mb: 64,
};

type Props = {
  disabled?: boolean;
  onMessage?: (msg: string) => void;
};

export function SettingsSysdiagnoseIngestSection({ disabled = false, onMessage }: Props) {
  const { t } = useLocale();
  const [config, setConfig] = useState<SysdiagnoseIngestConfig>(DEFAULT_SYSDIAGNOSE_INGEST_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/settings/sysdiagnose_ingest");
      if (res.ok) {
        const body = (await res.json()) as Partial<SysdiagnoseIngestConfig>;
        setConfig({
          logarchive_decode_max_lines:
            typeof body.logarchive_decode_max_lines === "number"
              ? body.logarchive_decode_max_lines
              : DEFAULT_SYSDIAGNOSE_INGEST_CONFIG.logarchive_decode_max_lines,
          ioservice_full_tree: Boolean(body.ioservice_full_tree),
          logarchive_uncapped: Boolean(body.logarchive_uncapped),
          max_entry_mb:
            typeof body.max_entry_mb === "number"
              ? body.max_entry_mb
              : DEFAULT_SYSDIAGNOSE_INGEST_CONFIG.max_entry_mb,
        });
      }
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
      const res = await fetch("/api/v1/settings/sysdiagnose_ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        onMessage?.(await res.text());
        return;
      }
      onMessage?.(t("sysdiagnoseIngest.saved"));
    } catch (e) {
      onMessage?.(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="muted text-xs">{t("sysdiagnoseIngest.loading")}</p>;
  }

  return (
    <div className="settings-panel__block">
      <h3 className="settings-panel__subhead">{t("sysdiagnoseIngest.title")}</h3>
      <p className="muted text-xs">{t("sysdiagnoseIngest.subtitle")}</p>

      <SysdiagnoseIngestOptionsFields
        config={config}
        onChange={setConfig}
        disabled={disabled || saving}
        label={(key) => t(`sysdiagnoseIngest.${key}` as "sysdiagnoseIngest.logarchiveUncappedLabel")}
      />

      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled || saving}
        onClick={() => void save()}
      >
        {saving ? t("sysdiagnoseIngest.saving") : t("sysdiagnoseIngest.save")}
      </button>
    </div>
  );
}
