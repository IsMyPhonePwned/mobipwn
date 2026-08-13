import { Regex, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/contexts/LocaleContext";

type Props = {
  value: string;
  regexMode: boolean;
  onChange: (value: string) => void;
  onRegexModeChange: (enabled: boolean) => void;
  error?: string;
  matchCount?: number;
  totalCount?: number;
};

export function ResultsFilterBar({
  value,
  regexMode,
  onChange,
  onRegexModeChange,
  error,
  matchCount,
  totalCount,
}: Props) {
  const { t } = useLocale();
  const active = value.trim().length > 0;
  const showCount =
    active && !error && matchCount != null && totalCount != null && matchCount !== totalCount;

  return (
    <div className="results-filter-bar">
      <div className="results-filter-input-wrap">
        <Search size={14} className="results-filter-icon" aria-hidden />
        <Input
          className="results-filter-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("searchResults.filterPlaceholder")}
          spellCheck={false}
          aria-label={t("searchResults.filterLabel")}
        />
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="results-filter-clear"
            onClick={() => onChange("")}
            title={t("searchResults.filterClear")}
            aria-label={t("searchResults.filterClear")}
          >
            <X size={14} />
          </Button>
        )}
      </div>
      <Button
        type="button"
        variant={regexMode ? "secondary" : "ghost"}
        size="sm"
        className="results-filter-regex-btn"
        onClick={() => onRegexModeChange(!regexMode)}
        title={t("searchResults.filterRegexTitle")}
        aria-pressed={regexMode}
      >
        <Regex size={14} />
        <span>{t("searchResults.filterRegex")}</span>
      </Button>
      {showCount && (
        <span className="results-filter-count muted">
          {t("searchResults.filterCount")
            .replace("{{match}}", matchCount.toLocaleString())
            .replace("{{total}}", totalCount.toLocaleString())}
        </span>
      )}
      {error && <span className="results-filter-error">{t("searchResults.filterInvalid")}: {error}</span>}
    </div>
  );
}
