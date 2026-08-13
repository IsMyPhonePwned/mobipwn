import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Ban, Copy, KeyRound, Plus, Shield, Trash2, Undo2, UserRound } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { listUserDirectory, type UserDirectoryEntry } from "@/lib/auth";
import {
  createApiKey,
  formatBytes,
  listApiKeyUsageByUser,
  listApiKeys,
  revokeApiKey,
  suspendApiKey,
  suspendApiKeysForUser,
  unsuspendApiKey,
  type ApiKeyRecord,
  type ApiKeyUserUsage,
} from "@/lib/apiKeys";
import { hasPermission } from "@/lib/permissions";
import { fetchMcpConfig, fetchMcpStatus } from "@/lib/mcpSettings";
import { RevealableApiKeyField } from "@/components/settings/RevealableApiKeyField";

const ROLES = [
  { id: "analyst", label: "Analyst", hint: "Search, triage, ingest, edit rules & alerts" },
  { id: "admin", label: "Admin", hint: "Full access including settings and users" },
  { id: "viewer", label: "Viewer", hint: "Read-only search and dashboards" },
] as const;

type Props = {
  apiUrl?: string;
  mcpBinaryPath?: string;
  /** Render inside Settings tab (no extra top margin). */
  embedded?: boolean;
  className?: string;
};

function formatWhen(iso?: string | null) {
  if (!iso) return "Never";
  return iso.slice(0, 16).replace("T", " ");
}

function roleBadgeClass(role: string) {
  if (role === "admin") return "api-keys-role api-keys-role--admin";
  if (role === "viewer") return "api-keys-role api-keys-role--viewer";
  return "api-keys-role api-keys-role--analyst";
}

function mcpSnippet(token: string, apiUrl: string, binaryPath: string) {
  return JSON.stringify(
    {
      mcpServers: {
        mobipwn: {
          command: binaryPath,
          env: {
            MOBIPWN_API_URL: apiUrl,
            MOBIPWN_API_KEY: token,
          },
        },
      },
    },
    null,
    2
  );
}

function curlTest(token: string, apiUrl: string) {
  return `curl -s -H 'X-API-Key: ${token}' ${apiUrl.replace(/\/$/, "")}/v1/overview`;
}

