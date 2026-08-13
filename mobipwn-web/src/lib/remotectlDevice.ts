import { parseHeaderExt } from "@/lib/bugreportHeader";

export type RemotectlField = { label: string; value: string; mono?: boolean };

export type RemotectlFieldSection = {
  title: string;
  fields: RemotectlField[];
};

const IOS_DEVICE_LABELS: Record<string, string> = {
  producttype: "Model",
  product_type: "Model",
  device_model: "Model",
  productname: "Product",
  product_name: "Product",
  osversion: "iOS version",
  os_version: "iOS version",
  buildversion: "Build",
  build_version: "Build",
  humanreadableproductversionstring: "Version string",
  serialnumber: "Serial",
  serial: "Serial",
  uniquedeviceid: "UDID",
  unique_device_id: "UDID",
  cpuarchitecture: "CPU",
  hwmodel: "Hardware model",
  regioninfo: "Region",
  ethernetmacaddress: "Ethernet MAC",
  modelnumber: "Model number",
  regioncode: "Region code",
  deviceclass: "Device class",
  hardwareplatform: "Hardware platform",
  chipid: "Chip ID",
  uniquechipid: "Unique chip ID",
  boardid: "Board ID",
  devicecolor: "Device color",
  deviceenclosurecolor: "Enclosure color",
  hassep: "Secure Enclave",
  effectivesecuritymodesep: "SEP security mode",
  effectivesecuritymodeap: "AP security mode",
  signingfuse: "Signing fuse",
  certificateproductionstatus: "Production cert",
  certificatesecuritymode: "Cert security mode",
  devicesupportslockdown: "Lockdown support",
  isvirtualdevice: "Virtual device",
  storedemomode: "Demo mode",
  appleinternal: "Apple internal",
  isuibuild: "UI build",
  bootsessionuuid: "Boot session UUID",
  thinningproducttype: "Thinning product type",
  mobiledeviceminimumversion: "MDM min version",
  image4supported: "Image4 supported",
  image4cryptohashmethod: "Image4 hash",
};

const SECTION_SPECS: { title: string; keys: string[] }[] = [
  {
    title: "Identification",
    keys: [
      "producttype",
      "product_name",
      "productname",
      "osversion",
      "os_version",
      "buildversion",
      "build_version",
      "humanreadableproductversionstring",
      "serialnumber",
      "serial",
      "uniquedeviceid",
      "unique_device_id",
      "modelnumber",
    ],
  },
  {
    title: "Hardware",
    keys: [
      "hwmodel",
      "hardwareplatform",
      "cpuarchitecture",
      "chipid",
      "uniquechipid",
      "boardid",
      "deviceclass",
      "devicecolor",
      "deviceenclosurecolor",
      "thinningproducttype",
    ],
  },
  {
    title: "Security",
    keys: [
      "hassep",
      "effectivesecuritymodesep",
      "effectivesecuritymodeap",
      "signingfuse",
      "certificateproductionstatus",
      "certificatesecuritymode",
      "devicesupportslockdown",
      "isvirtualdevice",
      "appleinternal",
      "storedemomode",
      "isuibuild",
    ],
  },
  {
    title: "Network & region",
    keys: ["ethernetmacaddress", "regioninfo", "regioncode"],
  },
];

const SKIP_KEYS = new Set([
  "message",
  "event_type",
  "parser",
  "data_type",
  "sysdiagnose_parser",
  "timestamp_desc",
]);

function pickRowString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function formatBoolish(value: string): string {
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  return value;
}

