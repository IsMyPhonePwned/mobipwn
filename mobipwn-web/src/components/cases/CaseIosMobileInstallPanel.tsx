import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Loader2, Trash2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_MOBILE_INSTALL_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import {
  compileInstallEnrichmentRules,
  enrichMobileInstallEvents,
  fetchInstallEnrichmentConfig,
  installEnrichmentQuery,
  installEnrichmentSearchQuery,
  type InstallEnrichmentConfig,
  DEFAULT_INSTALL_ENRICHMENT_CONFIG,
} from "@/lib/mobileInstallEnrichment";
import {
  mobileInstallEvents,
  mobileInstallSearchQuery,
  type MobileInstallKind,
} from "@/lib/mobileInstallTimeline";

function mobileInstallQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="mobileinstallation" bundle_id=* | fields timestamp, datetime, bundle_id, message, action, parser | sort -timestamp | head 2000`;
}

function KindIcon({ kind }: { kind: MobileInstallKind }) {
  if (kind === "deleted") return <Trash2 size={12} aria-hidden />;
  return <Download size={12} aria-hidden />;
}

export function CaseIosMobileInstallPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [enrichCfg, setEnrichCfg] = useState<InstallEnrichmentConfig>(
    DEFAULT_INSTALL_ENRICHMENT_CONFIG
  );

  useEffect(() => {
    let cancelled = false;
    void fetchInstallEnrichmentConfig().then((cfg) => {
      if (!cancelled) setEnrichCfg(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const compiledRules = useMemo(
    () => compileInstallEnrichmentRules(enrichCfg.rules),
    [enrichCfg.rules]
  );
  const windowMs = enrichCfg.window_minutes * 60 * 1000;

  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_MOBILE_INSTALL_PANEL_ID,
      title: "Installed / deleted apps",
      query: mobileInstallQuery(ingestSource),
      viz: "table",
      layout: {
        i: CASE_IOS_MOBILE_INSTALL_PANEL_ID,
        x: 0,
        y: 0,
        w: 12,
        h: 10,
        minW: 4,
        minH: 5,
      },
    }),
    [ingestSource]
  );

  const enrichPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_MOBILE_INSTALL_PANEL_ID}-enrich`,
      title: "Install enrichment",
      query: installEnrichmentQuery(src, compiledRules),
      viz: "table",
      layout: {
        i: `${CASE_IOS_MOBILE_INSTALL_PANEL_ID}-enrich`,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      },
    }),
    [src, compiledRules]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const { rows: enrichRows, loading: enrichLoading } = useDashboardPanel(
    enrichPanel,
    "24h",
    refreshKey,
    compiledRules.length > 0
  );
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | MobileInstallKind>("all");
  const events = useMemo(() => {
    const base = mobileInstallEvents(rows, 200);
    return enrichMobileInstallEvents(base, enrichRows, {
      windowMs,
      rules: compiledRules,
    });
  }, [rows, enrichRows, windowMs, compiledRules]);
  const visible = useMemo(() => {
    return events.filter((ev) => {
      if (kindFilter !== "all" && ev.kind !== kindFilter) return false;
      const enrichText = ev.enrichments.map((e) => `${e.label} ${e.detail}`).join(" ");
      return panelSearchMatch(filter, ev.label, ev.bundleId, ev.version, ev.message, enrichText);
    });
  }, [events, filter, kindFilter]);
  const scope = `source="${src}"`;
  const installedCount = events.filter((e) => e.kind === "installed").length;
  const deletedCount = events.filter((e) => e.kind === "deleted").length;
  const enrichedCount = events.filter((e) => e.enrichments.length > 0).length;

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

  if (!events.length) {
    return (
      <p className="case-del-pkg-panel case-del-pkg-panel--empty muted text-xs">
        No mobileinstallation install or uninstall events in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-del-pkg-panel case-mi-install-panel">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter bundle, version, IPA, or sideload tool…"
      />
      <div className="case-mi-install-panel__filters">
        {(
          [
            ["all", `All (${events.length})`],
            ["installed", `Installed (${installedCount})`],
            ["deleted", `Deleted (${deletedCount})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`case-mi-install-panel__chip${kindFilter === id ? " case-mi-install-panel__chip--active" : ""}`}
            onClick={() => setKindFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="case-del-pkg-panel__count muted text-xs">
        {visible.length}
        {visible.length !== events.length ? ` / ${events.length}` : ""} event
        {visible.length === 1 ? "" : "s"}
        {enrichedCount > 0
          ? ` · ${enrichedCount} with sideload / IPA activity`
          : enrichLoading
            ? " · checking sideload / IPA activity…"
            : ""}
      </p>
      <div className="case-del-pkg-panel__table-wrap">
        {visible.length === 0 ? (
          <p className="muted text-xs">No events match the filter.</p>
        ) : (
          <table className="case-del-pkg-panel__table">
            <thead>
              <tr>
                <th>App</th>
                <th>Event</th>
                <th>When</th>
                <th>Version</th>
                <th title="IPA files and sideload tools correlated to this install/delete">
                  Sideload / IPA
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((ev) => (
                <tr key={ev.key}>
                  <td className="case-del-pkg-panel__name">
                    <KindIcon kind={ev.kind} />
                    <span title={ev.message || ev.bundleId}>
                      <Link
                        to={buildSearchHref(mobileInstallSearchQuery(ev.bundleId, scope), {
                          run: true,
                        })}
                        className="case-del-pkg-panel__link"
                      >
                        <strong>{ev.label}</strong>
                      </Link>
                      <span className="case-del-pkg-panel__bundle mono text-xs muted">
                        {ev.bundleId}
                      </span>
                    </span>
                  </td>
                  <td>
                    <span
                      className={`case-mi-install-panel__badge case-mi-install-panel__badge--${ev.kind}`}
                    >
                      {ev.kind}
                    </span>
                  </td>
                  <td className="mono text-xs">{ev.timestamp || "—"}</td>
                  <td className="mono text-xs">{ev.version || "—"}</td>
                  <td className="case-mi-install-panel__related">
                    {ev.enrichments.length === 0 ? (
                      <span className="muted text-xs">—</span>
                    ) : (
                      <div className="case-mi-install-panel__enrich-list">
                        {ev.enrichments.map((hit) => (
                          <Link
                            key={hit.key}
                            to={buildSearchHref(installEnrichmentSearchQuery(scope, hit), {
                              run: true,
                            })}
                            className={`case-mi-install-panel__enrich case-mi-install-panel__enrich--${
                              hit.kind === "ipa" ? "ipa" : "sideload_tool"
                            }`}
                            title={`${hit.detail || hit.label}${hit.timestamp ? ` · ${hit.timestamp}` : ""} (${hit.parser})`}
                          >
                            {hit.label}
                          </Link>
                        ))}
                      </div>
                    )}
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
            `${scope} parser="mobileinstallation" | sort -timestamp | head 40`,
            { run: true }
          )}
          className="case-del-pkg-panel__search text-xs"
        >
          Search all mobileinstallation events →
        </Link>
      </div>
    </div>
  );
}