export function ApiKeysSection({
  apiUrl: apiUrlProp,
  mcpBinaryPath: mcpBinaryPathProp,
  embedded = false,
  className = "",
}: Props) {
  const [apiUrl, setApiUrl] = useState(apiUrlProp ?? "http://127.0.0.1:3000");
  const [mcpBinaryPath, setMcpBinaryPath] = useState(mcpBinaryPathProp ?? "target/release/mobipwn-mcp");

  useEffect(() => {
    if (apiUrlProp) setApiUrl(apiUrlProp);
  }, [apiUrlProp]);

  useEffect(() => {
    if (mcpBinaryPathProp) setMcpBinaryPath(mcpBinaryPathProp);
  }, [mcpBinaryPathProp]);

  useEffect(() => {
    if (apiUrlProp && mcpBinaryPathProp) return;
    void Promise.all([fetchMcpConfig(), fetchMcpStatus()])
      .then(([cfg, status]) => {
        if (!apiUrlProp && cfg.api_url) setApiUrl(cfg.api_url);
        if (!mcpBinaryPathProp) {
          setMcpBinaryPath(cfg.binary_path || status.binary_path || "target/release/mobipwn-mcp");
        }
      })
      .catch(() => {});
  }, [apiUrlProp, mcpBinaryPathProp]);
  const { log } = useActivityLog();
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [userUsage, setUserUsage] = useState<ApiKeyUserUsage[]>([]);
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("analyst");
  const [linkedUserId, setLinkedUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id && !linkedUserId) setLinkedUserId(user.id);
  }, [user?.id, linkedUserId]);

  useEffect(() => {
    if (!hasPermission(user, "users_admin")) return;
    void listUserDirectory()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [user?.role]);

  const load = useCallback(async () => {
    if (!hasPermission(user, "users_admin")) return;
    setLoading(true);
    try {
      const [nextKeys, nextUsage] = await Promise.all([listApiKeys(), listApiKeyUsageByUser()]);
      setKeys(nextKeys);
      setUserUsage(nextUsage);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const totalRequests = keys.reduce((n, k) => n + (k.request_count ?? 0), 0);
    const totalBytes = keys.reduce((n, k) => n + (k.response_bytes ?? 0), 0);
    const activeRecently = keys.filter((k) => k.last_used_at && !k.suspended_at).length;
    const suspended = keys.filter((k) => k.suspended_at).length;
    return { count: keys.length, totalRequests, totalBytes, activeRecently, suspended };
  }, [keys]);

  const copyText = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 2000);
  };

  if (!user || !hasPermission(user, "users_admin")) return null;

  const onCreate = async () => {
    if (!name.trim()) {
      setMsg("Name is required — e.g. lmstudio-mcp or cursor.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const res = await createApiKey({
        name: name.trim(),
        role,
        description: description.trim(),
        user_id: linkedUserId || null,
      });
      log("info", `Create API key: ${res.key.name}`, `role: ${role}`);
      setCreated({ name: res.key.name, token: res.token });
      setName("");
      setDescription("");
      setMsg(`Created “${res.key.name}”.`);
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={`card editor api-keys-section${embedded ? " api-keys-section--embedded" : ""} ${className}`.trim()}
    >
      <header className="api-keys-header">
        <div className="api-keys-header__title">
          <span className="api-keys-header__icon" aria-hidden>
            <KeyRound size={18} />
          </span>
          <div>
            <h3 className="text-sm font-medium" style={{ margin: 0 }}>
              API keys
            </h3>
            <p className="muted text-xs" style={{ margin: "4px 0 0" }}>
              Named tokens for MCP and scripts — link each key to a user for audits, assignee filters, and{" "}
              <code className="mono">@me</code> scoping.
            </p>
          </div>
        </div>
        <div className="api-keys-stats">
          <div className="stat-card api-keys-stat">
            <span className="api-keys-stat__label">Active keys</span>
            <span className="stat-value">{stats.count}</span>
          </div>
          <div className="stat-card api-keys-stat">
            <span className="api-keys-stat__label">Used recently</span>
            <span className="stat-value">{stats.activeRecently}</span>
          </div>
          <div className="stat-card api-keys-stat">
            <span className="api-keys-stat__label">Total requests</span>
            <span className="stat-value">{stats.totalRequests.toLocaleString()}</span>
          </div>
          <div className="stat-card api-keys-stat">
            <span className="api-keys-stat__label">Response data</span>
            <span className="stat-value">{formatBytes(stats.totalBytes)}</span>
          </div>
          <div className="stat-card api-keys-stat">
            <span className="api-keys-stat__label">Suspended</span>
            <span className="stat-value">{stats.suspended}</span>
          </div>
        </div>
      </header>

      {userUsage.length > 0 && (
        <div className="api-keys-user-usage card">
          <h4 className="api-keys-list__title">
            <UserRound size={14} aria-hidden />
            Usage by linked user
          </h4>
          <p className="muted text-xs" style={{ margin: "0 0 10px" }}>
            Sorted by response volume — also logged on each API key request (
            <code className="mono">api key request</code> in API logs).
          </p>
          <div className="api-keys-user-table-wrap">
            <table className="api-keys-user-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Keys</th>
                  <th>Requests</th>
                  <th>Data out</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {userUsage.map((row) => (
                  <tr key={row.user_id ?? row.username}>
                    <td>
                      <strong>{row.username}</strong>
                      {row.suspended_keys > 0 && row.suspended_keys < row.active_keys ? (
                        <span className="api-keys-partial-suspend muted text-xs">
                          {" "}
                          · {row.suspended_keys} suspended
                        </span>
                      ) : null}
                    </td>
                    <td className="mono">{row.active_keys}</td>
                    <td className="mono">{row.request_count.toLocaleString()}</td>
                    <td className="mono">{formatBytes(row.response_bytes)}</td>
                    <td className="mono">{formatWhen(row.last_used_at)}</td>
                    <td className="api-keys-user-actions">
                      {row.user_id ? (
                        row.suspended_keys >= row.active_keys ? (
                          <span className="muted text-xs">All suspended</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm api-keys-suspend-user"
                            onClick={() => {
                              if (
                                !confirm(
                                  `Suspend all MCP/API keys for “${row.username}”? Clients get 401 until unsuspended.`
                                )
                              ) {
                                return;
                              }
                              void suspendApiKeysForUser(row.user_id!)
                                .then((res) => {
                                  log("info", `Suspend all API keys: ${row.username}`, `${res.suspended} key(s)`);
                                  setMsg(`Suspended ${res.suspended} key(s) for “${row.username}”.`);
                                  return load();
                                })
                                .catch((e) => setMsg(String(e)));
                            }}
                          >
                            <Ban size={14} />
                            Suspend all
                          </button>
                        )
                      ) : (
                        <span className="muted text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {msg && <p className="api-keys-msg muted text-xs">{msg}</p>}

      {created && (
        <div className="api-keys-reveal">
          <div className="api-keys-reveal__head">
            <Shield size={16} aria-hidden />
            <div>
              <strong>New key: {created.name}</strong>
              <p className="muted text-xs" style={{ margin: "4px 0 0" }}>
                Copy it now — it won&apos;t be shown again. Paste into LM Studio / Cursor MCP config.
              </p>
            </div>
          </div>
          <label className="api-keys-field">
            <span className="api-keys-field__label">Token</span>
            <div className="api-keys-copy-row">
              <code className="mono api-keys-token">{created.token}</code>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void copyText("token", created.token)}
              >
                <Copy size={14} />
                {copied === "token" ? "Copied" : "Copy"}
              </button>
            </div>
          </label>
          <label className="api-keys-field">
            <span className="api-keys-field__label">Test with curl</span>
            <div className="api-keys-copy-row">
              <pre className="mono api-keys-snippet">{curlTest(created.token, apiUrl)}</pre>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => void copyText("curl", curlTest(created.token, apiUrl))}
              >
                {copied === "curl" ? "Copied" : "Copy"}
              </button>
            </div>
          </label>
          <label className="api-keys-field">
            <span className="api-keys-field__label">LM Studio / Cursor MCP snippet</span>
            <pre className="doc-guide-snippet__pre mono api-keys-mcp-pre">
              {mcpSnippet(created.token, apiUrl, mcpBinaryPath)}
            </pre>
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginTop: 8 }}
              onClick={() =>
                void copyText("mcp", mcpSnippet(created.token, apiUrl, mcpBinaryPath))
              }
            >
              <Copy size={14} />
              {copied === "mcp" ? "Copied MCP config" : "Copy MCP config"}
            </button>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreated(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="api-keys-layout">
        <div className="api-keys-create card">
          <h4 className="api-keys-create__title">
            <Plus size={14} aria-hidden />
            Create key
          </h4>
          <label className="api-keys-field">
            <span className="api-keys-field__label">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="lmstudio-mcp"
              onKeyDown={(e) => e.key === "Enter" && void onCreate()}
            />
          </label>
          <label className="api-keys-field">
            <span className="api-keys-field__label">Linked user</span>
            <select
              value={linkedUserId}
              onChange={(e) => {
                const id = e.target.value;
                setLinkedUserId(id);
                const picked = users.find((u) => u.id === id);
                if (picked && !name.trim()) {
                  setName(`${picked.username}-mcp`);
                }
              }}
            >
              <option value="">— Service / no user —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                  {u.id === user?.id ? " (you)" : ""}
                </option>
              ))}
            </select>
            <p className="muted text-xs" style={{ margin: "6px 0 0" }}>
              MCP and API calls act as this user in case wall, alerts, and maintainer filters.
            </p>
          </label>
          <label className="api-keys-field">
            <span className="api-keys-field__label">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — who or what uses this key"
            />
          </label>
          <div className="api-keys-field">
            <span className="api-keys-field__label">Role</span>
            <div className="api-keys-role-chips">
              {ROLES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`api-keys-role-chip${role === r.id ? " api-keys-role-chip--active" : ""}`}
                  onClick={() => setRole(r.id)}
                  title={r.hint}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="muted text-xs" style={{ margin: "6px 0 0" }}>
              {ROLES.find((r) => r.id === role)?.hint}
            </p>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onCreate()}>
            {busy ? "Creating…" : "Create API key"}
          </button>
          <p className="muted text-xs" style={{ marginTop: 12, marginBottom: 0 }}>
            Send as <code className="mono">X-API-Key</code> or{" "}
            <code className="mono">Authorization: Bearer</code>.
          </p>
        </div>

        <div className="api-keys-list">
          <h4 className="api-keys-list__title">
            <Activity size={14} aria-hidden />
            Active keys
          </h4>
          {loading ? (
            <p className="muted text-xs">Loading…</p>
          ) : keys.length === 0 ? (
            <div className="api-keys-empty">
              <KeyRound size={28} strokeWidth={1.25} className="api-keys-empty__icon" />
              <p className="text-sm" style={{ margin: "0 0 6px" }}>
                No API keys yet
              </p>
              <p className="muted text-xs" style={{ margin: 0 }}>
                Create one for LM Studio, Cursor, or CI — each client gets its own name and usage stats.
              </p>
            </div>
          ) : (
            <ul className="api-keys-cards">
              {keys.map((k) => (
                <li key={k.id} className={`api-keys-card${k.suspended_at ? " api-keys-card--suspended" : ""}`}>
                  <div className="api-keys-card__head">
                    <div>
                      <div className="api-keys-card__name-row">
                        <span
                          className={`api-keys-activity${k.last_used_at && !k.suspended_at ? " api-keys-activity--live" : ""}`}
                          title={
                            k.suspended_at
                              ? "Suspended"
                              : k.last_used_at
                                ? "Used at least once"
                                : "Never used"
                          }
                        />
                        <strong>{k.name}</strong>
                        <span className={roleBadgeClass(k.role)}>{k.role}</span>
                        {k.suspended_at ? (
                          <span className="api-keys-suspended-badge">Suspended</span>
                        ) : null}
                      </div>
                      {k.user_username ? (
                        <p className="api-keys-linked-user muted text-xs" style={{ margin: "4px 0 0" }}>
                          <UserRound size={12} aria-hidden />
                          Acts as <strong>{k.user_username}</strong>
                        </p>
                      ) : null}
                      {k.description ? (
                        <p className="muted text-xs" style={{ margin: "4px 0 0" }}>
                          {k.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="api-keys-card__actions">
                      {k.suspended_at ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          title={`Unsuspend ${k.name}`}
                          onClick={() => {
                            void unsuspendApiKey(k.id)
                              .then(() => {
                                log("info", `Unsuspend API key: ${k.name}`);
                                setMsg(`Unsuspended “${k.name}”.`);
                                return load();
                              })
                              .catch((e) => setMsg(String(e)));
                          }}
                        >
                          <Undo2 size={14} />
                          Unsuspend
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm api-keys-suspend"
                          title={`Suspend ${k.name}`}
                          onClick={() => {
                            if (
                              !confirm(
                                `Suspend API key “${k.name}”? MCP clients using it will get 401 until unsuspended.`
                              )
                            ) {
                              return;
                            }
                            void suspendApiKey(k.id)
                              .then(() => {
                                log("info", `Suspend API key: ${k.name}`);
                                setMsg(`Suspended “${k.name}”.`);
                                return load();
                              })
                              .catch((e) => setMsg(String(e)));
                          }}
                        >
                          <Ban size={14} />
                          Suspend
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm api-keys-revoke"
                        title={`Revoke ${k.name}`}
                        onClick={() => {
                          if (!confirm(`Revoke API key “${k.name}”? Clients using it will get 401.`)) return;
                          void revokeApiKey(k.id)
                            .then(() => {
                              log("info", `Revoke API key: ${k.name}`);
                              setMsg(`Revoked “${k.name}”.`);
                              return load();
                            })
                            .catch((e) => setMsg(String(e)));
                        }}
                      >
                        <Trash2 size={14} />
                        Revoke
                      </button>
                    </div>
                  </div>
                  <RevealableApiKeyField
                    keyId={k.id}
                    keyName={k.name}
                    recoverable={k.token_recoverable ?? false}
                  />
                  <dl className="api-keys-meta">
                    <div>
                      <dt>Last used</dt>
                      <dd className="mono">{formatWhen(k.last_used_at)}</dd>
                    </div>
                    <div>
                      <dt>Last IP</dt>
                      <dd className="mono">{k.last_used_ip ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Requests</dt>
                      <dd>{k.request_count.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Data out</dt>
                      <dd>{formatBytes(k.response_bytes ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Linked user</dt>
                      <dd>{k.user_username ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>
                        {formatWhen(k.created_at)}
                        {k.created_by_username ? (
                          <span className="muted"> · {k.created_by_username}</span>
                        ) : null}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
