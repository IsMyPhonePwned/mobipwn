import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Globe, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_NETWORK_SOCKETS_PANEL_ID, type CasePlatform } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import { networkSocketRows, networkSocketsQuery, topDestinations } from "@/lib/networkSockets";
import { collectUidOwnerHints } from "@/lib/networkUidHints";
import { packagesQuery } from "@/lib/packageSnapshot";
import { processesQuery } from "@/lib/processSnapshot";
import { NetworkUidOwnerFootnote } from "@/components/cases/NetworkUidOwnerFootnote";

export function CaseNetworkSocketsPanel({
  ingestSource,
  refreshKey,
  platform = "android",
}: {
  ingestSource: string;
  refreshKey: number;
  platform?: CasePlatform;
}) {
  const isIos = platform === "ios";
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_NETWORK_SOCKETS_PANEL_ID,
      title: isIos ? "Network endpoints" : "Network sockets",
      query: networkSocketsQuery(ingestSource, platform),
      viz: "table",
      layout: { i: CASE_NETWORK_SOCKETS_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [ingestSource, platform, isIos]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);

  const packageLookupPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_NETWORK_SOCKETS_PANEL_ID}_uid_pkg`,
      title: "Packages (UID lookup)",
      query: packagesQuery(ingestSource, platform),
      viz: "table",
      layout: { i: `${CASE_NETWORK_SOCKETS_PANEL_ID}_uid_pkg`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [ingestSource, platform]
  );
  const processLookupPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_NETWORK_SOCKETS_PANEL_ID}_uid_proc`,
      title: "Processes (UID lookup)",
      query: processesQuery(ingestSource, platform),
      viz: "table",
      layout: { i: `${CASE_NETWORK_SOCKETS_PANEL_ID}_uid_proc`, x: 0, y: 0, w: 1, h: 1 },
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

  const socketOpts = useMemo(() => {
    if (isIos) return { iosRelaxed: true as const };
    const uidHints = collectUidOwnerHints([...rows, ...packageRows, ...processRows]);
    return { uidHints };
  }, [isIos, rows, packageRows, processRows]);
  const allSockets = useMemo(() => networkSocketRows(rows, 80, socketOpts), [rows, socketOpts]);
  const [filter, setFilter] = useState("");
  const peerSockets = useMemo(
    () => allSockets.filter((s) => s.remote || s.isStale),
    [allSockets]
  );
  const sockets = useMemo(
    () =>
      peerSockets
        .filter((s) =>
          panelSearchMatch(
            filter,
            s.protocol,
            s.state,
            s.owner,
            s.ownerLabel,
            s.ownerDetail,
            s.local,
            s.remote
          )
        )
        .slice(0, 40),
    [peerSockets, filter]
  );
  const topDest = useMemo(() => topDestinations(allSockets, 6), [allSockets]);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-network-sockets case-network-sockets--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-network-sockets case-network-sockets--error muted text-xs">{error}</p>;
  }

  if (!allSockets.length) {
    return (
      <p className="case-network-sockets case-network-sockets--empty muted text-xs">
        {isIos
          ? "No socket-style network data in this sysdiagnose. iOS cases use Wi‑Fi parsers (wifiscan, wifinetworks) on the Network tab."
          : "No socket rows in this bugreport netstat section."}
      </p>
    );
  }

  return (
    <div className="case-network-sockets">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter owner, local, or remote…"
      />
      {topDest.length > 0 && (
        <div className="case-network-sockets__chips">
          {topDest.map((d) => (
            <span key={d.dest} className="case-network-sockets__chip mono text-xs">
              <Globe size={11} aria-hidden />
              {d.dest} ×{d.count}
            </span>
          ))}
        </div>
      )}
      {!peerSockets.length ? (
        <p className="case-network-sockets__hint muted text-xs">
          {allSockets.length} socket(s) in dump — no established TCP/UDP peers with remote endpoints.
        </p>
      ) : sockets.length === 0 ? (
        <p className="case-network-sockets__hint muted text-xs">No sockets match the filter.</p>
      ) : (
        <div className="case-network-sockets__table-wrap">
          <table className="case-network-sockets__table">
            <thead>
              <tr>
                <th>Proto</th>
                <th>State</th>
                <th>Owner</th>
                <th>Local</th>
                <th>Remote</th>
              </tr>
            </thead>
            <tbody>
              {sockets.map((s, i) => (
                <tr
                  key={`sock-${i}`}
                  className={s.isStale ? "case-network-sockets__row--stale" : undefined}
                >
                  <td className="mono text-xs">{s.protocol}</td>
                  <td className="mono text-xs case-network-sockets__state">
                    {s.isStale ? (
                      <span className="case-network-sockets__stale-badge">stale</span>
                    ) : (
                      s.state || "—"
                    )}
                  </td>
                  <td className="text-xs case-network-sockets__owner" title={s.owner || undefined}>
                    <div className="case-network-sockets__owner-main mono">
                      {s.ownerLabel === "stale"
                        ? "stale"
                        : s.ownerLabel !== "unknown" && s.ownerLabel !== "unattributed"
                          ? s.ownerLabel
                          : "—"}
                    </div>
                    <NetworkUidOwnerFootnote
                      explanation={s.ownerExplanation}
                      secondary={s.ownerExplanation ? null : s.ownerDetail}
                      isUid={s.owner.startsWith("uid:")}
                      className="case-network-sockets__owner-detail"
                    />
                  </td>
                  <td className="mono text-xs case-network-sockets__addr">{s.local || "—"}</td>
                  <td className="mono text-xs case-network-sockets__addr">{s.remote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="case-network-sockets__footer">
        <Link
          to={buildSearchHref(
            platform === "ios"
              ? `${scope} parser="network_iocs" (dest_ip=* OR ioc_kind="ipv4") | head 50`
              : `${scope} parser="Network" data_type=*network_socket* dest_ip=* | head 50`
          )}
          className="case-network-sockets__link text-xs"
        >
          Search sockets →
        </Link>
      </div>
    </div>
  );
}
