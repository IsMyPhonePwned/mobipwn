import { useCallback, useEffect, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";

export type SearchLimitsConfig = {
  max_concurrent: number;
  max_limit: number;
  max_export_limit: number;
  max_query_len: number;
  require_time_range: boolean;
  default_hours: number;
  max_joins: number;
  max_execution_time_secs: number;
  events_ttl_days: number;
};

const DEFAULTS: SearchLimitsConfig = {
  max_concurrent: 4,
  max_limit: 10_000,
  max_export_limit: 50_000,
  max_query_len: 8192,
  require_time_range: true,
  default_hours: 24,
  max_joins: 2,
  max_execution_time_secs: 60,
  events_ttl_days: 90,
};

type Props = {
  disabled?: boolean;
  onMessage?: (msg: string) => void;
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function SettingsSearchLimitsSection({ disabled = false, onMessage }: Props) {
  const { log } = useActivityLog();
  const [config, setConfig] = useState<SearchLimitsConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/settings/search_limits");
      if (!res.ok) return;
      const body = (await res.json()) as Partial<SearchLimitsConfig>;
      setConfig({
        max_concurrent: num(body.max_concurrent, DEFAULTS.max_concurrent),
        max_limit: num(body.max_limit, DEFAULTS.max_limit),
        max_export_limit: num(body.max_export_limit, DEFAULTS.max_export_limit),
        max_query_len: num(body.max_query_len, DEFAULTS.max_query_len),
        require_time_range:
          typeof body.require_time_range === "boolean"
            ? body.require_time_range
            : DEFAULTS.require_time_range,
        default_hours: num(body.default_hours, DEFAULTS.default_hours),
        max_joins: num(body.max_joins, DEFAULTS.max_joins),
        max_execution_time_secs: num(
          body.max_execution_time_secs,
          DEFAULTS.max_execution_time_secs,
        ),
        events_ttl_days: num(body.events_ttl_days, DEFAULTS.events_ttl_days),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = <K extends keyof SearchLimitsConfig>(key: K, value: SearchLimitsConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: SearchLimitsConfig = {
        max_concurrent: Math.min(64, Math.max(1, Math.round(config.max_concurrent))),
        max_limit: Math.min(1_000_000, Math.max(1, Math.round(config.max_limit))),
        max_export_limit: Math.min(5_000_000, Math.max(1, Math.round(config.max_export_limit))),
        max_query_len: Math.min(100_000, Math.max(64, Math.round(config.max_query_len))),
        require_time_range: config.require_time_range,
        default_hours: Math.min(24 * 365, Math.max(1, Math.round(config.default_hours))),
        max_joins: Math.min(16, Math.max(0, Math.round(config.max_joins))),
        max_execution_time_secs: Math.min(
          3600,
          Math.max(1, Math.round(config.max_execution_time_secs)),
        ),
        events_ttl_days: Math.min(3650, Math.max(1, Math.round(config.events_ttl_days))),
      };
      const res = await fetch("/api/v1/settings/search_limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = (await res.text()) || `HTTP ${res.status}`;
        log("error", "Save search limits failed", msg);
        onMessage?.(msg);
        return;
      }
      setConfig(body);
      log(
        "info",
        "Save search limits",
        `limit ${body.max_limit} · default ${body.default_hours}h · TTL ${body.events_ttl_days}d`,
      );
      onMessage?.(
        `Search limits saved — max ${body.max_limit.toLocaleString()} rows, default ${body.default_hours}h window.`,
      );
    } catch (e) {
      const msg = String(e);
      log("error", "Save search limits failed", msg);
      onMessage?.(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="muted text-xs">Loading search limits…</p>;
  }

  return (
    <div className="settings-panel__block" id="settings-general-search">
      <h3 className="settings-panel__subhead">Search limits</h3>
      <p className="muted text-xs">
        Admission caps for mPL queries. When <code className="mono">require_time_range</code> is on,
        queries without <code className="mono">last Nh</code> / explicit bounds are rejected.
      </p>

      <div className="settings-field-grid">
        <label className="settings-field">
          <span className="settings-field__label">Default time window (hours)</span>
          <input
            type="number"
            min={1}
            max={8760}
            disabled={disabled || saving}
            value={config.default_hours}
            onChange={(e) => setField("default_hours", Number(e.target.value) || 1)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Max result rows</span>
          <input
            type="number"
            min={1}
            max={1_000_000}
            step={1000}
            disabled={disabled || saving}
            value={config.max_limit}
            onChange={(e) => setField("max_limit", Number(e.target.value) || 1)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Max export rows</span>
          <input
            type="number"
            min={1}
            max={5_000_000}
            step={1000}
            disabled={disabled || saving}
            value={config.max_export_limit}
            onChange={(e) => setField("max_export_limit", Number(e.target.value) || 1)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Max query length (chars)</span>
          <input
            type="number"
            min={64}
            max={100_000}
            step={256}
            disabled={disabled || saving}
            value={config.max_query_len}
            onChange={(e) => setField("max_query_len", Number(e.target.value) || 64)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Concurrent searches</span>
          <input
            type="number"
            min={1}
            max={64}
            disabled={disabled || saving}
            value={config.max_concurrent}
            onChange={(e) => setField("max_concurrent", Number(e.target.value) || 1)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Max joins</span>
          <input
            type="number"
            min={0}
            max={16}
            disabled={disabled || saving}
            value={config.max_joins}
            onChange={(e) => setField("max_joins", Number(e.target.value) || 0)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Query timeout (seconds)</span>
          <input
            type="number"
            min={1}
            max={3600}
            disabled={disabled || saving}
            value={config.max_execution_time_secs}
            onChange={(e) => setField("max_execution_time_secs", Number(e.target.value) || 1)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Events TTL (days)</span>
          <input
            type="number"
            min={1}
            max={3650}
            disabled={disabled || saving}
            value={config.events_ttl_days}
            onChange={(e) => setField("events_ttl_days", Number(e.target.value) || 1)}
          />
          <span className="muted text-xs">ClickHouse TTL for the events table (global).</span>
        </label>
      </div>

      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={config.require_time_range}
          disabled={disabled || saving}
          onChange={(e) => setField("require_time_range", e.target.checked)}
        />
        Require a time bound on every search
      </label>

      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled || saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save search limits"}
      </button>
    </div>
  );
}
