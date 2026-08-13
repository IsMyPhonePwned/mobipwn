import { Code2, Moon, Sun, Terminal } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useTheme } from "@/contexts/ThemeContext";
import { nextTheme, themeLabelKey, type Theme } from "@/lib/theme";

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "matrix") return <Terminal size={16} strokeWidth={1.75} />;
  if (theme === "light") return <Sun size={16} strokeWidth={1.75} />;
  if (theme === "focus") return <Code2 size={16} strokeWidth={1.75} />;
  return <Moon size={16} strokeWidth={1.75} />;
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useLocale();
  const { log } = useActivityLog();
  const next = nextTheme(theme);
  const nextLabel = t(themeLabelKey(next));

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        toggleTheme();
        log("info", `Theme cycle → ${nextLabel}`);
      }}
      title={t("theme.cycle", { next: nextLabel })}
      aria-label={t("theme.cycle", { next: nextLabel })}
    >
      <ThemeIcon theme={theme} />
      <span className="theme-toggle-label">{t(themeLabelKey(theme))}</span>
    </button>
  );
}
