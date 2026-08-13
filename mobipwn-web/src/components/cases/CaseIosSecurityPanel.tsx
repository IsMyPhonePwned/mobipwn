import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Loader2, Shield } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_SECURITY_PANEL_ID } from "@/lib/caseDashboard";
import {
  iosParserQuery,
  securityDevicesFromRows,
  securitySectionCounts,
} from "@/lib/iosParserData";

export function CaseIosSecurityPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_SECURITY_PANEL_ID,
      title: "Paired devices",
      query: iosParserQuery(src, "security_sysdiagnose", "| fields message, ext | head 60"),
      viz: "table",
      layout: { i: CASE_IOS_SECURITY_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const devices = useMemo(() => securityDevicesFromRows(rows), [rows]);
  const sections = useMemo(() => securitySectionCounts(devices), [devices]);
  const scope = `source="${src}" parser="security_sysdiagnose"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-security case-ios-security--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-security case-ios-security--error muted text-xs">{error}</p>;
  }

  if (!devices.length) {
    return (
      <p className="case-ios-security case-ios-security--empty muted text-xs">
        No security_sysdiagnose keychain entries in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-security">
      <header className="case-ios-security__hero">
        <Shield size={18} aria-hidden />
        <div>
          <span className="case-ios-security__hero-title">{devices.length} trusted entries</span>
          <span className="case-ios-security__hero-meta muted text-xs">
            {sections.map((s) => `${s.section} (${s.count})`).join(" · ")}
          </span>
        </div>
      </header>

      <ul className="case-ios-security__list">
        {devices.slice(0, 8).map((d) => (
          <li key={`${d.section}:${d.name}:${d.service}`} className="case-ios-security__item">
            <span className="case-ios-security__name">{d.name}</span>
            <span className="case-ios-security__meta muted text-xs">
              {d.section}
              {d.added ? ` · ${d.added}` : ""}
            </span>
          </li>
        ))}
      </ul>

      {devices.length > 8 && (
        <p className="muted text-xs">+{devices.length - 8} more entries</p>
      )}

      <p className="case-ios-security__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} | head 80`)}>Search security_sysdiagnose</Link>
      </p>
    </div>
  );
}
