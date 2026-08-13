import { authHeaders } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { parseApiResponse } from "@/lib/response";

/** Raw file retained after Collect or mobile Ingest submission. */
export type StoredBlob = {
  id: string;
  ingest_job_id?: string | null;
  source: string;
  platform: string;
  file_name: string;
  file_hash: string;
  file_size: number;
  storage_path: string;
  case_user?: string | null;
  ingest_tags: string[];
  origin: string;
  analyzed: boolean;
  created_at: string;
  case_id?: string | null;
  case_title?: string | null;
};

type BlobListResponse = {
  blobs: StoredBlob[];
};

type ReingestResponse = {
  ingested: number;
  deduplicated: boolean;
  job_id?: string | null;
  status?: string | null;
  events_cleared?: number | null;
  blob_id?: string | null;
};

export type { ReingestResponse };

type StoreBlobResponse = {
  id: string;
  source: string;
  file_name: string;
  file_size: number;
  analyzed: boolean;
};

export async function storeCollectBlob(params: {
  platform: "android" | "ios";
  source: string;
  fileName: string;
  data: Blob | Uint8Array;
  user?: string;
  origin?: string;
}): Promise<StoreBlobResponse> {
  const url = new URL("/api/v1/collect/blobs", window.location.origin);
  url.searchParams.set("platform", params.platform);
  url.searchParams.set("source", params.source);
  url.searchParams.set("file_name", params.fileName);
  if (params.user?.trim()) url.searchParams.set("user", params.user.trim());
  if (params.origin?.trim()) url.searchParams.set("origin", params.origin.trim());

  const body =
    params.data instanceof Blob ? params.data : new Blob([params.data as BlobPart]);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/octet-stream" },
    body,
  });
  return parseApiResponse<StoreBlobResponse>(res);
}

export async function listStoredBlobs(opts?: {
  source?: string;
  limit?: number;
}): Promise<StoredBlob[]> {
  const params = new URLSearchParams();
  if (opts?.source?.trim()) params.set("source", opts.source.trim());
  if (opts?.limit) params.set("limit", String(opts.limit));
  const q = params.toString();
  const data = await apiFetch<BlobListResponse>(`/v1/collect/blobs${q ? `?${q}` : ""}`);
  return data.blobs;
}

export async function reingestStoredBlob(
  id: string,
  opts?: { clean?: boolean }
): Promise<ReingestResponse> {
  const clean = opts?.clean ?? true;
  const q = `?clean=${clean ? "true" : "false"}`;
  return apiFetch<ReingestResponse>(`/v1/collect/blobs/${id}/reingest${q}`, { method: "POST" });
}

/** Store a raw archive for a source, then re-parse it into ClickHouse. */
export async function storeAndReingestBlob(params: {
  platform: "android" | "ios";
  source: string;
  fileName: string;
  data: Blob | File;
  user?: string;
  clean?: boolean;
}): Promise<ReingestResponse> {
  const stored = await storeCollectBlob({
    platform: params.platform,
    source: params.source,
    fileName: params.fileName,
    data: params.data,
    user: params.user,
    origin: "case-reingest",
  });
  return reingestStoredBlob(stored.id, { clean: params.clean ?? true });
}

export async function deleteStoredBlob(id: string): Promise<void> {
  const res = await fetch(`/api/v1/collect/blobs/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (res.status === 204) return;
  await parseApiResponse(res);
}

export async function downloadStoredBlob(id: string, fileName: string): Promise<void> {
  const res = await fetch(`/api/v1/collect/blobs/${id}/download`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    await parseApiResponse(res);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
