import type { SysdiagnoseIngestConfig } from "@/components/settings/SettingsSysdiagnoseIngestSection";

type Props = {
  config: SysdiagnoseIngestConfig;
  onChange: (next: SysdiagnoseIngestConfig) => void;
  disabled?: boolean;
  /** i18n key prefix — `sysdiagnoseIngest` (settings) or `ingest.sysdiagnose` */
  label: (key: string) => string;
};

const DEFAULT_LINES = 2500;
const DEFAULT_ENTRY_MB = 64;

/** Shared iOS sysdiagnose ingest knobs (Settings + Ingest page). */
export function SysdiagnoseIngestOptionsFields({
  config,
  onChange,
  disabled = false,
  label,
}: Props) {
  return (
    <>
      <label className="settings-row settings-row--checkbox">
        <input
          type="checkbox"
          checked={config.logarchive_uncapped}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...config,
              logarchive_uncapped: e.target.checked,
              ...(e.target.checked
                ? {
                    logarchive_decode_max_lines: 250000,
                    max_entry_mb:
                      config.max_entry_mb < 512
                        ? 512
                        : Math.min(config.max_entry_mb || 512, 1024),
                  }
                : {
                    logarchive_decode_max_lines:
                      config.logarchive_decode_max_lines >= 250000
                        ? DEFAULT_LINES
                        : config.logarchive_decode_max_lines || DEFAULT_LINES,
                    max_entry_mb: config.max_entry_mb || DEFAULT_ENTRY_MB,
                  }),
            })
          }
        />
        <div>
          <span className="settings-row__label">{label("logarchiveUncappedLabel")}</span>
          <p className="muted text-xs">{label("logarchiveUncappedHint")}</p>
        </div>
      </label>

      <label className="settings-field">
        <span className="settings-field__label">{label("logarchiveMaxLinesLabel")}</span>
        <input
          type="number"
          min={100}
          max={config.logarchive_uncapped ? 250000 : 50000}
          step={100}
          disabled={disabled || config.logarchive_uncapped}
          value={config.logarchive_decode_max_lines}
          onChange={(e) =>
            onChange({
              ...config,
              logarchive_decode_max_lines: Number(e.target.value) || DEFAULT_LINES,
            })
          }
        />
        <span className="muted text-xs">{label("logarchiveMaxLinesHint")}</span>
      </label>

      <label className="settings-field">
        <span className="settings-field__label">{label("maxEntryMbLabel")}</span>
        <input
          type="number"
          min={1}
          max={1024}
          step={64}
          disabled={disabled}
          value={config.max_entry_mb}
          onChange={(e) =>
            onChange({
              ...config,
              max_entry_mb: Math.min(Math.max(Number(e.target.value) || DEFAULT_ENTRY_MB, 1), 1024),
            })
          }
        />
        <span className="muted text-xs">{label("maxEntryMbHint")}</span>
      </label>

      <label className="settings-row settings-row--checkbox">
        <input
          type="checkbox"
          checked={config.ioservice_full_tree}
          disabled={disabled}
          onChange={(e) => onChange({ ...config, ioservice_full_tree: e.target.checked })}
        />
        <div>
          <span className="settings-row__label">{label("ioserviceFullTreeLabel")}</span>
          <p className="muted text-xs">{label("ioserviceFullTreeHint")}</p>
        </div>
      </label>
    </>
  );
}
