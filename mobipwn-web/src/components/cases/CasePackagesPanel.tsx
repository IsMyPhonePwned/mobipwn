import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Loader2, Package } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_PACKAGES_PANEL_ID, type CasePlatform } from "@/lib/caseDashboard";
import { CasePanelSearchBar } from "@/components/cases/CasePanelSearchBar";
import {
  installerLabel,
  packagePermissionSummary,
  packageRows,
  packagesListSearchQuery,
  packagesQuery,
  packageSearchQuery,
  permissionChipTitle,
  shortenPackagePath,
  type PackagePermission,
  type PackageRow,
} from "@/lib/packageSnapshot";
import {
  compileInstallEnrichmentRules,
  DEFAULT_INSTALL_ENRICHMENT_CONFIG,
  enrichMobileInstallEvents,
  fetchInstallEnrichmentConfig,
  installEnrichmentQuery,
  installEnrichmentSearchQuery,
  installContextByBundleId,
  type InstallEnrichmentConfig,
  type InstallEnrichmentHit,
} from "@/lib/mobileInstallEnrichment";
import { mobileInstallEvents } from "@/lib/mobileInstallTimeline";

/** Column / section label for IPA + sideload-tool chips correlated to an app. */
const INSTALL_CONTEXT_LABEL = "Sideload / IPA";
const INSTALL_CONTEXT_COUNT = "with sideload / IPA activity";

function permissionChipClass(perm: PackagePermission): string {
  if (perm.granted === true) return "case-pkg-panel__perm--granted";
  if (perm.granted === false) return "case-pkg-panel__perm--denied";
  return "case-pkg-panel__perm--declared";
}

function PermissionChip({ perm }: { perm: PackagePermission }) {
  return (
    <span
      className={`case-pkg-panel__perm ${permissionChipClass(perm)}`}
      title={permissionChipTitle(perm)}
    >
      {perm.shortName}
      {perm.permType ? (
        <span className="case-pkg-panel__perm-type">{perm.permType.slice(0, 3)}</span>
      ) : null}
    </span>
  );
}

function InstalledAtCell({ pkg }: { pkg: PackageRow }) {
  if (!pkg.installedAt) {
    return <td className="text-xs muted">—</td>;
  }
  return (
    <td className="text-xs case-pkg-panel__installed" title={pkg.installedAt}>
      <time dateTime={pkg.installedAtMs != null ? new Date(pkg.installedAtMs).toISOString() : undefined}>
        {pkg.installedAt}
      </time>
    </td>
  );
}

function DetailItem({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  const v = value?.trim();
  if (!v) return null;
  return (
    <div className="case-pkg-panel__detail-item">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined} title={v}>
        {v}
      </dd>
    </div>
  );
}

