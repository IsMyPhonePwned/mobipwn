import { parseApiResponse } from "@/lib/response";
import type { MagpieCommand } from "./androidCollector";

export type AndroidYaraRule = {
  id: string;
  name: string;
  enabled: boolean;
  source: string;
  compiled_b64?: string | null;
  compile_error?: string | null;
};

export type AndroidCollectConfig = {
  default_commands: MagpieCommand[];
  find_paths: string[];
  max_depth: number;
  yara_paths: string[];
  yara_max_depth: number;
  /** When true, find passes --hash (slow). Default: metadata-only inventory. */
  hash_files: boolean;
  /** Max file size (bytes) to hash when hash_files is enabled. */
  max_hash_size: number;
  /** Extra directory glob patterns for find --exclude-dir. */
  exclude_dirs: string[];
  yara_rules: AndroidYaraRule[];
  yara_bundle_b64?: string | null;
  yara_bundle_error?: string | null;
  /** Device paths pulled wholesale into blob storage (pending analysis). */
  pull_repository_paths: string[];
  pull_max_depth: number;
  pull_max_file_size: number;
  pull_max_files: number;
};

export type PublicAndroidCollectConfig = {
  default_commands: MagpieCommand[];
  find_paths: string[];
  max_depth: number;
  yara_paths: string[];
  yara_max_depth: number;
  hash_files: boolean;
  max_hash_size: number;
  exclude_dirs: string[];
  yara_rule_names: string[];
  yara_bundle_b64?: string | null;
  pull_repository_paths: string[];
  pull_max_depth: number;
  pull_max_file_size: number;
  pull_max_files: number;
};

export const DEFAULT_PULL_MAX_FILE_SIZE = 50 * 1024 * 1024;
export const DEFAULT_PULL_MAX_FILES = 500;

export const DEFAULT_ANDROID_DEVICE_PATHS = ["/sdcard", "/data/local/tmp"] as const;

export const DEFAULT_MAX_HASH_SIZE = 512 * 1024;

export const DEFAULT_ANDROID_COLLECT: AndroidCollectConfig = {
  default_commands: ["find"],
  find_paths: [...DEFAULT_ANDROID_DEVICE_PATHS],
  max_depth: 3,
  yara_paths: [...DEFAULT_ANDROID_DEVICE_PATHS],
  yara_max_depth: 3,
  hash_files: false,
  max_hash_size: DEFAULT_MAX_HASH_SIZE,
  exclude_dirs: [],
  yara_rules: [],
  pull_repository_paths: [...DEFAULT_ANDROID_DEVICE_PATHS],
  pull_max_depth: 5,
  pull_max_file_size: DEFAULT_PULL_MAX_FILE_SIZE,
  pull_max_files: DEFAULT_PULL_MAX_FILES,
};

const MAGPIE_COMMANDS: MagpieCommand[] = ["find", "ps", "yara"];

export function normalizeConfigCommands(commands: string[] | undefined): MagpieCommand[] {
  const seen = new Set<MagpieCommand>();
  const out: MagpieCommand[] = [];
  for (const raw of commands ?? DEFAULT_ANDROID_COLLECT.default_commands) {
    const cmd = raw.trim().toLowerCase() as MagpieCommand;
    if (MAGPIE_COMMANDS.includes(cmd) && !seen.has(cmd)) {
      seen.add(cmd);
      out.push(cmd);
    }
  }
  return out.length > 0 ? out : ["find"];
}

export function newYaraRuleId(): string {
  return `yara-${crypto.randomUUID().slice(0, 8)}`;
}

export function defaultYaraRule(name = "New rule"): AndroidYaraRule {
  return {
    id: newYaraRuleId(),
    name,
    enabled: true,
    source: `rule example {\n  meta:\n    description = "Example YARA rule"\n  strings:\n    $a = "example"\n  condition:\n    $a\n}\n`,
  };
}

export async function fetchPublicAndroidCollectConfig(): Promise<PublicAndroidCollectConfig> {
  const res = await fetch("/api/v1/public/collect/android-config");
  return parseApiResponse<PublicAndroidCollectConfig>(res);
}

export type CompileYaraResponse = {
  ok: boolean;
  compiled_b64?: string | null;
  error?: string | null;
};

export async function compileYaraSource(source: string): Promise<CompileYaraResponse> {
  const res = await fetch("/api/v1/settings/yara/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  return parseApiResponse<CompileYaraResponse>(res);
}