function labelForKey(key: string): string {
  return IOS_DEVICE_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

function fieldFromKey(map: Map<string, string>, key: string): RemotectlField | null {
  const value = map.get(key.toLowerCase());
  if (!value) return null;
  const label = labelForKey(key.toLowerCase());
  return {
    label,
    value: formatBoolish(value),
    mono: /serial|udid|mac|build|model|cpu|id|uuid|chip|platform/i.test(label),
  };
}

/** Merge top-level search row fields with parsed `ext` for remotectl device metadata. */
export function remotectlDeviceFields(row: Record<string, unknown>): Map<string, string> {
  const fromExt = parseHeaderExt(row);
  const map = new Map<string, string>();

  const topKeys = [
    "device_model",
    "os_version",
    "device_id",
    "serial",
    "product_type",
    "product_name",
    "build_version",
    "unique_device_id",
  ];
  for (const key of topKeys) {
    const value = pickRowString(row, [key]);
    if (value) map.set(key.toLowerCase(), value);
  }
  for (const [key, value] of Object.entries(fromExt)) {
    if (value.trim()) map.set(normalizeRemotectlKey(key), value.trim());
  }

  aliasRemotectlPascalCase(map);
  return map;
}

function normalizeRemotectlKey(key: string): string {
  const leaf = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
  return leaf.toLowerCase();
}

function aliasRemotectlPascalCase(map: Map<string, string>): void {
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const v = map.get(key.toLowerCase());
      if (v) return v;
    }
    return "";
  };
  const setIf = (target: string, ...sources: string[]) => {
    if (map.has(target)) return;
    const v = get(...sources);
    if (v) map.set(target, v);
  };
  setIf("os_version", "osversion", "productversion", "humanreadableproductversionstring");
  setIf("device_model", "producttype", "devicemodel");
  setIf("serial", "serialnumber", "serial_number");
  setIf("unique_device_id", "uniquedeviceid");
  setIf("build_version", "buildversion");
  setIf("product_name", "productname");
  setIf("hwmodel", "hardwaremodel");
  setIf("cpuarchitecture", "cpuarchitecture");
}

/** Shown inline on the device panel — keep short; hero covers model / OS / serial. */
const PRIMARY_INLINE_KEYS = [
  "uniquedeviceid",
  "unique_device_id",
  "modelnumber",
  "hwmodel",
  "cpuarchitecture",
  "regioninfo",
  "deviceclass",
  "ethernetmacaddress",
] as const;

/** Keys already represented in the hero subtitle or device id line. */
const HERO_COVERED_KEYS = new Set([
  "producttype",
  "product_type",
  "device_model",
  "productname",
  "product_name",
  "osversion",
  "os_version",
  "humanreadableproductversionstring",
  "buildversion",
  "build_version",
  "supplementalbuildversion",
  "serialnumber",
  "serial",
  "device_id",
  "uniquedeviceid",
  "unique_device_id",
]);

export function remotectlPrimaryFields(map: Map<string, string>): RemotectlField[] {
  const out: RemotectlField[] = [];
  const seen = new Set<string>();
  for (const key of PRIMARY_INLINE_KEYS) {
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    const field = fieldFromKey(map, lower);
    if (!field) continue;
    seen.add(lower);
    out.push(field);
  }
  return out;
}

