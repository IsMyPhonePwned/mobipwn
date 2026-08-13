import { describe, expect, it } from "vitest";
import {
  packageDisplayLabel,
  packageRows,
  parsePackageRow,
  parsePackageTimeMs,
  resolveAndroidProcessPackage,
  type PackageRow,
} from "@/lib/packageSnapshot";

describe("parsePackageTimeMs", () => {
  it("parses android dump timestamps", () => {
    expect(parsePackageTimeMs("2025-08-26 13:40:57")).toBe(Date.parse("2025-08-26T13:40:57Z"));
  });

  it("rejects epoch sentinel times", () => {
    expect(parsePackageTimeMs("1970-01-01 01:00:00")).toBeNull();
  });

  it("rejects absurd future powerlogs times", () => {
    expect(parsePackageTimeMs("2082-05-22 02:56:39")).toBeNull();
  });
});

describe("parsePackageRow ios trusts ingest-stamped bundle_id", () => {
  it("does not invent apps from empty bundle_id + plist URL messages", () => {
    const pkg = parsePackageRow(
      {
        parser: "plists",
        bundle_id: "",
        message:
          "Plist URL logs/parsecd/config.plist resources.iphone_clock_1x: https://cdn.smoot.apple.com/image/clock_1x.png",
        timestamp: "2026-07-08T16:56:45.000Z",
      },
      "ios"
    );
    expect(pkg).toBeNull();
  });

  it("uses stamped bundle_id from mobileinstallation", () => {
    const pkg = parsePackageRow(
      {
        parser: "mobileinstallation",
        bundle_id: "com.cbouvat.saracroche",
        message:
          "Staging <MIInstallableBundle ID=com.cbouvat.saracroche; Persona=FEEDEEEE, Version=1, ShortVersion=4.12.0>",
        timestamp: "2026-06-25T12:37:45.000Z",
      },
      "ios"
    );
    expect(pkg?.bundleId).toBe("com.cbouvat.saracroche");
    expect(pkg?.version).toBe("4.12.0");
  });

  it("ignores prose version fragments like 'version does'", () => {
    const pkg = parsePackageRow(
      {
        parser: "mobileinstallation",
        bundle_id: "org.whispersystems.signal",
        message: "Install requested; version does not match existing container",
        timestamp: "2025-04-07T14:47:00.000Z",
      },
      "ios"
    );
    expect(pkg?.bundleId).toBe("org.whispersystems.signal");
    expect(pkg?.version).toBe("");
  });

  it("parses powerlogs App Info name/version and drops bogus time", () => {
    const pkg = parsePackageRow(
      {
        parser: "powerlogs",
        bundle_id: "com.supercell.laser",
        message:
          "App Info: app name=Brawl Stars, app executable name=laser, app build version=68.250, app bundle version=68.250, app type=101, app deleted date=NOT DELETED",
        timestamp: "1970-03-25T19:30:00.000Z",
        ext: {
          "app name": "Brawl Stars",
          "app executable name": "laser",
          "app build version": "68.250",
          "app bundle version": "68.250",
          "app type": "101",
          "app deleted date": "NOT DELETED",
        },
      },
      "ios"
    );
    expect(pkg?.bundleId).toBe("com.supercell.laser");
    expect(pkg?.label).toBe("Brawl Stars");
    expect(pkg?.version).toBe("68.250");
    expect(pkg?.executableName).toBe("laser");
    expect(pkg?.buildVersion).toBe("68.250");
    expect(pkg?.appType).toBe("101");
    expect(pkg?.isDeleted).toBeFalsy();
    expect(pkg?.installedAtMs).toBeNull();
  });

  it("merges TCC permissions onto App Info inventory", () => {
    const pkgs = packageRows(
      [
        {
          parser: "powerlogs",
          bundle_id: "com.apple.Health",
          message:
            "App Info: app name=Health, app executable name=Health, app bundle version=1.0, app deleted date=NOT DELETED",
          timestamp: "1970-01-01T00:00:00.000Z",
          ext: {
            "app name": "Health",
            "app executable name": "Health",
            "app bundle version": "1.0",
            "app deleted date": "NOT DELETED",
          },
        },
        {
          parser: "accessibility_tcc",
          bundle_id: "com.apple.Health",
          permission: "kTCCServiceLiverpool",
          message: "App Permissions: service=kTCCServiceLiverpool, client=com.apple.Health, allowed=ALLOWED",
          ext: {
            service: "kTCCServiceLiverpool",
            client: "com.apple.Health",
            allowed: "ALLOWED",
            "last modified": "2023-05-24 12:00:00",
          },
        },
      ],
      0,
      "ios"
    );
    const health = pkgs.find((p) => p.bundleId === "com.apple.Health");
    expect(health?.label).toBe("Health");
    expect(health?.executableName).toBe("Health");
    expect(health?.permissions?.some((p) => p.name === "kTCCServiceLiverpool" && p.granted === true)).toBe(
      true
    );
    expect(health?.permissions?.some((p) => p.shortName === "CloudKit")).toBe(true);
    expect(health?.sources).toEqual(expect.arrayContaining(["accessibility_tcc", "powerlogs"]));
  });

  it("merges rows that already share a host-app bundle_id", () => {
    const pkgs = packageRows(
      [
        {
          parser: "mobileinstallation",
          bundle_id: "com.cbouvat.saracroche",
          message: "Data container for com.cbouvat.saracroche.blocker is now at /private/var/…",
          timestamp: "2026-07-08T12:15:17.000Z",
        },
        {
          parser: "mobileinstallation",
          bundle_id: "com.cbouvat.saracroche",
          message:
            "Staging <MIInstallableBundle ID=com.cbouvat.saracroche; Version=1, ShortVersion=4.13.1>",
          timestamp: "2026-07-08T12:15:18.000Z",
        },
        {
          parser: "powerlogs",
          bundle_id: "com.supercell.laser",
          message:
            "App Info: app name=Brawl Stars, app bundle version=68.250, app deleted date=NOT DELETED",
          timestamp: "1970-03-25T19:30:00.000Z",
        },
      ],
      0,
      "ios"
    );
    expect(pkgs.filter((p) => p.bundleId.includes("saracroche")).map((p) => p.bundleId)).toEqual([
      "com.cbouvat.saracroche",
    ]);
    expect(pkgs.map((p) => p.bundleId)).toContain("com.supercell.laser");
  });
});

