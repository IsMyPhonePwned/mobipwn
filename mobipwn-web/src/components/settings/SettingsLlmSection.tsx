import { useEffect, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLlm } from "@/contexts/LlmContext";
import { apiFetch } from "@/lib/api";
import { detectLlmPresetId, isLocalLlmUrl, LLM_PRESETS, type LlmPreset } from "@/lib/llmPresets";

export function SettingsLlmSection() {
  const { log } = useActivityLog();
  const { refreshStatus } = useLlm();
  const [llmUrl, setLlmUrl] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [llmKeySet, setLlmKeySet] = useState(false);
  const [llmPreset, setLlmPreset] = useState("custom");
  const [llmStatus, setLlmStatus] = useState<{
    configured: boolean;
    model: string;
    api_url?: string;
    local?: boolean;
  } | null>(null);
  const [msg, setMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latency_ms?: number;
    reply_preview?: string;
    error?: string;
    hint?: string;
    endpoint?: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/v1/settings/llm_config")
      .then((r) => r.json())
      .then((v: { api_url?: string; model?: string; api_key_set?: boolean }) => {
        const url = v.api_url ?? "";
        setLlmUrl(url);
        setLlmModel(v.model ?? "");
        setLlmPreset(detectLlmPresetId(url));
        setLlmKeySet(Boolean(v.api_key_set));
      })
      .catch(() => {});
    apiFetch<{ configured: boolean; model: string; api_url?: string; local?: boolean }>("/v1/llm/status")
      .then(setLlmStatus)
      .catch(() => setLlmStatus(null));
  }, []);

  const applyLlmPreset = (preset: LlmPreset) => {
    setLlmPreset(preset.id);
    if (preset.id !== "custom") {
      setLlmUrl(preset.apiUrl);
      setLlmModel(preset.model);
      if (!preset.keyRequired) setLlmKey("");
    }
  };

  const testLlm = async () => {
    const url = llmUrl.trim();
    const model = llmModel.trim();
    if (!url || !model) {
      setTestResult({ ok: false, error: "Base URL and model are required before testing." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    log("info", "Test LLM connection");
    try {
      const res = await apiFetch<{
        ok: boolean;
        latency_ms: number;
        reply_preview?: string;
        error?: string;
        hint?: string;
        endpoint?: string;
      }>("/v1/llm/test", {
        method: "POST",
        body: JSON.stringify({
          api_url: url,
          model,
          api_key: llmKey.trim() || (llmKeySet ? "********" : ""),
        }),
      });
      setTestResult(res);
      if (res.ok) {
        log("info", "LLM test OK", res.reply_preview?.slice(0, 80) ?? "");
      } else {
        log("error", "LLM test failed", res.error ?? "");
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setTestResult({ ok: false, error: err });
      log("error", "LLM test failed", err);
    } finally {
      setTesting(false);
    }
  };

  const saveLlm = async () => {
    if (!llmUrl.trim() || !llmModel.trim()) {
      setMsg("Base URL and model are required.");
      return;
    }
    log("info", "Save settings: llm_config");
    try {
      await fetch("/api/v1/settings/llm_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_url: llmUrl.trim(),
          model: llmModel.trim(),
          api_key: llmKey.trim() || (llmKeySet ? "********" : ""),
        }),
      });
      setLlmKey("");
      setLlmKeySet(llmKey.trim().length > 0 || llmKeySet);
      const status = await apiFetch<{
        configured: boolean;
        model: string;
        api_url?: string;
        local?: boolean;
      }>("/v1/llm/status");
      setLlmStatus(status);
      await refreshStatus();
      setMsg("LLM settings saved.");
    } catch (e) {
      setMsg(String(e));
      log("error", "Save settings failed: llm_config", String(e));
    }
  };

  return (
    <section className="settings-panel card editor">
      <header className="settings-panel__header">
        <h2>LLM assistant</h2>
        <p className="muted text-sm">
          OpenAI-compatible chat for mPL hunts and in-app triage — local (Ollama, LM Studio) or hosted APIs.
        </p>
      </header>

      {msg && <p className="settings-panel__msg muted text-xs">{msg}</p>}

      {llmStatus?.configured ? (
        <p className="settings-status-pill muted text-xs">
          Connected · {llmStatus.local ? "local" : "remote"} ·{" "}
          <code className="mono">{llmStatus.model}</code>
        </p>
      ) : (
        <p className="settings-status-pill muted text-xs">Not configured — pick a preset below.</p>
      )}

      <div className="settings-chip-row">
        {LLM_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`btn btn-sm${llmPreset === preset.id ? " btn-primary" : ""}`}
            onClick={() => applyLlmPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="muted text-xs">
        {LLM_PRESETS.find((p) => p.id === llmPreset)?.hint ?? "POST {base_url}/chat/completions"}
      </p>

      <div className="settings-field-grid">
        <label className="settings-field">
          <span className="settings-field__label">Base URL</span>
          <input
            value={llmUrl}
            onChange={(e) => {
              setLlmUrl(e.target.value);
              setLlmPreset(detectLlmPresetId(e.target.value));
            }}
            placeholder="http://127.0.0.1:11434/v1"
            className="mono"
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Model</span>
          <input
            value={llmModel}
            onChange={(e) => setLlmModel(e.target.value)}
            placeholder={isLocalLlmUrl(llmUrl) ? "llama3.2" : "gpt-4o-mini"}
            className="mono"
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">API key {isLocalLlmUrl(llmUrl) ? "(optional)" : ""}</span>
          <input
            type="password"
            value={llmKey}
            onChange={(e) => setLlmKey(e.target.value)}
            placeholder={
              isLocalLlmUrl(llmUrl)
                ? "Optional for local servers"
                : llmKeySet
                  ? "Leave blank to keep current"
                  : "sk-…"
            }
            autoComplete="off"
          />
        </label>
      </div>

      <div className="settings-action-row">
        <button type="button" className="btn btn-primary" onClick={() => void saveLlm()}>
          Save LLM settings
        </button>
        <button
          type="button"
          className="btn"
          disabled={testing || !llmUrl.trim() || !llmModel.trim()}
          onClick={() => void testLlm()}
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
      </div>

      {testResult && (
        <div
          className={`settings-test-result text-sm${testResult.ok ? " settings-test-result--ok" : " settings-test-result--err"}`}
          role="status"
        >
          {testResult.ok ? (
            <>
              <strong>Connection OK</strong>
              {testResult.latency_ms != null && (
                <span className="muted"> · {testResult.latency_ms} ms</span>
              )}
              {testResult.reply_preview && (
                <p className="mono text-xs settings-test-result__preview">{testResult.reply_preview}</p>
              )}
            </>
          ) : (
            <>
              <strong>Connection failed</strong>
              {testResult.error && <p>{testResult.error}</p>}
              {testResult.hint && <p className="muted text-xs">{testResult.hint}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
