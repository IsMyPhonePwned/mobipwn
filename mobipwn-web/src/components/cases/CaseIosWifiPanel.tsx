import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Wifi } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_WIFI_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import {
  iosParserQuery,
  wifiNetworksFromRows,
  wifiScanRssiTone,
  wifiScanSummary,
  type IosWifiNetwork,
} from "@/lib/iosParserData";

type SortMode = "rssi" | "ssid" | "channel";
type QuickFilter = "all" | "open" | "hidden" | "sleep";

function securityPillClass(kind: IosWifiNetwork["securityKind"]): string {
  switch (kind) {
    case "open":
      return "case-ios-wifi__pill case-ios-wifi__pill--open";
    case "wep":
      return "case-ios-wifi__pill case-ios-wifi__pill--wep";
    case "enterprise":
      return "case-ios-wifi__pill case-ios-wifi__pill--enterprise";
    case "wpa":
      return "case-ios-wifi__pill case-ios-wifi__pill--wpa";
    default:
      return "case-ios-wifi__pill";
  }
}

function sortNetworks(networks: IosWifiNetwork[], mode: SortMode): IosWifiNetwork[] {
  const copy = [...networks];
  copy.sort((a, b) => {
    if (mode === "ssid") return a.ssid.localeCompare(b.ssid);
    if (mode === "channel") {
      const ac = Number.parseInt(a.channel, 10);
      const bc = Number.parseInt(b.channel, 10);
      if (Number.isFinite(ac) && Number.isFinite(bc) && ac !== bc) return ac - bc;
      return a.channel.localeCompare(b.channel) || a.ssid.localeCompare(b.ssid);
    }
    if (a.rssiDbm != null && b.rssiDbm != null && a.rssiDbm !== b.rssiDbm) {
      return b.rssiDbm - a.rssiDbm;
    }
    if (a.rssiDbm != null && b.rssiDbm == null) return -1;
    if (a.rssiDbm == null && b.rssiDbm != null) return 1;
    return a.ssid.localeCompare(b.ssid);
  });
  return copy;
}

function WifiScanCard({ n }: { n: IosWifiNetwork }) {
  const tone = wifiScanRssiTone(n.rssiDbm);

  return (
    <li className="case-ios-wifi__item case-ios-wifi__item--scan">
      <div className="case-ios-wifi__row">
        <div className="case-ios-wifi__title">
          <Wifi size={14} aria-hidden />
          <span className="case-ios-wifi__ssid" title={n.label}>
            {n.ssid}
          </span>
          {n.hidden && <span className="case-ios-wifi__pill">hidden</span>}
          {n.connectedInSleep && (
            <span className="case-ios-wifi__pill case-ios-wifi__pill--sleep">sleep</span>
          )}
          {n.security !== "—" && (
            <span className={securityPillClass(n.securityKind)} title={n.security}>
              {n.securityKind === "open" ? "open" : n.security}
            </span>
          )}
        </div>
        <span className={`case-ios-wifi__rssi case-ios-wifi__rssi--${tone} mono`}>{n.rssi}</span>
      </div>

      <dl className="case-ios-wifi__facts">
        <div>
          <dt>BSSID</dt>
          <dd className="mono">{n.bssid || "—"}</dd>
        </div>
        <div>
          <dt>Channel</dt>
          <dd className="mono">
            {n.channel}
            {n.band ? ` · ${n.band}` : ""}
          </dd>
        </div>
        <div>
          <dt>PHY</dt>
          <dd className="mono">{n.phy}</dd>
        </div>
        <div>
          <dt>Country</dt>
          <dd className="mono">{n.country}</dd>
        </div>
      </dl>

      {(n.ssidHex || n.age) && (
        <p className="case-ios-wifi__meta muted text-xs mono">
          {n.ssidHex ? `hex ${n.ssidHex.slice(0, 24)}${n.ssidHex.length > 24 ? "…" : ""}` : ""}
          {n.ssidHex && n.age ? " · " : ""}
          {n.age ? `age ${n.age}` : ""}
        </p>
      )}
    </li>
  );
}

