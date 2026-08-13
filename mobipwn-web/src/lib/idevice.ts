/**
 * WebUSB Apple device client — vendored from idevice-rs (idevice-wasm).
 * Pair + list/download sysdiagnose archives for /collect and Device Advanced.
 */
type IdeviceModule = typeof import("@/vendor/idevice/idevice_wasm.js");

export type SysdiagnoseArchiveEntry = {
  path: string;
  name: string;
  sizeBytes: number;
};

export type IdeviceCallArgs = {
  mode: string;
  hostId: string;
  systemBuid: string;
  plistXml: string;
  tlsClientAuth: string;
  tlsSni: string;
  verbose: boolean;
};

export const PAIR_STORAGE_KEY = "idevice-rs.pairRecordXml";

const IDEVICE_BUILD_HINT =
  "iOS WebUSB (idevice-wasm) is not built. On macOS: brew install llvm, then ./scripts/build-idevice-wasm.sh release (or ./dev.sh restart).";

let ideviceModule: IdeviceModule | null = null;
let initPromise: Promise<IdeviceModule> | null = null;
let wasmReady = false;

async function loadIdeviceModule(): Promise<IdeviceModule> {
  if (ideviceModule) return ideviceModule;
  if (!initPromise) {
    initPromise = import("@/vendor/idevice/idevice_wasm.js")
      .then(async (mod) => {
        if (!wasmReady) {
          await mod.default();
          wasmReady = true;
        }
        ideviceModule = mod;
        return mod;
      })
      .catch((err) => {
        initPromise = null;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("Failed to fetch") ||
          msg.includes("Cannot find module") ||
          msg.includes("Failed to resolve")
        ) {
          throw new Error(IDEVICE_BUILD_HINT);
        }
        throw err;
      });
  }
  return initPromise;
}

export async function ideviceWasmAvailable(): Promise<boolean> {
  try {
    await loadIdeviceModule();
    return true;
  } catch {
    return false;
  }
}

export function diagnoseWebUsb(): string | null {
  if (!navigator.usb) {
    return "WebUSB is not available. Use Chromium (Chrome/Edge/Brave) over HTTPS or http://127.0.0.1/.";
  }
  if (!window.isSecureContext) {
    return "WebUSB requires a secure context (localhost or HTTPS).";
  }
  return null;
}

export function getStoredPairPlist(): string {
  try {
    const xml = localStorage.getItem(PAIR_STORAGE_KEY);
    if (xml && xml.includes("<plist")) return xml;
  } catch {
    /* ignore */
  }
  return "";
}

export function storePairPlist(xml: string): void {
  try {
    if (xml && xml.includes("<plist")) {
      localStorage.setItem(PAIR_STORAGE_KEY, xml);
    }
  } catch {
    /* ignore */
  }
}

