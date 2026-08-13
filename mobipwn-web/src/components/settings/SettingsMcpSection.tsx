import { useCallback, useEffect, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import {
  fetchMcpConfig,
  fetchMcpStatus,
  restartMcp,
  saveMcpConfig,
  startMcp,
  stopMcp,
  type McpStatus,
} from "@/lib/mcpSettings";

export function SettingsMcpSection() {
  const { log } = useActivityLog();
  const [mcpAutoStart, setMcpAutoStart] = useState(true);
  const [mcpApiUrl, setMcpApiUrl] = useState("http://127.0.0.1:3000");
  const [mcpApiKey, setMcpApiKey] = useState("");
  const [mcpApiKeySet, setMcpApiKeySet] = useState(false);
  const [mcpBinaryPath, setMcpBinaryPath] = useState("");
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const loadMcp = useCallback(async () => {
    const [cfg, status] = await Promise.all([fetchMcpConfig(), fetchMcpStatus()]);
    setMcpAutoStart(Boolean(cfg.auto_start));
    setMcpApiUrl(cfg.api_url ?? "http://127.0.0.1:3000");
    setMcpApiKeySet(Boolean(cfg.api_key_set));
    setMcpApiKey("");
    setMcpBinaryPath(cfg.binary_path ?? "");
    setMcpStatus(status);
  }, []);

  useEffect(() => {
    void loadMcp().catch(() => setMcpStatus(null));
  }, [loadMcp]);

  const saveMcp = async () => {
    log("info", "Save settings: mcp_config");
    setMcpBusy(true);
    try {
      await saveMcpConfig({
        auto_start: mcpAutoStart,
        api_url: mcpApiUrl.trim(),
        api_key: mcpApiKey.trim() || (mcpApiKeySet ? "********" : ""),
        binary_path: mcpBinaryPath.trim(),
      });
      setMcpApiKey("");
      await loadMcp();
      setMsg("MCP settings saved.");
    } catch (e) {
      setMsg(String(e));
      log("error", "Save settings failed: mcp_config", String(e));
    } finally {
      setMcpBusy(false);
    }
  };

  const runMcpAction = async (action: "start" | "stop" | "restart") => {
    log("info", `MCP ${action}`);
    setMcpBusy(true);
    try {
      const status =
        action === "start" ? await startMcp() : action === "stop" ? await stopMcp() : await restartMcp();
      setMcpStatus(status);
      setMsg(`MCP ${action}${status.running ? " — running" : " — stopped"}`);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setMcpBusy(false);
    }
  };

  const copyCursorConfig = async () => {
    if (!mcpStatus?.cursor_config) return;
    await navigator.clipboard.writeText(JSON.stringify(mcpStatus.cursor_config, null, 2));
    setMsg("Copied Cursor MCP config.");
  };

  return (
    <section className="settings-panel card editor">
      <header className="settings-panel__header">
        <h2>MCP server</h2>
        <p className="muted text-sm">
          <code className="mono">mobipwn-mcp</code> for Cursor / Claude — tools over the REST API via stdio.
        </p>
      </header>

      {msg && <p className="settings-panel__msg muted text-xs">{msg}</p>}

      {mcpStatus ? (
        <p className="settings-status-pill muted text-xs">
          <strong>{mcpStatus.running ? "Running" : "Stopped"}</strong>
          {mcpStatus.pid ? ` · pid ${mcpStatus.pid}` : ""}
          {!mcpStatus.binary_found ? " · build with `cargo build -p mobipwn-mcp`" : ""}
          {mcpStatus.last_error ? ` · ${mcpStatus.last_error}` : ""}
        </p>
      ) : (
        <p className="settings-status-pill muted text-xs">Loading status…</p>
      )}

      <div className="settings-action-row">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={mcpBusy || mcpStatus?.running}
          onClick={() => void runMcpAction("start")}
        >
          Start
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={mcpBusy || !mcpStatus?.running}
          onClick={() => void runMcpAction("stop")}
        >
          Stop
        </button>
        <button type="button" className="btn btn-sm" disabled={mcpBusy} onClick={() => void runMcpAction("restart")}>
          Restart
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!mcpStatus?.cursor_config}
          onClick={() => void copyCursorConfig()}
        >
          Copy Cursor config
        </button>
      </div>

      <label className="settings-checkbox">
        <input type="checkbox" checked={mcpAutoStart} onChange={(e) => setMcpAutoStart(e.target.checked)} />
        Auto-start when mobipwn-api starts
      </label>

      <div className="settings-field-grid">
        <label className="settings-field">
          <span className="settings-field__label">API URL</span>
          <input
            value={mcpApiUrl}
            onChange={(e) => setMcpApiUrl(e.target.value)}
            placeholder="http://127.0.0.1:3000"
            className="mono"
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">API key</span>
          <input
            type="password"
            value={mcpApiKey}
            onChange={(e) => setMcpApiKey(e.target.value)}
            placeholder={mcpApiKeySet ? "Leave blank to keep current" : "From API keys section"}
            autoComplete="off"
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Binary path</span>
          <input
            value={mcpBinaryPath}
            onChange={(e) => setMcpBinaryPath(e.target.value)}
            placeholder={mcpStatus?.binary_path || "target/debug/mobipwn-mcp"}
            className="mono"
          />
        </label>
      </div>

      <button type="button" className="btn btn-primary" disabled={mcpBusy} onClick={() => void saveMcp()}>
        Save MCP settings
      </button>

      {mcpStatus?.cursor_config && (
        <div className="settings-panel__block">
          <h3 className="settings-panel__subhead">Cursor / Claude snippet</h3>
          <pre className="doc-guide-snippet__pre mono settings-snippet">
            {JSON.stringify(mcpStatus.cursor_config, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
