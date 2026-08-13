import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  authHeaders,
  fetchAuthStatus,
  fetchMe,
  getSessionToken,
  installAuthFetchInterceptor,
  logout as logoutApi,
  setSessionToken,
  type AuthUser,
} from "@/lib/auth";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  requireAuth: boolean;
  loginSuccess: (token: string, user: AuthUser) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  headers: () => Record<string, string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [requireAuth, setRequireAuth] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await fetchAuthStatus();
      setRequireAuth(status.require_auth);
      if (status.require_auth && getSessionToken()) {
        const me = await fetchMe();
        setUser(me);
      } else if (!status.require_auth) {
        setUser(null);
      } else {
        setUser(null);
      }
    } catch {
      setRequireAuth(true);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    installAuthFetchInterceptor();
    void refresh();
  }, [refresh]);

  const loginSuccess = useCallback((token: string, u: AuthUser) => {
    setSessionToken(token);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await logoutApi();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      requireAuth,
      loginSuccess,
      logout,
      refresh,
      headers: authHeaders,
    }),
    [user, loading, requireAuth, loginSuccess, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
