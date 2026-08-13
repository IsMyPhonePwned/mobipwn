import {
  mergeAnomarkConfig,
  mergeEndpointIngestConfig,
  type IronSiftPlatformConfig,
} from "@/lib/ironsift";

export type IronSiftConfigPreset = {
  id: string;
  name: string;
  builtIn?: boolean;
  savedAt?: string;
  detection_config: Record<string, unknown>;
};

const STORAGE_KEY = "mobipwn.ironsift.configPresets.v1";

/** Defaults aligned with upstream IronSift `DetectionConfig`. */
export const DEFAULT_DETECTION_CONFIG: Record<string, unknown> = {
  entropy_threshold: 4.5,
  minority_cluster_ratio: 0.1,
  dbscan_tolerance: 0.35,
  dbscan_min_samples: 2,
  normalize_features: true,
  exclude_kernel_threads: true,
  exclude_init_children: false,
  flag_unexpected_root: true,
  debug_display: false,
  quiet: false,
  suspicious_path_patterns: [
    "/tmp/",
    "/dev/shm/",
    "/var/tmp/",
    "/home/[^/]+/\\.[^/]+",
    "^\\./",
    "/(?:bin|sbin|usr/bin|usr/sbin)/\\.[^/]+",
  ],
  common_root_processes: [
    "systemd",
    "init",
    "sshd",
    "cron",
    "crond",
    "rsyslogd",
    "dockerd",
    "containerd",
    "kubelet",
  ],
  whitelisted_path_patterns: [],
  file_excluded_path_regexes: [],
  file_excluded_filename_regexes: [],
  file_rare_signature_includes_size: false,
  file_rare_signature_includes_metadata: false,
  file_rare_signature_includes_recent_mtime: false,
  file_rare_requires_risk: true,
  file_max_rare_examples_per_host: 20,
  file_max_unique_features: 8000,
  file_fleet_baseline_fingerprint_enabled: false,
  file_fleet_baseline_min_host_fraction: 1.0,
  file_fleet_baseline_mtime_bucket_secs: 86400,
  file_fleet_baseline_exclude_suspicious_paths: true,
  file_exclude_common_inventory_sql: true,
  file_recent_mtime: {
    clock_skew_minutes: 5,
    max_hours_critical_paths: 12,
    max_hours_system_elevated: 6,
    max_hours_suspicious_only: 3,
    volatile_path_prefixes: ["/var/log/", "/var/cache/", "/tmp/", "/run/"],
  },
};

export const BUILTIN_CONFIG_PRESETS: IronSiftConfigPreset[] = [
  {
    id: "builtin-default",
    name: "Default (balanced)",
    builtIn: true,
    detection_config: { ...DEFAULT_DETECTION_CONFIG },
  },
  {
    id: "builtin-strict",
    name: "Strict clustering",
    builtIn: true,
    detection_config: {
      ...DEFAULT_DETECTION_CONFIG,
      dbscan_tolerance: 0.22,
      minority_cluster_ratio: 0.06,
      entropy_threshold: 4.0,
    },
  },
  {
    id: "builtin-sensitive-file",
    name: "Sensitive file fleet",
    builtIn: true,
    detection_config: {
      ...DEFAULT_DETECTION_CONFIG,
      file_rare_requires_risk: false,
      file_max_rare_examples_per_host: 40,
      file_max_unique_features: 12000,
    },
  },
];

export function mergeDetectionDefaults(raw: Record<string, unknown>): Record<string, unknown> {
  const base = structuredClone(DEFAULT_DETECTION_CONFIG);
  const merged = { ...base, ...raw };
  if (raw.file_recent_mtime && typeof raw.file_recent_mtime === "object") {
    merged.file_recent_mtime = {
      ...(base.file_recent_mtime as Record<string, unknown>),
      ...(raw.file_recent_mtime as Record<string, unknown>),
    };
  }
  return merged;
}

export const PLATFORM_CONFIG_PRESET_ID = "platform";

/** Detection config sent with a run: preset override or omit for server platform default. */
export function detectionConfigForRun(
  presetId: string,
  platformDetection?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!presetId || presetId === PLATFORM_CONFIG_PRESET_ID) {
    return undefined;
  }
  const preset = listConfigPresets().find((p) => p.id === presetId);
  if (preset) {
    return mergeDetectionDefaults(preset.detection_config);
  }
  if (platformDetection && Object.keys(platformDetection).length > 0) {
    return mergeDetectionDefaults(platformDetection);
  }
  return undefined;
}

export function listConfigPresets(): IronSiftConfigPreset[] {
  let saved: IronSiftConfigPreset[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw) as IronSiftConfigPreset[];
  } catch {
    saved = [];
  }
  return [...BUILTIN_CONFIG_PRESETS, ...saved.filter((p) => !p.builtIn)];
}

export function saveConfigPreset(name: string, detection_config: Record<string, unknown>): IronSiftConfigPreset {
  const preset: IronSiftConfigPreset = {
    id: `user-${Date.now()}`,
    name: name.trim() || "Custom preset",
    savedAt: new Date().toISOString(),
    detection_config: structuredClone(detection_config),
  };
  const saved = listConfigPresets().filter((p) => !p.builtIn);
  saved.push(preset);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  return preset;
}

export function deleteConfigPreset(id: string): void {
  const saved = listConfigPresets()
    .filter((p) => !p.builtIn && p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

export function exportConfigJson(cfg: IronSiftPlatformConfig): string {
  return JSON.stringify(cfg, null, 2);
}

export function parseImportedConfig(text: string): IronSiftPlatformConfig {
  const parsed = JSON.parse(text) as Partial<IronSiftPlatformConfig>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid config JSON");
  }
  return {
    enabled: parsed.enabled ?? true,
    fleet_cron: parsed.fleet_cron ?? "0 0 3 * * *",
    post_ingest_temporal: parsed.post_ingest_temporal ?? true,
    min_fleet_devices: parsed.min_fleet_devices ?? 3,
    min_score: parsed.min_score ?? 0.4,
    mudm_platform: parsed.mudm_platform ?? "endpoint",
    detection_config: mergeDetectionDefaults(
      (parsed.detection_config as Record<string, unknown>) ?? {}
    ),
    anomark_config: mergeAnomarkConfig(parsed.anomark_config),
    endpoint_ingest: mergeEndpointIngestConfig(parsed.endpoint_ingest),
  };
}

export function downloadConfigFile(cfg: IronSiftPlatformConfig, filename = "ironsift-config.json") {
  const blob = new Blob([exportConfigJson(cfg)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
