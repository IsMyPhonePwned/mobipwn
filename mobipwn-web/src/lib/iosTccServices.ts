/**
 * Human labels / tooltips for Apple TCC service ids (`kTCCService…`).
 *
 * Many services use opaque Apple codenames (Liverpool, Willow, …) that are not
 * shown in Settings → Privacy. Labels are best-effort community mappings —
 * Apple does not publish an official dictionary.
 */

export type IosTccServiceInfo = {
  /** Canonical id, e.g. `kTCCServiceLiverpool`. */
  id: string;
  /** Short chip label (e.g. "CloudKit"). */
  label: string;
  /** One-line explanation for tooltips. */
  description: string;
};

type Entry = { id: string; label: string; description: string };

/** Known / commonly seen TCC services. Keys are without the `kTCCService` prefix, lowercased. */
const BY_SUFFIX: Record<string, Entry> = {
  addressbook: {
    id: "kTCCServiceAddressBook",
    label: "Contacts",
    description: "Access to Contacts (Address Book).",
  },
  appleevents: {
    id: "kTCCServiceAppleEvents",
    label: "Automation",
    description: "Control other apps via Apple Events (macOS Automation).",
  },
  bluetoothalways: {
    id: "kTCCServiceBluetoothAlways",
    label: "Bluetooth",
    description: "Bluetooth access while the app is in use or in the background.",
  },
  bluetoothperipheral: {
    id: "kTCCServiceBluetoothPeripheral",
    label: "Bluetooth peripheral",
    description: "Act as a Bluetooth peripheral / LE accessory.",
  },
  calendar: {
    id: "kTCCServiceCalendar",
    label: "Calendars",
    description: "Access to Calendar data.",
  },
  camera: {
    id: "kTCCServiceCamera",
    label: "Camera",
    description: "Access to the device camera.",
  },
  faceid: {
    id: "kTCCServiceFaceID",
    label: "Face ID",
    description: "Use Face ID / biometrics.",
  },
  focusstatus: {
    id: "kTCCServiceFocusStatus",
    label: "Focus",
    description: "Read Focus / Do Not Disturb status.",
  },
  health: {
    id: "kTCCServiceHealth",
    label: "Health",
    description: "HealthKit access (generic).",
  },
  healthshare: {
    id: "kTCCServiceHealthShare",
    label: "Health (share)",
    description: "Read HealthKit data shared with the app.",
  },
  healthupdate: {
    id: "kTCCServiceHealthUpdate",
    label: "Health (write)",
    description: "Write HealthKit data.",
  },
  homekit: {
    id: "kTCCServiceHomeKit",
    label: "HomeKit",
    description: "Access to HomeKit home / accessory data.",
  },
  liverpool: {
    id: "kTCCServiceLiverpool",
    label: "CloudKit",
    description:
      "Undocumented TCC service (kTCCServiceLiverpool), widely mapped to CloudKit / iCloud-backed data — not Location Services. Not shown as its own Privacy Settings row.",
  },
  location: {
    id: "kTCCServiceLocation",
    label: "Location",
    description: "Location Services access (when gated via TCC on this OS).",
  },
  localnetwork: {
    id: "kTCCServiceLocalNetwork",
    label: "Local network",
    description: "Discover and connect to devices on the local network.",
  },
  medialibrary: {
    id: "kTCCServiceMediaLibrary",
    label: "Media library",
    description: "Access to the Apple Music / media library.",
  },
  microphone: {
    id: "kTCCServiceMicrophone",
    label: "Microphone",
    description: "Access to the microphone.",
  },
  motion: {
    id: "kTCCServiceMotion",
    label: "Motion & fitness",
    description: "Motion / accelerometer / fitness-related sensors.",
  },
  photos: {
    id: "kTCCServicePhotos",
    label: "Photos",
    description: "Read access to the Photo Library.",
  },
  photosadd: {
    id: "kTCCServicePhotosAdd",
    label: "Photos (add)",
    description: "Add-only access to the Photo Library.",
  },
  reminders: {
    id: "kTCCServiceReminders",
    label: "Reminders",
    description: "Access to Reminders.",
  },
  screencapture: {
    id: "kTCCServiceScreenCapture",
    label: "Screen recording",
    description: "Screen capture / recording.",
  },
  siri: {
    id: "kTCCServiceSiri",
    label: "Siri",
    description: "Siri / voice assistant integration.",
  },
  speechrecognition: {
    id: "kTCCServiceSpeechRecognition",
    label: "Speech recognition",
    description: "On-device or server speech recognition.",
  },
  systempolicyallfiles: {
    id: "kTCCServiceSystemPolicyAllFiles",
    label: "Full Disk Access",
    description: "Full Disk Access (macOS System Policy).",
  },
  systempolicydesktopfolder: {
    id: "kTCCServiceSystemPolicyDesktopFolder",
    label: "Desktop folder",
    description: "Access to the Desktop folder (macOS).",
  },
  systempolicydocumentsfolder: {
    id: "kTCCServiceSystemPolicyDocumentsFolder",
    label: "Documents folder",
    description: "Access to the Documents folder (macOS).",
  },
  systempolicydownloadsfolder: {
    id: "kTCCServiceSystemPolicyDownloadsFolder",
    label: "Downloads folder",
    description: "Access to the Downloads folder (macOS).",
  },
  systempolicynetworkvolumes: {
    id: "kTCCServiceSystemPolicyNetworkVolumes",
    label: "Network volumes",
    description: "Access to network volumes (macOS).",
  },
  systempolicyremovablevolumes: {
    id: "kTCCServiceSystemPolicyRemovableVolumes",
    label: "Removable volumes",
    description: "Access to removable volumes (macOS).",
  },
  ubiquity: {
    id: "kTCCServiceUbiquity",
    label: "iCloud Drive",
    description:
      "Undocumented TCC service (kTCCServiceUbiquity) for iCloud Drive / ubiquity container access.",
  },
  usertracking: {
    id: "kTCCServiceUserTracking",
    label: "Tracking",
    description: "App Tracking Transparency — track the user across apps/websites.",
  },
  watchkit: {
    id: "kTCCServiceWatchKit",
    label: "WatchKit",
    description: "WatchKit / Apple Watch companion access.",
  },
  willow: {
    id: "kTCCServiceWillow",
    label: "Home / HomeKit data",
    description:
      "Undocumented TCC service (kTCCServiceWillow), generally associated with Home / HomeKit-related private data.",
  },
};

