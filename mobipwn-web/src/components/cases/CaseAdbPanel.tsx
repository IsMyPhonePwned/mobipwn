import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Cable, KeyRound, Loader2, Server, Wifi } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_ADB_PANEL_ID } from "@/lib/caseDashboard";
import { adbConnectedLabel, adbSnapshotFromRows } from "@/lib/adbStatus";

function adbQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="Adb" | fields timestamp, data_type, message, ext | head 20`;
}

export function CaseAdbPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_ADB_PANEL_ID,
      title: "ADB",
      query: adbQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_ADB_PANEL_ID, x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const snapshot = useMemo(() => adbSnapshotFromRows(rows), [rows]);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-adb-panel case-adb-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-adb-panel case-adb-panel--error muted text-xs">{error}</p>;
  }

  if (!snapshot) {
    return (
      <p className="case-adb-panel case-adb-panel--empty muted text-xs">
        No ADB debugging manager state in this bugreport.
      </p>
    );
  }

  const connectedClass =
    snapshot.connected === true
      ? "case-adb-status--on"
      : snapshot.connected === false
        ? "case-adb-status--off"
        : "case-adb-status--unknown";

  return (
    <div className="case-adb-panel">
      <div className="case-adb-panel__hero">
        <span className={`case-adb-status ${connectedClass}`}>
          <Cable size={13} aria-hidden />
          {adbConnectedLabel(snapshot.connected)}
        </span>
        {snapshot.lastKeyReceived && (
          <div className="case-adb-last-key">
            <KeyRound size={13} aria-hidden />
            <span>
              Last key <strong className="mono">{snapshot.lastKeyReceived}</strong>
            </span>
          </div>
        )}
      </div>

      <div className="case-adb-panel__scroll">
      <dl className="case-adb-grid">
        {snapshot.servicePid != null && (
          <div className="case-adb-grid__row">
            <dt>
              <Server size={12} aria-hidden />
              Service PID
            </dt>
            <dd className="mono">{snapshot.servicePid}</dd>
          </div>
        )}
        {snapshot.threadsInUse && (
          <div className="case-adb-grid__row">
            <dt>Threads</dt>
            <dd className="mono">{snapshot.threadsInUse}</dd>
          </div>
        )}
        {snapshot.clientPids.length > 0 && (
          <div className="case-adb-grid__row">
            <dt>Client PIDs</dt>
            <dd className="mono">{snapshot.clientPids.join(", ")}</dd>
          </div>
        )}
        {snapshot.wirelessHosts.length > 0 && (
          <div className="case-adb-grid__row">
            <dt>
              <Wifi size={12} aria-hidden />
              Wireless host
            </dt>
            <dd className="mono">{snapshot.wirelessHosts.join(", ")}</dd>
          </div>
        )}
      </dl>

      {snapshot.authorizedKeys.length > 0 && (
        <section className="case-adb-section">
          <h4 className="case-adb-section__title">Authorized keys</h4>
          <ul className="case-adb-keys">
            {snapshot.authorizedKeys.map((key) => (
              <li key={key.identifier} className="case-adb-key">
                <span className="case-adb-key__id">{key.identifier}</span>
                <span className="case-adb-key__preview mono muted">{key.keyPreview}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {snapshot.keystore && (
        <section className="case-adb-section">
          <h4 className="case-adb-section__title">Keystore</h4>
          <div className="case-adb-keystore">
            {snapshot.keystore.hasKey && <span className="case-adb-tag">ADB key stored</span>}
            {snapshot.keystore.hasLastConnection && (
              <span className="case-adb-tag">Last connection recorded</span>
            )}
            {snapshot.keystore.hasVersion && <span className="case-adb-tag">Version present</span>}
            {snapshot.keystore.keyIdentifier && (
              <span className="case-adb-keystore__id mono muted">{snapshot.keystore.keyIdentifier}</span>
            )}
            {snapshot.keystore.rawLength != null && (
              <span className="muted text-xs">{snapshot.keystore.rawLength} bytes</span>
            )}
          </div>
        </section>
      )}
      </div>

      <Link
        to={buildSearchHref(`${scope} parser="Adb" | head 10`)}
        className="case-adb-panel__link text-xs"
      >
        Search →
      </Link>
    </div>
  );
}
