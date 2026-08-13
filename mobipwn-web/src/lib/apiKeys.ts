import { parseApiResponse } from "@/lib/response";
import { authHeaders } from "@/lib/auth";

export type ApiKeyRecord = {
  id: string;
  name: string;
  role: string;
  description: string;
  created_at: string;
  last_used_at?: string | null;
  last_used_ip?: string | null;
  request_count: number;
  response_bytes: number;
  suspended_at?: string | null;
  token_recoverable: boolean;
  user_id?: string | null;
  user_username?: string | null;
  created_by_username?: string | null;
};

export type ApiKeyUserUsage = {
  user_id?: string | null;
  username: string;
  active_keys: number;
  suspended_keys: number;
  request_count: number;
  response_bytes: number;
  last_used_at?: string | null;
};

export type CreateApiKeyResponse = {
  key: ApiKeyRecord;
  token: string;
};

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 10 || i === 0 ? value.toFixed(i === 0 ? 0 : 1) : value.toFixed(2)} ${units[i]}`;
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  return parseApiResponse<ApiKeyRecord[]>(
    await fetch("/api/v1/auth/api-keys", { headers: authHeaders() })
  );
}

export async function listMyApiKeys(): Promise<ApiKeyRecord[]> {
  return parseApiResponse<ApiKeyRecord[]>(
    await fetch("/api/v1/auth/api-keys/mine", { headers: authHeaders() })
  );
}

export async function revealApiKey(id: string): Promise<{ token: string }> {
  return parseApiResponse<{ token: string }>(
    await fetch(`/api/v1/auth/api-keys/${id}/reveal`, { headers: authHeaders() })
  );
}

export async function listApiKeyUsageByUser(): Promise<ApiKeyUserUsage[]> {
  return parseApiResponse<ApiKeyUserUsage[]>(
    await fetch("/api/v1/auth/api-keys/usage-by-user", { headers: authHeaders() })
  );
}

export async function createApiKey(body: {
  name: string;
  role: string;
  description?: string;
  user_id?: string | null;
}): Promise<CreateApiKeyResponse> {
  const res = await fetch("/api/v1/auth/api-keys", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseApiResponse<CreateApiKeyResponse>(res);
}

export async function revokeApiKey(id: string): Promise<void> {
  const res = await fetch(`/api/v1/auth/api-keys/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (res.status === 204) return;
  await parseApiResponse(res);
}

export async function suspendApiKey(id: string): Promise<void> {
  const res = await fetch(`/api/v1/auth/api-keys/${id}/suspend`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (res.status === 204) return;
  await parseApiResponse(res);
}

export async function unsuspendApiKey(id: string): Promise<void> {
  const res = await fetch(`/api/v1/auth/api-keys/${id}/unsuspend`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (res.status === 204) return;
  await parseApiResponse(res);
}

export async function suspendApiKeysForUser(userId: string): Promise<{ suspended: number }> {
  return parseApiResponse<{ suspended: number }>(
    await fetch(`/api/v1/auth/api-keys/suspend-user/${userId}`, {
      method: "POST",
      headers: authHeaders(),
    })
  );
}