export function clearStoredPairPlist(): void {
  try {
    localStorage.removeItem(PAIR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function readPlistRootDictStrings(xmlText: string): Record<string, string> {
  const d = new DOMParser().parseFromString(xmlText, "application/xml");
  if (d.querySelector("parsererror")) throw new Error("Invalid plist XML");
  const dict = d.querySelector("plist dict");
  if (!dict) throw new Error("No dict found in plist");
  const out: Record<string, string> = {};
  let pendingKey: string | null = null;
  for (const el of Array.from(dict.children)) {
    if (!(el instanceof Element)) continue;
    if (el.tagName === "key") pendingKey = (el.textContent ?? "").trim();
    else if (pendingKey !== null) {
      if (el.tagName === "string") out[pendingKey] = el.textContent ?? "";
      pendingKey = null;
    }
  }
  return out;
}

export function ideviceCallArgs(
  plistXml?: string,
  overrides: Partial<IdeviceCallArgs> & { pairMode?: string } = {}
): IdeviceCallArgs {
  const plist = (plistXml ?? getStoredPairPlist() ?? "").trim();
  const mode = overrides.pairMode || overrides.mode || (plist ? "plist" : "random");
  let hostId = overrides.hostId ?? "";
  let systemBuid = overrides.systemBuid ?? "";
  if (plist && (!hostId || !systemBuid)) {
    try {
      const ids = readPlistRootDictStrings(plist);
      hostId = hostId || ids.HostID || "";
      systemBuid = systemBuid || ids.SystemBUID || "";
    } catch {
      /* ignore */
    }
  }
  return {
    mode,
    hostId,
    systemBuid,
    plistXml: plist,
    tlsClientAuth: overrides.tlsClientAuth || "host",
    tlsSni: overrides.tlsSni || "device",
    verbose: !!overrides.verbose,
  };
}

function toLockdownArgs(device: USBDevice, args: IdeviceCallArgs) {
  return [
    device,
    args.mode,
    args.hostId,
    args.systemBuid,
    args.plistXml,
    args.verbose,
    args.tlsClientAuth,
    args.tlsSni,
  ] as const;
}

/** Must run in a user-gesture handler (click). */
export async function pickIphoneDevice(): Promise<USBDevice> {
  const mod = await loadIdeviceModule();
  const problem = diagnoseWebUsb();
  if (problem) throw new Error(problem);
  const dev = await mod.requestAppleDevice();
  mod.prefetchPairHostKeys();
  return dev;
}

export async function pairIphoneDevice(
  device: USBDevice,
  mode = "random",
  verbose = false
): Promise<string> {
  const mod = await loadIdeviceModule();
  const xml = await mod.lockdownPair(device, mode, verbose);
  storePairPlist(xml);
  return xml;
}

export async function listSysdiagnoseArchives(
  device: USBDevice,
  options: Partial<IdeviceCallArgs> & { pairMode?: string; plistXml?: string } = {}
): Promise<SysdiagnoseArchiveEntry[]> {
  const mod = await loadIdeviceModule();
  const a = ideviceCallArgs(options.plistXml, options);
  const res = await mod.lockdownSysdiagnoseList(...toLockdownArgs(device, a));
  const raw = res?.entries != null ? res.entries : Array.isArray(res) ? res : null;
  if (!raw || typeof (raw as { length: number }).length !== "number") return [];
  const len = (raw as { length: number }).length;
  return Array.from({ length: len }, (_, i) => {
    const o = (raw as ArrayLike<{ path: string; name: string; sizeBytes?: number }>)[i];
    return {
      path: o.path,
      name: o.name,
      sizeBytes: o.sizeBytes ?? 0,
    };
  });
}

export async function downloadSysdiagnoseArchive(
  device: USBDevice,
  devicePath: string,
  options: Partial<IdeviceCallArgs> & {
    pairMode?: string;
    plistXml?: string;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<{ name: string; path: string; data: Uint8Array; byteLength: number }> {
  const mod = await loadIdeviceModule();
  const a = ideviceCallArgs(options.plistXml, options);
  const res = await mod.lockdownSysdiagnoseDownload(
    ...toLockdownArgs(device, a),
    devicePath,
    options.onProgress
  );
  if (!res || !(res.data instanceof Uint8Array)) {
    throw new Error("Sysdiagnose download returned no data");
  }
  return {
    name: res.name || "sysdiagnose.tar.gz",
    path: res.path || devicePath,
    data: res.data,
    byteLength: res.byteLength ?? res.data.byteLength,
  };
}

export async function runIdeviceBattery(device: USBDevice): Promise<string> {
  const mod = await loadIdeviceModule();
  const a = ideviceCallArgs();
  return mod.lockdownBattery(
    device,
    a.mode,
    a.hostId,
    a.systemBuid,
    a.verbose,
    a.plistXml,
    a.tlsClientAuth,
    a.tlsSni
  );
}

export async function runIdeviceDiagnostics(device: USBDevice): Promise<string> {
  const mod = await loadIdeviceModule();
  const a = ideviceCallArgs();
  return mod.lockdownDiagnostics(
    device,
    a.mode,
    a.hostId,
    a.systemBuid,
    a.verbose,
    a.plistXml,
    a.tlsClientAuth,
    a.tlsSni
  );
}

export async function runIdeviceCrashReports(device: USBDevice): Promise<string> {
  const mod = await loadIdeviceModule();
  const a = ideviceCallArgs();
  return mod.lockdownCrashReports(
    device,
    a.mode,
    a.hostId,
    a.systemBuid,
    a.plistXml,
    a.verbose,
    a.tlsClientAuth,
    a.tlsSni,
    true,
    "",
    false
  );
}

export function formatIdeviceBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

export { IDEVICE_BUILD_HINT };
