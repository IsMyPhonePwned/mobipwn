import type { IngestProgressStep } from "@/lib/ingestProgress";

type Props = {
  visible: boolean;
  title: string;
  percent: number;
  phaseLabel: string;
  detail?: string;
  steps: IngestProgressStep[];
  mode?: string;
};

export function IronSiftRunProgressPanel({
  visible,
  title,
  percent,
  phaseLabel,
  detail,
  steps,
  mode = "fleet",
}: Props) {
  if (!visible) return null;

  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div
      className={`ironsift-run-progress ironsift-run-progress--${mode}`}
      role="status"
      aria-live="polite"
    >
      <div className="ironsift-run-progress__glow" aria-hidden />
      <div className="ironsift-run-progress__header">
        <span className="ironsift-run-progress__title">{title}</span>
        <span className="ironsift-run-progress__pct mono">{clamped}%</span>
      </div>
      <div className="ironsift-run-progress__bar" aria-hidden>
        <div className="ironsift-run-progress__fill" style={{ width: `${clamped}%` }} />
      </div>
      <p className="ironsift-run-progress__phase">{phaseLabel}</p>
      {detail ? <p className="ironsift-run-progress__detail mono">{detail}</p> : null}
      {steps.length > 0 && (
        <ol className="ironsift-run-progress__steps">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`ironsift-run-progress__step ironsift-run-progress__step--${step.status}`}
            >
              <span className="ironsift-run-progress__step-dot" aria-hidden />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
