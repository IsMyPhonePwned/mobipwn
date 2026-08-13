import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownCircle, Loader2, Trash2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_APK_DOWNGRADE_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import {
  apkDailyEvents,
  apkDailyQuery,
  apkDailySearchQuery,
  type ApkDailyEvent,
} from "@/lib/apkDaily";

function actionBadge(ev: ApkDailyEvent): { label: string; className: string } {
  switch (ev.action) {
    case "downgrade":
      return { label: "Downgrade", className: "case-apk-daily__badge case-apk-daily__badge--down" };
    case "uninstall":
      return { label: "Uninstall", className: "case-apk-daily__badge case-apk-daily__badge--uninstall" };
    default:
      return { label: "Update", className: "case-apk-daily__badge" };
  }
}

export function CaseApkDowngradePanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_APK_DOWNGRADE_PANEL_ID,
      title: "APK downgrades (battery daily)",
      query: apkDailyQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_APK_DOWNGRADE_PANEL_ID, x: 0, y: 0, w: 12, h: 6, minW: 4, minH: 4 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const [filter, setFilter] = useState("");
  const events = useMemo(
    () => apkDailyEvents(rows, 80, { actions: ["downgrade", "uninstall"] }),
    [rows]
  );
  const visible = useMemo(
    () =>
      events.filter((ev) =>
        panelSearchMatch(
          filter,
          ev.packageName,
          ev.action,
          ev.vers,
          ev.previousVers,
          ev.from,
          ev.to,
          ev.message
        )
      ),
    [events, filter]
  );
  const scope = `source="${escapeMplString(ingestSource)}"`;
  const downgradeCount = events.filter((e) => e.action === "downgrade").length;
  const uninstallCount = events.filter((e) => e.action === "uninstall").length;

  if (loading && rows.length === 0) {
    return (
      <div className="case-apk-daily case-apk-daily--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-apk-daily case-apk-daily--error muted text-xs">{error}</p>;
  }

  if (!events.length) {
    return (
      <p className="case-apk-daily case-apk-daily--empty muted text-xs">
        No APK downgrades or vers=0 uninstalls in batterystats daily updates.
      </p>
    );
  }

  return (
    <div className="case-apk-daily">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter package, version, or date…"
      />
      <p className="case-apk-daily__count muted text-xs">
        {visible.length}
        {visible.length !== events.length ? ` / ${events.length}` : ""} event
        {visible.length === 1 ? "" : "s"}
        {downgradeCount > 0 ? ` · ${downgradeCount} downgrade${downgradeCount === 1 ? "" : "s"}` : ""}
        {uninstallCount > 0 ? ` · ${uninstallCount} uninstall${uninstallCount === 1 ? "" : "s"}` : ""}
      </p>
      <div className="case-apk-daily__table-wrap">
        {visible.length === 0 ? (
          <p className="muted text-xs">No events match “{filter.trim()}”.</p>
        ) : (
          <table className="case-apk-daily__table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Package</th>
                <th>Version</th>
                <th>Daily window</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((ev, i) => {
                const badge = actionBadge(ev);
                const versionLabel =
                  ev.action === "downgrade" && ev.previousVers
                    ? `${ev.previousVers} → ${ev.vers}`
                    : ev.vers || "—";
                return (
                  <tr key={`${ev.packageName}-${ev.from}-${ev.vers}-${i}`}>
                    <td>
                      <span className={badge.className}>
                        {ev.action === "downgrade" ? (
                          <ArrowDownCircle size={12} aria-hidden />
                        ) : (
                          <Trash2 size={12} aria-hidden />
                        )}
                        {badge.label}
                      </span>
                    </td>
                    <td className="mono text-xs" title={ev.message}>
                      {ev.packageName}
                    </td>
                    <td className="mono text-xs">{versionLabel}</td>
                    <td className="mono text-xs muted">
                      {ev.from || "—"}
                      {ev.to ? ` → ${ev.to}` : ""}
                    </td>
                    <td>
                      <Link
                        to={buildSearchHref(apkDailySearchQuery(scope, ev), { run: true })}
                        className="case-apk-daily__link text-xs"
                      >
                        Hunt
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="case-apk-daily__footer">
        <Link
          to={buildSearchHref(apkDailySearchQuery(scope), { run: true })}
          className="case-apk-daily__link text-xs"
        >
          Search all downgrades →
        </Link>
      </div>
    </div>
  );
}
