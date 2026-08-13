import { useLocale } from "@/contexts/LocaleContext";
import type { IosCollectConfig } from "@/lib/collectorConfig";
import { SettingsSysdiagnoseIngestSection } from "@/components/settings/SettingsSysdiagnoseIngestSection";

type Props = {
  value: IosCollectConfig;
  onChange: (next: IosCollectConfig) => void;
  disabled?: boolean;
  onMessage?: (msg: string) => void;
};

export function SettingsIosCollectSection({
  value,
  onChange,
  disabled = false,
  onMessage,
}: Props) {
  const { t } = useLocale();

  return (
    <div className="collector-platform-settings">
      <label className="settings-row settings-row--checkbox">
        <input
          type="checkbox"
          checked={value.upload_enabled}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, upload_enabled: e.target.checked })}
        />
        <div>
          <span className="settings-row__label">{t("iosCollect.uploadEnabledLabel")}</span>
          <p className="muted text-xs">{t("iosCollect.uploadEnabledHint")}</p>
        </div>
      </label>

      <label className="settings-field">
        <span className="settings-field__label">{t("iosCollect.instructionsLabel")}</span>
        <textarea
          rows={4}
          value={value.instructions}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, instructions: e.target.value })}
        />
        <span className="muted text-xs">{t("iosCollect.instructionsHint")}</span>
      </label>

      <div className="collector-platform-settings__ingest">
        <p className="muted text-xs">{t("iosCollect.ingestOptionsHint")}</p>
        <SettingsSysdiagnoseIngestSection disabled={disabled} onMessage={onMessage} />
      </div>
    </div>
  );
}
