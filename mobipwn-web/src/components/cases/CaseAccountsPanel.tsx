import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Laptop,
  Loader2,
  Mail,
  Shield,
  User,
  UserCircle2,
  Users,
} from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_ACCOUNTS_PANEL_ID, type CasePlatform } from "@/lib/caseDashboard";
import {
  accountSearchQuery,
  accountSnapshotFromRows,
  type AccountEntry,
  type AndroidUserEntry,
  type LinkedDeviceEntry,
  type ManagedOrganizationEntry,
} from "@/lib/accountSnapshot";

function accountsQuery(source: string, platform: CasePlatform): string {
  const src = escapeMplString(source);
  const parser = platform === "ios" ? "accounts" : "Account";
  return `source="${src}" parser="${parser}" | fields timestamp, data_type, user, action, app_name, message, ext | head 50`;
}

function AccountRow({ account }: { account: AccountEntry }) {
  const display = account.email || account.accountName;
  const typeLabel =
    account.accountType === "activation_lock"
      ? "Activation Lock / Apple ID"
      : account.accountType === "owner_email"
        ? "Calendar owner email"
        : account.accountType || "unknown type";
  return (
    <li className="case-accounts-panel__account">
      <Mail size={14} aria-hidden />
      <div className="case-accounts-panel__account-body">
        <strong className="mono">{display}</strong>
        <span className="case-accounts-panel__meta muted text-xs">
          {typeLabel}
          {account.userName || account.userId
            ? ` · user ${account.userName || account.userId}`
            : null}
        </span>
      </div>
    </li>
  );
}

