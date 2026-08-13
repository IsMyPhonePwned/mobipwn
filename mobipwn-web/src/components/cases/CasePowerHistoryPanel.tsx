import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Loader2, Power, RotateCcw, Zap } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_POWER_HISTORY_PANEL_ID } from "@/lib/caseDashboard";
import {
  powerHistoryQuery,
  powerPanelViewFromRows,
  type PowerHistoryEventView,
  type PowerResetView,
} from "@/lib/powerHistory";

function powerKindClass(eventType: string): string {
  const et = eventType.toUpperCase();
  if (et.includes("SHUTDOWN")) return "case-power-kind--shutdown";
  if (et.includes("REBOOT")) return "case-power-kind--reboot";
  return "case-power-kind--history";
}

function PowerFieldGrid({
  fields,
}: {
  fields: Array<{ key: string; label: string; value: string }>;
}) {
  if (!fields.length) return null;
  return (
    <dl className="case-power-fields">
      {fields.map((field) => (
        <div key={field.key} className="case-power-fields__row">
          <dt>{field.label}</dt>
          <dd className="mono" title={field.value}>
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HistoryEventCard({ event }: { event: PowerHistoryEventView }) {
  return (
    <li className="case-power-event">
      <div className="case-power-event__head">
        <span className={`case-power-kind ${powerKindClass(event.eventType)}`}>{event.eventType}</span>
        {event.when && (
          <time className="case-power-event__time mono text-xs" dateTime={event.when}>
            {event.when}
          </time>
        )}
      </div>
      <dl className="case-power-event__facts">
        {event.flags && (
          <div>
            <dt>Flags</dt>
            <dd className="mono">{event.flags}</dd>
          </div>
        )}
        {event.details && (
          <div>
            <dt>Details</dt>
            <dd className="mono">{event.details}</dd>
          </div>
        )}
        {event.entryTimestamp && (
          <div>
            <dt>Reset block</dt>
            <dd className="mono">{event.entryTimestamp}</dd>
          </div>
        )}
      </dl>
      <PowerFieldGrid fields={event.extraFields} />
    </li>
  );
}

function ResetBlockCard({ reset }: { reset: PowerResetView }) {
  return (
    <li className="case-power-reset">
      <div className="case-power-reset__head">
        <Power size={14} aria-hidden />
        <strong className="mono">{reset.reason}</strong>
        {reset.when && (
          <time className="case-power-event__time mono text-xs" dateTime={reset.when}>
            {reset.when}
          </time>
        )}
      </div>

      <dl className="case-power-event__facts">
        {reset.entryTimestamp && (
          <div>
            <dt>Block time</dt>
            <dd className="mono">{reset.entryTimestamp}</dd>
          </div>
        )}
      </dl>

      {reset.stackTrace.length > 0 && (
        <details className="case-power-reset__details" open>
          <summary className="case-power-reset__summary">
            Stack trace ({reset.stackTrace.length} lines)
          </summary>
          <pre className="case-power-reset__stack mono text-xs">{reset.stackTrace.join("\n")}</pre>
        </details>
      )}

      {reset.otherLines.length > 0 && (
        <details className="case-power-reset__details">
          <summary className="case-power-reset__summary">
            Other lines ({reset.otherLines.length})
          </summary>
          <pre className="case-power-reset__stack mono text-xs">{reset.otherLines.join("\n")}</pre>
        </details>
      )}

      {reset.nestedHistory.length > 0 && (
        <div className="case-power-reset__nested">
          <h5 className="case-power-reset__nested-title">
            Events in this reset block ({reset.nestedHistory.length})
          </h5>
          <ul className="case-power-events case-power-events--nested">
            {reset.nestedHistory.map((event, i) => (
              <HistoryEventCard key={`${reset.entryTimestamp}-${event.eventType}-${i}`} event={event} />
            ))}
          </ul>
        </div>
      )}

      <PowerFieldGrid fields={reset.extraFields} />
    </li>
  );
}

export function CasePowerHistoryPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_POWER_HISTORY_PANEL_ID,
      title: "Power history",
      query: powerHistoryQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_POWER_HISTORY_PANEL_ID, x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 4 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const view = useMemo(() => powerPanelViewFromRows(rows), [rows]);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-power-panel case-power-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-power-panel case-power-panel--error muted text-xs">{error}</p>;
  }

  if (!view) {
    return (
      <p className="case-power-panel case-power-panel--empty muted text-xs">
        No power events yet. Re-ingest the bugreport after updating bugreport-extractor-library to
        export power history rows.
      </p>
    );
  }

  const standaloneHistory = view.history.filter((event) => !event.entryTimestamp);

  return (
    <div className="case-power-panel">
      <div className="case-power-panel__summary">
        {view.summary.history > 0 && (
          <span className="case-power-stat case-power-stat--history">
            <Zap size={14} aria-hidden />
            {view.summary.history} history
          </span>
        )}
        {view.summary.shutdown > 0 && (
          <span className="case-power-stat case-power-stat--shutdown">{view.summary.shutdown} shutdown</span>
        )}
        {view.summary.reboot > 0 && (
          <span className="case-power-stat case-power-stat--reboot">{view.summary.reboot} reboot</span>
        )}
        {view.summary.reset > 0 && (
          <span className="case-power-stat case-power-stat--reset">
            <RotateCcw size={14} aria-hidden />
            {view.summary.reset} reset
          </span>
        )}
        <span className="case-power-stat muted">{view.totalRows} rows loaded</span>
      </div>

      <div className="case-power-panel__scroll">
        {standaloneHistory.length > 0 && (
          <section className="case-power-section">
            <h4 className="case-power-section__title">
              Boot / shutdown timeline ({standaloneHistory.length})
            </h4>
            <ul className="case-power-events">
              {standaloneHistory.map((event, i) => (
                <HistoryEventCard key={`ph-${event.eventType}-${event.when}-${i}`} event={event} />
              ))}
            </ul>
          </section>
        )}

        {view.resets.length > 0 && (
          <section className="case-power-section">
            <h4 className="case-power-section__title">Reset reasons ({view.resets.length})</h4>
            <ul className="case-power-resets">
              {view.resets.map((reset, i) => (
                <ResetBlockCard key={`pr-${reset.entryTimestamp}-${reset.reason}-${i}`} reset={reset} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <Link
        to={buildSearchHref(`${scope} parser="Power" | sort -timestamp | head 80`)}
        className="case-power-panel__link text-xs"
      >
        Search all power events →
      </Link>
    </div>
  );
}
