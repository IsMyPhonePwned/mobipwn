import type { IosTccPermission } from "@/lib/iosParserData";
import { tccAllowedStatus } from "@/lib/iosParserData";

/** TCC services considered privacy-sensitive (camera, mic, location, contacts, …). */
const SENSITIVE_TCC_RAW = new Set([
  "kTCCServiceCamera",
  "kTCCServiceMicrophone",
  "kTCCServicePhotos",
  "kTCCServicePhotosAdd",
  "kTCCServiceAddressBook",
  "kTCCServiceCalendar",
  "kTCCServiceReminders",
  "kTCCServiceLocation",
  "kTCCServiceMotion",
  "kTCCServiceSpeechRecognition",
  "kTCCServiceMediaLibrary",
  "kTCCServiceFaceID",
  "kTCCServiceBluetoothAlways",
  "kTCCServiceBluetoothPeripheral",
  "kTCCServiceUserTracking",
  "kTCCServiceWillow",
  "kTCCServiceLiverpool",
  "kTCCServiceScreenCapture",
  "kTCCServiceFocusStatus",
  "kTCCServiceHealth",
  "kTCCServiceHealthUpdate",
  "kTCCServiceHealthShare",
  "kTCCServiceHomeKit",
  "kTCCServiceAppleEvents",
  "kTCCServiceSystemPolicyDesktopFolder",
  "kTCCServiceSystemPolicyDocumentsFolder",
  "kTCCServiceSystemPolicyDownloadsFolder",
  "kTCCServiceSystemPolicyNetworkVolumes",
  "kTCCServiceSystemPolicyRemovableVolumes",
  "kTCCServiceUbiquity",
  "kTCCServiceWatchKit",
  "kTCCServiceSiri",
  "kTCCServiceLocalNetwork",
]);

const SENSITIVE_LABEL_KEYWORDS = [
  "camera",
  "microphone",
  "photo",
  "contact",
  "address book",
  "calendar",
  "reminder",
  "location",
  "motion",
  "speech",
  "media library",
  "face id",
  "biometric",
  "bluetooth",
  "tracking",
  "screen capture",
  "health",
  "home kit",
  "siri",
  "local network",
  "focus",
  "file provider",
  "downloads",
  "documents",
  "desktop",
  "removable",
  // "cloudkit", "liverpool", "homekit" tokens for keyword matching after label rewrite
  "cloudkit",
  "liverpool",
  "willow",
  "ubiquity",
  "icloud",
];

export function isSensitiveTccPermission(perm: IosTccPermission): boolean {
  if (perm.serviceRaw && SENSITIVE_TCC_RAW.has(perm.serviceRaw)) return true;
  const label = perm.service.toLowerCase();
  return SENSITIVE_LABEL_KEYWORDS.some((kw) => label.includes(kw));
}

export type AppSensitiveTccPermissions = {
  client: string;
  clientLabel: string;
  sensitive: IosTccPermission[];
  granted: IosTccPermission[];
  denied: IosTccPermission[];
};

function clientDisplayLabel(client: string): string {
  if (!client.includes(".")) return client;
  const parts = client.split(".");
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return client;
}

export function appsWithSensitiveTccPermissions(
  permissions: IosTccPermission[]
): AppSensitiveTccPermissions[] {
  const byClient = new Map<string, IosTccPermission[]>();

  for (const perm of permissions) {
    if (!isSensitiveTccPermission(perm)) continue;
    const list = byClient.get(perm.client) ?? [];
    list.push(perm);
    byClient.set(perm.client, list);
  }

  const out: AppSensitiveTccPermissions[] = [];
  for (const [client, sensitive] of byClient) {
    const granted = sensitive.filter((p) => p.granted === true || tccAllowedStatus(p.allowed) === true);
    const denied = sensitive.filter((p) => p.granted === false || tccAllowedStatus(p.allowed) === false);
    out.push({
      client,
      clientLabel: clientDisplayLabel(client),
      sensitive: sensitive.sort(
        (a, b) => a.service.localeCompare(b.service) || a.serviceRaw.localeCompare(b.serviceRaw)
      ),
      granted,
      denied,
    });
  }

  return out.sort((a, b) => {
    if (a.granted.length !== b.granted.length) return b.granted.length - a.granted.length;
    if (a.sensitive.length !== b.sensitive.length) return b.sensitive.length - a.sensitive.length;
    return a.clientLabel.localeCompare(b.clientLabel) || a.client.localeCompare(b.client);
  });
}

export function iosTccAppSearchQuery(scope: string, client: string): string {
  const c = client.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `${scope} parser="accessibility_tcc" message="*${c}*" | fields timestamp, message, ext | sort -timestamp | head 40`;
}
