import { apiFetch, apiPost } from "@/lib/api";
import { escapeMplString } from "@/lib/mplQuery";

export type IronSiftRunMode = "fleet" | "temporal" | "file" | "both" | "anomark";
export type IronSiftFleetCheck = "process" | "file" | "both" | "process_anomark" | "anomark";
export type IronSiftRunScope = "fleet" | "case" | "device";

export type ScopeFilter = {
  source?: string | null;
  sources?: string[] | null;
  case_id?: string | null;
  platform?: string | null;
  device_id?: string | null;
  machine_ids?: string[] | null;
  baseline_tags?: string[] | null;
  candidate_tags?: string[] | null;
  time_from?: string | null;
  time_to?: string | null;
  baseline_from?: string | null;
  baseline_to?: string | null;
  current_from?: string | null;
  current_to?: string | null;
};

export type AnoMarkPlatformConfig = {
  default_order: number;
  default_suspect_percent: number;
  parallel_train_lines: number;
  max_reasons_per_host: number;
  exclude_kernel_threads: boolean;
  exclude_regex: string[];
};

export const DEFAULT_ANOMARK_CONFIG: AnoMarkPlatformConfig = {
  default_order: 4,
  default_suspect_percent: 95,
  parallel_train_lines: 2000,
  max_reasons_per_host: 5,
  exclude_kernel_threads: true,
  exclude_regex: [],
};

export function mergeAnomarkConfig(
  value?: Partial<AnoMarkPlatformConfig> | null
): AnoMarkPlatformConfig {
  return { ...DEFAULT_ANOMARK_CONFIG, ...(value ?? {}) };
}

export type EndpointZipDeviceRule = {
  parent_dir_field?: number | null;
  delimiter?: string;
};

export type EndpointIngestConfig = {
  zip_device_rule?: EndpointZipDeviceRule;
  zip_parent_tag_field?: number | null;
};

export const DEFAULT_ENDPOINT_INGEST_CONFIG: EndpointIngestConfig = {
  zip_device_rule: { parent_dir_field: null, delimiter: "-" },
  zip_parent_tag_field: null,
};

export const PULSESECURE_DEVICE_RULE: EndpointZipDeviceRule = {
  parent_dir_field: 4,
  delimiter: "-",
};

export function mergeEndpointIngestConfig(
  value?: Partial<EndpointIngestConfig> | null
): EndpointIngestConfig {
  const base = DEFAULT_ENDPOINT_INGEST_CONFIG;
  const rule = value?.zip_device_rule ?? {};
  return {
    zip_device_rule: {
      parent_dir_field:
        rule.parent_dir_field !== undefined
          ? rule.parent_dir_field
          : base.zip_device_rule?.parent_dir_field ?? null,
      delimiter: rule.delimiter ?? base.zip_device_rule?.delimiter ?? "-",
    },
    zip_parent_tag_field:
      value?.zip_parent_tag_field !== undefined
        ? value.zip_parent_tag_field
        : base.zip_parent_tag_field ?? null,
  };
}

export type IronSiftPlatformConfig = {
  enabled: boolean;
  fleet_cron: string;
  post_ingest_temporal: boolean;
  min_fleet_devices: number;
  min_score: number;
  mudm_platform: string;
  detection_config: Record<string, unknown>;
  anomark_config?: AnoMarkPlatformConfig;
  endpoint_ingest?: EndpointIngestConfig;
};

export type IronSiftRun = {
  id: string;
  mode: IronSiftRunMode;
  scope: IronSiftRunScope;
  scope_filter: ScopeFilter;
  status: string;
  fleet_size: number;
  anomaly_count: number;
  summary: string;
  error?: string | null;
  report_json?: Record<string, unknown> | null;
  started_at: string;
  finished_at?: string | null;
  triggered_by: string;
  ironsift_config_name?: string | null;
  anomark_config_name?: string | null;
};

export type IronSiftFinding = {
  id: string;
  run_id: string;
  machine_id: string;
  detector: string;
  severity: string;
  score: number;
  distance_score?: number | null;
  reasons: string[];
  cluster_id?: string | null;
  alert_id?: string | null;
  raw_json?: Record<string, unknown> | null;
  created_at: string;
};