function AndroidPackageDetails({ pkg }: { pkg: PackageRow }) {
  const perms = pkg.permissions ?? [];
  const summary = packagePermissionSummary(perms);
  return (
    <div className="case-pkg-panel__detail">
      <dl className="case-pkg-panel__detail-grid">
        <DetailItem label="Label" value={pkg.label !== pkg.bundleId ? pkg.label : undefined} />
        <DetailItem
          label="Version"
          value={
            [pkg.version, pkg.versionCode ? `code ${pkg.versionCode}` : ""]
              .filter(Boolean)
              .join(" · ") || undefined
          }
          mono
        />
        <DetailItem label="UID / appId" value={pkg.uid} mono />
        <DetailItem
          label="SDK"
          value={
            [pkg.minSdk ? `min ${pkg.minSdk}` : "", pkg.targetSdk ? `target ${pkg.targetSdk}` : ""]
              .filter(Boolean)
              .join(" · ") || undefined
          }
          mono
        />
        <DetailItem label="First install" value={pkg.installedAt} />
        <DetailItem label="Last update" value={pkg.updatedAt || pkg.updated} />
        <DetailItem label="Installer" value={pkg.installer} mono />
        <DetailItem label="Initiating" value={pkg.initiatingPackage} mono />
        <DetailItem label="Originating" value={pkg.originatingPackage} mono />
        <DetailItem label="Install reason" value={pkg.installReason} mono />
        <DetailItem label="Package source" value={pkg.packageSource} mono />
        <DetailItem label="APK signing" value={pkg.apkSigningVersion} mono />
        <DetailItem label="ABI" value={pkg.primaryCpuAbi} mono />
        <DetailItem label="Flags" value={pkg.flags} mono />
        <DetailItem label="Code path" value={pkg.codePath} mono />
        <DetailItem label="Data dir" value={pkg.dataDir} mono />
      </dl>
      {perms.length > 0 ? (
        <div className="case-pkg-panel__detail-perms">
          <p className="case-pkg-panel__detail-perms-title muted text-xs">
            Permissions · {summary.total}
            {summary.granted ? ` · ${summary.granted} granted` : ""}
            {summary.denied ? ` · ${summary.denied} denied` : ""}
          </p>
          <div className="case-pkg-panel__perms">
            {perms.map((perm) => (
              <PermissionChip key={`${pkg.bundleId}-${perm.name}`} perm={perm} />
            ))}
          </div>
        </div>
      ) : (
        <p className="muted text-xs">No permission entries in package metadata.</p>
      )}
    </div>
  );
}

function IosPackageDetails({
  pkg,
  installContext = [],
}: {
  pkg: PackageRow;
  installContext?: InstallEnrichmentHit[];
}) {
  const perms = pkg.permissions ?? [];
  const summary = packagePermissionSummary(perms);
  const extras = pkg.extras ?? [];
  return (
    <div className="case-pkg-panel__detail">
      <dl className="case-pkg-panel__detail-grid">
        <DetailItem label="Display name" value={pkg.label !== pkg.bundleId ? pkg.label : undefined} />
        <DetailItem label="Bundle ID" value={pkg.bundleId} mono />
        <DetailItem
          label="Version"
          value={
            [pkg.version, pkg.buildVersion && pkg.buildVersion !== pkg.version ? `build ${pkg.buildVersion}` : ""]
              .filter(Boolean)
              .join(" · ") || undefined
          }
          mono
        />
        <DetailItem label="Executable" value={pkg.executableName} mono />
        <DetailItem label="App type" value={pkg.appType} mono />
        <DetailItem label="Installed / seen" value={pkg.installedAt} />
        <DetailItem label="Deleted" value={pkg.isDeleted ? pkg.deletedDate || "yes" : undefined} />
        <DetailItem label="Primary source" value={pkg.parser} mono />
        <DetailItem label="All sources" value={pkg.sources?.join(", ")} mono />
        <DetailItem label="Installer / provenance" value={pkg.installer} mono />
        <DetailItem
          label={INSTALL_CONTEXT_LABEL}
          value={
            installContext.length ? installContext.map((h) => h.label).join(", ") : undefined
          }
        />
        {extras.map((item) => (
          <DetailItem key={`${pkg.bundleId}-${item.label}`} label={item.label} value={item.value} mono />
        ))}
      </dl>
      {perms.length > 0 ? (
        <div className="case-pkg-panel__detail-perms">
          <p className="case-pkg-panel__detail-perms-title muted text-xs">
            TCC permissions · {summary.total}
            {summary.granted ? ` · ${summary.granted} allowed` : ""}
            {summary.denied ? ` · ${summary.denied} denied` : ""}
          </p>
          <div className="case-pkg-panel__perms">
            {perms.map((perm) => (
              <PermissionChip key={`${pkg.bundleId}-${perm.name}`} perm={perm} />
            ))}
          </div>
        </div>
      ) : (
        <p className="muted text-xs">No TCC permission rows linked to this bundle in accessibility_tcc.</p>
      )}
    </div>
  );
}

