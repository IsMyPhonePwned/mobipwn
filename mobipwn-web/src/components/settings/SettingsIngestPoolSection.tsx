import { useCallback, useEffect, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";

type IngestPoolConfig = {
  workers: number;
  max_queue: number;
  insert_chunk_size: number;
};

type IngestPoolLive = {
  workers: number;
  queued: number;
  active: number;
  max_queue?: number | null;
  saturated?: boolean;
};

type Props = {
  disabled?: boolean;
  onMessage?: (msg: string) => void;
};

const DEFAULTS: IngestPoolConfig = {
  workers: 2,
  max_queue: 32,
  insert_chunk_size: 25_000,
};

export function SettingsIngestPoolSection({ disabled = false, onMessage }: Props) {
  const { log } = useActivityLog();
  const [config, setConfig] = useState<IngestPoolConfig>(DEFAULTS);
  const [live, setLive] = useState<IngestPoolLive | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/settings/ingest_pool_config");
      if (!res.ok) return;
      const body = (await res.json()) as Partial<IngestPoolConfig>;
      setConfig({
        workers: typeof body.workers === "number" ? body.workers : DEFAULTS.workers,
        max_queue: typeof body.max_queue === "number" ? body.max_queue : DEFAULTS.max_queue,
        insert_chunk_size:
          typeof body.insert_chunk_size === "number"
            ? body.insert_chunk_size
            : DEFAULTS.insert_chunk_size,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLive = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/health/detail");
      if (!res.ok) return;
      const detail = (await res.json()) as { ingest_pool?: IngestPoolLive | null };
      if (detail.ingest_pool) setLive(detail.ingest_pool);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadLive();
    const id = window.setInterval(() => void loadLive(), 4000);
    return () => window.clearInterval(id);
  }, [load, loadLive]);

  const save = async () => {
    setSaving(true);
    try {
      const body: IngestPoolConfig = {
        workers: Math.min(16, Math.max(1, Math.round(config.workers))),
        max_queue: Math.min(10_000, Math.max(0, Math.round(config.max_queue))),
        insert_chunk_size: Math.min(
          500_000,
          Math.max(1_000, Math.round(config.insert_chunk_size)),
        ),
      };
      const res = await fetch("/api/v1/settings/ingest_pool_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = (await res.text()) || `HTTP ${res.status}`;
        log("error", "Save ingest worker settings failed", msg);
        onMessage?.(msg);
        return;
      }
      setConfig(body);
      log(
        "info",
        "Save ingest worker settings",
        `${body.workers} workers · queue ${body.max_queue || "unlimited"} · chunk ${body.insert_chunk_size}`,
      );
      onMessage?.(
        `Ingest pool updated: ${body.workers} workers, max queue ${body.max_queue || "unlimited"}, insert chunk ${body.insert_chunk_size} (live).`,
      );
      await loadLive();
    } catch (e) {
      const msg = String(e);
      log("error", "Save ingest worker settings failed", msg);
      onMessage?.(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="muted text-xs">Loading ingest worker settings…</p>;
  }

  return (
    <div className="settings-panel__block">
      <h3 className="settings-panel__subhead">Ingest workers</h3>
      <p className="muted text-xs">
        Concurrent archive parse/index slots, queue backpressure (HTTP 429 when full), and ClickHouse
        insert chunk size. Changes apply immediately without restarting the API. Use a separate
        process with <code className="mono">MOBIPWN_INGEST_MODE=worker</code> to scale ingest off the
        API host.
      </p>

      <label className="settings-field">
        <span className="settings-field__label">Concurrent workers (1–16)</span>
        <input
          type="number"
          min={1}
          max={16}
          step={1}
          disabled={disabled || saving}
          value={config.workers}
          onChange={(e) =>
            setConfig((c) => ({ ...c, workers: Number(e.target.value) || 1 }))
          }
        />
      </label>

      <label className="settings-field">
        <span className="settings-field__label">Max queue depth (0 = unlimited)</span>
        <input
          type="number"
          min={0}
          max={10000}
          step={1}
          disabled={disabled || saving}
          value={config.max_queue}
          onChange={(e) =>
            setConfig((c) => ({ ...c, max_queue: Number(e.target.value) || 0 }))
          }
        />
        <span className="muted text-xs">
          When the pending queue is full, new upload completes return HTTP 429 until a worker frees.
        </span>
      </label>

      <label className="settings-field">
        <span className="settings-field__label">ClickHouse insert chunk (rows)</span>
        <input
          type="number"
          min={1000}
          max={500000}
          step={1000}
          disabled={disabled || saving}
          value={config.insert_chunk_size}
          onChange={(e) =>
            setConfig((c) => ({
              ...c,
              insert_chunk_size: Number(e.target.value) || DEFAULTS.insert_chunk_size,
            }))
          }
        />
        <span className="muted text-xs">
          Lower values reduce peak RAM while indexing large archives; higher values mean fewer inserts.
        </span>
      </label>

      <div className="settings-inline-actions" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save ingest pool"}
        </button>
      </div>

      {live && (
        <p className="muted text-xs mono" style={{ marginTop: 10 }}>
          Live: {live.active}/{live.workers} busy
          {live.queued > 0 ? ` · ${live.queued} queued` : " · queue empty"}
          {live.max_queue != null && live.max_queue > 0 ? ` · cap ${live.max_queue}` : ""}
          {live.saturated ? " · SATURATED" : ""}
        </p>
      )}
    </div>
  );
}