/** Normalize any raw TCC service string to a lookup key (suffix, lowercased). */
export function normalizeTccServiceKey(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const withoutPrefix = t.replace(/^kTCCService/i, "");
  // "Liverpool", "Cloud Kit", "kTCCServiceLiverpool" → liverpool
  return withoutPrefix.replace(/[\s_-]+/g, "").toLowerCase();
}

function fallbackLabel(raw: string): string {
  const stripped = raw.replace(/^kTCCService/i, "").trim();
  if (!stripped) return raw.trim() || "Unknown";
  return stripped.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
}

/** Resolve display label + description for a TCC service id or short name. */
export function iosTccServiceInfo(raw: string): IosTccServiceInfo {
  const trimmed = raw.trim();
  const key = normalizeTccServiceKey(trimmed);
  const entry = key ? BY_SUFFIX[key] : undefined;
  if (entry) {
    return { id: entry.id, label: entry.label, description: entry.description };
  }
  const id = /^kTCCService/i.test(trimmed)
    ? `kTCCService${trimmed.replace(/^kTCCService/i, "")}`
    : trimmed;
  const label = fallbackLabel(trimmed);
  return {
    id: id || label,
    label,
    description: `TCC service ${id || label}. Apple does not document every kTCCService* name.`,
  };
}

/** Short chip label (CloudKit, Camera, …). */
export function iosTccServiceLabel(raw: string): string {
  return iosTccServiceInfo(raw).label;
}

/** Tooltip body: description + raw id when not already in the description. */
export function iosTccServiceTooltip(raw: string): string {
  const info = iosTccServiceInfo(raw);
  if (info.description.includes(info.id)) return info.description;
  return `${info.description} (${info.id})`;
}