describe("parsePackageRow android install time", () => {
  it("reads firstInstallTime from users[0]", () => {
    const row = {
      parser: "Package",
      data_type: "android:bugreport:package_metadata",
      bundle_id: "com.example.app",
      ext: {
        versionName: "1.0",
        lastUpdateTime: "2025-08-26 14:00:00",
        users: [{ user_id: 0, firstInstallTime: "2025-08-26 13:40:57" }],
      },
    };
    const pkg = parsePackageRow(row, "android");
    expect(pkg?.installedAtMs).toBe(Date.parse("2025-08-26T13:40:57Z"));
    expect(pkg?.installedAt).toBeTruthy();
  });

  it("extracts UID, SDK, paths, and installer provenance", () => {
    const pkg = parsePackageRow(
      {
        parser: "Package",
        data_type: "android:bugreport:package_metadata",
        bundle_id: "com.bitchat.droid",
        ext: {
          appId: 10333,
          versionName: "1.2.0",
          versionCode: 16,
          minSdk: 26,
          targetSdk: 34,
          codePath: "/data/app/~~x==/com.bitchat.droid-y==",
          dataDir: "/data/user/0/com.bitchat.droid",
          installerPackageName: "com.google.android.packageinstaller",
          initiatingPackageName: "com.google.android.packageinstaller",
          originatingPackageName: "com.sec.android.app.sbrowser",
          lastUpdateTime: "2025-08-26 13:40:57",
          apkSigningVersion: "2",
          primaryCpuAbi: "arm64-v8a",
          flags: "[ HAS_CODE ALLOW_CLEAR_USER_DATA ]",
          users: [{ user_id: 0, firstInstallTime: "2025-08-26 13:40:57", installReason: 4 }],
        },
      },
      "android"
    );
    expect(pkg?.uid).toBe("10333");
    expect(pkg?.version).toBe("1.2.0");
    expect(pkg?.versionCode).toBe("16");
    expect(pkg?.minSdk).toBe("26");
    expect(pkg?.targetSdk).toBe("34");
    expect(pkg?.codePath).toContain("/data/app/");
    expect(pkg?.isSystemPath).toBe(false);
    expect(pkg?.originatingPackage).toBe("com.sec.android.app.sbrowser");
    expect(pkg?.installReason).toBe("4");
    expect(pkg?.updatedAtMs).toBe(Date.parse("2025-08-26T13:40:57Z"));
  });

  it("flags system partition code paths", () => {
    const pkg = parsePackageRow(
      {
        parser: "Package",
        data_type: "android:bugreport:package_metadata",
        bundle_id: "com.android.settings",
        ext: { codePath: "/system/priv-app/Settings" },
      },
      "android"
    );
    expect(pkg?.isSystemPath).toBe(true);
  });
});

describe("packageRows sort", () => {
  it("sorts newest install first", () => {
    const rows = [
      {
        parser: "Package",
        data_type: "android:bugreport:package_metadata",
        bundle_id: "com.old.app",
        ext: { users: [{ user_id: 0, firstInstallTime: "2024-01-01 10:00:00" }] },
      },
      {
        parser: "Package",
        data_type: "android:bugreport:package_metadata",
        bundle_id: "com.new.app",
        ext: { users: [{ user_id: 0, firstInstallTime: "2025-06-01 10:00:00" }] },
      },
    ];
    const pkgs = packageRows(rows, 0, "android");
    expect(pkgs.map((p) => p.bundleId)).toEqual(["com.new.app", "com.old.app"]);
  });
});

describe("packageDisplayLabel", () => {
  it("prefers human label over version-like strings", () => {
    expect(
      packageDisplayLabel({ bundleId: "com.example.app", label: "Example" })
    ).toBe("Example");
    expect(packageDisplayLabel({ bundleId: "com.example.app", label: "1.2.3" })).toBe(
      "example.app"
    );
  });
});

describe("resolveAndroidProcessPackage", () => {
  const packages: PackageRow[] = [
    {
      bundleId: "com.whatsapp",
      label: "WhatsApp",
      version: "2.0",
      installer: "",
      updated: "",
      timestamp: "",
      installedAt: "",
      installedAtMs: null,
    },
    {
      bundleId: "com.google.android.gms",
      label: "Google Play services",
      version: "1",
      installer: "",
      updated: "",
      timestamp: "",
      installedAt: "",
      installedAtMs: null,
    },
  ];

  it("matches exact package id and package:suffix processes", () => {
    expect(resolveAndroidProcessPackage("com.whatsapp", packages)?.bundleId).toBe(
      "com.whatsapp"
    );
    expect(resolveAndroidProcessPackage("com.whatsapp:remote", packages)?.label).toBe(
      "WhatsApp"
    );
    expect(resolveAndroidProcessPackage("com.google.android.gms/ui", packages)?.bundleId).toBe(
      "com.google.android.gms"
    );
  });

  it("skips kernel threads and unknown cmds", () => {
    expect(resolveAndroidProcessPackage("[kthreadd]", packages)).toBeNull();
    expect(resolveAndroidProcessPackage("system_server", packages)).toBeNull();
  });
});
