type Props = {
  error?: string;
  success?: string;
  warning?: string;
};

export function IronSiftFeedback({ error, success, warning }: Props) {
  if (!error && !success && !warning) return null;

  return (
    <div className="ironsift-feedback" role="status" aria-live="polite">
      {success ? (
        <p className="ironsift-feedback__banner ironsift-feedback__banner--success">{success}</p>
      ) : null}
      {warning ? (
        <p className="ironsift-feedback__banner ironsift-feedback__banner--warning">{warning}</p>
      ) : null}
      {error ? (
        <p className="ironsift-feedback__banner ironsift-feedback__banner--error">{error}</p>
      ) : null}
    </div>
  );
}
