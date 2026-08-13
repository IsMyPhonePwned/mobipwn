import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { parseIronSiftError } from "@/lib/ironsiftActivity";
import { AnomarkConfigProfilesBar } from "@/components/ironsift/ConfigProfilesBar";
import { IronSiftConfigSaveBar } from "@/components/ironsift/IronSiftConfigSaveBar";
import { mergeAnomarkConfig, type AnoMarkPlatformConfig } from "@/lib/ironsift";

function bool(v: unknown, fallback: boolean) {
  return typeof v === "boolean" ? v : fallback;
}

function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function listToLines(items: string[]): string {
  return items.join("\n");
}

export function AnoMarkConfigEditor({
  config,
  canWrite,
  onSave,
  onSaved,
  onReload,
  onProfileSuccess,
  onError,
}: {
  config: AnoMarkPlatformConfig;
  canWrite: boolean;
  onSave: (cfg: AnoMarkPlatformConfig) => Promise<void>;
  onSaved?: () => void;
  onReload?: () => void | Promise<void>;
  onProfileSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const { t } = useLocale();
  const [anomark, setAnomark] = useState(() => mergeAnomarkConfig(config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAnomark(mergeAnomarkConfig(config));
  }, [config]);

  function patch(patch: Partial<AnoMarkPlatformConfig>) {
    setAnomark((prev) => ({ ...prev, ...patch }));
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave(anomark);
      onSaved?.();
    } catch (e) {
      const msg = parseIronSiftError(e);
      setError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  const savedConfig = useMemo(() => mergeAnomarkConfig(config), [config]);
  const isDirty = useMemo(
    () => JSON.stringify(anomark) !== JSON.stringify(savedConfig),
    [anomark, savedConfig]
  );

  return (
    <div className="ironsift-anomark-config">
      <AnomarkConfigProfilesBar
        canWrite={canWrite}
        getCurrentConfig={() => anomark}
        onApplied={onReload ?? onSaved ?? (() => {})}
        onError={onError}
        onSuccess={onProfileSuccess}
      />
      <IronSiftConfigSaveBar
        canWrite={canWrite}
        isDirty={isDirty}
        busy={busy}
        saveLabel={t("ironsift.configAnomarkSave")}
        onSave={() => void save()}
      />
      <p className="muted text-xs">{t("ironsift.configAnomarkPanelHint")}</p>
      <details className="ironsift-config-section" open>
        <summary>{t("ironsift.configAnomarkTrainingTitle")}</summary>
        <div className="ironsift-config-section__body">
        <div className="ironsift-config-grid">
          <label className="ironsift-config-field">
            <span className="muted text-xs mono">default_order</span>
            <input
              type="number"
              className="mono"
              disabled={!canWrite}
              min={1}
              max={8}
              value={anomark.default_order}
              onChange={(e) => patch({ default_order: Number(e.target.value) })}
            />
          </label>
          <label className="ironsift-config-field">
            <span className="muted text-xs mono">default_suspect_percent</span>
            <input
              type="number"
              className="mono"
              disabled={!canWrite}
              min={55}
              max={99.999}
              step={0.5}
              value={anomark.default_suspect_percent}
              onChange={(e) => patch({ default_suspect_percent: Number(e.target.value) })}
            />
          </label>
          <label className="ironsift-config-field">
            <span className="muted text-xs mono">parallel_train_lines</span>
            <input
              type="number"
              className="mono"
              disabled={!canWrite}
              min={100}
              value={anomark.parallel_train_lines}
              onChange={(e) => patch({ parallel_train_lines: Number(e.target.value) })}
            />
          </label>
          <label className="ironsift-config-field">
            <span className="muted text-xs mono">max_reasons_per_host</span>
            <input
              type="number"
              className="mono"
              disabled={!canWrite}
              min={1}
              max={20}
              value={anomark.max_reasons_per_host}
              onChange={(e) => patch({ max_reasons_per_host: Number(e.target.value) })}
            />
          </label>
        </div>
        </div>
      </details>

      <details className="ironsift-config-section" open>
        <summary>{t("ironsift.configAnomarkFiltersTitle")}</summary>
        <div className="ironsift-config-section__body">
        <p className="muted text-xs">{t("ironsift.configAnomarkHint")}</p>
        <div className="ironsift-config-grid">
          <label className="ironsift-config-check ironsift-config-check--wide">
            <input
              type="checkbox"
              disabled={!canWrite}
              checked={bool(anomark.exclude_kernel_threads, true)}
              onChange={(e) => patch({ exclude_kernel_threads: e.target.checked })}
            />
            <span className="mono text-xs">exclude_kernel_threads</span>
          </label>
          <label className="ironsift-config-list-field ironsift-config-list-field--wide">
            <span className="muted text-xs">{t("ironsift.configAnomarkExcludeRegex")}</span>
            <textarea
              className="mono"
              rows={4}
              disabled={!canWrite}
              placeholder={t("ironsift.configAnomarkExcludeRegexPlaceholder")}
              value={listToLines(anomark.exclude_regex ?? [])}
              onChange={(e) => patch({ exclude_regex: linesToList(e.target.value) })}
            />
            <span className="muted text-xs">{t("ironsift.configAnomarkExcludeRegexHint")}</span>
          </label>
        </div>
        </div>
      </details>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
