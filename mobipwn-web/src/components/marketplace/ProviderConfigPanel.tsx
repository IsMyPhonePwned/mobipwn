import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  maskConfigForDisplay,
  providerConfigFields,
  type EnrichmentProvider,
} from "@/lib/enrichment";

type Props = {
  provider: EnrichmentProvider;
  onSaved: () => void;
};

export function ProviderConfigPanel({ provider, onSaved }: Props) {
  const fields = useMemo(() => providerConfigFields(provider.slug), [provider.slug]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const cfg = (provider.config ?? {}) as Record<string, unknown>;
    const next: Record<string, string> = {};
    for (const f of fields) {
      const v = cfg[f.key];
      next[f.key] = v == null ? "" : String(v);
    }
    setDraft(next);
    setMessage("");
    setError("");
  }, [open, provider.id, provider.config, provider.slug, fields]);

  const save = useCallback(async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const config: Record<string, unknown> = { ...(provider.config as object) };
      for (const f of fields) {
        const raw = draft[f.key]?.trim() ?? "";
        if (f.type === "number") {
          const n = parseInt(raw, 10);
          if (!Number.isNaN(n)) config[f.key] = n;
          else delete config[f.key];
        } else if (raw) {
          config[f.key] = raw;
        } else if (f.key === "api_key") {
          /* keep existing key if user left password blank */
        } else {
          delete config[f.key];
        }
      }
      if (provider.slug === "virustotal" && !draft.api_key?.trim()) {
        const existing = (provider.config as Record<string, unknown>)?.api_key;
        if (typeof existing === "string" && existing) config.api_key = existing;
      }
      const res = await fetch(`/api/v1/marketplace/providers/${provider.id}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Configuration saved.");
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [draft, fields, onSaved, provider]);

  const test = useCallback(async () => {
    setTesting(true);
    setError("");
    setMessage("");
    try {
      if (provider.slug === "virustotal" && draft.api_key?.trim()) {
        await fetch(`/api/v1/marketplace/providers/${provider.id}/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: { ...(provider.config as object), api_key: draft.api_key.trim() },
          }),
        });
      }
      const res = await fetch(`/api/v1/marketplace/providers/${provider.id}/test`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; ok?: boolean };
      if (!res.ok) throw new Error(data.message ?? (await res.text()));
      setMessage(data.message ?? "Connection OK");
    } catch (e) {
      setError(String(e));
    } finally {
      setTesting(false);
    }
  }, [draft.api_key, provider]);

  if (!fields.length) return null;

  const masked = maskConfigForDisplay(provider.slug, (provider.config ?? {}) as Record<string, unknown>);

  return (
    <div className="provider-config">
      <Button variant="ghost" size="sm" type="button" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide config" : "Configure"}
      </Button>
      {!open && provider.slug === "virustotal" && masked.api_key != null && (
        <span className="muted provider-config-hint">API key set</span>
      )}
      {open && (
        <div className="provider-config-form">
          {fields.map((f) => (
            <label key={f.key} className="provider-config-field">
              <span>{f.label}</span>
              <Input
                type={f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
                value={draft[f.key] ?? ""}
                placeholder={
                  f.type === "password" && masked.api_key
                    ? String(masked.api_key)
                    : f.placeholder
                }
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                autoComplete={f.type === "password" ? "off" : undefined}
              />
            </label>
          ))}
          <div className="provider-config-actions">
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {provider.slug === "virustotal" && (
              <Button size="sm" variant="secondary" onClick={() => void test()} disabled={testing}>
                {testing ? "Testing…" : "Test API key"}
              </Button>
            )}
          </div>
          {message && <p className="provider-config-ok">{message}</p>}
          {error && <p className="provider-config-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
