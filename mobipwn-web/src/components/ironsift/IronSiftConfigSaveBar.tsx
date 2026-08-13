import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";

export function IronSiftConfigSaveBar({
  canWrite,
  isDirty,
  busy,
  saveLabel,
  onSave,
}: {
  canWrite: boolean;
  isDirty: boolean;
  busy: boolean;
  saveLabel: string;
  onSave: () => void;
}) {
  const { t } = useLocale();
  if (!canWrite) return null;

  return (
    <div className={`ironsift-config-savebar${isDirty ? " ironsift-config-savebar--dirty" : ""}`}>
      <span className="ironsift-config-savebar__status muted text-xs">
        {isDirty ? t("ironsift.configUnsaved") : t("ironsift.configSavedState")}
      </span>
      <Button disabled={busy || !isDirty} size="sm" onClick={onSave}>
        {busy ? t("ironsift.running") : saveLabel}
      </Button>
    </div>
  );
}
