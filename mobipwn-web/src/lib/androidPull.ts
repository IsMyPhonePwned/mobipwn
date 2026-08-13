import { storeCollectBlob } from "@/lib/blobStorage";
import { uploadPublicCollectStore } from "@/lib/publicCollect";
import { connectAdb, type WebAdbClient } from "@/lib/webadb";

export type PullRepositoryOptions = {
  repositories: string[];
  maxDepth: number;
  maxFileSize: number;
  maxFiles: number;
  source: string;
  user?: string;
  /** Use authenticated blob API (in-app collector) or public /collect store. */
  storeMode?: "auth" | "public";
};

export type PullRepositoryProgress = {
  repository: string;
  remotePath: string;
  stored: number;
  skipped: number;
  errors: number;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function blobFileName(remotePath: string): string {
  const trimmed = remotePath.replace(/^\/+/, "");
  return trimmed.replace(/\//g, "__") || "file.bin";
}

type FileStat = {
  size: number;
  is_directory?: boolean;
  is_file?: boolean;
};

async function listRepositoryFiles(
  adb: WebAdbClient,
  repoPath: string,
  maxDepth: number,
  maxFiles: number,
  log: (line: string) => void
): Promise<string[]> {
  const cmd = `find ${shellQuote(repoPath)} -type f -maxdepth ${maxDepth} 2>/dev/null | head -n ${maxFiles}`;
  log(`$ ${cmd}`);
  const out = await adb.shell_with_timeout(cmd, 600_000);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function fileSize(adb: WebAdbClient, remotePath: string): Promise<number | null> {
  try {
    const raw = await adb.stat_file(remotePath);
    const stat = raw as unknown as FileStat;
    if (stat.is_directory) return null;
    return typeof stat.size === "number" ? stat.size : null;
  } catch {
    return null;
  }
}

async function storePulledFile(
  options: PullRepositoryOptions,
  fileName: string,
  data: Uint8Array
): Promise<void> {
  const mode = options.storeMode ?? "public";
  if (mode === "auth") {
    await storeCollectBlob({
      platform: "android",
      source: options.source,
      fileName,
      data,
      user: options.user,
      origin: "device-pull",
    });
    return;
  }
  await uploadPublicCollectStore({
    platform: "android",
    source: options.source,
    fileName,
    data,
    user: options.user,
  });
}

export async function pullRepositoriesToBlobStore(
  options: PullRepositoryOptions,
  log: (line: string) => void,
  onProgress?: (progress: PullRepositoryProgress) => void
): Promise<{ stored: number; skipped: number; errors: number }> {
  const repos = options.repositories.map((p) => p.trim()).filter(Boolean);
  if (repos.length === 0) {
    throw new Error("No repository paths configured.");
  }

  log("Connecting to device via WebUSB…");
  const { adb } = await connectAdb();
  log("Device connected.");

  let stored = 0;
  let skipped = 0;
  let errors = 0;
  let remaining = options.maxFiles;

  for (const repo of repos) {
    if (remaining <= 0) {
      log(`Reached max file limit (${options.maxFiles}); stopping.`);
      break;
    }
    log(`Listing files under ${repo}…`);
    let paths: string[];
    try {
      paths = await listRepositoryFiles(adb, repo, options.maxDepth, remaining, log);
    } catch (e) {
      log(`Failed to list ${repo}: ${String(e)}`);
      errors += 1;
      continue;
    }
    log(`Found ${paths.length} file(s) under ${repo}.`);

    for (const remotePath of paths) {
      if (remaining <= 0) break;

      const size = await fileSize(adb, remotePath);
      if (size == null) {
        skipped += 1;
        log(`Skip (not a file): ${remotePath}`);
        continue;
      }
      if (size > options.maxFileSize) {
        skipped += 1;
        log(`Skip (too large, ${size} bytes): ${remotePath}`);
        continue;
      }

      try {
        log(`Pulling ${remotePath} (${size} bytes)…`);
        const data = await adb.pull_file(remotePath);
        const fileName = blobFileName(remotePath);
        await storePulledFile(options, fileName, data);
        stored += 1;
        remaining -= 1;
        log(`Stored ${fileName}.`);
        onProgress?.({ repository: repo, remotePath, stored, skipped, errors });
      } catch (e) {
        errors += 1;
        log(`Error on ${remotePath}: ${String(e)}`);
        onProgress?.({ repository: repo, remotePath, stored, skipped, errors });
      }
    }
  }

  log(`Done: ${stored} stored, ${skipped} skipped, ${errors} error(s).`);
  return { stored, skipped, errors };
}
