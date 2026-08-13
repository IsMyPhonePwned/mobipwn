import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_ANDROID_DANGEROUS_PERMS_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import {
  packagesWithDangerousPermissions,
  type PackageDangerousPermissions,
} from "@/lib/androidDangerousPermissions";
import {
  packageRows,
  packagesQuery,
  packageSearchQuery,
  permissionChipTitle,
  type PackagePermission,
} from "@/lib/packageSnapshot";

function DangerousPermChip({ perm }: { perm: PackagePermission }) {
  const className =
    perm.granted === true
      ? "case-android-danger-perms__perm case-android-danger-perms__perm--granted"
      : perm.granted === false
        ? "case-android-danger-perms__perm case-android-danger-perms__perm--denied"
        : "case-android-danger-perms__perm case-android-danger-perms__perm--declared";
  return (
    <span className={className} title={permissionChipTitle(perm)}>
      {perm.shortName}
      {perm.granted === true ? " ✓" : perm.granted === false ? " ✗" : ""}
    </span>
  );
}

function PackageDangerRow({
  entry,
  scope,
}: {
  entry: PackageDangerousPermissions;
  scope: string;
}) {
  const { pkg, dangerous, granted } = entry;
  return (
    <tr>
      <td className="case-android-danger-perms__pkg">
        <Link
          to={buildSearchHref(packageSearchQuery(pkg.bundleId, scope, "android"), { run: true })}
          className="case-android-danger-perms__pkg-link"
          title={pkg.label && pkg.label !== pkg.bundleId ? pkg.label : pkg.bundleId}
        >
          <strong className="mono">{pkg.bundleId}</strong>
          {pkg.version ? (
            <span className="case-android-danger-perms__version mono text-xs muted">{pkg.version}</span>
          ) : null}
          {pkg.label && pkg.label !== pkg.bundleId ? (
            <span className="case-android-danger-perms__label text-xs muted">{pkg.label}</span>
          ) : null}
        </Link>
      </td>
      <td className="mono text-xs case-android-danger-perms__counts">
        <span title="Granted dangerous permissions">{granted.length}</span>
        <span className="muted"> / </span>
        <span title="Total dangerous permissions">{dangerous.length}</span>
      </td>
      <td>
        <div className="case-android-danger-perms__perms">
          {dangerous.map((perm) => (
            <DangerousPermChip key={perm.name} perm={perm} />
          ))}
        </div>
      </td>
    </tr>
  );
}

export function CaseAndroidDangerousPermissionsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_ANDROID_DANGEROUS_PERMS_PANEL_ID,
      title: "Dangerous permissions",
      query: packagesQuery(ingestSource, "android"),
      viz: "table",
      layout: {
        i: CASE_ANDROID_DANGEROUS_PERMS_PANEL_ID,
        x: 0,
        y: 0,
        w: 12,
        h: 6,
        minW: 6,
        minH: 5,
      },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const [filter, setFilter] = useState("");
  const entries = useMemo(
    () => packagesWithDangerousPermissions(packageRows(rows, 0, "android")),
    [rows]
  );
  const visible = useMemo(
    () =>
      entries.filter((entry) => {
        const { pkg, dangerous } = entry;
        if (panelSearchMatch(filter, pkg.bundleId, pkg.label, pkg.version, pkg.installer)) return true;
        return dangerous.some((p) => panelSearchMatch(filter, p.name, p.shortName));
      }),
    [entries, filter]
  );
  const scope = `source="${escapeMplString(ingestSource)}"`;
  const grantedTotal = visible.reduce((n, e) => n + e.granted.length, 0);
  const deniedTotal = visible.reduce((n, e) => n + e.denied.length, 0);

  if (loading && rows.length === 0) {
    return (
      <div className="case-android-danger-perms case-android-danger-perms--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="case-android-danger-perms case-android-danger-perms--error muted text-xs">
        {error}
      </p>
    );
  }

  if (!entries.length) {
    return (
      <p className="case-android-danger-perms case-android-danger-perms--empty muted text-xs">
        No packages with dangerous Android permissions in this bugreport.
      </p>
    );
  }

  return (
    <div className="case-android-danger-perms">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter package name, version, or permission…"
      />
      <header className="case-android-danger-perms__hero">
        <AlertTriangle size={18} aria-hidden />
        <div>
          <span className="case-android-danger-perms__hero-title">
            {visible.length}
            {visible.length !== entries.length ? ` / ${entries.length}` : ""} package(s) with
            dangerous permissions
          </span>
          <span className="case-android-danger-perms__hero-meta muted text-xs">
            {grantedTotal} granted
            {deniedTotal > 0 ? ` · ${deniedTotal} denied` : ""}
            {" · "}
            runtime / protection=dangerous
          </span>
        </div>
      </header>

      <div className="case-android-danger-perms__table-wrap">
        {visible.length === 0 ? (
          <p className="muted text-xs">No packages match the filter.</p>
        ) : (
          <table className="case-android-danger-perms__table">
            <thead>
              <tr>
                <th>Package</th>
                <th>Granted</th>
                <th>Dangerous permissions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <PackageDangerRow key={entry.pkg.bundleId} entry={entry} scope={scope} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="case-android-danger-perms__footer muted text-xs">
        <Link
          to={buildSearchHref(
            `${scope} parser="Package" data_type=*package_metadata* | head 50`,
            { run: true }
          )}
        >
          Search package metadata →
        </Link>
      </p>
    </div>
  );
}
