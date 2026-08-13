import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_SENSITIVE_PERMS_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import {
  appsWithSensitiveTccPermissions,
  iosTccAppSearchQuery,
  type AppSensitiveTccPermissions,
} from "@/lib/iosSensitivePermissions";
import {
  iosParserQuery,
  tccPermissionTitle,
  tccPermissionsFromRows,
  type IosTccPermission,
} from "@/lib/iosParserData";

function SensitiveTccChip({ perm }: { perm: IosTccPermission }) {
  const className =
    perm.granted === true
      ? "case-ios-danger-perms__perm case-ios-danger-perms__perm--granted"
      : perm.granted === false
        ? "case-ios-danger-perms__perm case-ios-danger-perms__perm--denied"
        : "case-ios-danger-perms__perm case-ios-danger-perms__perm--declared";
  return (
    <span className={className} title={tccPermissionTitle(perm)}>
      {perm.service}
      {perm.granted === true ? " ✓" : perm.granted === false ? " ✗" : ""}
    </span>
  );
}

function AppSensitiveRow({
  entry,
  scope,
}: {
  entry: AppSensitiveTccPermissions;
  scope: string;
}) {
  const { client, clientLabel, sensitive, granted } = entry;
  return (
    <tr>
      <td className="case-ios-danger-perms__pkg">
        <Link
          to={buildSearchHref(iosTccAppSearchQuery(scope, client), { run: true })}
          className="case-ios-danger-perms__pkg-link"
          title={client}
        >
          <strong>{clientLabel}</strong>
          <span className="mono text-xs muted">{client}</span>
        </Link>
      </td>
      <td className="mono text-xs case-ios-danger-perms__counts">
        <span title="Allowed sensitive TCC services">{granted.length}</span>
        <span className="muted"> / </span>
        <span title="Total sensitive TCC services">{sensitive.length}</span>
      </td>
      <td>
        <div className="case-ios-danger-perms__perms">
          {sensitive.map((perm) => (
            <SensitiveTccChip key={`${perm.serviceRaw}:${perm.allowed}`} perm={perm} />
          ))}
        </div>
      </td>
    </tr>
  );
}

export function CaseIosSensitivePermissionsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_SENSITIVE_PERMS_PANEL_ID,
      title: "Sensitive permissions",
      query: iosParserQuery(src, "accessibility_tcc", "| fields message, ext | head 2000"),
      viz: "table",
      layout: {
        i: CASE_IOS_SENSITIVE_PERMS_PANEL_ID,
        x: 0,
        y: 0,
        w: 12,
        h: 6,
        minW: 6,
        minH: 5,
      },
    }),
    [src]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const [filter, setFilter] = useState("");
  const entries = useMemo(
    () => appsWithSensitiveTccPermissions(tccPermissionsFromRows(rows)),
    [rows]
  );
  const visible = useMemo(
    () =>
      entries.filter((entry) => {
        if (panelSearchMatch(filter, entry.client, entry.clientLabel)) return true;
        return entry.sensitive.some((p) => panelSearchMatch(filter, p.service, p.serviceRaw));
      }),
    [entries, filter]
  );
  const scope = `source="${src}"`;
  const grantedTotal = visible.reduce((n, e) => n + e.granted.length, 0);
  const deniedTotal = visible.reduce((n, e) => n + e.denied.length, 0);

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-danger-perms case-ios-danger-perms--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="case-ios-danger-perms case-ios-danger-perms--error muted text-xs">{error}</p>
    );
  }

  if (!entries.length) {
    return (
      <p className="case-ios-danger-perms case-ios-danger-perms--empty muted text-xs">
        No apps with sensitive TCC permissions in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-danger-perms">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter app, bundle ID, or TCC service…"
      />
      <header className="case-ios-danger-perms__hero">
        <AlertTriangle size={18} aria-hidden />
        <div>
          <span className="case-ios-danger-perms__hero-title">
            {visible.length}
            {visible.length !== entries.length ? ` / ${entries.length}` : ""} app(s) with sensitive
            permissions
          </span>
          <span className="case-ios-danger-perms__hero-meta muted text-xs">
            {grantedTotal} allowed
            {deniedTotal > 0 ? ` · ${deniedTotal} denied/restricted` : ""}
            {" · "}
            TCC.db via accessibility_tcc
          </span>
        </div>
      </header>

      <div className="case-ios-danger-perms__table-wrap">
        {visible.length === 0 ? (
          <p className="muted text-xs">No apps match the filter.</p>
        ) : (
          <table className="case-ios-danger-perms__table">
            <thead>
              <tr>
                <th>App</th>
                <th>Allowed</th>
                <th>Sensitive permissions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <AppSensitiveRow key={entry.client} entry={entry} scope={scope} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="case-ios-danger-perms__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} parser="accessibility_tcc" | head 80`, { run: true })}>
          Search accessibility_tcc →
        </Link>
      </p>
    </div>
  );
}
