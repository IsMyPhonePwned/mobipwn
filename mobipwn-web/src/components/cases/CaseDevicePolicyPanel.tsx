import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Building2, Loader2, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_DEVICE_POLICY_PANEL_ID } from "@/lib/caseDashboard";
import {
  devicePolicySearchQuery,
  devicePolicySnapshotFromRows,
  type DevicePolicyAdmin,
  type DevicePolicyField,
} from "@/lib/devicePolicy";

function devicePolicyQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="DevicePolicy" | fields timestamp, data_type, bundle_id, message, ext | head 30`;
}

function FieldGrid({ fields }: { fields: DevicePolicyField[] }) {
  if (!fields.length) return null;
  return (
    <dl className="case-dp-grid">
      {fields.map((field, index) => (
        <div key={`${field.key}-${index}`} className="case-dp-grid__row">
          <dt>{field.key}</dt>
          <dd className="mono">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AdminCard({ admin }: { admin: DevicePolicyAdmin }) {
  return (
    <section className="case-dp-admin">
      <header className="case-dp-admin__head">
        <div className="case-dp-admin__title">
          <Shield size={13} aria-hidden />
          <strong className="mono">{admin.package || admin.component}</strong>
        </div>
        <div className="case-dp-admin__badges">
          {admin.enabled === true && <span className="case-dp-tag case-dp-tag--on">Enabled</span>}
          {admin.enabled === false && <span className="case-dp-tag case-dp-tag--off">Disabled</span>}
          {admin.uid != null && <span className="case-dp-tag muted mono">uid {admin.uid}</span>}
        </div>
      </header>

      {admin.receiver && (
        <p className="case-dp-admin__receiver muted text-xs mono">{admin.receiver}</p>
      )}

      {admin.policies.length > 0 && (
        <div className="case-dp-admin__section">
          <h5 className="case-dp-admin__section-title">Policies</h5>
          <div className="case-dp-tags">
            {admin.policies.map((policy) => (
              <span key={policy} className="case-dp-tag">
                {policy}
              </span>
            ))}
          </div>
        </div>
      )}

      {admin.password.length > 0 && (
        <div className="case-dp-admin__section">
          <h5 className="case-dp-admin__section-title">Password requirements</h5>
          <FieldGrid fields={admin.password} />
        </div>
      )}

      {admin.security.length > 0 && (
        <div className="case-dp-admin__section">
          <h5 className="case-dp-admin__section-title">Security & VPN</h5>
          <FieldGrid fields={admin.security} />
        </div>
      )}

      {admin.restrictions.length > 0 && (
        <div className="case-dp-admin__section">
          <h5 className="case-dp-admin__section-title">
            <ShieldAlert size={12} aria-hidden />
            Active restrictions
          </h5>
          <FieldGrid fields={admin.restrictions} />
        </div>
      )}

      {admin.other.length > 0 && (
        <details className="case-dp-admin__more">
          <summary className="muted text-xs">More fields ({admin.other.length})</summary>
          <FieldGrid fields={admin.other} />
        </details>
      )}
    </section>
  );
}

export function CaseDevicePolicyPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_DEVICE_POLICY_PANEL_ID,
      title: "Device policy",
      query: devicePolicyQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_DEVICE_POLICY_PANEL_ID, x: 0, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const snapshot = useMemo(() => devicePolicySnapshotFromRows(rows), [rows]);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-dp-panel case-dp-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-dp-panel case-dp-panel--error muted text-xs">{error}</p>;
  }

  if (!snapshot) {
    return (
      <p className="case-dp-panel case-dp-panel--empty muted text-xs">
        No device policy admins or profile owners in this bugreport.
      </p>
    );
  }

  return (
    <div className="case-dp-panel">
      <div className="case-dp-panel__summary">
        {snapshot.profileOwners.length > 0 && (
          <span className="case-dp-stat">
            <Building2 size={13} aria-hidden />
            {snapshot.profileOwners.length} profile owner{snapshot.profileOwners.length === 1 ? "" : "s"}
          </span>
        )}
        <span className="case-dp-stat">
          <ShieldCheck size={13} aria-hidden />
          {snapshot.admins.length} admin{snapshot.admins.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="case-dp-panel__scroll">
      {snapshot.profileOwners.map((owner) => (
        <section key={`${owner.package}|${owner.receiver}`} className="case-dp-owner">
          <h4 className="case-dp-owner__title">
            <Building2 size={13} aria-hidden />
            Profile owner
          </h4>
          <p className="case-dp-owner__package mono">{owner.package}</p>
          {owner.receiver && <p className="case-dp-owner__receiver muted text-xs mono">{owner.receiver}</p>}
          {owner.orgOwned != null && (
            <span className="case-dp-tag">
              {owner.orgOwned ? "Organization-owned device" : "Personal work profile"}
            </span>
          )}
          {owner.package && (
            <Link
              to={buildSearchHref(devicePolicySearchQuery(owner.package, scope), { run: true })}
              className="case-dp-panel__link text-xs"
            >
              Search →
            </Link>
          )}
        </section>
      ))}

      {snapshot.admins.map((admin) => (
        <div key={admin.id}>
          <AdminCard admin={admin} />
          {admin.package && (
            <Link
              to={buildSearchHref(devicePolicySearchQuery(admin.package, scope), { run: true })}
              className="case-dp-panel__link text-xs"
            >
              Search {admin.package} →
            </Link>
          )}
        </div>
      ))}
      </div>

      <Link
        to={buildSearchHref(`${scope} parser="DevicePolicy" | head 20`, { run: true })}
        className="case-dp-panel__link text-xs"
      >
        Search all device policy events →
      </Link>
    </div>
  );
}
