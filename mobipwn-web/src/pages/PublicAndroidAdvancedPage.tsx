import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WebsiteAdvancedMount } from "@/components/device-advanced/WebsiteAdvancedMount";
import { useLocale } from "@/contexts/LocaleContext";
import { fetchDeviceAdvancedStatus } from "@/lib/deviceAdvanced";
import workspaceHtml from "@/vendor/website-advanced/android/workspace.html?raw";
import "@/vendor/website-advanced/android/android-advanced.css";
import {
  bootAndroidAdvanced,
  resetAndroidAdvancedBoot,
} from "@/vendor/website-advanced/android/android-advanced-app.js";

export default function PublicAndroidAdvancedPage() {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetchDeviceAdvancedStatus()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  if (enabled === null) {
    return (
      <div className="device-advanced device-advanced--standalone">
        <p className="muted">{t("common.loading")}</p>
      </div>
    );
  }

  if (enabled === false) {
    return (
      <div className="device-advanced device-advanced--standalone">
        <p className="muted">{t("deviceAdvanced.disabledPublic")}</p>
      </div>
    );
  }

  return (
    <div className="device-advanced device-advanced--standalone">
      <header className="device-advanced__header">
        <div>
          <h1 className="device-advanced__title">
            <span className="device-advanced__title-icon device-advanced__title-icon--android">
              <Smartphone size={20} aria-hidden />
            </span>
            {t("deviceAdvanced.androidTitle")}
          </h1>
          <p className="muted text-sm device-advanced__nav-links">
            <Link to="/iphone-advanced">{t("deviceAdvanced.iphoneTitle")}</Link>
            <span aria-hidden>·</span>
            <Link to="/collect">{t("collector.openPage")}</Link>
          </p>
        </div>
        <div className="device-advanced__header-actions">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <p className="device-advanced__lead muted text-sm">{t("deviceAdvanced.androidLead")}</p>
      <WebsiteAdvancedMount
        html={workspaceHtml}
        id="adb-workspace-host"
        className="android-advanced-workspace"
        boot={bootAndroidAdvanced}
        reset={resetAndroidAdvancedBoot}
      />
    </div>
  );
}
