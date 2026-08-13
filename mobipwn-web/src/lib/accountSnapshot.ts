import { extField, parseExt, strField } from "@/lib/rowExt";

export type AccountEntry = {
  accountName: string;
  accountType: string;
  email: string;
  userId: string;
  userName: string;
};

export type AndroidUserEntry = {
  userId: string;
  userName: string;
  userFlags: string;
  userType: string;
  isPrimary: boolean;
  lastLoggedIn: string;
};

export type LinkedDeviceEntry = {
  serial: string;
  name: string;
  model: string;
  osVersion: string;
};

/** MDM / DEP CloudConfigurationDetails contact — not a signed-in account. */
export type ManagedOrganizationEntry = {
  email: string;
  organizationName: string;
  department: string;
};

export type AccountSnapshot = {
  ownerName: string;
  currentUser: string;
  accounts: AccountEntry[];
  users: AndroidUserEntry[];
  linkedDevices: LinkedDeviceEntry[];
  /** Organization contact from MDM enrollment (CloudConfigurationDetails). */
  managedOrganizations: ManagedOrganizationEntry[];
  lockdownMode: boolean | null;
  /** At least one Account / accounts identity row was found. */
  sectionFound: boolean;
};

function dataTypeOf(row: Record<string, unknown>): string {
  return (extField(row, "data_type") || strField(row, "data_type")).toLowerCase();
}

function eventTypeOf(row: Record<string, unknown>): string {
  return (extField(row, "event_type") || strField(row, "action")).toLowerCase();
}

function isIdentityParser(parser: string): boolean {
  return parser === "account" || parser === "accounts";
}

function parseAccount(row: Record<string, unknown>): AccountEntry | null {
  const ext = parseExt(row);
  const accountName =
    extField(row, "account_name") ||
    extField(row, "email") ||
    extField(row, "account_id") ||
    extField(row, "phone") ||
    strField(row, "app_name") ||
    String(ext.account_name ?? "").trim();
  const accountType =
    extField(row, "account_type") ||
    strField(row, "action") ||
    String(ext.account_type ?? "").trim();
  if (!accountName && !accountType) return null;
  if (
    accountType === "account" ||
    accountType === "owner_name" ||
    accountType === "android_user" ||
    accountType === "linked_device" ||
    accountType === "lockdown_mode"
  ) {
    if (!accountName) return null;
  }
  const email =
    extField(row, "email") || (accountName.includes("@") ? accountName : "");
  return {
    accountName: accountName || "—",
    accountType: accountType === "account" ? "" : accountType,
    email,
    userId: extField(row, "user_id") || strField(row, "user") || "",
    userName: extField(row, "user_name") || "",
  };
}

function parseUser(row: Record<string, unknown>): AndroidUserEntry | null {
  const userId = extField(row, "user_id");
  const userName = extField(row, "user_name") || strField(row, "user") || strField(row, "app_name");
  if (!userId && !userName) return null;
  const primary = extField(row, "is_primary");
  return {
    userId: userId || "?",
    userName: userName || "user",
    userFlags: extField(row, "user_flags") || extField(row, "flags_detail"),
    userType: extField(row, "user_type"),
    isPrimary: primary === "true" || primary === "1",
    lastLoggedIn: extField(row, "last_logged_in"),
  };
}

function parseLinkedDevice(row: Record<string, unknown>): LinkedDeviceEntry | null {
  const serial = extField(row, "serial") || extField(row, "device_id") || strField(row, "device_id");
  const name = extField(row, "device_name") || strField(row, "app_name");
  const model = extField(row, "device_model") || strField(row, "device_model");
  const osVersion = extField(row, "os_version") || strField(row, "os_version");
  if (!serial && !name && !model) return null;
  return { serial, name, model, osVersion };
}

