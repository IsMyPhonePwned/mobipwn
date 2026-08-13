import { apiFetch, apiPost } from "@/lib/api";

type DeleteOpts = {
  author?: string;
  reason?: string;
};

export async function deleteAlert(id: string, opts?: DeleteOpts) {
  const params = new URLSearchParams();
  if (opts?.author) params.set("author", opts.author);
  if (opts?.reason) params.set("reason", opts.reason);
  const q = params.toString();
  const res = await fetch(`/api/v1/alerts/${id}${q ? `?${q}` : ""}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export async function deleteAlerts(ids: string[], opts?: DeleteOpts) {
  const res = await fetch("/api/v1/alerts/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, author: opts?.author, reason: opts?.reason }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data as { deleted: number; requested?: number };
}

export async function deleteAlertsByFilter(
  filter: { status?: string; rule_id?: string },
  opts?: DeleteOpts
) {
  const res = await fetch("/api/v1/alerts/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...filter, author: opts?.author, reason: opts?.reason }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data as { deleted: number; requested?: number };
}

export type AlertDeletionAuditSummary = {
  id: string;
  alert_id: string;
  deleted_at: string;
  deleted_by: string;
  reason?: string | null;
  batch_id?: string | null;
  rule_name?: string | null;
  title?: string | null;
  status?: string | null;
  events_count: number;
};

export async function listAlertDeletionAudit(limit = 50) {
  return apiFetch<AlertDeletionAuditSummary[]>(`/v1/alerts/deletion-audit?limit=${limit}`);
}

export type AlertActivityEntry = {
  id: string;
  alert_id: string;
  kind: string;
  body: string;
  author: string;
  created_at: string;
  rule_name?: string | null;
  alert_title?: string | null;
  alert_status?: string | null;
  source: string;
  alert_exists: boolean;
};

export async function listAlertActivity(opts?: {
  limit?: number;
  alert_id?: string;
  kind?: string;
}) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.alert_id) params.set("alert_id", opts.alert_id);
  if (opts?.kind) params.set("kind", opts.kind);
  const q = params.toString();
  return apiFetch<AlertActivityEntry[]>(`/v1/alerts/activity${q ? `?${q}` : ""}`);
}

const KIND_LABELS: Record<string, string> = {
  status: "Status change",
  comment: "Comment",
  assignee: "Assignee",
  tags: "Tags",
  dismissed: "Dismissed",
  restored: "Restored",
  deleted: "Deleted",
};

export function alertActivityKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export async function dismissAlert(id: string) {
  return apiPost(`/v1/alerts/${id}`, { dismissed: true });
}

export async function restoreAlert(id: string) {
  return apiPost(`/v1/alerts/${id}`, { dismissed: false });
}

export async function patchAlertStatus(id: string, status: string, comment?: string) {
  return apiPost(`/v1/alerts/${id}`, {
    status,
    ...(comment?.trim() ? { comment: comment.trim() } : {}),
  });
}