export type HoneycombCell = {
  machine_id: string;
  severity: string;
  score: number;
  row: number;
  col: number;
};

export type ScopeCaseOption = {
  id: string;
  title: string;
  ingest_source?: string | null;
  tags: string[];
  device_ids: string[];
};

export type ScopeSourceOption = {
  source: string;
  device_ids: string[];
  case_id?: string | null;
  tags: string[];
};

export type IronSiftScopeOptions = {
  cases: ScopeCaseOption[];
  tags: string[];
  sources: ScopeSourceOption[];
};

export type IronSiftDashboardStats = {
  source_count: number;
  run_count: number;
  latest_findings_count: number;
  anomark_train_count: number;
  latest_run: IronSiftRun | null;
};

export type IronSiftTriageRecord = {
  run_id: string;
  finding_id: string;
  detector: string;
  reason: string;
  verdict: "unset" | "false_positive" | "malicious";
  alert_id?: string | null;
  updated_at: string;
};

export type TriageMemoryEntry = {
  detector: string;
  reason: string;
  verdict: "unset" | "false_positive" | "malicious";
  run_id: string;
  updated_at: string;
};

export type IronSiftTabId =
  | "dashboard"
  | "ingestion"
  | "config"
  | "runs"
  | "anomark"
  | "fleet-memory";

export function fleetCheckToMode(check: IronSiftFleetCheck): IronSiftRunMode {
  switch (check) {
    case "process":
    case "process_anomark":
      return "fleet";
    case "file":
      return "file";
    case "both":
      return "both";
    case "anomark":
      return "anomark";
  }
}

export function fleetCheckUsesAnomark(check: IronSiftFleetCheck): boolean {
  return check === "anomark" || check === "both" || check === "process_anomark";
}

export type AnoMarkTrainRecord = {
  id: string;
  label: string;
  scope_filter: ScopeFilter;
  request_json: Record<string, unknown>;
  training_line_count: number;
  rel_model_path: string;
  rel_training_path: string;
  created_at: string;
  favorite: boolean;
};

export type AnoMarkTrainsListResponse = {
  trains: AnoMarkTrainRecord[];
  selected_id: string | null;
};

export function formatAnoMarkTrainLabel(train: AnoMarkTrainRecord): string {
  const name = train.label || train.id.slice(0, 8);
  return train.favorite ? `★ ${name}` : name;
}

export type AnoMarkTrainStats = {
  process_log_count: number;
  training_line_count: number;
  distinct_machines: number;
  order: number;
  scope_relaxed: boolean;
};

export type AnoMarkTrainResult = {
  status: string;
  train_id: string;
  record: AnoMarkTrainRecord;
  stats: AnoMarkTrainStats;
};

export type AnoMarkModelInspection = {
  model_path: string;
  file_size_bytes: number;
  order: number;
  is_trained: boolean;
  prior: number;
  num_contexts: number;
  num_transitions: number;
  alphabet_len: number;
  raw_markov_entries: number;
  suspect_threshold_ln: number;
};

export type AnoMarkTrainInspectResult = {
  record: AnoMarkTrainRecord;
  inspection: AnoMarkModelInspection;
  sample_training_lines: string[];
};

export type AnoMarkCommandScore = {
  train_id: string;
  model_path: string;
  order: number;
  log_likelihood: number;
  suspect_threshold_ln: number;
  is_suspect: boolean;
  margin_ln: number;
  suspect_percent_used: number;
  line_scored: string;
};

export async function fetchIronSiftConfig() {
  return apiFetch<IronSiftPlatformConfig>("/v1/ironsift/config");
}

