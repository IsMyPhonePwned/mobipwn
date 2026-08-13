import { useState } from "react";
import { Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { revealApiKey } from "@/lib/apiKeys";

type Props = {
  keyId: string;
  recoverable: boolean;
  label?: string;
  keyName?: string;
};

export function RevealableApiKeyField({ keyId, recoverable, label = "API token", keyName }: Props) {
  const { log } = useActivityLog();
  const [visible, setVisible] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const hide = () => {
    setVisible(false);
    setToken(null);
    setError("");
  };

  const reveal = async () => {
    if (visible) {
      hide();
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await revealApiKey(keyId);
      log("info", `Reveal API key: ${keyName ?? keyId.slice(0, 8)}`);
      setToken(res.token);
      setVisible(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (!recoverable) {
    return (
      <div className="api-key-reveal api-key-reveal--unavailable">
        <span className="api-key-reveal__label muted text-xs">{label}</span>
        <span className="muted text-xs">Not stored — create a new key to enable reveal</span>
      </div>
    );
  }

  return (
    <div className="api-key-reveal">
      <span className="api-key-reveal__label muted text-xs">{label}</span>
      <div className="api-key-reveal__row">
        <div
          className={`api-key-reveal__value mono${visible ? " api-key-reveal__value--visible" : ""}`}
          onClick={() => {
            if (!visible && !loading) void reveal();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !visible && !loading) void reveal();
          }}
          role="button"
          tabIndex={0}
          title={visible ? token ?? "" : "Click to reveal"}
        >
          {loading ? (
            <span className="api-key-reveal__placeholder">
              <Loader2 size={14} className="api-key-reveal__spin" aria-hidden />
              Loading…
            </span>
          ) : visible && token ? (
            token
          ) : (
            <span className="api-key-reveal__placeholder">••••••••••••••••••••••••</span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-sm btn-ghost api-key-reveal__toggle"
          onClick={() => void reveal()}
          disabled={loading}
          title={visible ? "Hide token" : "Show token"}
        >
          {visible ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          {visible ? "Hide" : "Show"}
        </button>
        {visible && token ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copy()}>
            <Copy size={14} aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      {error ? <p className="api-key-reveal__error muted text-xs">{error}</p> : null}
    </div>
  );
}
