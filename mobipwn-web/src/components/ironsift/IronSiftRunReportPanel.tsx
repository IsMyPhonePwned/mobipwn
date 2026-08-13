import { useLocale } from "@/contexts/LocaleContext";
import type { IronSiftRun } from "@/lib/ironsift";
import { ironSiftRunReportRows } from "@/lib/ironsiftRunReport";

export function IronSiftRunReportPanel({ run }: { run: IronSiftRun }) {
  const { t } = useLocale();
  const rows = ironSiftRunReportRows(run, t);

  return (
    <div className="ironsift-run-report">
      <p className="ironsift-run-report__summary">{run.summary}</p>
      <dl className="ironsift-run-report__grid">
        {rows.map((row, index) => (
          <div key={`${index}-${row.label}`} className="ironsift-run-report__row">
            <dt className="muted text-xs">{row.label}</dt>
            <dd className="mono">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted text-xs ironsift-run-report__meta">
        {run.mode} / {run.scope} · {run.fleet_size} devices
        {run.finished_at ? ` · ${run.finished_at.slice(0, 19)}` : ""}
      </p>
    </div>
  );
}
