import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_SYNC_CRON, type EnrichmentProvider } from "@/lib/enrichment";
import { useLocale } from "@/contexts/LocaleContext";

type PresetId = "default" | "15m" | "hourly" | "6h" | "daily" | "manual" | "custom";

const PRESETS: Record<Exclude<PresetId, "custom">, string> = {
  default: DEFAULT_SYNC_CRON,
  "15m": "0 */15 * * *",
  hourly: "0 * * * *",
  "6h": "0 */6 * * *",
  daily: "0 0 * * *",
  manual: "manual",
};

function presetFromCron(cron: string | undefined): { preset: PresetId; custom: string } {
  if (!cron || cron === "manual") return { preset: "manual", custom: "" };
  if (cron === DEFAULT_SYNC_CRON || cron === `0 ${DEFAULT_SYNC_CRON}`) {
    return { preset: "default", custom: "" };
  }
  for (const [id, expr] of Object.entries(PRESETS)) {
    if (id !== "manual" && id !== "default" && cron === expr) {
      return { preset: id as PresetId, custom: "" };
    }
  }
  return { preset: "custom", custom: cron };
}

type Props = {
  provider: EnrichmentProvider;
  onSaved: () => void;
};

export function ProviderSyncSchedule({ provider, onSaved }: Props) {
  const { t } = useLocale();
  const initial = useMemo(
    () => presetFromCron((provider.config?.sync_cron as string | undefined) ?? undefined),
    [provider.config]
  );
  const [preset, setPreset] = useState<PresetId>(initial.preset);
  const [customCron, setCustomCron] = useState(initial.custom);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const next = presetFromCron((provider.config?.sync_cron as string | undefined) ?? undefined);
    setPreset(next.preset);
    setCustomCron(next.custom);
    setMessage("");
    setError("");
  }, [provider.id, provider.config]);

  const resolvedCron = useMemo(() => {
    if (preset === "manual") return "manual";
    if (preset === "custom") return customCron.trim();
    return PRESETS[preset];
  }, [preset, customCron]);

  const save = useCallback(async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (preset === "custom" && !customCron.trim()) {
        throw new Error(t("marketplace.syncScheduleCustomRequired"));
      }
      const config = { ...(provider.config ?? {}) };
      if (preset === "manual") {
        config.sync_cron = "manual";
      } else if (preset === "default") {
        config.sync_cron = DEFAULT_SYNC_CRON;
      } else {
        config.sync_cron = resolvedCron;
      }
      const res = await fetch(`/api/v1/marketplace/providers/${provider.id}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage(t("marketplace.syncScheduleSaved"));
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [customCron, onSaved, preset, provider, resolvedCron, t]);

  const scheduleHint =
    preset === "manual"
      ? t("marketplace.syncScheduleManualHint")
      : t("marketplace.syncScheduleAutoHint").replace("{{cron}}", resolvedCron);

  return (
    <div className="provider-sync-schedule">
      <label className="provider-sync-schedule-label">
        <span>{t("marketplace.syncScheduleLabel")}</span>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as PresetId)}
          disabled={!provider.enabled}
        >
          <option value="default">{t("marketplace.syncScheduleEvery5m")}</option>
          <option value="15m">{t("marketplace.syncScheduleEvery15m")}</option>
          <option value="hourly">{t("marketplace.syncScheduleHourly")}</option>
          <option value="6h">{t("marketplace.syncScheduleEvery6h")}</option>
          <option value="daily">{t("marketplace.syncScheduleDaily")}</option>
          <option value="manual">{t("marketplace.syncScheduleManual")}</option>
          <option value="custom">{t("marketplace.syncScheduleCustom")}</option>
        </select>
      </label>
      {preset === "custom" && (
        <label className="provider-sync-schedule-custom">
          <span>{t("marketplace.syncScheduleCron")}</span>
          <Input
            className="mono"
            value={customCron}
            onChange={(e) => setCustomCron(e.target.value)}
            placeholder="0 */30 * * *"
            disabled={!provider.enabled}
          />
        </label>
      )}
      <p className="muted provider-sync-schedule-hint">{scheduleHint}</p>
      {provider.enabled && (
        <Button size="sm" variant="secondary" onClick={() => void save()} disabled={saving}>
          {saving ? t("common.loading") : t("marketplace.syncScheduleSave")}
        </Button>
      )}
      {!provider.enabled && (
        <p className="muted provider-sync-schedule-hint">{t("marketplace.syncScheduleDisabledHint")}</p>
      )}
      {message && <p className="provider-config-ok">{message}</p>}
      {error && <p className="provider-config-error">{error}</p>}
    </div>
  );
}