export function accountSnapshotFromRows(rows: Record<string, unknown>[]): AccountSnapshot {
  const accountsByKey = new Map<string, AccountEntry>();
  const usersByKey = new Map<string, AndroidUserEntry>();
  const devicesByKey = new Map<string, LinkedDeviceEntry>();
  const managedByKey = new Map<string, ManagedOrganizationEntry>();
  let ownerName = "";
  let currentUser = "";
  let lockdownMode: boolean | null = null;
  let sectionFound = false;

  for (const row of rows) {
    const parser = strField(row, "parser").toLowerCase();
    if (parser && !isIdentityParser(parser)) continue;

    sectionFound = true;
    const dt = dataTypeOf(row);
    const et = eventTypeOf(row);

    if (et === "lockdown_mode" || dt.includes(":lockdown_mode")) {
      const raw = extField(row, "lockdown_mode");
      if (raw === "true" || raw === "1") lockdownMode = true;
      else if (raw === "false" || raw === "0") lockdownMode = false;
      continue;
    }

    // MDM / DEP enrollment contact (CloudConfigurationDetails) — not a user account.
    if (dt.includes(":organization_email") || et === "organization_email") {
      const email = extField(row, "email") || extField(row, "account_name");
      const organizationName = extField(row, "organization_name");
      const department = extField(row, "organization_department");
      if (email || organizationName) {
        const key = `${organizationName}:${email}`;
        managedByKey.set(key, {
          email,
          organizationName,
          department,
        });
      }
      continue;
    }

    if (dt.includes(":owner_email") || et === "owner_email") {
      const email = extField(row, "email") || extField(row, "account_name");
      if (email) {
        if (!ownerName) ownerName = email;
        const account = parseAccount(row);
        if (account) {
          accountsByKey.set(`${account.accountType || "owner"}:${account.accountName}`, account);
        }
      }
      continue;
    }

    // Find My / Activation Lock Apple ID from mobileactivationd (ActivationLockUsername).
    if (
      dt.includes(":activation_lock_username") ||
      et === "activation_lock_username" ||
      extField(row, "account_type") === "activation_lock"
    ) {
      const email = extField(row, "email") || extField(row, "account_name");
      if (email) {
        if (!ownerName) ownerName = email;
        const account = parseAccount(row);
        if (account) {
          account.accountType = "activation_lock";
          accountsByKey.set(`activation_lock:${account.accountName}`, account);
        }
      }
      continue;
    }

    if ((dt.includes(":owner") && !dt.includes("owner_email")) || et === "owner_name") {
      const name =
        extField(row, "owner_name") || strField(row, "app_name") || strField(row, "user");
      if (name) ownerName = name;
      const cur = extField(row, "current_user") || extField(row, "user_id");
      if (cur) currentUser = cur;
      continue;
    }

    if (dt.includes(":linked_device") || et === "linked_device") {
      const device = parseLinkedDevice(row);
      if (device) {
        devicesByKey.set(device.serial || device.name || device.model, device);
      }
      continue;
    }

    if (dt.includes(":user") || et === "android_user") {
      const user = parseUser(row);
      if (user) usersByKey.set(user.userId, user);
      continue;
    }

    if (
      dt.includes(":account") ||
      dt.includes(":transparency_contact") ||
      et === "account" ||
      et === "apple_account" ||
      et === "transparency_contact" ||
      extField(row, "account_name") ||
      extField(row, "email")
    ) {
      const account = parseAccount(row);
      if (account) {
        const key = `${account.userId}:${account.accountType}:${account.accountName}`;
        accountsByKey.set(key, account);
      }
    }
  }

  return {
    ownerName,
    currentUser,
    accounts: [...accountsByKey.values()].sort(
      (a, b) =>
        a.accountType.localeCompare(b.accountType) || a.accountName.localeCompare(b.accountName)
    ),
    users: [...usersByKey.values()].sort((a, b) => Number(a.userId) - Number(b.userId)),
    linkedDevices: [...devicesByKey.values()].sort((a, b) =>
      (a.name || a.serial).localeCompare(b.name || b.serial)
    ),
    managedOrganizations: [...managedByKey.values()].sort((a, b) =>
      (a.organizationName || a.email).localeCompare(b.organizationName || b.email)
    ),
    lockdownMode,
    sectionFound,
  };
}

export function accountSearchQuery(scope: string, platform: "android" | "ios" = "android"): string {
  const parser = platform === "ios" ? "accounts" : "Account";
  return `${scope} parser="${parser}" | head 50`;
}