export function remotectlExtraFields(map: Map<string, string>): RemotectlField[] {
  const seen = new Set<string>([...HERO_COVERED_KEYS, ...PRIMARY_INLINE_KEYS.map((k) => k.toLowerCase())]);
  const out: RemotectlField[] = [];
  for (const [key, value] of map) {
    if (seen.has(key) || SKIP_KEYS.has(key)) continue;
    seen.add(key);
    out.push({
      label: labelForKey(key),
      value: formatBoolish(value),
      mono: /serial|udid|mac|build|id|uuid/i.test(key),
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function remotectlFieldSections(map: Map<string, string>): RemotectlFieldSection[] {
  const seen = new Set<string>();
  const sections: RemotectlFieldSection[] = [];

  for (const spec of SECTION_SPECS) {
    const fields: RemotectlField[] = [];
    for (const key of spec.keys) {
      const lower = key.toLowerCase();
      if (seen.has(lower)) continue;
      const field = fieldFromKey(map, lower);
      if (!field) continue;
      seen.add(lower);
      fields.push(field);
    }
    if (fields.length > 0) sections.push({ title: spec.title, fields });
  }

  const extra = remotectlExtraFields(map).filter((f) => {
    const key = f.label.toLowerCase();
    return !seen.has(key);
  });
  if (extra.length > 0) sections.push({ title: "Additional properties", fields: extra });

  return sections;
}

/** @deprecated Use remotectlFieldSections for grouped layout. */
export function remotectlDisplayFields(map: Map<string, string>): RemotectlField[] {
  return remotectlFieldSections(map).flatMap((s) => s.fields);
}

export function remotectlHeroTitle(map: Map<string, string>): string {
  return (
    pickFromMap(map, ["producttype", "product_type", "device_model"]) ||
    pickFromMap(map, ["hwmodel", "producttypedescforuservisibility"]) ||
    "iOS device"
  );
}

export function remotectlHeroSubtitle(map: Map<string, string>): string {
  const os =
    pickFromMap(map, ["osversion", "os_version", "humanreadableproductversionstring"]) || "";
  const build = pickFromMap(map, ["buildversion", "build_version", "supplementalbuildversion"]) || "";
  const model = pickFromMap(map, ["modelnumber"]) || "";
  return [os && `iOS ${os}`, build && `build ${build}`, model && `model ${model}`]
    .filter(Boolean)
    .join(" · ");
}

export function remotectlProductName(map: Map<string, string>): string {
  return pickFromMap(map, ["productname", "product_name", "producttypedescforuservisibility"]);
}

/** Snapshot chips under the hero — serial, UDID, build, hardware. */
export function remotectlHeroStats(map: Map<string, string>): RemotectlField[] {
  const specs: { label: string; keys: string[]; mono?: boolean }[] = [
    { label: "Serial", keys: ["serialnumber", "serial", "device_id"], mono: true },
    { label: "UDID", keys: ["uniquedeviceid", "unique_device_id"], mono: true },
    { label: "Build", keys: ["buildversion", "build_version", "supplementalbuildversion"], mono: true },
    { label: "Hardware", keys: ["hwmodel", "hardwaremodel"], mono: true },
    { label: "CPU", keys: ["cpuarchitecture"], mono: true },
    { label: "Model #", keys: ["modelnumber"], mono: true },
    { label: "Region", keys: ["regioninfo", "regioncode"] },
  ];
  const out: RemotectlField[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const value = pickFromMap(map, spec.keys);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: spec.label, value: formatBoolish(value), mono: spec.mono });
  }
  return out;
}

const STAT_COVERED_KEYS = new Set([
  ...HERO_COVERED_KEYS,
  "modelnumber",
  "hwmodel",
  "hardwaremodel",
  "cpuarchitecture",
  "regioninfo",
  "regioncode",
]);

/** Grouped detail sections with hero/stat fields removed to avoid duplication. */
export function remotectlDetailSections(map: Map<string, string>): RemotectlFieldSection[] {
  const seen = new Set<string>(STAT_COVERED_KEYS);
  const sections: RemotectlFieldSection[] = [];

  for (const spec of SECTION_SPECS) {
    const fields: RemotectlField[] = [];
    for (const key of spec.keys) {
      const lower = key.toLowerCase();
      if (seen.has(lower)) continue;
      const field = fieldFromKey(map, lower);
      if (!field) continue;
      seen.add(lower);
      fields.push(field);
    }
    if (fields.length > 0) sections.push({ title: spec.title, fields });
  }

  const extra: RemotectlField[] = [];
  for (const [key, value] of map) {
    if (seen.has(key) || SKIP_KEYS.has(key)) continue;
    seen.add(key);
    extra.push({
      label: labelForKey(key),
      value: formatBoolish(value),
      mono: /serial|udid|mac|build|id|uuid|chip|platform/i.test(key),
    });
  }
  if (extra.length > 0) {
    sections.push({
      title: "Additional properties",
      fields: extra.sort((a, b) => a.label.localeCompare(b.label)),
    });
  }

  return sections;
}

export function remotectlDeviceIdLine(map: Map<string, string>): { label: string; value: string } | null {
  const serial = pickFromMap(map, ["serialnumber", "serial", "device_id"]);
  if (serial) return { label: "Serial", value: serial };
  const udid = pickFromMap(map, ["uniquedeviceid", "unique_device_id"]);
  if (udid) return { label: "UDID", value: udid };
  return null;
}

export function remotectlDeviceId(map: Map<string, string>): string {
  return remotectlDeviceIdLine(map)?.value ?? "";
}

function pickFromMap(map: Map<string, string>, keys: string[]): string {
  for (const key of keys) {
    const v = map.get(key.toLowerCase());
    if (v) return v;
  }
  return "";
}
