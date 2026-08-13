import { Languages } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import type { Locale } from "@/i18n";

const OPTIONS: { id: Locale; labelKey: string }[] = [
  { id: "en", labelKey: "locale.en" },
  { id: "fr", labelKey: "locale.fr" },
  { id: "zh", labelKey: "locale.zh" },
];

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useLocale();
  const { log } = useActivityLog();

  return (
    <label className="locale-switcher">
      <Languages size={14} strokeWidth={1.75} aria-hidden />
      <span className="sr-only">{t("locale.label")}</span>
      <select
        value={locale}
        onChange={(e) => {
          const next = e.target.value as Locale;
          setLocale(next);
          log("info", `Language: ${next}`);
        }}
        aria-label={t("locale.label")}
        className="locale-switcher-select"
      >
        {OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
    </label>
  );
}
