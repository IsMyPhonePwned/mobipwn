import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { CasePlatformIcon } from "@/components/icons/PlatformIcons";
import { useLocale } from "@/contexts/LocaleContext";
import { usePlatformCaseTops } from "@/hooks/usePlatformCaseTops";
import { drilldownSearchUrl } from "@/lib/dashboard";
import { formatPlatformTopLabel, queryForSection } from "@/lib/platformCaseTops";

type Props = {
  timePreset: string;
  refreshKey: number;
};

function platformBadge(sectionId: string): "android" | "ios" {
  return sectionId.startsWith("ios") ? "ios" : "android";
}

export function PlatformCaseTopsPanel({ timePreset, refreshKey }: Props) {
  const { t } = useLocale();
  const { sections, loading } = usePlatformCaseTops(timePreset, refreshKey);

  return (
    <div className="platform-case-tops">
      {sections.map(({ section, items, loading: sectionLoading, error }) => {
        const query = queryForSection(section, timePreset);
        const badge = platformBadge(section.id);
        return (
          <section key={section.id} className={`platform-case-tops__section platform-case-tops__section--${badge}`}>
            <header className="platform-case-tops__header">
              <span className={`platform-case-tops__badge platform-case-tops__badge--${badge}`}>
                <CasePlatformIcon platform={badge} size={12} />
                {badge}
              </span>
              <h3 className="platform-case-tops__title">{t(`dashboards.${section.labelKey}`)}</h3>
            </header>
            {sectionLoading && items.length === 0 ? (
              <div className="platform-case-tops__loading">
                <Loader2 size={14} className="animate-spin" aria-hidden />
              </div>
            ) : error ? (
              <p className="platform-case-tops__error">{error}</p>
            ) : items.length === 0 ? (
              <p className="platform-case-tops__empty muted">{t("dashboards.platformTopsEmpty")}</p>
            ) : (
              <ol className="platform-case-tops__list">
                {items.map((item, idx) => (
                  <li key={`${item.label}-${idx}`} className="platform-case-tops__row">
                    <span className="platform-case-tops__rank">{idx + 1}</span>
                    <Link
                      to={drilldownSearchUrl(query, item.field, item.label)}
                      className="platform-case-tops__label mono"
                      title={item.label}
                    >
                      {formatPlatformTopLabel(item.field, item.label)}
                    </Link>
                    <span className="platform-case-tops__count">{item.value.toLocaleString()}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
      {loading && sections.every((s) => s.items.length === 0 && !s.error) && (
        <div className="platform-case-tops__overlay-loading">
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}
    </div>
  );
}
