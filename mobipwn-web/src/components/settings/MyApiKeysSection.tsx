import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { listMyApiKeys, type ApiKeyRecord } from "@/lib/apiKeys";
import { RevealableApiKeyField } from "@/components/settings/RevealableApiKeyField";

function formatWhen(iso?: string | null) {
  if (!iso) return "Never";
  return iso.slice(0, 16).replace("T", " ");
}

export function MyApiKeysSection() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setKeys(await listMyApiKeys());
    } catch (e) {
      setMsg(String(e));
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  return (
    <section className="my-api-keys">
      <h3 className="settings-panel__subhead">
        <KeyRound size={14} aria-hidden style={{ marginRight: 6, verticalAlign: -2 }} />
        My API keys
      </h3>
      <p className="muted text-xs" style={{ marginBottom: 12 }}>
        Keys linked to your account by an admin. Click the masked field to reveal your token for MCP or scripts.
      </p>

      {msg && <p className="settings-panel__msg muted text-xs">{msg}</p>}

      {loading ? (
        <p className="muted text-xs">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="muted text-sm">
          No keys linked to <strong>{user.username}</strong> yet. Ask an admin to create one in Settings → API keys.
        </p>
      ) : (
        <ul className="my-api-keys-list">
          {keys.map((k) => (
            <li key={k.id} className="my-api-keys-card card">
              <div className="my-api-keys-card__head">
                <strong>{k.name}</strong>
                <span className="mono muted text-xs">{k.role}</span>
              </div>
              {k.description ? (
                <p className="muted text-xs" style={{ margin: "4px 0 8px" }}>
                  {k.description}
                </p>
              ) : null}
              <RevealableApiKeyField keyId={k.id} keyName={k.name} recoverable={k.token_recoverable} />
              <p className="muted text-xs" style={{ margin: "8px 0 0" }}>
                Last used {formatWhen(k.last_used_at)} · {k.request_count.toLocaleString()} requests
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
