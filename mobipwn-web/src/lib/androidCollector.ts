/**
 * On-device Android collection via rusty-magpie (mobi-android-collector).
 * @see mobi-android-collector/README.mobipwn.md
 */
import type { WebAdbClient } from "./webadb";
import { DEFAULT_ANDROID_DEVICE_PATHS } from "./androidCollectConfig";

const REMOTE_DIR = "/data/local/tmp";
const REMOTE_BIN = `${REMOTE_DIR}/rusty_magpie`;
const BINARY_URL = "/vendor/rusty-magpie/rusty_magpie";

/** Android/Linux ELF magic (`\\x7fELF`). */
export function isElfBinary(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x7f &&
    data[1] === 0x45 &&
    data[2] === 0x4c &&
    data[3] === 0x46
  );
}

const MAGPIE_MISSING_MSG =
  "Rusty Magpie binary is not built or is invalid (expected Android ELF, not HTML). " +
  "Run scripts/build-android-collector.sh with ANDROID_NDK_HOME set — see mobi-android-collector/README.mobipwn.md.";

async function peekBinaryBytes(): Promise<Uint8Array | null> {
  const rangeResp = await fetch(BINARY_URL, { headers: { Range: "bytes=0-3" } });
  if (rangeResp.ok || rangeResp.status === 206) {
    return new Uint8Array(await rangeResp.arrayBuffer());
  }
  const head = await fetch(BINARY_URL, { method: "HEAD" });
  if (!head.ok) return null;
  const ct = head.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) return null;
  const len = Number(head.headers.get("content-length") ?? 0);
  if (len > 0 && len < 50_000) return null;
  const resp = await fetch(BINARY_URL);
  if (!resp.ok) return null;
  const data = new Uint8Array(await resp.arrayBuffer());
  return data.subarray(0, 4);
}

export type MagpieCommand = "ps" | "find" | "yara";

export const DEFAULT_MAGPIE_COMMANDS: MagpieCommand[] = ["find"];

export type MagpieCollectOptions = {
  /** Rusty Magpie subcommands to run (default: find only). */
  commands?: MagpieCommand[];
  findPaths?: string[];
  maxDepth?: number;
  /** Pass --hash when true (default: metadata-only inventory). */
  hashFiles?: boolean;
  /** --max-hash-size in bytes when hashFiles is true. */
  maxHashSize?: number;
  /** Extra --exclude-dir glob patterns. */
  excludeDirs?: string[];
  yaraPaths?: string[];
  yaraMaxDepth?: number;
  /** Base64-encoded compiled `.yarc` rules bundle for YARA scans. */
  yaraRulesB64?: string;
};

export type MagpieCollectResult = {
  processesJson: string;
  filesJson: string;
  yaraJson: string;
  findPaths: string[];
  yaraPaths: string[];
  maxDepth: number;
  hashFiles: boolean;
  maxHashSize: number;
  excludeDirs: string[];
  yaraMaxDepth: number;
  processCount: number;
  fileCount: number;
  yaraMatchCount: number;
};

let binaryCache: Uint8Array | null = null;

export function normalizeFindPaths(paths: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths ?? []) {
    const p = raw.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.length > 0 ? out : [...DEFAULT_ANDROID_DEVICE_PATHS];
}

