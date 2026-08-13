import { numFromValue, parseExt, strField } from "@/lib/rowExt";

export type DevicePolicyField = { key: string; value: string };

export type DevicePolicyProfileOwner = {
  package: string;
  receiver: string;
  orgOwned: boolean | null;
};

export type DevicePolicyAdmin = {
  id: string;
  package: string;
  receiver: string;
  component: string;
  enabled: boolean | null;
  uid: number | null;
  policies: string[];
  password: DevicePolicyField[];
  security: DevicePolicyField[];
  restrictions: DevicePolicyField[];
  other: DevicePolicyField[];
};

export type DevicePolicySnapshot = {
  profileOwners: DevicePolicyProfileOwner[];
  admins: DevicePolicyAdmin[];
};

const SKIP_EXT_KEYS = new Set([
  "event_type",
  "function",
  "file_path",
  "destination_domain",
  "remote_ip",
  "email",
  "installer",
  "eas_it_policies",
  "accountTypesWithManagementDisabled",
  "defaultEnabledRestrictionsAlreadySet",
  "crossProfileWidgetProviders",
  "mCrossProfileCalendarPackages",
  "mCrossProfilePackages",
  "excludedUids",
  "includedUids",
  "disabledKeyguardFeatures",
  "credentialManagerPolicy",
  "managedProfileCallerIdPolicy",
  "managedProfileContactsPolicy",
  "userRestrictions",
  "mPreferentialNetworkServiceConfigs",
]);

const PASSWORD_KEYS = [
  "passwordQuality",
  "minimumPasswordLength",
  "minimumPasswordLetters",
  "minimumPasswordLowerCase",
  "minimumPasswordUpperCase",
  "minimumPasswordNumeric",
  "minimumPasswordSymbols",
  "minimumPasswordNonLetter",
  "maximumFailedPasswordsForWipe",
  "maximumTimeToUnlock",
  "passwordExpirationTimeout",
  "passwordHistoryLength",
  "mPasswordComplexity",
  "strongAuthUnlockTimeout",
];

const SECURITY_KEYS = [
  "encryptionRequested",
  "isNetworkLoggingEnabled",
  "testOnlyAdmin",
  "mCommonCriteriaMode",
  "mAlwaysOnVpnPackage",
  "mAlwaysOnVpnLockdown",
  "specifiesGlobalProxy",
  "mtePolicy",
  "mWifiMinimumSecurityLevel",
  "requireAutoTime",
  "isParent",
  "mAdminCanGrantSensorsPermissions",
];

const RESTRICTION_KEYS = [
  "disableCamera",
  "disableScreenCapture",
  "disableCallerId",
  "disableContactsSearch",
  "disableBluetoothContactSharing",
  "mSuspendPersonalApps",
  "forceEphemeralUsers",
  "blockNonMatchingNetworks",
  "allowFallbackToDefaultConnection",
  "mUsbDataSignaling",
];

function boolValue(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function cleanLabel(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "").trim();
}

function packageFromComponent(component: string): string {
  const trimmed = component.trim().replace(/:$/, "");
  const slash = trimmed.indexOf("/");
  if (slash > 0) return trimmed.slice(0, slash);
  return "";
}

function adminId(pkg: string, receiver: string): string {
  return `${pkg}|${receiver}`;
}

function formatFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const trimmed = cleanLabel(value);
    if (!trimmed || trimmed === "None" || trimmed === "null") return "";
    return trimmed;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => formatFieldValue(item))
      .filter(Boolean);
    return items.join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const formatted = formatFieldValue(v);
        return formatted ? `${k}=${formatted}` : "";
      })
      .filter(Boolean);
    return entries.join("; ");
  }
  return String(value);
}

function fieldLabel(key: string): string {
  return key
    .replace(/^m/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

function pickFields(
  ext: Record<string, unknown>,
  keys: string[],
  onlyTruthy = false
): DevicePolicyField[] {
  const fields: DevicePolicyField[] = [];
  for (const key of keys) {
    if (!(key in ext)) continue;
    const raw = ext[key];
    const value = formatFieldValue(raw);
    if (!value) continue;
    if (onlyTruthy) {
      const b = boolValue(raw);
      if (b === false || value === "0" || value === "no") continue;
    }
    fields.push({ key: fieldLabel(key), value });
  }
  return fields;
}

function parsePolicies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => cleanLabel(String(item))).filter(Boolean);
}

function parseProfileOwner(raw: unknown): DevicePolicyProfileOwner | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const pkg = cleanLabel(String(obj.package ?? ""));
  const receiver = cleanLabel(String(obj.receiver ?? ""));
  if (!pkg && !receiver) return null;
  return {
    package: pkg,
    receiver: receiver,
    orgOwned: boolValue(obj.isOrganizationOwnedDevice),
  };
}

