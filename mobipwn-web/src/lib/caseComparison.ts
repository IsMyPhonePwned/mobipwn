import { apiFetch, apiPost } from "@/lib/api";
import type { CaseRecord } from "@/lib/cases";

export type ComparePlatform = "android" | "ios";

export type CompareCaseMeta = {
  case_id: string;
  title: string;
  ingest_source: string;
  platform: string;
  event_count?: number | null;
  case_user?: string | null;
  first_ingest_at?: string | null;
  last_ingest_at?: string | null;
  device_model?: string | null;
  device_id?: string | null;
  serial_number?: string | null;
  android_id?: string | null;
  imei?: string | null;
  meid?: string | null;
  unique_device_id?: string | null;
  os_version?: string | null;
  product_name?: string | null;
  build_fingerprint?: string | null;
  build_id?: string | null;
  sdk?: string | null;
  blob_file_name?: string | null;
  blob_file_hash?: string | null;
  blob_created_at?: string | null;
};

export type CompareEntityItem = {
  value: string;
  count_a: number;
  count_b: number;
};

export type EntityCompareSection = {
  entity_type: string;
  label: string;
  only_a: CompareEntityItem[];
  only_b: CompareEntityItem[];
  shared: CompareEntityItem[];
};

export type CompareSummary = {
  shared_count: number;
  only_a_count: number;
  only_b_count: number;
  sections: number;
};

export type CaseComparisonResult = {
  platform: string;
  case_a: CompareCaseMeta;
  case_b: CompareCaseMeta;
  summary: CompareSummary;
  sections: EntityCompareSection[];
};

/** @deprecated Use CaseComparisonResult */
export type BugreportComparisonResult = CaseComparisonResult;

export type EligibleCase = CaseRecord;

export type IdentityFieldKey =
  | "device_model"
  | "device_id"
  | "serial_number"
  | "android_id"
  | "imei"
  | "meid"
  | "unique_device_id"
  | "os_version"
  | "build_id"
  | "build_fingerprint"
  | "blob_file_hash";

export type IdentityCompareRow = {
  key: IdentityFieldKey;
  label: string;
  valueA: string | null;
  valueB: string | null;
  status: "match" | "mismatch" | "partial";
};

