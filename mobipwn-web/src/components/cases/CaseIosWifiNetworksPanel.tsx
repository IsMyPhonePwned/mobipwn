import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Router } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_WIFI_NETWORKS_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import { iosParserQuery, wifiSavedNetworksFromRows } from "@/lib/iosParserData";

export function CaseIosWifiNetworksPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_WIFI_NETWORKS_PANEL_ID,
      title: "Saved Wi‑Fi networks",
      query: iosParserQuery(src, "wifinetworks", "| fields message, ssid, ext | head 80"),
      viz: "table",
      layout: { i: CASE_IOS_WIFI_NETWORKS_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const networks = useMemo(() => wifiSavedNetworksFromRows(rows), [rows]);
  const visible = useMemo(
    () =>
      networks.filter((n) =>
        panelSearchMatch(filter, n.ssid, n.file, n.networkKey, n.bssid, n.channel, n.addedAt)
      ),
    [networks, filter]
  );
  const scope = `source="${src}" parser="wifinetworks"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-wifinet case-ios-wifi--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-wifinet case-ios-wifi--error muted text-xs">{error}</p>;
  }

  if (!networks.length) {
    return (
      <p className="case-ios-wifinet case-ios-wifi--empty muted text-xs">
        No wifinetworks entries in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-wifinet">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter SSID, BSSID, or file…"
      />
      <header className="case-ios-wifi__hero">
        <Router size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">
          {visible.length}
          {visible.length !== networks.length ? ` / ${networks.length}` : ""} saved networks
        </span>
      </header>

      {visible.length === 0 ? (
        <p className="muted text-xs">No networks match the filter.</p>
      ) : (
        <ul className="case-ios-wifi__list">
          {visible.slice(0, 24).map((n) => (
            <li key={`${n.ssid}:${n.file}:${n.networkKey}`} className="case-ios-wifi__item">
              <div className="case-ios-wifi__row">
                <span className="case-ios-wifi__ssid">{n.ssid}</span>
                {n.channel && <span className="mono muted text-xs">{n.channel}</span>}
              </div>
              <span className="case-ios-wifi__meta muted text-xs">
                {n.file || "plist"}
                {n.networkKey ? ` · ${n.networkKey}` : ""}
                {n.bssid ? ` · ${n.bssid}` : ""}
                {n.addedAt ? ` · ${n.addedAt}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {visible.length > 24 && (
        <p className="muted text-xs">+{visible.length - 24} more networks</p>
      )}

      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} | head 80`)}>Search wifinetworks</Link>
      </p>
    </div>
  );
}