function parseAdmin(raw: Record<string, unknown>): DevicePolicyAdmin | null {
  const component = cleanLabel(String(raw.component ?? ""));
  const pkg = cleanLabel(String(raw.package ?? "")) || packageFromComponent(component);
  const receiver = cleanLabel(String(raw.receiver ?? ""));
  if (!pkg && !component) return null;

  const password = pickFields(raw, PASSWORD_KEYS);
  const security = pickFields(raw, SECURITY_KEYS);
  const restrictions = pickFields(raw, RESTRICTION_KEYS, true);
  const policies = parsePolicies(raw.policies);

  const other: DevicePolicyField[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (SKIP_EXT_KEYS.has(key)) continue;
    if (
      [
        ...PASSWORD_KEYS,
        ...SECURITY_KEYS,
        ...RESTRICTION_KEYS,
        "event_type",
        "package",
        "receiver",
        "component",
        "policies",
        "isEnabled",
        "uid",
      ].includes(key)
    ) {
      continue;
    }
    const formatted = formatFieldValue(value);
    if (!formatted) continue;
    other.push({ key: fieldLabel(key), value: formatted });
  }

  return {
    id: adminId(pkg || component, receiver),
    package: pkg,
    receiver,
    component,
    enabled: boolValue(raw.isEnabled),
    uid: numFromValue(raw.uid),
    policies,
    password,
    security,
    restrictions,
    other: other.slice(0, 8),
  };
}

function mergeProfileOwners(
  existing: DevicePolicyProfileOwner[],
  incoming: DevicePolicyProfileOwner[]
): DevicePolicyProfileOwner[] {
  const byKey = new Map(existing.map((p) => [`${p.package}|${p.receiver}`, p]));
  for (const owner of incoming) {
    const key = `${owner.package}|${owner.receiver}`;
    if (!byKey.has(key)) byKey.set(key, owner);
  }
  return [...byKey.values()];
}

function mergeAdmins(existing: DevicePolicyAdmin[], incoming: DevicePolicyAdmin[]): DevicePolicyAdmin[] {
  const byId = new Map(existing.map((a) => [a.id, a]));
  for (const admin of incoming) {
    const prev = byId.get(admin.id);
    if (!prev) {
      byId.set(admin.id, admin);
      continue;
    }
    byId.set(admin.id, {
      ...prev,
      enabled: admin.enabled ?? prev.enabled,
      uid: admin.uid ?? prev.uid,
      policies: admin.policies.length ? admin.policies : prev.policies,
      password: admin.password.length ? admin.password : prev.password,
      security: admin.security.length ? admin.security : prev.security,
      restrictions: [...new Map([...prev.restrictions, ...admin.restrictions].map((f) => [f.key, f])).values()],
      other: admin.other.length ? admin.other : prev.other,
    });
  }
  return [...byId.values()];
}

function parseRow(row: Record<string, unknown>): {
  profileOwners: DevicePolicyProfileOwner[];
  admins: DevicePolicyAdmin[];
} {
  const ext = parseExt(row);
  const profileOwners: DevicePolicyProfileOwner[] = [];
  const admins: DevicePolicyAdmin[] = [];

  const eventType = strField(ext, "event_type") || strField(row, "data_type").split(":").pop() || "";

  if (eventType === "profile_owner") {
    const owner = parseProfileOwner(ext);
    if (owner) profileOwners.push(owner);
    return { profileOwners, admins };
  }

  if (eventType === "device_admin") {
    const admin = parseAdmin(ext);
    if (admin) admins.push(admin);
    return { profileOwners, admins };
  }

  const owner = parseProfileOwner(ext.profile_owner);
  if (owner) profileOwners.push(owner);

  for (const [key, value] of Object.entries(ext)) {
    if (!key.startsWith("device_admins_")) continue;
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const admin = parseAdmin(item as Record<string, unknown>);
      if (admin) admins.push(admin);
    }
  }

  return { profileOwners, admins };
}

export function devicePolicySnapshotFromRows(rows: Record<string, unknown>[]): DevicePolicySnapshot | null {
  let profileOwners: DevicePolicyProfileOwner[] = [];
  let admins: DevicePolicyAdmin[] = [];

  for (const row of rows) {
    if (strField(row, "parser") && strField(row, "parser") !== "DevicePolicy") continue;
    const parsed = parseRow(row);
    profileOwners = mergeProfileOwners(profileOwners, parsed.profileOwners);
    admins = mergeAdmins(admins, parsed.admins);
  }

  if (!profileOwners.length && !admins.length) return null;
  admins.sort((a, b) => a.package.localeCompare(b.package));
  return { profileOwners, admins };
}

export function devicePolicySearchQuery(packageName: string, scope?: string): string {
  const pkg = packageName.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const base = scope ? `${scope} ` : "";
  return `${base}parser="DevicePolicy" bundle_id="${pkg}" | head 20`;
}