export function CaseIosWifiPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortMode>("rssi");
  const [quick, setQuick] = useState<QuickFilter>("all");

  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_WIFI_PANEL_ID,
      title: "Wi‑Fi scan",
      query: iosParserQuery(
        src,
        "wifiscan",
        '| fields timestamp, message, ssid, ext | sort -timestamp | head 200'
      ),
      viz: "table",
      layout: { i: CASE_IOS_WIFI_PANEL_ID, x: 0, y: 0, w: 6, h: 6, minW: 4, minH: 4 },
    }),
    [src]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const networks = useMemo(() => wifiNetworksFromRows(rows), [rows]);
  const summary = useMemo(() => wifiScanSummary(networks), [networks]);

  const visible = useMemo(() => {
    const filtered = networks.filter((n) => {
      if (quick === "open" && n.securityKind !== "open") return false;
      if (quick === "hidden" && !n.hidden) return false;
      if (quick === "sleep" && !n.connectedInSleep) return false;
      return panelSearchMatch(
        filter,
        n.ssid,
        n.bssid,
        n.security,
        n.channel,
        n.band,
        n.phy,
        n.country,
        n.rssi,
        n.ssidHex,
        n.label
      );
    });
    return sortNetworks(filtered, sort);
  }, [networks, filter, quick, sort]);

  const scope = `source="${src}" parser="wifiscan"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-wifi case-ios-wifi--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-wifi case-ios-wifi--error muted text-xs">{error}</p>;
  }

  if (!networks.length) {
    return (
      <p className="case-ios-wifi case-ios-wifi--empty muted text-xs">
        No wifiscan networks in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-wifi case-ios-wifi--scan">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter SSID, BSSID, security, channel…"
      />

      <header className="case-ios-wifi__hero">
        <Wifi size={18} aria-hidden />
        <div>
          <span className="case-ios-wifi__hero-title">
            {visible.length}
            {visible.length !== networks.length ? ` / ${networks.length}` : ""} scanned networks
          </span>
          <span className="case-ios-wifi__hero-meta muted text-xs">
            {[
              summary.open > 0 ? `${summary.open} open` : "",
              summary.hidden > 0 ? `${summary.hidden} hidden` : "",
              summary.sleep > 0 ? `${summary.sleep} sleep-connected` : "",
              summary.strong > 0 ? `${summary.strong} strong signal` : "",
            ]
              .filter(Boolean)
              .join(" · ") || "Sorted by signal strength"}
          </span>
        </div>
      </header>

      <div className="case-ios-wifi__toolbar">
        <div className="case-ios-wifi__chips" role="group" aria-label="Quick filters">
          {(
            [
              ["all", "All"],
              ["open", `Open${summary.open ? ` (${summary.open})` : ""}`],
              ["hidden", `Hidden${summary.hidden ? ` (${summary.hidden})` : ""}`],
              ["sleep", `Sleep${summary.sleep ? ` (${summary.sleep})` : ""}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`case-ios-wifi__chip${quick === id ? " is-active" : ""}`}
              onClick={() => setQuick(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="case-ios-wifi__sort muted text-xs">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="case-ios-wifi__sort-select"
          >
            <option value="rssi">RSSI</option>
            <option value="ssid">SSID</option>
            <option value="channel">Channel</option>
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="muted text-xs">No networks match the filter.</p>
      ) : (
        <ul className="case-ios-wifi__list case-ios-wifi__list--scan">
          {visible.slice(0, 40).map((n, i) => (
            <WifiScanCard key={`${n.ssid}:${n.bssid}:${n.channel}:${i}`} n={n} />
          ))}
        </ul>
      )}

      {visible.length > 40 && (
        <p className="muted text-xs">+{visible.length - 40} more — open search for the full set</p>
      )}

      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} ssid=* | head 100`, { run: true })}>
          Search wifiscan
        </Link>
        {summary.open > 0 && (
          <>
            {" · "}
            <Link
              to={buildSearchHref(`${scope} security=*none* OR security=*open* | head 50`, {
                run: true,
              })}
            >
              Hunt open APs
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