export function normalizeExcludeDirs(paths: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths ?? []) {
    const p = raw.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export const DEFAULT_MAX_HASH_SIZE = 512 * 1024;

function buildFindFlags(options: {
  hashFiles?: boolean;
  maxHashSize?: number;
  excludeDirs?: string[];
}): string {
  let flags = "";
  if (options.hashFiles) {
    flags += " --hash";
    const maxSize = options.maxHashSize ?? DEFAULT_MAX_HASH_SIZE;
    flags += ` --max-hash-size ${maxSize}`;
  }
  for (const dir of normalizeExcludeDirs(options.excludeDirs)) {
    flags += ` --exclude-dir ${shellQuote(dir)}`;
  }
  return flags;
}

export function normalizeMagpieCommands(commands?: MagpieCommand[]): MagpieCommand[] {
  const seen = new Set<MagpieCommand>();
  const out: MagpieCommand[] = [];
  for (const cmd of commands ?? DEFAULT_MAGPIE_COMMANDS) {
    if ((cmd === "ps" || cmd === "find" || cmd === "yara") && !seen.has(cmd)) {
      seen.add(cmd);
      out.push(cmd);
    }
  }
  return out.length > 0 ? out : [...DEFAULT_MAGPIE_COMMANDS];
}

export function toggleMagpieCommand(
  current: MagpieCommand[],
  command: MagpieCommand,
  enabled: boolean
): MagpieCommand[] {
  if (enabled) {
    return current.includes(command) ? current : [...current, command];
  }
  const next = current.filter((c) => c !== command);
  return next.length > 0 ? next : current;
}

export async function magpieBinaryAvailable(): Promise<boolean> {
  try {
    const peek = await peekBinaryBytes();
    return peek !== null && isElfBinary(peek);
  } catch {
    return false;
  }
}

async function loadMagpieBinary(): Promise<Uint8Array> {
  if (binaryCache) return binaryCache;
  const resp = await fetch(BINARY_URL);
  if (!resp.ok) {
    throw new Error(MAGPIE_MISSING_MSG);
  }
  const data = new Uint8Array(await resp.arrayBuffer());
  if (!isElfBinary(data)) {
    throw new Error(MAGPIE_MISSING_MSG);
  }
  binaryCache = data;
  return binaryCache;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function countJsonArray(json: string): number {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function remoteFindPath(index: number): string {
  return `${REMOTE_DIR}/mobipwn_magpie_find_${index}.json`;
}

const REMOTE_YARA_RULES = `${REMOTE_DIR}/mobipwn_magpie_rules.yarc`;

function remoteYaraPath(index: number): string {
  return `${REMOTE_DIR}/mobipwn_magpie_yara_${index}.json`;
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function cleanupMagpieArtifacts(
  adb: WebAdbClient,
  log: (line: string) => void
): Promise<void> {
  log("Removing collector binary and output files from device…");
  const cleanupCmd = `rm -f ${shellQuote(REMOTE_BIN)} ${REMOTE_DIR}/mobipwn_magpie_*`;
  try {
    await runShell(adb, cleanupCmd, 30_000, log);
    log("Device cleanup complete.");
  } catch (err) {
    log(`Warning: device cleanup failed (${String(err)})`);
  }
}

async function runShell(
  adb: WebAdbClient,
  command: string,
  timeoutMs: number,
  log: (line: string) => void
): Promise<string> {
  log(`$ ${command}`);
  console.info(`[magpie] $ ${command}`);
  return adb.shell_with_timeout(command, timeoutMs);
}

async function scanDirectory(
  adb: WebAdbClient,
  findPath: string,
  maxDepth: number,
  index: number,
  findOptions: Pick<MagpieCollectOptions, "hashFiles" | "maxHashSize" | "excludeDirs">,
  log: (line: string) => void
): Promise<Record<string, unknown>[]> {
  const remoteOut = remoteFindPath(index);
  const hashNote = findOptions.hashFiles ? "with SHA-256 hashing" : "metadata-only";
  log(`Scanning files under ${findPath} (max depth ${maxDepth}, ${hashNote})…`);
  await runShell(adb, `rm -f ${shellQuote(remoteOut)}`, 30_000, log);
  const findFlags = buildFindFlags(findOptions);
  const findShell =
    `${REMOTE_BIN} find --path ${shellQuote(findPath)} --max-depth ${maxDepth}${findFlags}` +
    ` > ${shellQuote(remoteOut)} 2>&1`;
  const started = Date.now();
  const findOut = await runShell(adb, findShell, 600_000, log);
  log(`File scan finished in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  if (findOut.trim()) {
    log(findOut.trim().split("\n").slice(-3).join("\n"));
  }

  const findBytes = await adb.pull_file(remoteOut);
  const raw = new TextDecoder().decode(findBytes).trim();
  if (!raw.startsWith("[")) {
    throw new Error(
      `File inventory failed for ${findPath}: ${raw.slice(0, 240) || "(empty output)"}`
    );
  }

  const items = JSON.parse(raw) as unknown;
  if (!Array.isArray(items)) {
    throw new Error(`File inventory for ${findPath} must be a JSON array`);
  }

  return items.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return { ...(item as Record<string, unknown>), scan_root: findPath };
    }
    return { value: item, scan_root: findPath };
  });
}

async function runYaraScan(
  adb: WebAdbClient,
  scanPath: string,
  maxDepth: number,
  index: number,
  log: (line: string) => void
): Promise<Record<string, unknown>[]> {
  const remoteOut = remoteYaraPath(index);
  log(`YARA scan under ${scanPath} (max depth ${maxDepth})…`);
  await runShell(adb, `rm -f ${shellQuote(remoteOut)}`, 30_000, log);
  const yaraShell =
    `${REMOTE_BIN} yara --path ${shellQuote(scanPath)} --rule-path ${shellQuote(REMOTE_YARA_RULES)}` +
    ` --max-depth ${maxDepth} > ${shellQuote(remoteOut)} 2>&1`;
  const started = Date.now();
  const yaraOut = await runShell(adb, yaraShell, 600_000, log);
  log(`YARA scan finished in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  if (yaraOut.trim()) {
    log(yaraOut.trim().split("\n").slice(-3).join("\n"));
  }

  const yaraBytes = await adb.pull_file(remoteOut);
  const raw = new TextDecoder().decode(yaraBytes).trim();
  if (!raw.startsWith("[")) {
    throw new Error(
      `YARA scan failed for ${scanPath}: ${raw.slice(0, 240) || "(empty output)"}`
    );
  }

  const items = JSON.parse(raw) as unknown;
  if (!Array.isArray(items)) {
    throw new Error(`YARA results for ${scanPath} must be a JSON array`);
  }

  return items.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return { ...(item as Record<string, unknown>), scan_root: scanPath };
    }
    return { value: item, scan_root: scanPath };
  });
}

export async function runMagpieCollector(
  adb: WebAdbClient,
  log: (line: string) => void,
  options: MagpieCollectOptions = {}
): Promise<MagpieCollectResult> {
  const commands = normalizeMagpieCommands(options.commands);
  const runPs = commands.includes("ps");
  const runFind = commands.includes("find");
  const runYara = commands.includes("yara");
  const findPaths = runFind ? normalizeFindPaths(options.findPaths) : [];
  const yaraPaths = runYara ? normalizeFindPaths(options.yaraPaths ?? options.findPaths) : [];
  const maxDepth = options.maxDepth ?? 3;
  const hashFiles = options.hashFiles ?? false;
  const maxHashSize = options.maxHashSize ?? DEFAULT_MAX_HASH_SIZE;
  const excludeDirs = normalizeExcludeDirs(options.excludeDirs);
  const yaraMaxDepth = options.yaraMaxDepth ?? maxDepth;
  const yaraRulesB64 = options.yaraRulesB64?.trim() ?? "";

  if (runYara && !yaraRulesB64) {
    throw new Error(
      "YARA scanning is enabled but no compiled rules bundle is configured. Add rules under Settings → Plugins → Collector → Configure → Android."
    );
  }

  try {
    log(`Loading Rusty Magpie collector binary (${commands.join(", ")})…`);
    const binary = await loadMagpieBinary();
    log(`Pushing collector (${(binary.byteLength / (1024 * 1024)).toFixed(1)} MB) to device…`);
    await adb.push_file(binary, REMOTE_BIN);
    log("Binary pushed to device.");

    if (runYara) {
      const rulesBytes = decodeBase64(yaraRulesB64);
      log(`Pushing YARA rules (${(rulesBytes.byteLength / 1024).toFixed(1)} KB) to device…`);
      await adb.push_file(rulesBytes, REMOTE_YARA_RULES);
      log("YARA rules pushed to device.");
    }

    let processesJson = "[]";
    if (runPs) {
      log("Collecting process list (rusty_magpie ps)…");
      const psStarted = Date.now();
      processesJson = (await runShell(adb, `${REMOTE_BIN} ps 2>&1`, 180_000, log)).trim();
      log(`Process list finished in ${((Date.now() - psStarted) / 1000).toFixed(1)}s.`);
      if (!processesJson.startsWith("[")) {
        throw new Error(
          `Process collection failed: ${processesJson.slice(0, 240) || "(empty output)"}`
        );
      }
    }

    const mergedFiles: Record<string, unknown>[] = [];
    if (runFind) {
      const findOptions = { hashFiles, maxHashSize, excludeDirs };
      for (let i = 0; i < findPaths.length; i += 1) {
        const batch = await scanDirectory(adb, findPaths[i]!, maxDepth, i, findOptions, log);
        mergedFiles.push(...batch);
        log(`  ${findPaths[i]} → ${batch.length.toLocaleString()} files`);
      }
    }

    const mergedYara: Record<string, unknown>[] = [];
    if (runYara) {
      for (let i = 0; i < yaraPaths.length; i += 1) {
        const batch = await runYaraScan(adb, yaraPaths[i]!, yaraMaxDepth, i, log);
        mergedYara.push(...batch);
        log(`  ${yaraPaths[i]} → ${batch.length.toLocaleString()} YARA hit(s)`);
      }
    }

    const filesJson = JSON.stringify(mergedFiles);
    const yaraJson = JSON.stringify(mergedYara);
    const processCount = countJsonArray(processesJson);
    const fileCount = mergedFiles.length;
    const yaraMatchCount = mergedYara.length;
    const parts: string[] = [];
    if (runPs) parts.push(`${processCount.toLocaleString()} processes`);
    if (runFind) {
      parts.push(
        `${fileCount.toLocaleString()} files across ${findPaths.length} path${findPaths.length === 1 ? "" : "s"}`
      );
    }
    if (runYara) {
      parts.push(
        `${yaraMatchCount.toLocaleString()} YARA hit(s) across ${yaraPaths.length} path${yaraPaths.length === 1 ? "" : "s"}`
      );
    }
    log(`Collector done — ${parts.join(", ")}.`);

    return {
      processesJson,
      filesJson,
      yaraJson,
      findPaths,
      yaraPaths,
      maxDepth,
      hashFiles,
      maxHashSize,
      excludeDirs,
      yaraMaxDepth,
      processCount,
      fileCount,
      yaraMatchCount,
    };
  } finally {
    await cleanupMagpieArtifacts(adb, log);
  }
}
