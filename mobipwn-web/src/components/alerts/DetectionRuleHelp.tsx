import { Link } from "react-router-dom";

/** Reference for detection rule lifecycle / mode (nano-style). */
export function DetectionRuleHelp() {
  return (
    <details className="card alerts-help">
      <summary className="alerts-help-title">How alerts and rules relate</summary>
      <p className="muted alerts-help-intro">
        Alerts on this page are produced by <strong>detection rules</strong> on the{" "}
        <Link to="/rules">Detections</Link> page. Each alert has its own triage status; each
        rule has a lifecycle that controls when it runs.
      </p>
      <div className="alerts-help-grid">
        <div>
          <h3 className="alerts-help-sub">Alert triage (this page)</h3>
          <table className="alerts-help-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="badge badge-new">new</span>
                </td>
                <td>Unreviewed — needs analyst attention.</td>
              </tr>
              <tr>
                <td>
                  <span className="badge badge-triaged">triaged</span>
                </td>
                <td>Under investigation; hunt opened or context captured.</td>
              </tr>
              <tr>
                <td>
                  <span className="badge badge-verified">verified</span>
                </td>
                <td>Closed after triage — confirmed real threat or incident.</td>
              </tr>
              <tr>
                <td>
                  <span className="badge badge-false-positive">false positive</span>
                </td>
                <td>Closed after triage — benign or noisy; not a real incident.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="alerts-help-sub">Rule lifecycle (Detections)</h3>
          <table className="alerts-help-table">
            <thead>
              <tr>
                <th>Lifecycle</th>
                <th>Scheduled runs</th>
                <th>Creates alerts</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="badge badge-staging">staging</span>
                </td>
                <td>Not run by cron</td>
                <td>Only when you click <strong>Run now</strong> on Detections (manual test).</td>
              </tr>
              <tr>
                <td>
                  <span className="badge badge-live">live</span>
                </td>
                <td>Yes — when cron is due</td>
                <td>Yes — production monitoring, same as alerting for scheduling.</td>
              </tr>
              <tr>
                <td>
                  <span className="badge badge-alerting">alerting</span>
                </td>
                <td>Yes — when cron is due</td>
                <td>Yes — intended for rules that should open alerts in this inbox.</td>
              </tr>
            </tbody>
          </table>
          <p className="muted alerts-help-note">
            <strong>scheduled</strong> mode runs the mPL query on a cron (e.g. every 6h).{" "}
            <strong>realtime</strong> mode uses a ClickHouse materialized view on each new event
            (query must be filter-only, no <code className="mono">|</code> pipes). Ingest does not
            run rules — use <strong>Run now</strong> or wait for <code className="mono">mobipwn-jobs</code>
            .
          </p>
        </div>
      </div>
    </details>
  );
}
