import { Fragment, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { parseProcessReason } from "@/lib/processFindingDisplay";

export function ProcessFindingReason({ reason }: { reason: string }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const parsed = parseProcessReason(reason);
  const longArgs = (parsed.args?.length ?? 0) > 140;

  return (
    <div className="ironsift-process-reason">
      <div className="ironsift-process-reason__headline">{parsed.headline}</div>
      <dl className="ironsift-process-reason__meta">
        {parsed.pid != null && (
          <Fragment key="pid">
            <dt>PID</dt>
            <dd className="mono">{parsed.pid}</dd>
          </Fragment>
        )}
        {parsed.ppid != null && (
          <Fragment key="ppid">
            <dt>PPID</dt>
            <dd className="mono">{parsed.ppid}</dd>
          </Fragment>
        )}
        {parsed.uid != null && (
          <Fragment key="uid">
            <dt>UID</dt>
            <dd className="mono">{parsed.uid}</dd>
          </Fragment>
        )}
        {parsed.count != null && (
          <Fragment key="count">
            <dt>{t("ironsift.processFindingCount")}</dt>
            <dd className="mono">{parsed.count}</dd>
          </Fragment>
        )}
        {parsed.path && (
          <Fragment key="path">
            <dt>{t("ironsift.processFindingPath")}</dt>
            <dd className="mono ironsift-process-reason__path">{parsed.path}</dd>
          </Fragment>
        )}
        {parsed.flags && (
          <Fragment key="flags">
            <dt>{t("ironsift.processFindingFlags")}</dt>
            <dd>{parsed.flags.replace(/_/g, " ")}</dd>
          </Fragment>
        )}
      </dl>
      {parsed.args && (
        <div className="ironsift-process-reason__args">
          <span className="muted text-xs">{t("ironsift.processFindingArgs")}</span>
          <p className="mono ironsift-reason-text">
            {longArgs && !expanded ? `${parsed.args.slice(0, 140)}…` : parsed.args}
          </p>
          {longArgs && (
            <button
              type="button"
              className="ironsift-inline-link ironsift-reason-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? t("ironsift.findingsReasonCollapse") : t("ironsift.findingsReasonExpand")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
