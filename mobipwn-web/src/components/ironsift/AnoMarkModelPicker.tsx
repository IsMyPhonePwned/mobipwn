import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { parseIronSiftError } from "@/lib/ironsiftActivity";
import {
  formatAnoMarkTrainLabel,
  selectAnoMarkTrainForRuns,
  type AnoMarkTrainRecord,
} from "@/lib/ironsift";

export function AnoMarkModelPicker({
  trains,
  selectedTrainId,
  trainId,
  suspectPercent,
  canWrite,
  onTrainIdChange,
  onSuspectPercentChange,
  onSelectionSaved,
  onError,
  onSuccess,
  onOpenAnomark,
}: {
  trains: AnoMarkTrainRecord[];
  selectedTrainId: string | null;
  trainId: string;
  suspectPercent: number;
  canWrite: boolean;
  onTrainIdChange: (id: string) => void;
  onSuspectPercentChange: (pct: number) => void;
  onSelectionSaved?: () => void | Promise<void>;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
  onOpenAnomark?: () => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (trainId) return;
    if (selectedTrainId && trains.some((tr) => tr.id === selectedTrainId)) {
      onTrainIdChange(selectedTrainId);
      return;
    }
    const favorite = trains.find((tr) => tr.favorite);
    if (favorite) {
      onTrainIdChange(favorite.id);
      return;
    }
    if (trains[0]) onTrainIdChange(trains[0].id);
  }, [trainId, selectedTrainId, trains, onTrainIdChange]);

  async function applySelection() {
    if (!trainId) return;
    setBusy(true);
    try {
      await selectAnoMarkTrainForRuns(trainId);
      await onSelectionSaved?.();
      onSuccess?.(t("ironsift.runAnomarkModelApplied"));
    } catch (e) {
      onError?.(parseIronSiftError(e));
    } finally {
      setBusy(false);
    }
  }

  if (trains.length === 0) {
    return (
      <p className="muted text-xs">
        {t("ironsift.runAnomarkNoModels")}{" "}
        {onOpenAnomark && (
          <button type="button" className="ironsift-inline-link" onClick={onOpenAnomark}>
            {t("ironsift.tabAnomark")}
          </button>
        )}
      </p>
    );
  }

  return (
    <div className="ironsift-anomark-model-picker">
      <div className="ironsift-config-profiles ironsift-anomark-model-picker__bar">
        <label className="ironsift-config-field ironsift-config-field--profile">
          <span className="muted text-xs">{t("ironsift.runAnomarkModelLabel")}</span>
          <select
            className="mono"
            value={trainId}
            onChange={(e) => onTrainIdChange(e.target.value)}
          >
            <option value="">{t("ironsift.runAnomarkModelPick")}</option>
            {trains.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {formatAnoMarkTrainLabel(tr)} ({tr.training_line_count}{" "}
                {t("ironsift.runAnomarkModelLines")})
                {selectedTrainId === tr.id ? ` (${t("ironsift.runAnomarkModelDefault")})` : ""}
              </option>
            ))}
          </select>
        </label>
        {canWrite && (
          <Button variant="secondary" disabled={!trainId || busy} onClick={() => void applySelection()}>
            {t("ironsift.runAnomarkModelApply")}
          </Button>
        )}
        {onOpenAnomark && (
          <Button variant="secondary" onClick={onOpenAnomark}>
            {t("ironsift.runAnomarkManageModels")}
          </Button>
        )}
      </div>
      <label className="ironsift-config-field ironsift-anomark-model-picker__sensitivity">
        <span className="muted text-xs">{t("ironsift.anomarkSuspectPct")}</span>
        <input
          type="number"
          className="mono"
          min={55}
          max={99.999}
          step={0.5}
          value={suspectPercent}
          onChange={(e) => onSuspectPercentChange(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
