import { describe, expect, it } from "vitest";
import { accountSnapshotFromRows } from "@/lib/accountSnapshot";

describe("accountSnapshotFromRows", () => {
  it("groups owner, users, and accounts", () => {
    const snap = accountSnapshotFromRows([
      {
        parser: "Account",
        data_type: "android:bugreport:owner",
        app_name: "Alice Smith",
        ext: JSON.stringify({ event_type: "owner_name", owner_name: "Alice Smith", current_user: 0 }),
      },
      {
        parser: "Account",
        data_type: "android:bugreport:user",
        user: "Owner",
        ext: JSON.stringify({
          event_type: "android_user",
          user_id: 0,
          user_name: "Owner",
          is_primary: true,
          user_type: "android.os.usertype.full.SYSTEM",
        }),
      },
      {
        parser: "Account",
        data_type: "android:bugreport:account",
        action: "com.google",
        app_name: "alice@gmail.com",
        user: "Owner",
        ext: JSON.stringify({
          event_type: "account",
          account_name: "alice@gmail.com",
          account_type: "com.google",
          email: "alice@gmail.com",
          user_id: 0,
          user_name: "Owner",
        }),
      },
      {
        parser: "Account",
        data_type: "android:bugreport:account",
        action: "com.whatsapp",
        ext: JSON.stringify({
          event_type: "account",
          account_name: "work",
          account_type: "com.whatsapp",
          user_id: 0,
        }),
      },
    ]);

    expect(snap.sectionFound).toBe(true);
    expect(snap.ownerName).toBe("Alice Smith");
    expect(snap.currentUser).toBe("0");
    expect(snap.users).toHaveLength(1);
    expect(snap.users[0]?.userName).toBe("Owner");
    expect(snap.users[0]?.isPrimary).toBe(true);
    expect(snap.accounts).toHaveLength(2);
    expect(snap.accounts[0]?.email).toBe("alice@gmail.com");
    expect(snap.accounts.find((a) => a.accountType === "com.whatsapp")?.accountName).toBe("work");
  });

  it("groups iOS owner emails, contacts, and linked devices", () => {
    const snap = accountSnapshotFromRows([
      {
        parser: "accounts",
        ext: JSON.stringify({
          event_type: "owner_email",
          email: "alice@icloud.com",
          data_type: "ios:sysdiagnose:owner_email",
        }),
      },
      {
        parser: "accounts",
        ext: JSON.stringify({
          event_type: "transparency_contact",
          contact_uri: "im://mailto:alice@icloud.com",
          email: "alice@icloud.com",
          account_type: "transparency_contact",
          data_type: "ios:sysdiagnose:transparency_contact",
        }),
      },
      {
        parser: "accounts",
        ext: JSON.stringify({
          event_type: "linked_device",
          serial: "C02TEST",
          device_name: "Alice's MacBook",
          device_model: "MacBookPro18,1",
          os_version: "15.0",
          data_type: "ios:sysdiagnose:linked_device",
        }),
      },
      {
        parser: "accounts",
        ext: JSON.stringify({
          event_type: "lockdown_mode",
          lockdown_mode: true,
          data_type: "ios:sysdiagnose:lockdown_mode",
        }),
      },
    ]);

    expect(snap.sectionFound).toBe(true);
    expect(snap.ownerName).toBe("alice@icloud.com");
    expect(snap.lockdownMode).toBe(true);
    expect(snap.accounts.length).toBeGreaterThanOrEqual(1);
    expect(snap.linkedDevices).toHaveLength(1);
    expect(snap.linkedDevices[0]?.name).toBe("Alice's MacBook");
  });

  it("treats CloudConfiguration organization email as MDM management, not an account", () => {
    const snap = accountSnapshotFromRows([
      {
        parser: "accounts",
        ext: JSON.stringify({
          event_type: "organization_email",
          email: "jeremy.renard@edf.fr",
          account_name: "jeremy.renard@edf.fr",
          account_type: "organization_email",
          organization_name: "EDF SA",
          organization_department: "IT",
          data_type: "ios:sysdiagnose:organization_email",
        }),
      },
      {
        parser: "accounts",
        ext: JSON.stringify({
          event_type: "linked_device",
          serial: "KXKW2NH09M",
          device_model: "iPhone18,3",
          os_version: "26.5.1",
          data_type: "ios:sysdiagnose:linked_device",
        }),
      },
    ]);

    expect(snap.sectionFound).toBe(true);
    expect(snap.ownerName).toBe("");
    expect(snap.accounts).toEqual([]);
    expect(snap.managedOrganizations).toHaveLength(1);
    expect(snap.managedOrganizations[0]?.email).toBe("jeremy.renard@edf.fr");
    expect(snap.managedOrganizations[0]?.organizationName).toBe("EDF SA");
    expect(snap.managedOrganizations[0]?.department).toBe("IT");
    expect(snap.linkedDevices).toHaveLength(1);
  });

  it("groups Activation Lock Apple ID from mobileactivation", () => {
    const snap = accountSnapshotFromRows([
      {
        parser: "accounts",
        ext: JSON.stringify({
          event_type: "activation_lock_username",
          email: "anthony@42.bzh",
          account_name: "anthony@42.bzh",
          account_type: "activation_lock",
          data_type: "ios:sysdiagnose:activation_lock_username",
        }),
      },
    ]);

    expect(snap.sectionFound).toBe(true);
    expect(snap.ownerName).toBe("anthony@42.bzh");
    expect(snap.accounts).toHaveLength(1);
    expect(snap.accounts[0]?.email).toBe("anthony@42.bzh");
    expect(snap.accounts[0]?.accountType).toBe("activation_lock");
  });

  it("returns empty when no Account rows", () => {
    const snap = accountSnapshotFromRows([{ parser: "Vpn", message: "x" }]);
    expect(snap.sectionFound).toBe(false);
    expect(snap.accounts).toEqual([]);
    expect(snap.users).toEqual([]);
    expect(snap.linkedDevices).toEqual([]);
  });
});
