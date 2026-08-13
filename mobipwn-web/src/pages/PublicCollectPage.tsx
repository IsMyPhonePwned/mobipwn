import { Link, useSearchParams } from "react-router-dom";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PublicCollectPanel } from "@/components/collector/PublicCollectPanel";
import { AndroidIcon, AppleIcon } from "@/components/icons/PlatformIcons";
import { useLocale } from "@/contexts/LocaleContext";

/** Standalone public device collection (no app shell, no login). */
export default function PublicCollectPage() {
  const { t } = useLocale();
  const [searchParams] = useSearchParams();
  const platform = searchParams.get("platform") === "ios" ? "ios" : "android";

  return (
    <div
      className={`public-collect public-collect--standalone${
        platform === "ios" ? " public-collect--ios" : " public-collect--android"
      }`}
    >
      <header className="public-collect__header public-collect__header--standalone">
        <div className="public-collect__header-copy">
          <h1 className="public-collect__title">
            {platform === "ios" ? (
              <AppleIcon size={22} className="public-collect__title-icon" />
            ) : (
              <AndroidIcon size={22} className="public-collect__title-icon" />
            )}
            {t("collector.collectTitle")}
          </h1>
          <p className="muted text-sm public-collect__lead">
            {platform === "ios"
              ? t("collector.collectSubtitleIos")
              : t("collector.collectSubtitleAndroid")}
          </p>
          <p className="muted text-xs public-collect__analyst-hint">
            {t("collector.collectPublicAnalyst")}{" "}
            <Link to="/login">{t("collector.collectPublicAnalystLogin")}</Link>
            {" · "}
            {platform === "ios" ? (
              <Link to="/iphone-advanced">{t("deviceAdvanced.iphoneTitle")}</Link>
            ) : (
              <Link to="/android-advanced">{t("deviceAdvanced.androidTitle")}</Link>
            )}
          </p>
        </div>
        <div className="public-collect__header-actions">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <PublicCollectPanel />
    </div>
  );
}
