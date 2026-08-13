import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLocale } from "@/contexts/LocaleContext";
import { DEFAULT_IOS_COLLECT } from "@/lib/collectorConfig";
import {
  fetchPublicCollectConfig,
  savePublicCollectConfig,
  type PublicCollectConfig,
} from "@/lib/publicCollect";
import { DEFAULT_ANDROID_COLLECT } from "@/lib/androidCollectConfig";

type Props = {
  disabled?: boolean;
  onMessage?: (msg: string) => void;
};

/**
 * Admin toggle for iOS sysdiagnose upload on the public /collect page.
 * Mirrors the logarchive-style checkbox pattern under Settings → General.
 */
export function SettingsIosPublicCollectSection({ disabled = false, onMessage }: Props) {
  const { t } = useLocale();
  const [cfg, setCfg] = useState<PublicCollectConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchPublicCollectConfig();
      setCfg({
        ...next,
        android_collect: { ...DEFAULT_ANDROID_COLLECT, ...next.android_collect },
        ios_collect: { ...DEFAULT_IOS_COLLECT, ...next.ios_collect },
      });
    } catch (e) {
      onMessage?.(String(e));
    } finally {
      setLoading(false);
    }
  }, [onMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await savePublicCollectConfig(cfg);
      onMessage?.(t("iosCollect.saved"));
    } catch (e) {
      onMessage?.(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !cfg) {
    return <p className="muted text-xs">{t("iosCollect.loading")}</p>;
  }

  return (
    <div className="settings-panel__block">
      <h3 className="settings-panel__subhead">{t("iosCollect.publicTitle")}</h3>
      <p className="muted text-xs">{t("iosCollect.publicSubtitle")}</p>

      <label className="settings-row settings-row--checkbox">
        <input
          type="checkbox"
          checked={cfg.ios_collect.upload_enabled}
          disabled={disabled || saving}
          onChange={(e) =>
            setCfg({
              ...cfg,
              ios_collect: { ...cfg.ios_collect, upload_enabled: e.target.checked },
            })
          }
        />
        <div>
          <span className="settings-row__label">{t("iosCollect.uploadEnabledLabel")}</span>
          <p className="muted text-xs">{t("iosCollect.uploadEnabledHint")}</p>
        </div>
      </label>

      <p className="muted text-xs">
        {t("iosCollect.moreInCollector")}{" "}
        <Link to="/collector?tab=settings">{t("iosCollect.openCollectorSettings")}</Link>
      </p>

      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled || saving}
        onClick={() => void save()}
      >
        {saving ? t("iosCollect.saving") : t("iosCollect.save")}
      </button>
    </div>
  );
}
