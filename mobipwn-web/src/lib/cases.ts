import { apiFetch, apiPost } from "@/lib/api";
import type { ReingestResponse } from "@/lib/blobStorage";

export type CaseRecord = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  user: string;
  tags: string[];
  ingest_source?: string | null;
  event_count?: number | null;
  first_ingest_at?: string | null;
  last_ingest_at?: string | null;
  ingest_run_count?: number | null;
  device_model?: string | null;
  os_version?: string | null;
  device_id?: string | null;
  serial_number?: string | null;
  android_id?: string | null;
  unique_device_id?: string | null;
  imei?: string | null;
  blob_file_hash?: string | null;
  alert_count: number;
  created_at: string;
  updated_at: string;
};

export async function fetchCases(params?: { status?: string; q?: string; owner?: string }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.q) qs.set("q", params.q);
  if (params?.owner) qs.set("owner", params.owner);
  const suffix = qs.toString();
  return apiFetch<CaseRecord[]>(`/v1/cases${suffix ? `?${suffix}` : ""}`);
}

/** Resolve the investigation case created/linked for an ingest source label. */
export async function resolveCaseIdForIngestSource(source: string): Promise<string | null> {
  const label = source.trim();
  if (!label) return null;
  const cases = await fetchCases({ q: label });
  const exact = cases.find((c) => c.ingest_source === label);
  return exact?.id ?? cases[0]?.id ?? null;
}

export type CaseEntitiesResponse = {
  entities: Array<{
    entity_type: string;
    count: number;
    entities: Array<{
      entity_type: string;
      entity_value: string;
      occurrence_count: number;
      is_primary: boolean;
      risk_score?: number | null;
      enrichment_data?: Record<string, unknown> | null;
    }>;
  }>;
  graph: {
    nodes: Array<{
      id: string;
      entity_type: string;
      label: string;
      occurrence_count: number;
      is_primary: boolean;
    }>;
    edges: Array<{ source: string; target: string; weight: number; relationship?: string }>;
  };
  primary_entity?: { entity_type: string; entity_value: string } | null;
  auto_primary_entity?: { entity_type: string; entity_value: string } | null;
  primary_entity_source?: "auto" | "manual";
};

export async function fetchCaseEntities(caseId: string) {
  return apiFetch<CaseEntitiesResponse>(`/v1/cases/${caseId}/entities`);
}

export async function setCasePrimaryAnchor(
  caseId: string,
  entity_type: string,
  entity_value: string
) {
  return apiPost<CaseEntitiesResponse>(`/v1/cases/${caseId}/primary-anchor`, {
    entity_type,
    entity_value,
  });
}

export async function clearCasePrimaryAnchor(caseId: string) {
  const res = await fetch(`/api/v1/cases/${caseId}/primary-anchor`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as CaseEntitiesResponse;
}

export async function fetchCase(id: string) {
  return apiFetch<CaseRecord>(`/v1/cases/${id}`);
}

export async function linkAlertToCase(caseId: string, alertId: string) {
  return apiPost<{ linked: boolean }>(`/v1/cases/${caseId}/alerts/${alertId}`, {});
}

export async function unlinkAlertFromCase(caseId: string, alertId: string) {
  const res = await fetch(`/api/v1/cases/${caseId}/alerts/${alertId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export async function fetchCaseAlerts(caseId: string) {
  return apiFetch<import("@/components/alerts/AlertDetailDrawer").AlertDetail[]>(
    `/v1/cases/${caseId}/alerts`
  );
}

export type CaseWallEntry = {
  id: string;
  timestamp: string;
  message: string;
  action: string;
  actor_id?: string | null;
  actor_name?: string | null;
  severity: string;
  status: string;
  previous_status?: string | null;
  disposition?: string | null;
  alert_id?: string | null;
  notes?: string | null;
  time_since_creation_seconds?: number | null;
  time_to_resolve_seconds?: number | null;
  alert_count?: number | null;
  note_type?: string | null;
};

export async function fetchCaseWall(caseId: string, limit = 100) {
  return apiFetch<CaseWallEntry[]>(`/v1/cases/${caseId}/wall?limit=${limit}`);
}

export async function addCaseComment(
  caseId: string,
  body: string,
  noteType?: string
) {
  return apiPost<CaseWallEntry>(`/v1/cases/${caseId}/comments`, {
    body,
    note_type: noteType,
  });
}

export type UpdateCaseBody = {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  user?: string;
  tags?: string[];
  rename_ingest_source?: boolean;
};

export async function updateCase(id: string, body: UpdateCaseBody) {
  return apiPost<CaseRecord>(`/v1/cases/${id}`, body);
}

export async function renameCase(id: string, title: string, renameIngestSource = false) {
  return updateCase(id, { title: title.trim(), rename_ingest_source: renameIngestSource });
}

export async function closeCase(id: string) {
  return updateCase(id, { status: "closed" });
}

export async function deleteCase(id: string, deleteData = false) {
  const qs = deleteData ? "?delete_data=true" : "";
  const res = await fetch(`/api/v1/cases/${id}${qs}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

/** Re-parse a stored archive for this case (clears existing events by default). */
export async function reingestCase(
  caseId: string,
  opts?: { clean?: boolean; blobId?: string }
): Promise<ReingestResponse> {
  return apiPost<ReingestResponse>(`/v1/ingest/reingest/case/${caseId}`, {
    clean: opts?.clean ?? true,
    blob_id: opts?.blobId,
  });
}

export function parseCaseTagInput(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function patchCaseTags(
  id: string,
  body: { add?: string[]; remove?: string[] }
): Promise<CaseRecord> {
  return apiPost<CaseRecord>(`/v1/cases/${id}/tags`, body);
}
