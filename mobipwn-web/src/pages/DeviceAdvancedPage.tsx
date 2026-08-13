import { Link } from "react-router-dom";
import { ExternalLink, Puzzle, Smartphone } from "lucide-react";
import { AppleIcon } from "@/components/icons/PlatformIcons";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLocale } from "@/contexts/LocaleContext";
import { usePlugins } from "@/contexts/PluginsContext";
import { DEVICE_ADVANCED_PLUGIN_ID } from "@/lib/plugins";

export default function DeviceAdvancedPage() {
  const { t } = useLocale();
  const { plugins, loaded } = usePlugins();
  const plugin = plugins.find((p) => p.id === DEVICE_ADVANCED_PLUGIN_ID);
  const enabled = plugin?.enabled ?? false;

  return (
    <div className="device-advanced-page">
      <PageHeader
        title={t("deviceAdvanced.settingsTitle")}
        description={t("deviceAdvanced.settingsSubtitle")}
      />

      <section className="card device-advanced-settings">
        <header className="device-advanced-settings__head">
          <Puzzle className="icon" aria-hidden />
          <div>
            <h2 className="device-advanced-settings__title">{t("deviceAdvanced.settingsCardTitle")}</h2>
            <p className="muted text-sm">{t("deviceAdvanced.settingsCardHint")}</p>
          </div>
        </header>

        {!loaded ? (
          <p className="muted">{t("common.loading")}</p>
        ) : (
          <p className="device-advanced-settings__status text-sm">
            <span
              className={`device-advanced-settings__badge${enabled ? " device-advanced-settings__badge--on" : ""}`}
            >
              {enabled ? t("plugins.enabled") : t("plugins.disabled")}
            </span>
            <Link to="/settings?section=plugins" className="text-xs">
              {t("plugins.openSettings")}
            </Link>
          </p>
        )}

        <div className="device-advanced-settings__links">
          <div className="device-advanced-settings__link-card">
            <div className="device-advanced-settings__link-copy">
              <span className="device-advanced-settings__link-icon device-advanced-settings__link-icon--ios">
                <AppleIcon size={18} aria-hidden />
              </span>
              <div>
                <strong>{t("deviceAdvanced.iphoneTitle")}</strong>
                <p className="muted text-xs">{t("deviceAdvanced.iphoneLead")}</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/iphone-advanced" target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden />
                {t("deviceAdvanced.openIphonePublic")}
              </Link>
            </Button>
          </div>

          <div className="device-advanced-settings__link-card">
            <div className="device-advanced-settings__link-copy">
              <span className="device-advanced-settings__link-icon device-advanced-settings__link-icon--android">
                <Smartphone size={18} aria-hidden />
              </span>
              <div>
                <strong>{t("deviceAdvanced.androidTitle")}</strong>
                <p className="muted text-xs">{t("deviceAdvanced.androidLead")}</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/android-advanced" target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden />
                {t("deviceAdvanced.openAndroidPublic")}
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
