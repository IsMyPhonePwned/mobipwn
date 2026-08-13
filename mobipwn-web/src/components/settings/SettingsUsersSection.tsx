import { useCallback, useEffect, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { createUser, deleteUser, listUsers, updateUser, type AuthUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export function SettingsUsersSection() {
  const { log } = useActivityLog();
  const { user } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [msg, setMsg] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("analyst");
  const [resetPw, setResetPw] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!hasPermission(user, "users_admin")) return;
    try {
      setUsers(await listUsers());
    } catch (e) {
      setMsg(String(e));
    }
  }, [user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user || !hasPermission(user, "users_admin")) {
    return (
      <section className="settings-panel card editor">
        <p className="muted text-sm">Admin access required to manage users.</p>
      </section>
    );
  }

  return (
    <section className="settings-panel card editor">
      <header className="settings-panel__header">
        <h2>Users</h2>
        <p className="muted text-sm">
          Local accounts — <strong>admin</strong>, <strong>analyst</strong>, or <strong>viewer</strong>.
        </p>
      </header>

      {msg && <p className="settings-panel__msg muted text-xs">{msg}</p>}

      <div className="settings-user-form">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="admin">admin</option>
          <option value="analyst">analyst</option>
          <option value="viewer">viewer</option>
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            void createUser(username.trim(), password, role)
              .then(() => {
                log("info", `Create user: ${username.trim()}`, `role: ${role}`);
                setUsername("");
                setPassword("");
                setMsg("User created.");
                return load();
              })
              .catch((e) => setMsg(String(e)))
          }
        >
          Add user
        </button>
      </div>

      <table className="data-table settings-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>MFA</th>
            <th>Reset password</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>
                <select
                  value={u.role}
                  disabled={u.id === user.id}
                  onChange={(e) =>
                    void updateUser(u.id, { role: e.target.value })
                      .then(() => {
                        log("info", `Update user role: ${u.username}`, `role: ${e.target.value}`);
                        return load();
                      })
                      .catch((err) => setMsg(String(err)))
                  }
                >
                  <option value="admin">admin</option>
                  <option value="analyst">analyst</option>
                  <option value="viewer">viewer</option>
                </select>
              </td>
              <td>{u.totp_enabled ? "on" : "off"}</td>
              <td>
                <div className="settings-inline-form settings-inline-form--tight">
                  <input
                    type="password"
                    placeholder="New password"
                    value={resetPw[u.id] ?? ""}
                    onChange={(e) => setResetPw((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const pw = resetPw[u.id]?.trim();
                      if (!pw) return;
                      void updateUser(u.id, { password: pw })
                        .then(() => {
                          log("info", `Reset password: ${u.username}`);
                          setResetPw((prev) => ({ ...prev, [u.id]: "" }));
                          setMsg(`Password updated for ${u.username}.`);
                        })
                        .catch((err) => setMsg(String(err)));
                    }}
                  >
                    Set
                  </button>
                </div>
              </td>
              <td>
                {u.id !== user.id && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (!window.confirm(`Delete user ${u.username}?`)) return;
                      void deleteUser(u.id)
                        .then(() => {
                          log("info", `Delete user: ${u.username}`);
                          return load();
                        })
                        .catch((err) => setMsg(String(err)));
                    }}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