function norm(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

export function shortHash(hash: string | null | undefined, chars = 12): string {
  const h = norm(hash);
  if (!h) return "—";
  if (h.length <= chars + 3) return h;
  return `${h.slice(0, chars)}…`;
}

/** Short case UUID prefix used in pickers / search rows. */
export function shortCaseId(id: string | null | undefined, chars = 8): string {
  const t = (id ?? "").replace(/-/g, "").trim();
  if (!t) return "—";
  return t.slice(0, chars);
}

export type CaseIdentityBit = { label: string; value: string; title?: string };

type CaseIdentityInput = {
  id: string;
  device_id?: string | null;
  serial_number?: string | null;
  android_id?: string | null;
  unique_device_id?: string | null;
  imei?: string | null;
  blob_file_hash?: string | null;
};

/** Best durable ID for quick spotting in pickers — IMEI first when available. */
export function primarySpotId(c: CaseIdentityInput): CaseIdentityBit | null {
  const imei = norm(c.imei);
  if (imei) return { label: "IMEI", value: imei, title: imei };

  const androidId = norm(c.android_id);
  if (androidId) return { label: "Android ID", value: androidId, title: androidId };

  const udid = norm(c.unique_device_id);
  if (udid) {
    return {
      label: "UDID",
      value: udid.length > 16 ? `${udid.slice(0, 8)}…${udid.slice(-4)}` : udid,
      title: udid,
    };
  }

  const serial = norm(c.serial_number) || norm(c.device_id);
  if (serial) return { label: "Serial", value: serial, title: serial };

  return null;
}

/** Stable identifiers to tell prior reports of the same device apart in pickers. */
export function caseIdentityBits(c: CaseIdentityInput): CaseIdentityBit[] {
  const primary = primarySpotId(c);
  const bits: CaseIdentityBit[] = [];
  if (primary) bits.push(primary);

  bits.push({ label: "Case", value: shortCaseId(c.id), title: c.id });

  const androidId = norm(c.android_id);
  const udid = norm(c.unique_device_id);
  const serial = norm(c.serial_number) || norm(c.device_id);
  const imei = norm(c.imei);
  const hash = norm(c.blob_file_hash);
  const primaryLabel = primary?.label;

  if (imei && primaryLabel !== "IMEI") {
    bits.push({ label: "IMEI", value: imei, title: imei });
  }
  if (androidId && primaryLabel !== "Android ID") {
    bits.push({ label: "Android ID", value: androidId, title: androidId });
  }
  if (udid && primaryLabel !== "UDID") {
    bits.push({
      label: "UDID",
      value: udid.length > 16 ? `${udid.slice(0, 8)}…${udid.slice(-4)}` : udid,
      title: udid,
    });
  }
  if (serial && primaryLabel !== "Serial" && serial !== androidId && serial !== udid) {
    bits.push({ label: "Serial", value: serial, title: serial });
  }
  if (hash) {
    bits.push({
      label: "SHA",
      value: shortHash(hash, 12),
      title: hash,
    });
  }
  return bits;
}

/** Compare device/upload identity fields between two cases. */
export function compareDeviceIdentity(
  a: CompareCaseMeta,
  b: CompareCaseMeta,
  platform: ComparePlatform = "android",
): IdentityCompareRow[] {
  const rows: {
    key: IdentityFieldKey;
    label: string;
    valueA: string | null;
    valueB: string | null;
  }[] = [
    { key: "device_model", label: "Model", valueA: norm(a.device_model), valueB: norm(b.device_model) },
  ];

  if (platform === "android") {
    const serialA = norm(a.serial_number) ?? norm(a.device_id);
    const serialB = norm(b.serial_number) ?? norm(b.device_id);
    rows.push(
      { key: "serial_number", label: "Serial", valueA: serialA, valueB: serialB },
      { key: "imei", label: "IMEI", valueA: norm(a.imei), valueB: norm(b.imei) },
      { key: "meid", label: "MEID", valueA: norm(a.meid), valueB: norm(b.meid) },
      {
        key: "android_id",
        label: "Android ID",
        valueA: norm(a.android_id),
        valueB: norm(b.android_id),
      },
    );
  } else {
    rows.push({
      key: "device_id",
      label: "Device ID",
      valueA: norm(a.device_id),
      valueB: norm(b.device_id),
    });
    rows.push({
      key: "unique_device_id",
      label: "UDID",
      valueA: norm(a.unique_device_id),
      valueB: norm(b.unique_device_id),
    });
  }

  rows.push(
    { key: "os_version", label: "OS", valueA: norm(a.os_version), valueB: norm(b.os_version) },
    { key: "build_id", label: "Build", valueA: norm(a.build_id), valueB: norm(b.build_id) },
  );

  if (platform === "android") {
    rows.push({
      key: "build_fingerprint",
      label: "Fingerprint",
      valueA: norm(a.build_fingerprint),
      valueB: norm(b.build_fingerprint),
    });
  }

  rows.push({
    key: "blob_file_hash",
    label: "Archive SHA-256",
    valueA: norm(a.blob_file_hash),
    valueB: norm(b.blob_file_hash),
  });

  return rows.map((r) => {
    if (!r.valueA && !r.valueB) {
      return { ...r, status: "partial" as const };
    }
    if (!r.valueA || !r.valueB) {
      return { ...r, status: "partial" as const };
    }
    return {
      ...r,
      status: r.valueA === r.valueB ? ("match" as const) : ("mismatch" as const),
    };
  });
}

export function identityVerdict(rows: IdentityCompareRow[]): {
  sameDevice: boolean | null;
  differentUpload: boolean | null;
  label: string;
} {
  const model = rows.find((r) => r.key === "device_model");
  const deviceId = rows.find((r) => r.key === "device_id");
  const serial = rows.find((r) => r.key === "serial_number");
  const imei = rows.find((r) => r.key === "imei");
  const androidId = rows.find((r) => r.key === "android_id");
  const udid = rows.find((r) => r.key === "unique_device_id");
  const fp = rows.find((r) => r.key === "build_fingerprint");
  const hash = rows.find((r) => r.key === "blob_file_hash");

  const strongIds = [serial, imei, androidId, deviceId, udid, fp];

  let sameDevice: boolean | null = null;
  if (strongIds.some((r) => r?.status === "mismatch")) {
    sameDevice = false;
  } else if (strongIds.some((r) => r?.status === "match")) {
    sameDevice = true;
  } else if (model?.status === "match") {
    sameDevice = true;
  } else if (model?.status === "mismatch") {
    sameDevice = false;
  }

  let differentUpload: boolean | null = null;
  if (hash?.status === "match") differentUpload = false;
  else if (hash?.status === "mismatch") differentUpload = true;

  let label = "Device identity incomplete";
  if (sameDevice === true && differentUpload === true) {
    label = "Same device · different uploads";
  } else if (sameDevice === true && differentUpload === false) {
    label = "Same device · same archive hash";
  } else if (sameDevice === true) {
    label = "Likely same device";
  } else if (sameDevice === false && differentUpload === true) {
    label = "Different devices · different uploads";
  } else if (sameDevice === false) {
    label = "Different devices";
  } else if (differentUpload === true) {
    label = "Different uploads (device identity unclear)";
  }

  return { sameDevice, differentUpload, label };
}

export async function fetchEligibleComparisonCases(platform: ComparePlatform) {
  const qs = new URLSearchParams({ platform });
  return apiFetch<EligibleCase[]>(`/v1/case-comparison/eligible-cases?${qs}`);
}

export async function compareCases(
  platform: ComparePlatform,
  caseAId: string,
  caseBId: string,
) {
  return apiPost<CaseComparisonResult>("/v1/case-comparison/compare", {
    platform,
    case_a_id: caseAId,
    case_b_id: caseBId,
  });
}

/** Parse comparison selection from `/case-comparison?...` search params. */
export function parseCompareSearchParams(params: URLSearchParams): {
  platform: ComparePlatform;
  caseAId: string;
  caseBId: string;
} {
  const platform: ComparePlatform =
    params.get("platform")?.trim().toLowerCase() === "ios" ? "ios" : "android";
  const caseAId = params.get("a")?.trim() ?? "";
  const caseBId = params.get("b")?.trim() ?? "";
  return { platform, caseAId, caseBId };
}

/** Build a stable shareable query for a case pair. */
export function buildCompareSearchParams(opts: {
  platform: ComparePlatform;
  caseAId: string;
  caseBId: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("platform", opts.platform);
  if (opts.caseAId.trim()) params.set("a", opts.caseAId.trim());
  if (opts.caseBId.trim()) params.set("b", opts.caseBId.trim());
  return params;
}

export function comparePagePath(opts: {
  platform: ComparePlatform;
  caseAId: string;
  caseBId: string;
}): string {
  const qs = buildCompareSearchParams(opts).toString();
  return qs ? `/case-comparison?${qs}` : "/case-comparison";
}

export function comparePageUrl(opts: {
  platform: ComparePlatform;
  caseAId: string;
  caseBId: string;
}): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${comparePagePath(opts)}`;
}

/** External-device / inventory sections that matter for near-identical captures. */
export const COMPARE_SIGNAL_TYPES = [
  "usb",
  "usb_port",
  "adb",
  "bluetooth",
  "ssid",
  "account",
  "vpn",
  "bundle",
] as const;

export type CompareSignalType = (typeof COMPARE_SIGNAL_TYPES)[number];

export function isCompareSignalType(entityType: string): boolean {
  return (COMPARE_SIGNAL_TYPES as readonly string[]).includes(entityType);
}

export type SectionDelta = {
  entityType: string;
  label: string;
  onlyA: number;
  onlyB: number;
  shared: number;
  changed: number;
};

export function sectionDeltas(result: CaseComparisonResult): SectionDelta[] {
  return result.sections.map((s) => ({
    entityType: s.entity_type,
    label: s.label,
    onlyA: s.only_a.length,
    onlyB: s.only_b.length,
    shared: s.shared.length,
    changed: s.only_a.length + s.only_b.length,
  }));
}

export function signalSectionDeltas(result: CaseComparisonResult): SectionDelta[] {
  return sectionDeltas(result).filter((d) => isCompareSignalType(d.entityType));
}

/** Prefer the first signal section that actually differs (USB before packages). */
export function preferredDiffSection(result: CaseComparisonResult): string | null {
  const ordered = [
    "usb",
    "usb_port",
    "adb",
    "bluetooth",
    "ssid",
    "account",
    "vpn",
    "bundle",
    "process",
  ];
  for (const ty of ordered) {
    const s = result.sections.find((sec) => sec.entity_type === ty);
    if (s && (s.only_a.length > 0 || s.only_b.length > 0)) return ty;
  }
  const any = result.sections.find((s) => s.only_a.length > 0 || s.only_b.length > 0);
  return any?.entity_type ?? null;
}

export function packageInventoryStatus(result: CaseComparisonResult): {
  onlyA: number;
  onlyB: number;
  shared: number;
  identical: boolean;
} {
  const s = result.sections.find((sec) => sec.entity_type === "bundle");
  const onlyA = s?.only_a.length ?? 0;
  const onlyB = s?.only_b.length ?? 0;
  const shared = s?.shared.length ?? 0;
  return { onlyA, onlyB, shared, identical: onlyA === 0 && onlyB === 0 && shared > 0 };
}

/** @deprecated Use compareCases */
export async function compareBugreportCases(caseAId: string, caseBId: string) {
  return compareCases("android", caseAId, caseBId);
}
