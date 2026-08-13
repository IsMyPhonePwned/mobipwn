import { Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";

type Props = {
  open: boolean;
  ruleName?: string;
  busy?: boolean;
  onClose: () => void;
  onDryRun: () => void;
  onCreateAlerts: () => void;
};

export function RuleRunDialog({
  open,
  ruleName,
  busy,
  onClose,
  onDryRun,
  onCreateAlerts,
}: Props) {
  const { t } = useLocale();

  if (!open) return null;

  return (
    <div className="rule-run-dialog-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <div
        className="rule-run-dialog card"
        role="dialog"
        aria-labelledby="rule-run-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rule-run-dialog__header">
          <Play size={18} aria-hidden />
          <h2 id="rule-run-dialog-title">{t("rulesPage.runDialogTitle")}</h2>
        </header>
        <p className="rule-run-dialog__intro muted">
          {ruleName ? (
            <>
              <strong>{ruleName}</strong>
              <br />
            </>
          ) : null}
          {t("rulesPage.runDialogIntro")}
        </p>
        <div className="rule-run-dialog__options">
          <button
            type="button"
            className="rule-run-dialog__option"
            disabled={busy}
            onClick={onDryRun}
          >
            <Search size={16} aria-hidden />
            <span>
              <strong>{t("rulesPage.runDialogDryRun")}</strong>
              <span className="muted text-sm">{t("rulesPage.runDialogDryRunHint")}</span>
            </span>
          </button>
          <button
            type="button"
            className="rule-run-dialog__option rule-run-dialog__option--primary"
            disabled={busy}
            onClick={onCreateAlerts}
          >
            <Play size={16} aria-hidden />
            <span>
              <strong>{t("rulesPage.runDialogWithAlerts")}</strong>
              <span className="muted text-sm">{t("rulesPage.runDialogWithAlertsHint")}</span>
            </span>
          </button>
        </div>
        <footer className="rule-run-dialog__footer">
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </footer>
      </div>
    </div>
  );
}
