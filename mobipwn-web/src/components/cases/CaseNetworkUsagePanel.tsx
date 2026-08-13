import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownUp, Loader2, Network, Wifi } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_NETWORK_USAGE_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import {
  formatBytes,
  formatPacketCount,
  interfaceUsageRows,
  networkUsageQueryFields,
  networkUsageRows,
  networkUsageTotals,
  wifiAccessPointsFromRows,
  wifiApFrequencyLabel,
  wifiApTotals,
  wifiRssiTone,
  type WifiAccessPoint,
  type NetworkUsageRow,
} from "@/lib/networkUsage";

function TrafficCell({ rx, tx }: { rx: number; tx: number }) {
  const hasTraffic = rx > 0 || tx > 0;
  return (
    <div className="case-network-usage__traffic">
      <span className="case-network-usage__traffic-rx mono" title="Received">
        ↓ {hasTraffic ? formatBytes(rx) : "—"}
      </span>
      <span className="case-network-usage__traffic-tx mono" title="Transmitted">
        ↑ {hasTraffic ? formatBytes(tx) : "—"}
      </span>
    </div>
  );
}

function WifiApCard({ ap }: { ap: WifiAccessPoint }) {
  const rssiTone = wifiRssiTone(ap.rssi);
  const channel = wifiApFrequencyLabel(ap.frequencyMhz);
  const hasTraffic = ap.rxBytes > 0 || ap.txBytes > 0;
  const hasPackets = ap.rxPackets > 0 || ap.txPackets > 0;

  return (
    <li className="case-network-usage__wifi-card">
      <div className="case-network-usage__wifi-head">
        <div className="case-network-usage__wifi-title">
          <Wifi size={14} aria-hidden />
          <span className="case-network-usage__wifi-ssid">{ap.ssid}</span>
          {ap.detail.includes("saved") ? (
            <span className="case-network-usage__pill case-network-usage__pill--saved">saved</span>
          ) : null}
          {ap.detail.includes("default") ? (
            <span className="case-network-usage__pill case-network-usage__pill--default">default</span>
          ) : null}
        </div>
        <TrafficCell rx={ap.rxBytes} tx={ap.txBytes} />
      </div>

      <dl className="case-network-usage__facts">
        <div>
          <dt>BSSID</dt>
          <dd className="mono">{ap.bssid || "—"}</dd>
        </div>
        <div>
          <dt>Signal</dt>
          <dd>
            {ap.rssi != null ? (
              <span className={`case-network-usage__rssi case-network-usage__rssi--${rssiTone} mono`}>
                {ap.rssi} dBm
              </span>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Band</dt>
          <dd>{channel || "—"}</dd>
        </div>
        <div>
          <dt>Security</dt>
          <dd>{ap.security || "—"}</dd>
        </div>
        <div>
          <dt>Packets</dt>
          <dd className="mono">
            {hasPackets ? `↓${formatPacketCount(ap.rxPackets)} · ↑${formatPacketCount(ap.txPackets)}` : "—"}
          </dd>
        </div>
        <div>
          <dt>Traffic</dt>
          <dd className="mono">{hasTraffic ? `${formatBytes(ap.rxBytes)} / ${formatBytes(ap.txBytes)}` : "scan only"}</dd>
        </div>
      </dl>

      {ap.scanSection || (ap.detail && !ap.detail.includes("saved") && !ap.detail.includes("default")) ? (
        <p className="case-network-usage__wifi-foot muted text-xs">
          {[ap.scanSection, ap.detail.replace(/\b(saved network|default)\b/gi, "").trim()]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </li>
  );
}

function InterfaceTable({ rows }: { rows: NetworkUsageRow[] }) {
  return (
    <table className="case-network-usage__table case-network-usage__table--ifaces">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Received</th>
          <th>Sent</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`nu-${row.interfaceLabel}-${row.networkType}-${i}`}>
            <td className="case-network-usage__name">
              <Network size={12} aria-hidden />
              <span>{row.interfaceLabel}</span>
            </td>
            <td>
              <span
                className={`case-network-usage__pill ${
                  row.kind === "interface"
                    ? "case-network-usage__pill--iface"
                    : "case-network-usage__pill--route"
                }`}
              >
                {row.kind === "interface" ? "interface" : row.networkType}
              </span>
            </td>
            <td className="mono text-xs case-network-usage__bytes">{formatBytes(row.rxBytes)}</td>
            <td className="mono text-xs case-network-usage__bytes">{formatBytes(row.txBytes)}</td>
            <td className="case-network-usage__notes muted text-xs">{row.detail || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CaseNetworkUsagePanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_NETWORK_USAGE_PANEL_ID,
      title: "Network usage",
      query: networkUsageQueryFields(ingestSource),
      viz: "table",
      layout: { i: CASE_NETWORK_USAGE_PANEL_ID, x: 0, y: 0, w: 6, h: 10, minW: 4, minH: 7 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const [filter, setFilter] = useState("");
  const usage = useMemo(() => networkUsageRows(rows), [rows]);
  const wifiAps = useMemo(() => wifiAccessPointsFromRows(rows), [rows]);
  const interfaces = useMemo(() => interfaceUsageRows(usage, wifiAps), [usage, wifiAps]);
  const visibleWifi = useMemo(
    () =>
      wifiAps.filter((ap) =>
        panelSearchMatch(filter, ap.ssid, ap.bssid, ap.security, ap.scanSection, ap.detail)
      ),
    [wifiAps, filter]
  );
  const visibleIfaces = useMemo(
    () =>
      interfaces.filter((row) =>
        panelSearchMatch(filter, row.interfaceLabel, row.networkType, row.detail, row.dataType)
      ),
    [interfaces, filter]
  );
  const wifiTotals = useMemo(() => wifiApTotals(wifiAps), [wifiAps]);
  const ifaceTotals = useMemo(() => networkUsageTotals(interfaces), [interfaces]);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-network-usage case-network-usage--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-network-usage case-network-usage--error muted text-xs">{error}</p>;
  }

  if (!usage.length && !wifiAps.length) {
    return (
      <p className="case-network-usage case-network-usage--empty muted text-xs">
        No interface byte counters or Wi‑Fi access points in this bugreport.
      </p>
    );
  }

  return (
    <div className="case-network-usage">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter Wi‑Fi SSID, BSSID, or interface…"
      />
      {(wifiTotals.rxBytes > 0 || wifiTotals.txBytes > 0 || ifaceTotals.rxBytes > 0 || ifaceTotals.txBytes > 0) && (
        <div className="case-network-usage__summary">
          {wifiAps.length > 0 ? (
            <div className="case-network-usage__summary-block">
              <span className="case-network-usage__summary-label">Wi‑Fi total</span>
              <TrafficCell rx={wifiTotals.rxBytes} tx={wifiTotals.txBytes} />
            </div>
          ) : null}
          {interfaces.length > 0 ? (
            <div className="case-network-usage__summary-block">
              <span className="case-network-usage__summary-label">Interfaces total</span>
              <TrafficCell rx={ifaceTotals.rxBytes} tx={ifaceTotals.txBytes} />
            </div>
          ) : null}
        </div>
      )}

      <div className="case-network-usage__scroll">
        {wifiAps.length > 0 ? (
          <section className="case-network-usage__section case-network-usage__section--wifi">
            <h4 className="case-network-usage__heading">
              <Wifi size={14} aria-hidden />
              Wi‑Fi access points
              <span className="case-network-usage__count">{visibleWifi.length}</span>
            </h4>
            <div className="case-network-usage__section-body">
              {visibleWifi.length === 0 ? (
                <p className="muted text-xs">No Wi‑Fi access points match the filter.</p>
              ) : (
                <ul className="case-network-usage__wifi-list">
                  {visibleWifi.map((ap, i) => (
                    <WifiApCard key={`wifi-${ap.ssid}-${ap.bssid}-${i}`} ap={ap} />
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : null}

        {interfaces.length > 0 ? (
          <section className="case-network-usage__section case-network-usage__section--ifaces">
            <h4 className="case-network-usage__heading">
              <Network size={14} aria-hidden />
              Interfaces &amp; routes
              <span className="case-network-usage__count">{visibleIfaces.length}</span>
            </h4>
            <div className="case-network-usage__section-body">
              {visibleIfaces.length === 0 ? (
                <p className="muted text-xs">No interfaces match the filter.</p>
              ) : (
                <div className="case-network-usage__table-wrap">
                  <InterfaceTable rows={visibleIfaces} />
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>

      <div className="case-network-usage__footer">
        <span className="muted text-xs">
          <ArrowDownUp size={12} aria-hidden /> Counters and Wi‑Fi scan data from bugreport
        </span>
        <Link
          to={buildSearchHref(
            `${scope} parser="Network" (data_type=*network_interface* OR data_type=*network_stats* OR data_type=*wifi_scan_result* OR data_type=*wifi_saved*) | head 80`
          )}
          className="case-network-usage__link text-xs"
        >
          Search →
        </Link>
      </div>
    </div>
  );
}
