import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, GitBranch, Loader2, Radio, Search, Wifi } from "lucide-react";
import { NetworkFlowDiagram } from "@/components/cases/NetworkFlowDiagram";
import { NetworkFlowTable } from "@/components/cases/NetworkFlowTable";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { Input } from "@/components/ui/input";
import { buildSearchHref } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import {
  CASE_NETWORK_FLOW_PANEL_ID,
  type CasePlatform,
} from "@/lib/caseDashboard";
import {
  aggregateNetworkFlows,
  aggregateWifiScanSightings,
  flowSourceLabel,
  flowWeight,
  networkFlowQuery,
  networkFlowSearchQuery,
  wifiScanSearchQuery,
  type FlowWeightMode,
  type NetworkFlowLink,
  type WifiScanSighting,
} from "@/lib/networkFlow";
import { collectUidOwnerHints } from "@/lib/networkUidHints";
import { packagesQuery } from "@/lib/packageSnapshot";
import { processesQuery } from "@/lib/processSnapshot";
import { wifiApFrequencyLabel, wifiRssiTone } from "@/lib/networkUsage";

export function CaseNetworkFlowPanel({
  ingestSource,
  refreshKey,
  platform = "android",
}: {
  ingestSource: string;
  refreshKey: number;
  platform?: CasePlatform;
}) {
  const navigate = useNavigate();
  const [weightMode, setWeightMode] = useState<FlowWeightMode>("count");
  const [filter, setFilter] = useState("");
  const [hideUnknown, setHideUnknown] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_NETWORK_FLOW_PANEL_ID,
      title: "Network flows",
      query: networkFlowQuery(ingestSource, platform),
      viz: "table",
      layout: { i: CASE_NETWORK_FLOW_PANEL_ID, x: 0, y: 0, w: 12, h: 12, minW: 6, minH: 8 },
    }),
    [ingestSource, platform]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);

  const packageLookupPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_NETWORK_FLOW_PANEL_ID}_uid_pkg`,
      title: "Packages (UID lookup)",
      query: packagesQuery(ingestSource, platform),
      viz: "table",
      layout: { i: `${CASE_NETWORK_FLOW_PANEL_ID}_uid_pkg`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [ingestSource, platform]
  );
  const processLookupPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_NETWORK_FLOW_PANEL_ID}_uid_proc`,
      title: "Processes (UID lookup)",
      query: processesQuery(ingestSource, platform),
      viz: "table",
      layout: { i: `${CASE_NETWORK_FLOW_PANEL_ID}_uid_proc`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [ingestSource, platform]
  );

  const { rows: packageRows } = useDashboardPanel(
    packageLookupPanel,
    "24h",
    refreshKey,
    platform === "android"
  );
  const { rows: processRows } = useDashboardPanel(
    processLookupPanel,
    "24h",
    refreshKey,
    platform === "android"
  );

  const flows = useMemo(() => {
    const uidHints = collectUidOwnerHints([...rows, ...packageRows, ...processRows]);
    return aggregateNetworkFlows(rows, { uidHints });
  }, [rows, packageRows, processRows]);

  const wifiSightings = useMemo(
    () => (platform === "android" ? aggregateWifiScanSightings(rows) : []),
    [rows, platform]
  );

  const filteredFlows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return flows.filter((link) => {
      if (hideUnknown && (link.source === "unknown" || link.source === "unattributed")) return false;
      if (!q) return true;
      return (
        link.source.toLowerCase().includes(q) ||
        link.target.toLowerCase().includes(q) ||
        (link.sourceDetail?.toLowerCase().includes(q) ?? false) ||
        flowSourceLabel(link.source).toLowerCase().includes(q)
      );
    });
  }, [flows, filter, hideUnknown]);

  const filteredWifi = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return wifiSightings;
    return wifiSightings.filter(
      (s) =>
        s.ssid.toLowerCase().includes(q) ||
        (s.bssid?.toLowerCase().includes(q) ?? false)
    );
  }, [wifiSightings, filter]);

  const hasBytes = useMemo(() => flows.some((f) => f.bytes > 0), [flows]);
  const totalWeight = useMemo(
    () => filteredFlows.reduce((sum, f) => sum + flowWeight(f, weightMode), 0),
    [filteredFlows, weightMode]
  );

  const handleFlowClick = useCallback(
    (link: NetworkFlowLink) => {
      navigate(buildSearchHref(networkFlowSearchQuery(ingestSource, link, platform)));
    },
    [navigate, ingestSource, platform]
  );

  const handleWifiClick = useCallback(
    (sighting: WifiScanSighting) => {
      navigate(buildSearchHref(wifiScanSearchQuery(ingestSource, sighting)));
    },
    [navigate, ingestSource]
  );

  if (loading && rows.length === 0) {
    return (
      <div className="case-network-flow case-network-flow--loading">
        <Loader2 size={16} className="animate-spin" aria-hidden />
        <span className="muted text-xs">Loading flows…</span>
      </div>
    );
  }

  if (error) {
    return <p className="case-network-flow case-network-flow--error muted text-xs">{error}</p>;
  }

  if (!flows.length && !wifiSightings.length) {
    const emptyHint =
      platform === "ios"
        ? "No Wi‑Fi network telemetry to chart as flows. iOS sysdiagnose exposes wifiscan, wifinetworks, and related parsers — open the Network tab."
        : "No network flows with bundle and destination in this case. Upload a bugreport or sysdiagnose archive with Network parser telemetry.";
    return <p className="case-network-flow case-network-flow--empty muted text-xs">{emptyHint}</p>;
  }

  return (
    <div className="case-network-flow">
      {flows.length > 0 ? (
        <>
          <div className="case-network-flow__toolbar">
            <span className="case-network-flow__stat text-xs muted">
              <GitBranch size={12} aria-hidden />
              {filteredFlows.length}
              {filteredFlows.length !== flows.length ? ` / ${flows.length}` : ""} flow
              {filteredFlows.length === 1 ? "" : "s"}
              {totalWeight > 0
                ? ` · ${weightMode === "bytes" ? "volume" : "connections"}: ${totalWeight.toLocaleString()}`
                : ""}
            </span>
            <div className="case-network-flow__toolbar-right">
              <label className="case-network-flow__filter">
                <Search size={12} aria-hidden className="case-network-flow__filter-icon" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter app or destination…"
                  className="case-network-flow__filter-input h-7 text-xs"
                />
              </label>
              <label className="case-network-flow__toggle text-xs muted">
                <input
                  type="checkbox"
                  checked={hideUnknown}
                  onChange={(e) => setHideUnknown(e.target.checked)}
                />
                Hide unattributed
              </label>
              <div className="case-network-flow__modes">
                <button
                  type="button"
                  className={`case-network-flow__mode${weightMode === "count" ? " case-network-flow__mode--active" : ""}`}
                  onClick={() => setWeightMode("count")}
                >
                  Connections
                </button>
                <button
                  type="button"
                  className={`case-network-flow__mode${weightMode === "bytes" ? " case-network-flow__mode--active" : ""}`}
                  onClick={() => setWeightMode("bytes")}
                  disabled={!hasBytes}
                  title={hasBytes ? "Weight flows by rx/tx bytes" : "No byte counters in network rows"}
                >
                  Bytes
                </button>
              </div>
            </div>
          </div>

          {filteredFlows.length > 0 ? (
            <>
              <NetworkFlowDiagram
                links={filteredFlows}
                mode={weightMode}
                activeKey={activeKey}
                onActiveKeyChange={setActiveKey}
                onFlowClick={handleFlowClick}
              />

              <NetworkFlowTable
                links={filteredFlows}
                mode={weightMode}
                activeKey={activeKey}
                onHover={setActiveKey}
                onFlowClick={handleFlowClick}
              />
            </>
          ) : (
            <p className="case-network-flow__filter-empty muted text-xs">
              No flows match the current filter.
            </p>
          )}
        </>
      ) : null}

      {filteredWifi.length > 0 || (wifiSightings.length > 0 && filter.trim()) ? (
        <section className="case-network-flow__wifi" aria-label="Nearby Wi-Fi from scan">
          <div className="case-network-flow__wifi-head">
            <h4 className="case-network-flow__wifi-title">
              <Wifi size={14} aria-hidden />
              Nearby Wi‑Fi
              <span className="case-network-flow__wifi-count">{filteredWifi.length}</span>
            </h4>
            <p className="case-network-flow__wifi-hint muted text-xs">
              <Radio size={12} aria-hidden />
              SSIDs heard by the radio during a scan — not proof the phone connected to them.
            </p>
          </div>
          {!flows.length ? (
            <label className="case-network-flow__filter case-network-flow__wifi-filter">
              <Search size={12} aria-hidden className="case-network-flow__filter-icon" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter SSID…"
                className="case-network-flow__filter-input h-7 text-xs"
              />
            </label>
          ) : null}
          {filteredWifi.length > 0 ? (
            <ul className="case-network-flow__wifi-list">
              {filteredWifi.map((s) => {
                const band = wifiApFrequencyLabel(s.frequencyMhz);
                const tone = wifiRssiTone(s.rssi);
                return (
                  <li key={`${s.ssid}\0${s.bssid ?? ""}`}>
                    <button
                      type="button"
                      className="case-network-flow__wifi-item"
                      onClick={() => handleWifiClick(s)}
                      title="Open Wi‑Fi scan events in search"
                    >
                      <span className="case-network-flow__wifi-badge">SSID seen</span>
                      <span className="case-network-flow__wifi-ssid mono" title={s.ssid}>
                        {s.ssid}
                      </span>
                      <span className="case-network-flow__wifi-meta muted text-xs">
                        {s.rssi != null ? (
                          <span className={`case-network-flow__wifi-rssi case-network-flow__wifi-rssi--${tone}`}>
                            {s.rssi} dBm
                          </span>
                        ) : null}
                        {band ? <span>{band}</span> : null}
                        {s.bssid ? <span className="mono">{s.bssid}</span> : null}
                        <span>
                          {s.count} sighting{s.count === 1 ? "" : "s"}
                        </span>
                      </span>
                      <ExternalLink size={12} className="case-network-flow__wifi-open" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="case-network-flow__filter-empty muted text-xs">No SSIDs match the current filter.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
