import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Trash2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_DELETED_PACKAGES_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import { deletedPackageEntries, deletedPackagesSearchQuery } from "@/lib/deletedPackages";

function deletedPackagesQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="Package" data_type=*package_install* message=*DELETE* bundle_id=* | fields timestamp, datetime, bundle_id, message, ext | sort -timestamp | head 120`;
}

export function CaseDeletedPackagesPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_DELETED_PACKAGES_PANEL_ID,
      title: "Deleted packages",
      query: deletedPackagesQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_DELETED_PACKAGES_PANEL_ID, x: 0, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const [filter, setFilter] = useState("");
  const packages = useMemo(() => deletedPackageEntries(rows, 80), [rows]);
  const visible = useMemo(
    () =>
      packages.filter((pkg) =>
        panelSearchMatch(filter, pkg.label, pkg.bundleId, pkg.caller, pkg.user, pkg.observer)
      ),
    [packages, filter]
  );
  const scope = `source="${escapeMplString(ingestSource)}"`;
  const totalDeletes = useMemo(
    () => visible.reduce((sum, pkg) => sum + pkg.deleteCount, 0),
    [visible]
  );

  if (loading && rows.length === 0) {
    return (
      <div className="case-del-pkg-panel case-del-pkg-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-del-pkg-panel case-del-pkg-panel--error muted text-xs">{error}</p>;
  }

  if (!packages.length) {
    return (
      <p className="case-del-pkg-panel case-del-pkg-panel--empty muted text-xs">
        No package uninstall or delete events in this bugreport.
      </p>
    );
  }

  return (
    <div className="case-del-pkg-panel">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter deleted package or caller…"
      />
      <p className="case-del-pkg-panel__count muted text-xs">
        {visible.length}
        {visible.length !== packages.length ? ` / ${packages.length}` : ""} package
        {visible.length === 1 ? "" : "s"} · {totalDeletes} delete event
        {totalDeletes === 1 ? "" : "s"}
      </p>
      <div className="case-del-pkg-panel__table-wrap">
        {visible.length === 0 ? (
          <p className="muted text-xs">No deleted packages match the filter.</p>
        ) : (
          <table className="case-del-pkg-panel__table">
          <thead>
            <tr>
              <th>Package</th>
              <th>Last deleted</th>
              <th>×</th>
              <th>Caller</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((pkg) => (
              <tr key={pkg.bundleId}>
                <td className="case-del-pkg-panel__name">
                  <Trash2 size={12} aria-hidden />
                  <span title={pkg.bundleId}>
                    <Link
                      to={buildSearchHref(deletedPackagesSearchQuery(pkg.bundleId, scope), { run: true })}
                      className="case-del-pkg-panel__link"
                    >
                      <strong>{pkg.label}</strong>
                    </Link>
                    <span className="case-del-pkg-panel__bundle mono text-xs muted">{pkg.bundleId}</span>
                  </span>
                </td>
                <td className="mono text-xs">{pkg.lastDeleted || "—"}</td>
                <td className="mono text-xs">{pkg.deleteCount}</td>
                <td className="mono text-xs" title={pkg.user || pkg.observer}>
                  {pkg.caller || pkg.user || "—"}
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        )}
      </div>
      <div className="case-del-pkg-panel__footer">
        <Link
          to={buildSearchHref(
            `${scope} parser="Package" data_type=*package_install* message=*DELETE* | sort -timestamp | head 40`,
            { run: true }
          )}
          className="case-del-pkg-panel__search text-xs"
        >
          Search all delete events →
        </Link>
      </div>
    </div>
  );
}
