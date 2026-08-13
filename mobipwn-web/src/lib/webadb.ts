/**
 * WebUSB ADB client — vendored from webadb-rs (mobipwn-webadb crate).
 * Core ADB logic matches ~/Code/ismyphonepwned/webadb-rs (see scripts/sync-webadb-rs.sh).
 */
import { runMagpieCollector, type MagpieCollectResult, type MagpieCommand } from "./androidCollector";
import {
  appendMagpieToBugreportZip,
  buildMagpieOnlyZip,
  bundleBugreportWithMagpie,
  looksLikeZip,
  type MagpieArtifactBundle,
} from "./collectBundle";

type WebadbModule = typeof import("@/vendor/webadb/webadb_rs.js");

export type WebAdbClient = InstanceType<WebadbModule["Adb"]>;

export type BugreportCollectOptions = {
  /** Run rusty-magpie on device before pulling the bugreport. */
  magpie?: {
    commands?: MagpieCommand[];
    findPaths?: string[];
    maxDepth?: number;
    hashFiles?: boolean;
    maxHashSize?: number;
    excludeDirs?: string[];
    yaraPaths?: string[];
    yaraMaxDepth?: number;
    yaraRulesB64?: string;
  };
};

export type BugreportCollectResult = {
  data: Uint8Array;
  path?: string;
  magpie?: MagpieCollectResult;
};

const WEBADB_BUILD_HINT =
  "WebUSB ADB (wasm) is not built. Run: ./scripts/build-webadb-wasm.sh (requires wasm-pack).";

let webadbModule: WebadbModule | null = null;
let initPromise: Promise<WebadbModule> | null = null;

async function loadWebadbModule(): Promise<WebadbModule> {
  if (webadbModule) return webadbModule;
  if (!initPromise) {
    initPromise = import("@/vendor/webadb/webadb_rs.js")
      .then((mod) => {
        webadbModule = mod;
        return mod;
      })
      .catch((err) => {
        initPromise = null;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Failed to fetch") || msg.includes("Cannot find module")) {
          throw new Error(WEBADB_BUILD_HINT);
        }
        throw err;
      });
  }
  return initPromise;
}

/** True when the wasm bundle is present (dev/build artifact). */
export async function webadbWasmAvailable(): Promise<boolean> {
  try {
    await loadWebadbModule();
    return true;
  } catch {
    return false;
  }
}

function magpieArtifactBundle(
  magpie: MagpieCollectResult,
  commands: MagpieCommand[]
): MagpieArtifactBundle {
  return {
    processesJson: magpie.processesJson,
    filesJson: magpie.filesJson,
    yaraJson: magpie.yaraJson,
    findPaths: magpie.findPaths,
    yaraPaths: magpie.yaraPaths,
    maxDepth: magpie.maxDepth,
    hashFiles: magpie.hashFiles,
    maxHashSize: magpie.maxHashSize,
    excludeDirs: magpie.excludeDirs,
    yaraMaxDepth: magpie.yaraMaxDepth,
    commands,
  };
}

export function webUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

async function ensureWasm(): Promise<WebadbModule> {
  const mod = await loadWebadbModule();
  await mod.default();
  if (!mod.has_keypair()) {
    mod.generate_keypair();
  }
  return mod;
}

/** Request USB device in the click handler, then connect via WASM. */
export async function connectAdb(): Promise<{ adb: WebAdbClient; deviceInfo: unknown }> {
  const mod = await ensureWasm();
  if (!webUsbSupported()) {
    throw new Error("WebUSB is not supported in this browser (use Chrome or Edge on desktop).");
  }
  const device = await navigator.usb!.requestDevice({
    filters: [{ classCode: 255, subclassCode: 0x42, protocolCode: 1 }],
  });
  const adb = new mod.Adb();
  const deviceInfo = await adb.connectWithUsbDevice(device);
  return { adb, deviceInfo };
}

function parseBugreportPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/** Same scan flow as webadb-rs/bugreport.html — list_bugreports then download or generate. */
async function listBugreportsLikeWebadbRs(
  adb: WebAdbClient,
  log: (line: string) => void
): Promise<string[]> {
  log("Scanning device for existing bugreports…");
  const slowScan = window.setTimeout(() => {
    log("Still scanning… this can take a while on some Samsung devices.");
  }, 15_000);

  const started = Date.now();
  try {
    const raw = await adb.list_bugreports();
    const paths = parseBugreportPaths(raw);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (paths.length > 0) {
      log(`Found ${paths.length} bugreport(s) in ${seconds}s.`);
    } else {
      log(`No existing bugreports found (${seconds}s).`);
    }
    return paths;
  } finally {
    window.clearTimeout(slowScan);
  }
}

export async function collectBugreportFromDevice(
  log: (line: string) => void,
  options: BugreportCollectOptions = {}
): Promise<BugreportCollectResult> {
  await ensureWasm();
  log("Requesting USB device — accept the debugging prompt on your phone…");
  const { adb, deviceInfo } = await connectAdb();
  if (deviceInfo && typeof deviceInfo === "object") {
    log(`Connected: ${JSON.stringify(deviceInfo)}`);
  } else {
    log("Connected to device.");
  }

  let magpie: MagpieCollectResult | undefined;

  try {
    if (options.magpie) {
      log("Running Rusty Magpie on-device collector…");
      magpie = await runMagpieCollector(adb, log, options.magpie);
    }

    const paths = await listBugreportsLikeWebadbRs(adb, log);
    let data: Uint8Array;
    let path: string | undefined;

    if (paths.length > 0) {
      const bugPath = paths[0]!;
      log(`Downloading ${bugPath.split("/").pop() ?? bugPath}…`);
      data = new Uint8Array(await adb.download_bugreport(bugPath));
      path = bugPath;
      log(`Downloaded ${(data.byteLength / (1024 * 1024)).toFixed(1)} MB`);
    } else {
      log("No bugreports on device — generating a new one (this may take several minutes)…");
      data = new Uint8Array(await adb.bugreport());
      log(`Generated bugreport ${(data.byteLength / (1024 * 1024)).toFixed(1)} MB`);
    }

    if (magpie) {
      log("Bundling bugreport with Magpie artifacts…");
      const bundle = magpieArtifactBundle(magpie, options.magpie?.commands ?? []);
      data = looksLikeZip(data)
        ? appendMagpieToBugreportZip(data, bundle)
        : bundleBugreportWithMagpie(data, bundle);
    }

    return { data, path, magpie };
  } finally {
    try {
      await adb.disconnect();
      log("Disconnected from device.");
    } catch {
      log("Device disconnected.");
    }
  }
}

export async function collectMagpieOnlyFromDevice(
  log: (line: string) => void,
  options: NonNullable<BugreportCollectOptions["magpie"]>
): Promise<{ data: Uint8Array; magpie: MagpieCollectResult }> {
  await ensureWasm();
  log("Requesting USB device — accept the debugging prompt on your phone…");
  const { adb, deviceInfo } = await connectAdb();
  if (deviceInfo && typeof deviceInfo === "object") {
    log(`Connected: ${JSON.stringify(deviceInfo)}`);
  } else {
    log("Connected to device.");
  }

  try {
    log("Running Rusty Magpie on-device collector (no bugreport)…");
    const magpie = await runMagpieCollector(adb, log, options);
    log("Packaging Magpie results for upload…");
    const data = buildMagpieOnlyZip(
      magpieArtifactBundle(magpie, options.commands ?? [])
    );
    return { data, magpie };
  } finally {
    try {
      await adb.disconnect();
      log("Disconnected from device.");
    } catch {
      log("Device disconnected.");
    }
  }
}
