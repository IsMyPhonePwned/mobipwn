import { parseApiResponse } from "@/lib/response";

const TOKEN_KEY = "mobipwn_session";

export type AuthUser = {
  id: string;
  username: string;
  role: string;
  totp_enabled: boolean;
  created_at?: string;
  permissions?: string[];
};

export type UserDirectoryEntry = {
  id: string;
  username: string;
};

export type AuthStatus = {
  require_auth: boolean;
};

export function getSessionToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSessionToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/v1/auth/status");
  return parseApiResponse<AuthStatus>(res);
}

export async function login(username: string, password: string) {
  const res = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await parseApiResponse<
    | { token: string; user: AuthUser }
    | { mfa_required: boolean; challenge_id: string }
  >(res);
  return data;
}

export async function verifyMfa(challengeId: string, code: string) {
  const res = await fetch("/api/v1/auth/mfa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });
  return parseApiResponse<{ token: string; user: AuthUser }>(res);
}

export async function fetchMe(): Promise<AuthUser | null> {
  const token = getSessionToken();
  if (!token) return null;
  const res = await fetch("/api/v1/auth/me", { headers: authHeaders() });
  if (res.status === 401) {
    setSessionToken(null);
    return null;
  }
  if (!res.ok) return null;
  return parseApiResponse<AuthUser>(res);
}

export async function logout() {
  await fetch("/api/v1/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
  setSessionToken(null);
}

export async function setupTotp() {
  const res = await fetch("/api/v1/auth/totp/setup", { method: "POST", headers: authHeaders() });
  return parseApiResponse<{ secret: string; uri: string }>(res);
}

export async function enableTotp(code: string) {
  const res = await fetch("/api/v1/auth/totp/enable", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim() }),
  });
  if (res.status === 400) throw new Error("Invalid authenticator code — try the current 6-digit code");
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}

export async function disableTotp() {
  const res = await fetch("/api/v1/auth/totp/disable", { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
}

export async function listUsers() {
  return parseApiResponse<AuthUser[]>(
    await fetch("/api/v1/auth/users", { headers: authHeaders() })
  );
}

export async function listUserDirectory() {
  return parseApiResponse<UserDirectoryEntry[]>(
    await fetch("/api/v1/auth/users/directory", { headers: authHeaders() })
  );
}

export async function createUser(username: string, password: string, role: string) {
  const res = await fetch("/api/v1/auth/users", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role }),
  });
  return parseApiResponse<AuthUser>(res);
}

export async function updateUser(id: string, patch: { role?: string; password?: string }) {
  const res = await fetch(`/api/v1/auth/users/${id}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return parseApiResponse<AuthUser>(res);
}

export async function deleteUser(id: string) {
  const res = await fetch(`/api/v1/auth/users/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (res.status === 204) return;
  await parseApiResponse(res);
}

/** Attach session Bearer token to all `/api/*` requests. */
export function installAuthFetchInterceptor() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __mobipwnFetchPatched?: boolean };
  if (w.__mobipwnFetchPatched) return;
  w.__mobipwnFetchPatched = true;
  const native = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (url.startsWith("/api/")) {
      init = {
        ...init,
        headers: {
          ...authHeaders(),
          ...(init?.headers instanceof Headers
            ? Object.fromEntries(init.headers.entries())
            : init?.headers ?? {}),
        },
      };
    }
    return native(input, init);
  };
}
