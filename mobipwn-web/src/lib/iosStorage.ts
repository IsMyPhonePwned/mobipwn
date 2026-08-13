import { parseRowExt } from "./iosDeviceSnapshot";

export type IosStorageVolume = {
  mount: string;
  label: string;
  filesystem: string;
  filesystemShort: string;
  size: string;
  used: string;
  avail: string;
  capacityPercent: number;
  capacityLabel: string;
  usedBytes: number;
  sizeBytes: number;
};

const MOUNT_LABELS: Record<string, string> = {
  "/": "System root",
  "/private/var": "Variable data",
  "/private/var/mobile": "Mobile user data",
  "/private/preboot": "Preboot",
  "/private/var/hardware": "Hardware",
  "/private/var/MobileSoftwareUpdate": "Software update",
  "/private/var/wireless/baseband_data": "Baseband data",
};

const MOUNT_ORDER = [
  "/",
  "/private/var",
  "/private/var/mobile",
  "/private/preboot",
  "/private/var/hardware",
  "/private/var/MobileSoftwareUpdate",
];

function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseCapacityPercent(ext: Record<string, string>): number {
  const fromField = parseNum(ext.capacity_percent);
  if (fromField > 0) return Math.min(100, fromField);
  const cap = ext.capacity?.replace("%", "").trim();
  const n = parseNum(cap);
  return n > 0 ? Math.min(100, n) : 0;
}

function shortenFilesystem(fs: string): string {
  if (!fs) return "—";
  if (fs === "devfs") return "devfs";
  if (fs.startsWith("/dev/")) return fs;
  if (fs.includes("@/dev/")) {
    const dev = fs.split("@/dev/")[1];
    return dev ? `/dev/${dev}` : fs.slice(0, 24);
  }
  if (fs.startsWith("lifs://")) return "LiveFiles";
  if (fs.startsWith("com.apple.")) return "APFS snapshot";
  return fs.length > 28 ? `${fs.slice(0, 25)}…` : fs;
}

function mountLabel(mount: string): string {
  return MOUNT_LABELS[mount] ?? mount.replace(/^\/private\//, "");
}

function mountRank(mount: string): number {
  const idx = MOUNT_ORDER.indexOf(mount);
  if (idx >= 0) return idx;
  return 100 + mount.length;
}

/** Skip tiny virtual mounts that clutter the panel. */
function isNoiseVolume(vol: IosStorageVolume): boolean {
  if (vol.mount === "/dev") return true;
  if (vol.sizeBytes > 0 && vol.sizeBytes < 512 * 1024) return true;
  return false;
}

export function storageVolumesFromRows(rows: Record<string, unknown>[]): {
  primary: IosStorageVolume[];
  other: IosStorageVolume[];
} {
  const byMount = new Map<string, IosStorageVolume>();

  for (const row of rows) {
    const ext = parseRowExt(row);
    const mount = ext.mounted_on ?? "";
    if (!mount || byMount.has(mount)) continue;

    const sizeBytes = parseNum(ext.size_bytes);
    const usedBytes = parseNum(ext.used_bytes);
    const capacityPercent = parseCapacityPercent(ext);

    byMount.set(mount, {
      mount,
      label: mountLabel(mount),
      filesystem: ext.filesystem || "—",
      filesystemShort: shortenFilesystem(ext.filesystem || ""),
      size: ext.size || formatBytes(sizeBytes),
      used: ext.used || formatBytes(usedBytes),
      avail: ext.avail || formatBytes(parseNum(ext.avail_bytes)),
      capacityPercent,
      capacityLabel: ext.capacity || (capacityPercent ? `${capacityPercent}%` : "—"),
      usedBytes,
      sizeBytes,
    });
  }

  const all = [...byMount.values()]
    .filter((v) => !isNoiseVolume(v))
    .sort((a, b) => mountRank(a.mount) - mountRank(b.mount));

  const primaryMounts = new Set([
    "/",
    "/private/var",
    "/private/var/mobile",
    "/private/preboot",
  ]);

  return {
    primary: all.filter((v) => primaryMounts.has(v.mount)),
    other: all.filter((v) => !primaryMounts.has(v.mount)),
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function storageCapacityTone(percent: number): "low" | "medium" | "high" {
  if (percent >= 90) return "high";
  if (percent >= 70) return "medium";
  return "low";
}
