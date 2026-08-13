import { parseApiResponse } from "@/lib/response";
import { authHeaders } from "@/lib/auth";

function mergeHeaders(init?: RequestInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...authHeaders(),
    ...init?.headers,
  };
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: mergeHeaders(),
    body: JSON.stringify(body),
  });
  return parseApiResponse<T>(res);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: mergeHeaders(init),
  });
  if (res.status === 204) return undefined as T;
  return parseApiResponse<T>(res);
}
