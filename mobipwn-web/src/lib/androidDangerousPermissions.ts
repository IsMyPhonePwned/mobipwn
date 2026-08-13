import type { PackagePermission, PackageRow } from "@/lib/packageSnapshot";

/**
 * Android runtime-dangerous permission names (AOSP permission groups).
 * Matched against full `android.permission.*` names or short suffixes from bugreport metadata.
 */
const DANGEROUS_SHORT_NAMES = new Set([
  "READ_CALENDAR",
  "WRITE_CALENDAR",
  "CAMERA",
  "READ_CONTACTS",
  "WRITE_CONTACTS",
  "GET_ACCOUNTS",
  "ACCESS_FINE_LOCATION",
  "ACCESS_COARSE_LOCATION",
  "ACCESS_BACKGROUND_LOCATION",
  "RECORD_AUDIO",
  "READ_PHONE_STATE",
  "READ_PHONE_NUMBERS",
  "CALL_PHONE",
  "ANSWER_PHONE_CALLS",
  "READ_CALL_LOG",
  "WRITE_CALL_LOG",
  "ADD_VOICEMAIL",
  "USE_SIP",
  "PROCESS_OUTGOING_CALLS",
  "BODY_SENSORS",
  "BODY_SENSORS_BACKGROUND",
  "SEND_SMS",
  "RECEIVE_SMS",
  "READ_SMS",
  "RECEIVE_WAP_PUSH",
  "RECEIVE_MMS",
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
  "READ_MEDIA_IMAGES",
  "READ_MEDIA_VIDEO",
  "READ_MEDIA_AUDIO",
  "READ_MEDIA_VISUAL_USER_SELECTED",
  "BLUETOOTH_CONNECT",
  "BLUETOOTH_SCAN",
  "BLUETOOTH_ADVERTISE",
  "NEARBY_WIFI_DEVICES",
  "POST_NOTIFICATIONS",
  "ACTIVITY_RECOGNITION",
  "UWB_RANGING",
]);

export function permissionShortName(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot >= 0 ? trimmed.slice(dot + 1) : trimmed;
}

export function isDangerousAndroidPermission(name: string): boolean {
  const short = permissionShortName(name);
  return DANGEROUS_SHORT_NAMES.has(short) || DANGEROUS_SHORT_NAMES.has(name.trim());
}

export function isDangerousPermissionEntry(perm: PackagePermission): boolean {
  if (perm.protection?.toLowerCase() === "dangerous") return true;
  return isDangerousAndroidPermission(perm.name);
}

export type PackageDangerousPermissions = {
  pkg: PackageRow;
  dangerous: PackagePermission[];
  granted: PackagePermission[];
  denied: PackagePermission[];
};

export function dangerousPermissionsForPackage(pkg: PackageRow): PackagePermission[] {
  return (pkg.permissions ?? []).filter(isDangerousPermissionEntry);
}

export function packagesWithDangerousPermissions(
  packages: PackageRow[]
): PackageDangerousPermissions[] {
  const out: PackageDangerousPermissions[] = [];
  for (const pkg of packages) {
    const dangerous = dangerousPermissionsForPackage(pkg);
    if (!dangerous.length) continue;
    const granted = dangerous.filter((p) => p.granted === true);
    const denied = dangerous.filter((p) => p.granted === false);
    out.push({ pkg, dangerous, granted, denied });
  }
  return out.sort((a, b) => {
    const aGranted = a.granted.length;
    const bGranted = b.granted.length;
    if (aGranted !== bGranted) return bGranted - aGranted;
    if (a.dangerous.length !== b.dangerous.length) {
      return b.dangerous.length - a.dangerous.length;
    }
    return a.pkg.label.localeCompare(b.pkg.label) || a.pkg.bundleId.localeCompare(b.pkg.bundleId);
  });
}