function UserRow({ user }: { user: AndroidUserEntry }) {
  return (
    <li className="case-accounts-panel__user">
      <User size={14} aria-hidden />
      <div className="case-accounts-panel__account-body">
        <strong>
          {user.userName}
          <span className="case-accounts-panel__badge mono text-xs">u{user.userId}</span>
          {user.isPrimary ? (
            <span className="case-accounts-panel__badge case-accounts-panel__badge--primary text-xs">
              primary
            </span>
          ) : null}
        </strong>
        <span className="case-accounts-panel__meta muted text-xs">
          {[user.userType, user.userFlags, user.lastLoggedIn ? `last login ${user.lastLoggedIn}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </li>
  );
}

function DeviceRow({ device }: { device: LinkedDeviceEntry }) {
  return (
    <li className="case-accounts-panel__user">
      <Laptop size={14} aria-hidden />
      <div className="case-accounts-panel__account-body">
        <strong>{device.name || device.serial || device.model || "device"}</strong>
        <span className="case-accounts-panel__meta muted text-xs">
          {[device.model, device.serial, device.osVersion].filter(Boolean).join(" · ")}
        </span>
      </div>
    </li>
  );
}

function ManagedOrgRow({ org }: { org: ManagedOrganizationEntry }) {
  const title = org.organizationName || org.email || "Managed device";
  return (
    <li className="case-accounts-panel__user">
      <Building2 size={14} aria-hidden />
      <div className="case-accounts-panel__account-body">
        <strong>{title}</strong>
        <span className="case-accounts-panel__meta muted text-xs">
          {[
            org.email && org.organizationName ? org.email : null,
            org.department,
            "MDM / DEP enrollment contact",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </li>
  );
}

export function CaseAccountsPanel({
  ingestSource,
  refreshKey,
  platform = "android",
}: {
  ingestSource: string;
  refreshKey: number;
  platform?: CasePlatform;
}) {
  const identityPlatform: "android" | "ios" = platform === "ios" ? "ios" : "android";
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_ACCOUNTS_PANEL_ID,
      title: "Accounts",
      query: accountsQuery(ingestSource, identityPlatform),
      viz: "table",
      layout: { i: CASE_ACCOUNTS_PANEL_ID, x: 0, y: 0, w: 6, h: 5, minW: 3, minH: 4 },
    }),
    [ingestSource, identityPlatform]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const snapshot = useMemo(() => accountSnapshotFromRows(rows), [rows]);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-accounts-panel case-accounts-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-accounts-panel case-accounts-panel--error muted text-xs">{error}</p>;
  }

  if (!snapshot.sectionFound) {
    return (
      <div className="case-accounts-panel case-accounts-panel--empty">
        <UserCircle2 size={18} aria-hidden />
        <p className="muted text-xs">
          {identityPlatform === "ios"
            ? "No calendar owner / transparency account identity in this sysdiagnose."
            : "No AccountManager / UserManager identity rows in this bugreport."}
        </p>
        <Link
          to={buildSearchHref(accountSearchQuery(scope, identityPlatform))}
          className="case-accounts-panel__link text-xs"
        >
          Search account identity rows →
        </Link>
      </div>
    );
  }

  const accountCount = snapshot.accounts.length;
  const userCount = snapshot.users.length;
  const deviceCount = snapshot.linkedDevices.length;
  const managedCount = snapshot.managedOrganizations.length;
  const showManagement = managedCount > 0 || snapshot.lockdownMode != null;

  return (
    <div className="case-accounts-panel">
      <header className="case-accounts-panel__hero">
        <UserCircle2 size={18} aria-hidden />
        <div>
          <span className="case-accounts-panel__hero-title">
            {snapshot.ownerName
              ? snapshot.ownerName
              : accountCount > 0
                ? `${accountCount} account${accountCount === 1 ? "" : "s"}`
                : managedCount > 0
                  ? "Managed device"
                  : "Device users"}
          </span>
          <span className="case-accounts-panel__hero-meta muted text-xs">
            {[
              accountCount > 0 ? `${accountCount} account${accountCount === 1 ? "" : "s"}` : null,
              userCount > 0 ? `${userCount} Android user${userCount === 1 ? "" : "s"}` : null,
              deviceCount > 0
                ? `${deviceCount} linked device${deviceCount === 1 ? "" : "s"}`
                : null,
              managedCount > 0 ? "MDM enrollment" : null,
              snapshot.currentUser ? `current user ${snapshot.currentUser}` : null,
              snapshot.lockdownMode === true
                ? "lockdown on"
                : snapshot.lockdownMode === false
                  ? "lockdown off"
                  : null,
            ]
              .filter(Boolean)
              .join(" · ") ||
              (identityPlatform === "ios"
                ? "From MobileCal / Activation Lock / transparency / MDM config"
                : "From dumpsys account / user")}
          </span>
        </div>
      </header>

      <div className="case-accounts-panel__scroll">
        {snapshot.ownerName ? (
          <section className="case-accounts-panel__section">
            <h4 className="case-accounts-panel__section-title">
              <UserCircle2 size={13} aria-hidden />
              Owner
            </h4>
            <p className="case-accounts-panel__owner">{snapshot.ownerName}</p>
          </section>
        ) : null}

        {showManagement ? (
          <section className="case-accounts-panel__section">
            <h4 className="case-accounts-panel__section-title">
              <Shield size={13} aria-hidden />
              Device management
            </h4>
            {snapshot.lockdownMode != null ? (
              <p className="case-accounts-panel__owner">
                Lockdown mode: {snapshot.lockdownMode ? "Enabled" : "Disabled"}
              </p>
            ) : null}
            {managedCount > 0 ? (
              <ul className="case-accounts-panel__list">
                {snapshot.managedOrganizations.map((org) => (
                  <ManagedOrgRow
                    key={`${org.organizationName}:${org.email}`}
                    org={org}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {accountCount > 0 ? (
          <section className="case-accounts-panel__section">
            <h4 className="case-accounts-panel__section-title">
              <Mail size={13} aria-hidden />
              Accounts
            </h4>
            <ul className="case-accounts-panel__list">
              {snapshot.accounts.map((account) => (
                <AccountRow
                  key={`${account.userId}:${account.accountType}:${account.accountName}`}
                  account={account}
                />
              ))}
            </ul>
          </section>
        ) : (
          <p className="case-accounts-panel__none muted text-xs">
            {identityPlatform === "ios"
              ? "No calendar owner, Activation Lock Apple ID, or transparency contacts listed."
              : "No AccountManager accounts listed (may be redacted)."}
          </p>
        )}

        {userCount > 0 ? (
          <section className="case-accounts-panel__section">
            <h4 className="case-accounts-panel__section-title">
              <Users size={13} aria-hidden />
              Android users
            </h4>
            <ul className="case-accounts-panel__list">
              {snapshot.users.map((user) => (
                <UserRow key={user.userId} user={user} />
              ))}
            </ul>
          </section>
        ) : null}

        {deviceCount > 0 ? (
          <section className="case-accounts-panel__section">
            <h4 className="case-accounts-panel__section-title">
              <Laptop size={13} aria-hidden />
              Linked Apple devices
            </h4>
            <ul className="case-accounts-panel__list">
              {snapshot.linkedDevices.map((device) => (
                <DeviceRow
                  key={device.serial || device.name || device.model}
                  device={device}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <Link
        to={buildSearchHref(accountSearchQuery(scope, identityPlatform))}
        className="case-accounts-panel__link text-xs"
      >
        Search account identity events →
      </Link>
    </div>
  );
}
