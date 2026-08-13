import { useLocale } from "@/contexts/LocaleContext";
import type { AnoMarkTrainInspectResult } from "@/lib/ironsift";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function AnoMarkInspectPanel({
  data,
  onClose,
}: {
  data: AnoMarkTrainInspectResult;
  onClose?: () => void;
}) {
  const { t } = useLocale();
  const { record, inspection, sample_training_lines } = data;
  const request = record.request_json as {
    order?: number;
    tags?: string[];
    label?: string;
  };

  return (
    <div className="ironsift-anomark-inspect">
      <div className="ironsift-anomark-inspect__header">
        <h3>{record.label || record.id.slice(0, 8)}</h3>
        {onClose && (
          <button type="button" className="ironsift-anomark-inspect__close" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      <dl className="ironsift-anomark-inspect__grid">
        <dt>{t("ironsift.anomarkInspectId")}</dt>
        <dd className="mono">{record.id}</dd>
        <dt>{t("ironsift.colCreated")}</dt>
        <dd className="mono">{record.created_at.slice(0, 19)}</dd>
        <dt>{t("ironsift.colLines")}</dt>
        <dd>{record.training_line_count}</dd>
        <dt>{t("ironsift.anomarkInspectOrder")}</dt>
        <dd>{request.order ?? inspection.order}</dd>
        <dt>{t("ironsift.anomarkInspectModelPath")}</dt>
        <dd className="mono text-xs">{inspection.model_path}</dd>
        <dt>{t("ironsift.anomarkInspectModelSize")}</dt>
        <dd>{formatBytes(inspection.file_size_bytes)}</dd>
        <dt>{t("ironsift.anomarkInspectPrior")}</dt>
        <dd>{inspection.prior.toExponential(3)}</dd>
        <dt>{t("ironsift.anomarkInspectThreshold")}</dt>
        <dd>{inspection.suspect_threshold_ln.toFixed(4)}</dd>
        <dt>{t("ironsift.anomarkInspectContexts")}</dt>
        <dd>{inspection.num_contexts}</dd>
        <dt>{t("ironsift.anomarkInspectTransitions")}</dt>
        <dd>{inspection.num_transitions}</dd>
        <dt>{t("ironsift.anomarkInspectAlphabet")}</dt>
        <dd>{inspection.alphabet_len}</dd>
        <dt>{t("ironsift.anomarkInspectTrained")}</dt>
        <dd>{inspection.is_trained ? "✓" : "—"}</dd>
      </dl>

      {sample_training_lines.length > 0 && (
        <div className="ironsift-anomark-inspect__samples">
          <h4>{t("ironsift.anomarkInspectSamples")}</h4>
          <ol className="ironsift-anomark-inspect__sample-list">
            {sample_training_lines.map((line) => (
              <li key={line} className="mono text-xs">
                {line}
              </li>
            ))}
          </ol>
        </div>
      )}

      <details className="ironsift-anomark-inspect__raw">
        <summary className="muted text-xs">{t("ironsift.anomarkInspectRaw")}</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}
