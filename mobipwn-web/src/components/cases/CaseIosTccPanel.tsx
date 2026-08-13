import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Eye, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_TCC_PANEL_ID } from "@/lib/caseDashboard";
import { iosParserQuery, tccPermissionTitle, tccPermissionsFromRows, tccTopServices } from "@/lib/iosParserData";

export function CaseIosTccPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_TCC_PANEL_ID,
      title: "App permissions",
      query: iosParserQuery(src, "accessibility_tcc", "| fields message, ext | head 80"),
      viz: "table",
      layout: { i: CASE_IOS_TCC_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const permissions = useMemo(() => tccPermissionsFromRows(rows), [rows]);
  const topServices = useMemo(() => tccTopServices(permissions), [permissions]);
  const scope = `source="${src}" parser="accessibility_tcc"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-tcc case-ios-tcc--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-tcc case-ios-tcc--error muted text-xs">{error}</p>;
  }

  if (!permissions.length) {
    return (
      <p className="case-ios-tcc case-ios-tcc--empty muted text-xs">
        No accessibility_tcc permission rows in this sysdiagnose.
      </p>
    );
  }

  const denied = permissions.filter((p) => !/allow/i.test(p.allowed)).length;

  return (
    <div className="case-ios-tcc">
      <header className="case-ios-tcc__hero">
        <Eye size={18} aria-hidden />
        <div>
          <span className="case-ios-tcc__hero-title">{permissions.length} TCC records</span>
          <span className="case-ios-tcc__hero-meta muted text-xs">
            {denied > 0 ? `${denied} denied/restricted · ` : ""}
            {topServices.slice(0, 3).map((s) => s.service).join(", ")}
          </span>
        </div>
      </header>

      <ul className="case-ios-tcc__list">
        {permissions.slice(0, 8).map((p) => (
          <li key={`${p.client}:${p.service}`} className="case-ios-tcc__item">
            <div className="case-ios-tcc__row">
              <span className="case-ios-tcc__client mono">{p.client}</span>
              <span
                className={`case-ios-tcc__badge${/allow/i.test(p.allowed) ? " case-ios-tcc__badge--allow" : ""}`}
              >
                {p.allowed}
              </span>
            </div>
            <span className="case-ios-tcc__service muted text-xs" title={tccPermissionTitle(p)}>
              {p.service}
              {p.serviceRaw && !p.serviceRaw.toLowerCase().includes(p.service.toLowerCase().replace(/\s+/g, "")) ? (
                <span className="mono"> · {p.serviceRaw.replace(/^kTCCService/, "")}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      <p className="case-ios-tcc__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} | head 80`)}>Search accessibility_tcc</Link>
      </p>
    </div>
  );
}
