import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MapPin } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_WIFI_KNOWN_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import { iosParserQuery, wifiKnownLocationsFromRows } from "@/lib/iosParserData";

export function CaseIosWifiKnownPanel({
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
      id: CASE_IOS_WIFI_KNOWN_PANEL_ID,
      title: "Wi‑Fi geolocation",
      query: iosParserQuery(src, "wifi_known_networks", "| fields message, ssid, ext | head 80"),
      viz: "table",
      layout: { i: CASE_IOS_WIFI_KNOWN_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const locations = useMemo(() => wifiKnownLocationsFromRows(rows), [rows]);
  const visible = useMemo(
    () =>
      locations.filter((loc) =>
        panelSearchMatch(
          filter,
          loc.ssid,
          loc.bssid,
          loc.channel,
          loc.latitude,
          loc.longitude,
          loc.accuracy
        )
      ),
    [locations, filter]
  );
  const scope = `source="${src}" parser="wifi_known_networks"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-wifiknown case-ios-wifi--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-wifiknown case-ios-wifi--error muted text-xs">{error}</p>;
  }

  if (!locations.length) {
    return (
      <p className="case-ios-wifiknown case-ios-wifi--empty muted text-xs">
        No wifi_known_networks BSS coordinates in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-wifiknown">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter SSID, BSSID, or coordinates…"
      />
      <header className="case-ios-wifi__hero">
        <MapPin size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">
          {visible.length}
          {visible.length !== locations.length ? ` / ${locations.length}` : ""} geolocated BSS
          entries
        </span>
      </header>

      {visible.length === 0 ? (
        <p className="muted text-xs">No locations match the filter.</p>
      ) : (
        <ul className="case-ios-wifi__list">
          {visible.slice(0, 20).map((loc) => (
            <li key={`${loc.ssid}:${loc.bssid}:${loc.latitude}`} className="case-ios-wifi__item">
              <div className="case-ios-wifi__row">
                <span className="case-ios-wifi__ssid">{loc.ssid}</span>
                <span className="mono muted text-xs">
                  {loc.latitude}, {loc.longitude}
                </span>
              </div>
              <span className="case-ios-wifi__meta muted text-xs">
                {loc.bssid ? `${loc.bssid} · ` : ""}
                {loc.channel ? `ch ${loc.channel} · ` : ""}
                {loc.accuracy ? `±${loc.accuracy} m` : "Wi‑Fi BSS location"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {visible.length > 20 && (
        <p className="muted text-xs">+{visible.length - 20} more locations</p>
      )}

      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} | head 80`)}>Search wifi_known_networks</Link>
      </p>
    </div>
  );
}
