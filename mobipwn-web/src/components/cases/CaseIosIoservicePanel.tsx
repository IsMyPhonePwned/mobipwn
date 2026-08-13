import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Cpu, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_IOSERVICE_PANEL_ID } from "@/lib/caseDashboard";
import { ioserviceSnapshotFromRows } from "@/lib/iosIoservice";

export function CaseIosIoservicePanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_IOSERVICE_PANEL_ID,
      title: "IOService",
      query: `source="${src}" parser="ioservice" | fields timestamp, message, event_type, node_count, device_model, ext | sort -timestamp | head 20`,
      viz: "table",
      layout: { i: CASE_IOS_IOSERVICE_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const snapshot = useMemo(() => ioserviceSnapshotFromRows(rows), [rows]);
  const scope = `source="${src}" parser="ioservice"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-ioservice case-ios-ioservice--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-ioservice case-ios-ioservice--error muted text-xs">{error}</p>;
  }

  if (!snapshot) {
    return (
      <p className="case-ios-ioservice case-ios-ioservice--empty muted text-xs">
        No IOService compact preview in this sysdiagnose yet.
      </p>
    );
  }

  return (
    <div className="case-ios-ioservice">
      <header className="case-ios-wifi__hero">
        <Cpu size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">
          {snapshot.nodeCount != null ? `${snapshot.nodeCount} IOService nodes` : "IOService hardware"}
        </span>
      </header>
      {snapshot.properties.length > 0 ? (
        <ul className="case-ios-wifi__list">
          {snapshot.properties.slice(0, 8).map((prop) => (
            <li key={prop.key} className="case-ios-wifi__item">
              <div className="case-ios-wifi__row">
                <span className="muted text-xs">{prop.label}</span>
                <span className="mono text-xs">{prop.value}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {snapshot.treeTruncated ? (
        <p className="case-ios-wifi__meta muted text-xs">
          Tree truncated in compact preview — set MOBIPWN_IOSERVICE_FULL_TREE=1 for full tree at ingest.
        </p>
      ) : null}
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} | head 30`)}>Search ioservice</Link>
      </p>
    </div>
  );
}
