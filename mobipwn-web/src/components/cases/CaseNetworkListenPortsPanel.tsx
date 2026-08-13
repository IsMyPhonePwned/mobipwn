import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ear, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_NETWORK_LISTEN_PORTS_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import { NetworkUidOwnerFootnote } from "@/components/cases/NetworkUidOwnerFootnote";
import { listenOwnerDisplay, listenPortRows, listenPortsQuery } from "@/lib/networkListenPorts";
import { collectUidOwnerHints } from "@/lib/networkUidHints";
import { packagesQuery } from "@/lib/packageSnapshot";
import { processesQuery } from "@/lib/processSnapshot";

export function CaseNetworkListenPortsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_NETWORK_LISTEN_PORTS_PANEL_ID,
      title: "Listening ports",
      query: listenPortsQuery(ingestSource),
      viz: "table",
      layout: {
        i: CASE_NETWORK_LISTEN_PORTS_PANEL_ID,
        x: 0,
        y: 0,
        w: 6,
        h: 4,
        minW: 4,
        minH: 3,
      },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);

  const packageLookupPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_NETWORK_LISTEN_PORTS_PANEL_ID}_uid_pkg`,
      title: "Packages (UID lookup)",
      query: packagesQuery(ingestSource, "android"),
      viz: "table",
      layout: { i: `${CASE_NETWORK_LISTEN_PORTS_PANEL_ID}_uid_pkg`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [ingestSource]
  );
  const processLookupPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_NETWORK_LISTEN_PORTS_PANEL_ID}_uid_proc`,
      title: "Processes (UID lookup)",
      query: processesQuery(ingestSource, "android"),
      viz: "table",
      layout: { i: `${CASE_NETWORK_LISTEN_PORTS_PANEL_ID}_uid_proc`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [ingestSource]
  );

  const { rows: packageRows } = useDashboardPanel(packageLookupPanel, "24h", refreshKey, true);
  const { rows: processRows } = useDashboardPanel(processLookupPanel, "24h", refreshKey, true);

  const listeners = useMemo(() => {
    const uidHints = collectUidOwnerHints([...rows, ...packageRows, ...processRows]);
    return listenPortRows(rows, { uidHints });
  }, [rows, packageRows, processRows]);
  const [filter, setFilter] = useState("");
  const visible = useMemo(
    () =>
      listeners.filter((row) => {
        const display = listenOwnerDisplay(row);
        return panelSearchMatch(
          filter,
          row.port,
          row.protocol,
          row.local,
          row.bindHost,
          row.owner,
          display.primary,
          display.secondary,
          display.explanation
        );
      }),
    [listeners, filter]
  );
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-network-listen case-network-listen--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-network-listen case-network-listen--error muted text-xs">{error}</p>;
  }

  if (!listeners.length) {
    return (
      <p className="case-network-listen case-network-listen--empty muted text-xs">
        No LISTEN sockets in this bugreport netstat section. Re-ingest after updating
        bugreport-extractor-library to populate socket direction and owners.
      </p>
    );
  }

  return (
    <div className="case-network-listen">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter port, protocol, bind, or owner…"
      />
      <p className="case-network-listen__summary muted text-xs">
        <Ear size={12} aria-hidden />
        {visible.length}
        {visible.length !== listeners.length ? ` / ${listeners.length}` : ""} open port
        {visible.length === 1 ? "" : "s"} on device (TCP/UDP listeners from netstat).
      </p>
      <div className="case-network-listen__table-wrap">
        {visible.length === 0 ? (
          <p className="muted text-xs">No listening ports match the filter.</p>
        ) : (
          <table className="case-network-listen__table">
            <thead>
              <tr>
                <th>Port</th>
                <th>Proto</th>
                <th>Bind</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const display = listenOwnerDisplay(row);
                const ownerTitle = [row.owner, display.secondary].filter(Boolean).join(" · ");
                return (
                <tr key={`${row.protocol}|${row.local}|${row.owner}`}>
                  <td className="mono text-xs case-network-listen__port">{row.port}</td>
                  <td className="mono text-xs">{row.protocol}</td>
                  <td className="mono text-xs case-network-listen__bind" title={row.local}>
                    {row.bindHost}
                  </td>
                  <td className="text-xs case-network-listen__owner" title={ownerTitle || undefined}>
                    <div className="case-network-listen__owner-main mono">
                      {display.primary === "stale"
                        ? "stale"
                        : display.primary !== "unknown" && display.primary !== "unattributed"
                          ? display.primary
                          : "—"}
                    </div>
                    {display.explanation || display.secondary || display.isUid ? (
                      <NetworkUidOwnerFootnote
                        explanation={display.explanation}
                        secondary={display.explanation ? null : display.secondary}
                        isUid={display.isUid}
                        className="case-network-listen__owner-detail"
                      />
                    ) : null}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="case-network-listen__footer">
        <Link
          to={buildSearchHref(
            `${scope} parser="Network" data_type=*network_socket* | fields dest_ip, src_ip, action, message, ext, process_name, bundle_id | head 80`
          )}
          className="case-network-listen__link text-xs"
        >
          Search network sockets →
        </Link>
      </div>
    </div>
  );
}
