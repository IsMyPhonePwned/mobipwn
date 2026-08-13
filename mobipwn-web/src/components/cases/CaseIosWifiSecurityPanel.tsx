import { useMemo } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_WIFI_SECURITY_PANEL_ID } from "@/lib/caseDashboard";
import { iosParserQuery, wifiSecurityEntriesFromRows } from "@/lib/iosParserData";

export function CaseIosWifiSecurityPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_WIFI_SECURITY_PANEL_ID,
      title: "Wi‑Fi security",
      query: iosParserQuery(src, "wifisecurity", "| fields message, ext | head 40"),
      viz: "table",
      layout: { i: CASE_IOS_WIFI_SECURITY_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const entries = useMemo(() => wifiSecurityEntriesFromRows(rows), [rows]);
  const scope = `source="${src}" parser="wifisecurity"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-wifisec case-ios-wifi--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-wifisec case-ios-wifi--error muted text-xs">{error}</p>;
  }

  if (!entries.length) {
    return (
      <p className="case-ios-wifisec case-ios-wifi--empty muted text-xs">
        No wifisecurity entries in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-wifisec">
      <header className="case-ios-wifi__hero">
        <KeyRound size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{entries.length} AP config entries</span>
      </header>

      <ul className="case-ios-wifi__list">
        {entries.slice(0, 10).map((entry) => (
          <li key={`${entry.label}:${entry.account}:${entry.created}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid">{entry.label}</span>
              {entry.account && entry.account !== entry.label && (
                <span className="mono muted text-xs">{entry.account}</span>
              )}
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {entry.description || "Wi‑Fi AP config"}
              {entry.created ? ` · ${entry.created}` : ""}
            </span>
          </li>
        ))}
      </ul>

      {entries.length > 10 && <p className="muted text-xs">+{entries.length - 10} more entries</p>}

      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} | head 50`)}>Search wifisecurity</Link>
      </p>
    </div>
  );
}
