import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessRoute } from "@/lib/permissions";

export function RequirePermission({ children }: { children: React.ReactNode }) {
  const { user, loading, requireAuth } = useAuth();
  const location = useLocation();

  if (loading) return <p className="muted p-4">Loading…</p>;
  if (requireAuth && !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (user && !canAccessRoute(user, location.pathname)) {
    return (
      <div className="card editor" style={{ margin: 24 }}>
        <h2>Access denied</h2>
        <p className="muted">
          Your role (<strong>{user.role}</strong>) does not have access to this page.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
