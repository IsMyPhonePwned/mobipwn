import type { AuthUser } from "@/lib/auth";

export type Permission =
  | "search_run"
  | "search_export"
  | "alerts_read"
  | "alerts_write"
  | "rules_read"
  | "rules_write"
  | "cases_read"
  | "cases_write"
  | "ingest_write"
  | "dashboards_read"
  | "dashboards_write"
  | "saved_queries_write"
  | "marketplace_read"
  | "marketplace_write"
  | "settings_read"
  | "settings_write"
  | "users_admin"
  | "data_admin"
  | "health_read"
  | "notifications_write"
  | "llm_use";

const ANALYST: Permission[] = [
  "search_run",
  "search_export",
  "alerts_read",
  "alerts_write",
  "rules_read",
  "rules_write",
  "cases_read",
  "cases_write",
  "ingest_write",
  "dashboards_read",
  "dashboards_write",
  "saved_queries_write",
  "marketplace_read",
  "marketplace_write",
  "health_read",
  "llm_use",
];

const VIEWER: Permission[] = [
  "search_run",
  "search_export",
  "alerts_read",
  "rules_read",
  "cases_read",
  "dashboards_read",
  "marketplace_read",
  "health_read",
];

const ROLE_FALLBACK: Record<string, Permission[]> = {
  analyst: ANALYST,
  viewer: VIEWER,
};

export function permissionsForUser(user: AuthUser | null): Permission[] {
  if (!user) return [];
  if (user.role === "admin") {
    return [
      ...ANALYST,
      "settings_read",
      "settings_write",
      "users_admin",
      "data_admin",
      "notifications_write",
    ];
  }
  if (user.permissions?.length) return user.permissions as Permission[];
  return ROLE_FALLBACK[user.role] ?? [];
}

export function hasPermission(user: AuthUser | null, perm: Permission): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return permissionsForUser(user).includes(perm);
}

/** Minimum permission to access a route (undefined = any signed-in user). */
export const ROUTE_PERMISSIONS: Record<string, Permission | undefined> = {
  "/": undefined,
  "/search": "search_run",
  "/search/guide": "search_run",
  "/search/mpl": "search_run",
  "/guide/architecture": undefined,
  "/guide/agents": undefined,
  "/guide/agents/search": undefined,
  "/dashboards": "dashboards_read",
  "/alerts": "alerts_read",
  "/inbox": "cases_read",
  "/cases/search": "cases_read",
  "/cases": "cases_read",
  "/rules": "rules_read",
  "/r": "rules_read",
  "/a": "alerts_read",
  "/ingest": "ingest_write",
  "/data": "search_run",
  "/mudm": "search_run",
  "/marketplace": "marketplace_read",
  "/collector": "ingest_write",
  "/case-comparison": "cases_read",
  "/bugreport-comparison": "cases_read",
  "/health": "health_read",
  "/settings": undefined,
  "/logs": undefined,
};

export function canAccessRoute(user: AuthUser | null, path: string): boolean {
  if (!user) return false;
  const segments = path.split("/").filter(Boolean);
  const base = segments.length >= 2 ? `/${segments[0]}/${segments[1]}` : `/${segments[0] ?? ""}`;
  const perm = ROUTE_PERMISSIONS[path] ?? ROUTE_PERMISSIONS[base] ?? ROUTE_PERMISSIONS["/" + (segments[0] ?? "")];
  if (!perm) return true;
  return hasPermission(user, perm);
}