function IosPackagesTable({
  packages,
  scope,
  filter,
  installContext,
}: {
  packages: PackageRow[];
  scope: string;
  filter: string;
  installContext: Map<string, InstallEnrichmentHit[]>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const needle = filter.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!needle) return packages;
    return packages.filter((pkg) => {
      const ctx = installContext.get(pkg.bundleId) ?? [];
      const hay = [
        pkg.label,
        pkg.bundleId,
        pkg.version,
        pkg.buildVersion,
        pkg.executableName,
        pkg.parser,
        pkg.installer,
        pkg.installedAt,
        pkg.deletedDate,
        pkg.appType,
        ...ctx.map((h) => `${h.label} ${h.detail}`),
        ...(pkg.sources ?? []),
        ...(pkg.extras ?? []).flatMap((e) => [e.label, e.value]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(needle)) return true;
      return (pkg.permissions ?? []).some(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.shortName.toLowerCase().includes(needle)
      );
    });
  }, [packages, needle, installContext]);

  const withPerms = packages.filter((p) => (p.permissions?.length ?? 0) > 0).length;
  const deletedCount = packages.filter((p) => p.isDeleted).length;
  const withVersion = packages.filter((p) => p.version).length;
  const withContext = packages.filter((p) => (installContext.get(p.bundleId)?.length ?? 0) > 0)
    .length;

  const toggle = (bundleId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(bundleId)) next.delete(bundleId);
      else next.add(bundleId);
      return next;
    });
  };

  return (
    <>
      <p className="case-pkg-panel__count muted text-xs">
        {visible.length} of {packages.length} app(s)
        {withVersion > 0 && ` · ${withVersion} with version`}
        {withPerms > 0 && ` · ${withPerms} with TCC`}
        {deletedCount > 0 && ` · ${deletedCount} deleted`}
        {withContext > 0 && ` · ${withContext} ${INSTALL_CONTEXT_COUNT}`}
        {" · expand a row for full metadata"}
      </p>
      <div className="case-pkg-panel__toolbar">
        <button
          type="button"
          className="case-pkg-panel__toolbar-btn text-xs"
          onClick={() => setExpanded(new Set(visible.map((p) => p.bundleId)))}
        >
          Expand all
        </button>
        <button
          type="button"
          className="case-pkg-panel__toolbar-btn text-xs"
          onClick={() => setExpanded(new Set())}
        >
          Collapse all
        </button>
      </div>
      <div className="case-pkg-panel__table-wrap">
        <table className="case-pkg-panel__table case-pkg-panel__table--ios">
          <thead>
            <tr>
              <th className="case-pkg-panel__col-expand" />
              <th>App</th>
              <th>Version</th>
              <th>Executable</th>
              <th>Installed</th>
              <th title="IPA files and sideload tools correlated to this app’s install/delete timeline">
                {INSTALL_CONTEXT_LABEL}
              </th>
              <th>Source</th>
              <th>TCC</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((pkg) => {
              const perms = pkg.permissions ?? [];
              const summary = packagePermissionSummary(perms);
              const isOpen = expanded.has(pkg.bundleId);
              const hits = installContext.get(pkg.bundleId) ?? [];
              return (
                <Fragment key={pkg.bundleId}>
                  <tr className={isOpen ? "case-pkg-panel__row--open" : undefined}>
                    <td className="case-pkg-panel__col-expand">
                      <button
                        type="button"
                        className="case-pkg-panel__expand-btn"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Collapse app details" : "Expand app details"}
                        onClick={() => toggle(pkg.bundleId)}
                      >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <td className="case-pkg-panel__name">
                      <Package size={12} aria-hidden />
                      <span title={pkg.bundleId}>
                        <Link
                          to={buildSearchHref(packageSearchQuery(pkg.bundleId, scope, "ios"), {
                            run: true,
                          })}
                          className="case-pkg-panel__pkg-link"
                        >
                          <strong>{pkg.label}</strong>
                        </Link>
                        {pkg.isDeleted ? (
                          <span className="case-pkg-panel__badge case-pkg-panel__badge--warn text-xs">
                            deleted
                          </span>
                        ) : null}
                        <span className="case-pkg-panel__bundle mono text-xs muted">{pkg.bundleId}</span>
                      </span>
                    </td>
                    <td
                      className="mono text-xs"
                      title={
                        pkg.buildVersion && pkg.buildVersion !== pkg.version
                          ? `build ${pkg.buildVersion}`
                          : undefined
                      }
                    >
                      {pkg.version || "—"}
                      {pkg.buildVersion && pkg.buildVersion !== pkg.version ? (
                        <span className="muted"> ({pkg.buildVersion})</span>
                      ) : null}
                    </td>
                    <td className="mono text-xs muted">{pkg.executableName || "—"}</td>
                    <InstalledAtCell pkg={pkg} />
                    <td className="case-mi-install-panel__related">
                      {hits.length === 0 ? (
                        <span className="muted text-xs">—</span>
                      ) : (
                        <div className="case-mi-install-panel__enrich-list">
                          {hits.map((hit) => (
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
                    <td className="text-xs" title={(pkg.sources ?? [pkg.parser]).filter(Boolean).join(", ")}>
                      {pkg.parser || pkg.sources?.[0] || "—"}
                      {(pkg.sources?.length ?? 0) > 1 ? (
                        <span className="muted"> +{pkg.sources!.length - 1}</span>
                      ) : null}
                    </td>
                    <td
                      className="text-xs mono"
                      title={
                        summary.total
                          ? `${summary.total} TCC · ${summary.granted} allowed · ${summary.denied} denied`
                          : undefined
                      }
                    >
                      {summary.total
                        ? `${summary.total}${summary.denied ? ` / ${summary.denied}↓` : ""}`
                        : "—"}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="case-pkg-panel__perm-row">
                      <td />
                      <td colSpan={7}>
                        <IosPackageDetails pkg={pkg} installContext={hits} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AndroidPackagesTable({
  packages,
  scope,
  filter,
}: {
  packages: PackageRow[];
  scope: string;
  filter: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const needle = filter.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!needle) return packages;
    return packages.filter((pkg) => {
      const hay = [
        pkg.label,
        pkg.bundleId,
        pkg.version,
        pkg.versionCode,
        pkg.installer,
        pkg.installedAt,
        pkg.updatedAt,
        pkg.uid,
        pkg.codePath,
        pkg.dataDir,
        pkg.initiatingPackage,
        pkg.originatingPackage,
        pkg.targetSdk,
        pkg.minSdk,
        pkg.flags,
        pkg.primaryCpuAbi,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(needle)) return true;
      return (pkg.permissions ?? []).some(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.shortName.toLowerCase().includes(needle)
      );
    });
  }, [packages, needle]);

  const withPerms = packages.filter((p) => (p.permissions?.length ?? 0) > 0).length;
  const deniedCount = packages.reduce(
    (n, p) => n + (p.permissions ?? []).filter((perm) => perm.granted === false).length,
    0
  );
  const systemCount = packages.filter((p) => p.isSystemPath).length;

  const toggle = (bundleId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(bundleId)) next.delete(bundleId);
      else next.add(bundleId);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(visible.map((p) => p.bundleId)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <>
      <p className="case-pkg-panel__count muted text-xs">
        {visible.length} of {packages.length} package(s)
        {withPerms > 0 && ` · ${withPerms} with permissions`}
        {deniedCount > 0 && ` · ${deniedCount} denied grant(s)`}
        {systemCount > 0 && ` · ${systemCount} system path`}
        {" · newest install first"}
      </p>
      <div className="case-pkg-panel__toolbar">
        <button type="button" className="case-pkg-panel__toolbar-btn text-xs" onClick={expandAll}>
          Expand all
        </button>
        <button type="button" className="case-pkg-panel__toolbar-btn text-xs" onClick={collapseAll}>
          Collapse all
        </button>
      </div>
      <div className="case-pkg-panel__table-wrap">
        <table className="case-pkg-panel__table case-pkg-panel__table--android">
          <thead>
            <tr>
              <th className="case-pkg-panel__col-expand" />
              <th>Package</th>
              <th>Version</th>
              <th>UID</th>
              <th>Installed</th>
              <th>Updated</th>
              <th>Installer</th>
              <th>SDK</th>
              <th>Path</th>
              <th>Perms</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((pkg) => {
              const perms = pkg.permissions ?? [];
              const summary = packagePermissionSummary(perms);
              const isOpen = expanded.has(pkg.bundleId);
              const canExpand = true;
              return (
                <Fragment key={pkg.bundleId}>
                  <tr className={isOpen ? "case-pkg-panel__row--open" : undefined}>
                    <td className="case-pkg-panel__col-expand">
                      {canExpand ? (
                        <button
                          type="button"
                          className="case-pkg-panel__expand-btn"
                          aria-expanded={isOpen}
                          aria-label={isOpen ? "Collapse package details" : "Expand package details"}
                          onClick={() => toggle(pkg.bundleId)}
                        >
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      ) : null}
                    </td>
                    <td className="case-pkg-panel__name">
                      <Package size={12} aria-hidden />
                      <span title={pkg.label !== pkg.bundleId ? pkg.label : undefined}>
                        <Link
                          to={buildSearchHref(packageSearchQuery(pkg.bundleId, scope, "android"), {
                            run: true,
                          })}
                          className="case-pkg-panel__pkg-link"
                        >
                          <strong className="mono">{pkg.bundleId}</strong>
                        </Link>
                        {pkg.isSystemPath ? (
                          <span className="case-pkg-panel__badge text-xs">system</span>
                        ) : null}
                        {pkg.label && pkg.label !== pkg.bundleId ? (
                          <span className="case-pkg-panel__bundle text-xs muted">{pkg.label}</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="mono text-xs" title={pkg.versionCode ? `versionCode ${pkg.versionCode}` : undefined}>
                      {pkg.version || "—"}
                      {pkg.versionCode ? (
                        <span className="muted"> ({pkg.versionCode})</span>
                      ) : null}
                    </td>
                    <td className="mono text-xs">{pkg.uid || "—"}</td>
                    <InstalledAtCell pkg={pkg} />
                    <td className="text-xs muted" title={pkg.updatedAt || pkg.updated}>
                      {pkg.updatedAt || pkg.updated || "—"}
                    </td>
                    <td className="text-xs" title={[pkg.installer, pkg.initiatingPackage, pkg.originatingPackage].filter(Boolean).join(" · ")}>
                      {installerLabel(pkg.installer)}
                      {pkg.originatingPackage && pkg.originatingPackage !== pkg.installer ? (
                        <span className="case-pkg-panel__bundle text-xs muted">
                          via {pkg.originatingPackage.split(".").slice(-2).join(".")}
                        </span>
                      ) : null}
                    </td>
                    <td className="mono text-xs">
                      {pkg.targetSdk || pkg.minSdk
                        ? [pkg.minSdk && `≥${pkg.minSdk}`, pkg.targetSdk && `→${pkg.targetSdk}`]
                            .filter(Boolean)
                            .join(" ")
                        : "—"}
                    </td>
                    <td
                      className="mono text-xs muted case-pkg-panel__path"
                      title={pkg.codePath || pkg.dataDir}
                    >
                      {pkg.codePath
                        ? shortenPackagePath(pkg.codePath)
                        : pkg.dataDir
                          ? shortenPackagePath(pkg.dataDir)
                          : "—"}
                    </td>
                    <td className="text-xs mono" title={
                      summary.total
                        ? `${summary.total} total · ${summary.granted} granted · ${summary.denied} denied`
                        : undefined
                    }>
                      {summary.total
                        ? `${summary.total}${summary.denied ? ` / ${summary.denied}↓` : ""}`
                        : "—"}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="case-pkg-panel__perm-row">
                      <td />
                      <td colSpan={9}>
                        <AndroidPackageDetails pkg={pkg} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function CasePackagesPanel({
  ingestSource,
  refreshKey,
  platform = "android",
}: {
  ingestSource: string;
  refreshKey: number;
  platform?: CasePlatform;
}) {
  const isIos = platform === "ios";
  const [filter, setFilter] = useState("");
  const src = escapeMplString(ingestSource);
  const [enrichCfg, setEnrichCfg] = useState<InstallEnrichmentConfig>(
    DEFAULT_INSTALL_ENRICHMENT_CONFIG
  );

  useEffect(() => {
    if (!isIos) return;
    let cancelled = false;
    void fetchInstallEnrichmentConfig().then((cfg) => {
      if (!cancelled) setEnrichCfg(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, isIos]);

  const compiledRules = useMemo(
    () => compileInstallEnrichmentRules(enrichCfg.rules),
    [enrichCfg.rules]
  );
  const windowMs = enrichCfg.window_minutes * 60 * 1000;

  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_PACKAGES_PANEL_ID,
      title: "Packages & permissions",
      query: packagesQuery(ingestSource, platform),
      viz: "table",
      layout: { i: CASE_PACKAGES_PANEL_ID, x: 0, y: 0, w: 6, h: isIos ? 12 : 5, minW: 4, minH: 4 },
    }),
    [ingestSource, platform, isIos]
  );

  const miPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_PACKAGES_PANEL_ID}-mi`,
      title: "MI timeline",
      query: `source="${src}" parser="mobileinstallation" bundle_id=* | fields timestamp, datetime, bundle_id, message, action, parser | sort -timestamp | head 2000`,
      viz: "table",
      layout: { i: `${CASE_PACKAGES_PANEL_ID}-mi`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [src]
  );

  const enrichPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_PACKAGES_PANEL_ID}-enrich`,
      title: "Install enrichment",
      query: installEnrichmentQuery(src, compiledRules),
      viz: "table",
      layout: { i: `${CASE_PACKAGES_PANEL_ID}-enrich`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [src, compiledRules]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const { rows: miRows } = useDashboardPanel(miPanel, "24h", refreshKey, isIos);
  const { rows: enrichRows } = useDashboardPanel(
    enrichPanel,
    "24h",
    refreshKey,
    isIos && compiledRules.length > 0
  );

  const packages = useMemo(
    () => packageRows(rows, isIos ? 0 : 0, platform),
    [rows, isIos, platform]
  );
  const installContext = useMemo(() => {
    if (!isIos) return new Map<string, InstallEnrichmentHit[]>();
    const enriched = enrichMobileInstallEvents(mobileInstallEvents(miRows, 200), enrichRows, {
      windowMs,
      rules: compiledRules,
    });
    return installContextByBundleId(enriched);
  }, [isIos, miRows, enrichRows, windowMs, compiledRules]);
  const scope = `source="${src}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-pkg-panel case-pkg-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-pkg-panel case-pkg-panel--error muted text-xs">{error}</p>;
  }

  if (!packages.length) {
    return (
      <p className="case-pkg-panel case-pkg-panel--empty muted text-xs">
        {isIos
          ? "No bundle identifiers in this sysdiagnose case yet."
          : "No installed package metadata in this bugreport."}
      </p>
    );
  }

  return (
    <div className="case-pkg-panel">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder={
          isIos
            ? "Filter apps by name, bundle ID, IPA, sideload tool, TCC…"
            : "Filter package, UID, path, installer, permission…"
        }
      />

      {isIos ? (
        <IosPackagesTable
          packages={packages}
          scope={scope}
          filter={filter}
          installContext={installContext}
        />
      ) : (
        <AndroidPackagesTable packages={packages} scope={scope} filter={filter} />
      )}

      <div className="case-pkg-panel__footer">
        <Link
          to={buildSearchHref(packagesListSearchQuery(scope, platform))}
          className="case-pkg-panel__link text-xs"
        >
          {isIos ? "Search all apps →" : "Search all packages →"}
        </Link>
      </div>
    </div>
  );
}