export async function saveIronSiftConfig(cfg: IronSiftPlatformConfig) {
  return apiFetch<IronSiftPlatformConfig>("/v1/ironsift/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
}

export async function fetchAnomarkConfig() {
  return apiFetch<AnoMarkPlatformConfig>("/v1/ironsift/anomark/config");
}

export async function saveAnomarkConfig(cfg: AnoMarkPlatformConfig) {
  return apiFetch<AnoMarkPlatformConfig>("/v1/ironsift/anomark/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
}

export type ConfigProfileMeta = {
  id: string;
  name: string;
  saved_at: string;
};

export type ConfigProfilesListResponse = {
  profiles: ConfigProfileMeta[];
  selected_id: string | null;
};

export type ConfigProfile<T> = ConfigProfileMeta & { config: T };

export function activeConfigProfileName(
  profiles: ConfigProfilesListResponse | null | undefined
): string | null {
  if (!profiles?.selected_id) return null;
  return profiles.profiles.find((p) => p.id === profiles.selected_id)?.name ?? null;
}

export async function fetchIronSiftConfigProfiles() {
  return apiFetch<ConfigProfilesListResponse>("/v1/ironsift/config/profiles");
}

export async function createIronSiftConfigProfile(
  name: string,
  config?: IronSiftPlatformConfig
) {
  return apiPost<ConfigProfile<IronSiftPlatformConfig>>("/v1/ironsift/config/profiles", {
    name,
    config,
  });
}

export async function selectIronSiftConfigProfile(id: string) {
  return apiPost<IronSiftPlatformConfig>(`/v1/ironsift/config/profiles/${id}/select`, {});
}

export async function deleteIronSiftConfigProfile(id: string) {
  return apiFetch<{ status: string }>(`/v1/ironsift/config/profiles/${id}`, {
    method: "DELETE",
  });
}

export async function fetchAnomarkConfigProfiles() {
  return apiFetch<ConfigProfilesListResponse>("/v1/ironsift/anomark/config/profiles");
}

export async function createAnomarkConfigProfile(name: string, config?: AnoMarkPlatformConfig) {
  return apiPost<ConfigProfile<AnoMarkPlatformConfig>>(
    "/v1/ironsift/anomark/config/profiles",
    { name, config }
  );
}

export async function selectAnomarkConfigProfile(id: string) {
  return apiPost<AnoMarkPlatformConfig>(`/v1/ironsift/anomark/config/profiles/${id}/select`, {});
}

export async function deleteAnomarkConfigProfile(id: string) {
  return apiFetch<{ status: string }>(`/v1/ironsift/anomark/config/profiles/${id}`, {
    method: "DELETE",
  });
}

export async function fetchIronSiftScopeOptions() {
  return apiFetch<IronSiftScopeOptions>("/v1/ironsift/scope-options");
}

export async function fetchIronSiftDashboard() {
  return apiFetch<IronSiftDashboardStats>("/v1/ironsift/dashboard");
}

export async function fetchIronSiftRuns() {
  return apiFetch<IronSiftRun[]>("/v1/ironsift/runs");
}

export async function fetchIronSiftRun(id: string) {
  return apiFetch<IronSiftRun>(`/v1/ironsift/runs/${id}`);
}

export async function createIronSiftRun(body: {
  fleet_check?: IronSiftFleetCheck;
  mode?: IronSiftRunMode;
  scope: IronSiftRunScope;
  filter?: ScopeFilter;
  enable_anomark?: boolean;
  anomark_train_id?: string | null;
  anomark_suspect_percent?: number;
  detection_config?: Record<string, unknown>;
  sync_alerts?: boolean;
}) {
  return apiPost<IronSiftRun>("/v1/ironsift/runs", body);
}

export async function deleteIronSiftRun(id: string) {
  return apiFetch<void>(`/v1/ironsift/runs/${id}`, { method: "DELETE" });
}

export async function deleteAllIronSiftRuns() {
  return apiFetch<{ deleted: number }>("/v1/ironsift/runs", { method: "DELETE" });
}

export async function fetchIronSiftFindings(runId: string) {
  return apiFetch<IronSiftFinding[]>(`/v1/ironsift/runs/${runId}/findings`);
}

export async function promoteIronSiftFindingAlert(
  runId: string,
  findingId: string,
  reason?: string
) {
  return apiPost<IronSiftFinding>(
    `/v1/ironsift/runs/${runId}/findings/${findingId}/alert`,
    reason ? { reason } : {}
  );
}

export async function fetchIronSiftHoneycomb(runId: string, minScore = 0) {
  return apiFetch<HoneycombCell[]>(
    `/v1/ironsift/runs/${runId}/honeycomb?min_score=${minScore}`
  );
}

export async function fetchIronSiftTriage(runId: string) {
  return apiFetch<IronSiftTriageRecord[]>(`/v1/ironsift/runs/${runId}/triage`);
}

export async function saveIronSiftTriage(
  runId: string,
  entries: Array<{
    finding_id: string;
    detector: string;
    reason: string;
    verdict: "unset" | "false_positive" | "malicious";
  }>
) {
  const res = await fetch(`/api/v1/ironsift/runs/${runId}/triage`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export async function fetchTriageMemory() {
  return apiFetch<TriageMemoryEntry[]>("/v1/ironsift/triage-memory");
}

export async function deleteTriageMemory(detector: string, reason: string) {
  const q = new URLSearchParams({ detector, reason });
  const res = await fetch(`/api/v1/ironsift/triage-memory?${q}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export async function fetchAnoMarkTrains() {
  return apiFetch<AnoMarkTrainsListResponse>("/v1/ironsift/anomark/trains");
}

export async function selectAnoMarkTrainForRuns(trainId: string) {
  return apiPost<{ status: string; selected_id: string }>(
    `/v1/ironsift/anomark/trains/${trainId}/select`,
    {}
  );
}

export async function fetchAnoMarkTrain(id: string) {
  return apiFetch<AnoMarkTrainRecord>(`/v1/ironsift/anomark/trains/${id}`);
}

export async function inspectAnoMarkTrain(id: string) {
  return apiFetch<AnoMarkTrainInspectResult>(`/v1/ironsift/anomark/trains/${id}/inspect`);
}

export async function scoreAnoMarkCommand(
  trainId: string,
  body: {
    command: string;
    machine_name?: string;
    suspect_percent?: number;
  }
) {
  return apiPost<AnoMarkCommandScore>(
    `/v1/ironsift/anomark/trains/${trainId}/score-command`,
    body
  );
}

export async function deleteAnoMarkTrain(id: string) {
  return apiFetch<{ status: string }>(`/v1/ironsift/anomark/trains/${id}`, {
    method: "DELETE",
  });
}

export async function deleteAllAnoMarkTrains() {
  return apiFetch<{ status: string; removed: number }>("/v1/ironsift/anomark/trains", {
    method: "DELETE",
  });
}

export async function trainAnoMark(body: {
  label?: string;
  filter?: ScopeFilter;
  order?: number;
  tags?: string[];
}) {
  return apiPost<AnoMarkTrainResult>("/v1/ironsift/anomark/trains", body);
}

export function parseTagInput(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export type IronSiftDatasetRow = {
  id: string;
  kind: "source" | "case";
  name: string;
  subtitle: string;
  tags: string[];
  deviceCount: number;
};

/** Unified list of ingest sources and cases for dataset pickers. */
export function buildIronSiftDatasetRows(
  scope: IronSiftScopeOptions | null
): IronSiftDatasetRow[] {
  if (!scope) return [];
  const rows: IronSiftDatasetRow[] = scope.sources.map((s) => ({
    id: s.source,
    kind: "source",
    name: s.source,
    subtitle: `${s.device_ids.length} hosts`,
    tags: s.tags,
    deviceCount: s.device_ids.length,
  }));
  for (const c of scope.cases) {
    if (c.ingest_source && rows.some((r) => r.id === c.ingest_source)) continue;
    rows.push({
      id: c.id,
      kind: "case",
      name: c.title,
      subtitle: c.ingest_source ?? c.id.slice(0, 8),
      tags: c.tags,
      deviceCount: c.device_ids.length,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function datasetIdsMatchingScopeTags(
  scope: IronSiftScopeOptions | null,
  tags: string[]
): string[] {
  if (!scope || tags.length === 0) return [];
  const active = new Set(tags);
  return buildIronSiftDatasetRows(scope)
    .filter((row) => row.tags.some((tag) => active.has(tag)))
    .map((row) => row.id);
}

export function scopeDropdownPatchForTags(
  scope: IronSiftScopeOptions | null,
  tags: string[]
): { selectedCaseId: string; selectedSource: string } {
  if (!scope || tags.length === 0) {
    return { selectedCaseId: "", selectedSource: "" };
  }
  const active = new Set(tags);
  const matching = buildIronSiftDatasetRows(scope).filter((row) =>
    row.tags.some((tag) => active.has(tag))
  );
  if (matching.length !== 1) {
    return { selectedCaseId: "", selectedSource: "" };
  }
  const row = matching[0];
  if (row.kind === "case") {
    return { selectedCaseId: row.id, selectedSource: "" };
  }
  const src = scope.sources.find((s) => s.source === row.id);
  return {
    selectedCaseId: src?.case_id ?? "",
    selectedSource: row.id,
  };
}

/** When scope tags change, derive matching case/source dropdowns and dataset checkboxes. */
export function applyIronSiftTagScopeChange(
  scope: IronSiftScopeOptions | null,
  scopeTags: string
): {
  selectedCaseId: string;
  selectedSource: string;
  datasetIds: string[];
} {
  const tags = parseTagInput(scopeTags);
  if (tags.length === 0) {
    return { selectedCaseId: "", selectedSource: "", datasetIds: [] };
  }
  return {
    ...scopeDropdownPatchForTags(scope, tags),
    datasetIds: datasetIdsMatchingScopeTags(scope, tags),
  };
}

export function buildScopeFilter(opts: {
  caseId?: string;
  source?: string;
  sources?: string[];
  scopeTags?: string[];
  /** @deprecated use scopeTags */
  baselineTags?: string[];
  /** @deprecated use scopeTags */
  candidateTags?: string[];
  machineIds?: string[];
  baselineFrom?: string;
  baselineTo?: string;
  currentFrom?: string;
  currentTo?: string;
}): ScopeFilter {
  const filter: ScopeFilter = { platform: "endpoint" };
  if (opts.caseId) filter.case_id = opts.caseId;
  if (opts.source) filter.source = opts.source;
  if (opts.sources?.length) filter.sources = opts.sources;
  const mergedTags = opts.scopeTags?.length
    ? opts.scopeTags
    : [...(opts.baselineTags ?? []), ...(opts.candidateTags ?? [])];
  const tagList = [...new Set(mergedTags.map((t) => t.trim()).filter(Boolean))];
  if (tagList.length > 0) {
    filter.baseline_tags = tagList;
  }
  if (opts.machineIds?.length) filter.machine_ids = opts.machineIds;
  if (opts.baselineFrom) filter.baseline_from = opts.baselineFrom;
  if (opts.baselineTo) filter.baseline_to = opts.baselineTo;
  if (opts.currentFrom) filter.current_from = opts.currentFrom;
  if (opts.currentTo) filter.current_to = opts.currentTo;
  return filter;
}

/** Resolve ClickHouse ingest `source` label for a machine in an IronSift run scope. */
export function resolveIngestSourceForMachine(
  scopeOptions: IronSiftScopeOptions | null,
  scopeFilter: ScopeFilter,
  machineId: string
): string | null {
  const direct = scopeFilter.source?.trim();
  if (direct) return direct;

  const sources = scopeFilter.sources?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (sources.length === 1) return sources[0];

  if (sources.length > 1 && scopeOptions) {
    for (const srcName of sources) {
      const src = scopeOptions.sources.find((s) => s.source === srcName);
      if (src?.device_ids.includes(machineId)) return srcName;
    }
    return sources[0];
  }

  if (scopeFilter.case_id && scopeOptions) {
    const c = scopeOptions.cases.find((x) => x.id === scopeFilter.case_id);
    if (c?.ingest_source?.trim()) return c.ingest_source.trim();
  }

  if (scopeOptions) {
    for (const src of scopeOptions.sources) {
      if (src.device_ids.includes(machineId)) return src.source;
    }
    for (const c of scopeOptions.cases) {
      if (c.device_ids.includes(machineId) && c.ingest_source?.trim()) {
        return c.ingest_source.trim();
      }
    }
    if (scopeFilter.case_id) {
      const c = scopeOptions.cases.find((x) => x.id === scopeFilter.case_id);
      if (c?.ingest_source?.trim()) return c.ingest_source.trim();
    }
  }

  return null;
}

/** Open Search narrowed to one case source and device (IronSift machine_id). */
export function machineSearchHref(source: string, machineId: string): string {
  const params = new URLSearchParams({ source });
  const q =
    `source="${escapeMplString(source)}" device_id="${escapeMplString(machineId)}"` +
    " | fields timestamp, source, platform, parser, device_id, process_name, bundle_id, action, message" +
    " | sort -timestamp | head 200";
  params.set("q", q);
  params.set("run", "1");
  return `/search?${params.toString()}`;
}
