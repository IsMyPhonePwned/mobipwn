import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Globe, Loader2, Network, Shield, ShieldOff } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_VPN_PANEL_ID } from "@/lib/caseDashboard";
import { vpnSearchQuery, vpnSnapshotFromRows, type VpnSession } from "@/lib/vpnSnapshot";

function vpnQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="Vpn" | fields timestamp, data_type, message, ext, bundle_id, user | head 20`;
}

function VpnDetail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="case-vpn-panel__detail">
      <span className="case-vpn-panel__detail-label muted text-xs">{label}</span>
      <span className="case-vpn-panel__detail-value mono text-xs">{value}</span>
    </div>
  );
}

function VpnSessionCard({ session }: { session: VpnSession }) {
  return (
    <li className="case-vpn-panel__session">
      <div className="case-vpn-panel__session-head">
        <Shield size={14} aria-hidden />
        <strong className="mono">{session.packageName}</strong>
        <span className="case-vpn-panel__badge mono text-xs">user {session.userId}</span>
      </div>
      {session.rawData && session.rawData !== session.packageName && (
        <p className="case-vpn-panel__raw mono text-xs muted">{session.rawData}</p>
      )}
      <div className="case-vpn-panel__details">
        <VpnDetail label="Interface" value={session.interfaceName} />
        <VpnDetail label="Addresses" value={session.addresses} />
        <VpnDetail label="Routes" value={session.routes} />
        <VpnDetail label="DNS" value={session.dnsServers} />
        <VpnDetail label="Search domains" value={session.searchDomains} />
      </div>
    </li>
  );
}

export function CaseVpnPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_VPN_PANEL_ID,
      title: "VPN",
      query: vpnQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_VPN_PANEL_ID, x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const snapshot = useMemo(() => vpnSnapshotFromRows(rows), [rows]);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-vpn-panel case-vpn-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-vpn-panel case-vpn-panel--error muted text-xs">{error}</p>;
  }

  if (!snapshot.sectionFound) {
    return (
      <div className="case-vpn-panel case-vpn-panel--empty">
        <ShieldOff size={18} aria-hidden />
        <p className="muted text-xs">
          No <code className="mono">SecurityControllerImpl</code> VPN dump in this bugreport.
        </p>
        <Link to={buildSearchHref(vpnSearchQuery(scope))} className="case-vpn-panel__link text-xs">
          Search Vpn parser rows →
        </Link>
      </div>
    );
  }

  const activeCount = snapshot.sessions.length;

  return (
    <div className="case-vpn-panel">
      <header className="case-vpn-panel__hero">
        {activeCount > 0 ? <Shield size={18} aria-hidden /> : <ShieldOff size={18} aria-hidden />}
        <div>
          <span className="case-vpn-panel__hero-title">
            {activeCount > 0
              ? `${activeCount} active VPN tunnel${activeCount === 1 ? "" : "s"}`
              : "No active VPN tunnels"}
          </span>
          <span className="case-vpn-panel__hero-meta muted text-xs">
            From dumpsys SecurityControllerImpl · mCurrentVpns / mNetworkProperties
          </span>
        </div>
      </header>

      <div className="case-vpn-panel__scroll">
        {activeCount > 0 ? (
          <ul className="case-vpn-panel__sessions">
            {snapshot.sessions.map((session) => (
              <VpnSessionCard key={`${session.userId}:${session.packageName}`} session={session} />
            ))}
          </ul>
        ) : (
          <p className="case-vpn-panel__none muted text-xs">
            <Network size={13} aria-hidden /> Device reported no connected VPN profiles at capture time.
          </p>
        )}

        {snapshot.networkProperties.length > 0 && (
          <section className="case-vpn-panel__props">
            <h4 className="case-vpn-panel__props-title">
              <Globe size={13} aria-hidden />
              Network properties
            </h4>
            <dl className="case-vpn-panel__props-grid">
              {snapshot.networkProperties.map((prop) => (
                <div key={prop.key} className="case-vpn-panel__props-row">
                  <dt className="mono text-xs">{prop.key}</dt>
                  <dd className="mono text-xs">{prop.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      <Link to={buildSearchHref(vpnSearchQuery(scope))} className="case-vpn-panel__link text-xs">
        Search Vpn events →
      </Link>
    </div>
  );
}
