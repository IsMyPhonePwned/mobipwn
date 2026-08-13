import { alertEventHighlights, alertEventMessage } from "@/lib/alertTriage";

type Props = {
  row: Record<string, unknown>;
};

export function AlertEventHighlights({ row }: Props) {
  const highlights = alertEventHighlights(row);
  const message = alertEventMessage(row);

  return (
    <div className="alert-event-highlights">
      {highlights.length > 0 && (
        <dl className="alert-event-highlights__grid">
          {highlights.map(({ key, label, value }) => (
            <div key={key} className="alert-event-highlights__item">
              <dt>{label}</dt>
              <dd className="mono" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {message && (
        <div className="alert-event-highlights__message">
          <span className="alert-event-highlights__message-label">Message</span>
          <p className="alert-event-highlights__message-body">{message}</p>
        </div>
      )}
    </div>
  );
}
