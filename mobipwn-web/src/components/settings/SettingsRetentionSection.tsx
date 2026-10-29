import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";

type RetentionRow = { source_type: string; days: number };

const SUGGESTED_TYPES = ["android_bugreport", "ios_sysdiagnose", "vector"] as const;

type Props = {
  disabled?: boolean;
  onMessage?: (msg: string) => void;
};

export function SettingsRetentionSection({ disabled = false, onMessage }: Props) {
  const { log } = useActivityLog();
  const [rows, setRows] = useState<RetentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftType, setDraftType] = useState("");
  const [draftDays, setDraftDays] = useState(90);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/settings/retention_by_source_type");
      if (!res.ok) return;
      const body = (await res.json()) as Record<string, unknown>;
      const next: RetentionRow[] = Object.entries(body)
        .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && (v as number) > 0)
        .map(([source_type, days]) => ({
          source_type,
          days: Math.round(days as number),
        }))
        .sort((a, b) => a.source_type.localeCompare(b.source_type));
      setRows(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const usedTypes = useMemo(() => new Set(rows.map((r) => r.source_type)), [rows]);
  const suggestions = SUGGESTED_TYPES.filter((t) => !usedTypes.has(t));

  const addRow = (sourceType?: string, days = 90) => {
    const source_type = (sourceType ?? draftType).trim();
    if (!source_type) {
      onMessage?.("Source type is required.");
      return;
    }
    if (usedTypes.has(source_type)) {
      onMessage?.(`Retention for ${source_type} is already listed.`);
      return;
    }
    setRows((prev) =>
      [...prev, { source_type, days: Math.max(1, Math.round(days)) }].sort((a, b) =>
        a.source_type.localeCompare(b.source_type),
      ),
    );
    setDraftType("");
    setDraftDays(90);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, number> = {};
      for (const row of rows) {
        const key = row.source_type.trim();
        if (!key) continue;
        body[key] = Math.max(1, Math.round(row.days));
      }
      const res = await fetch("/api/v1/settings/retention_by_source_type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = (await res.text()) || `HTTP ${res.status}`;
        log("error", "Save retention failed", msg);
        onMessage?.(msg);
        return;
      }
      log("info", "Save retention settings", `${Object.keys(body).length} source type(s)`);
      onMessage?.(
        Object.keys(body).length
          ? `Retention saved for ${Object.keys(body).length} source type(s).`
          : "Retention cleared (no per-type overrides).",
      );
      await load();
    } catch (e) {
      const msg = String(e);
      log("error", "Save retention failed", msg);
      onMessage?.(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="muted text-xs">Loading retention…</p>;
  }

  return (
    <div className="settings-panel__block" id="settings-general-retention">
      <h3 className="settings-panel__subhead">Data retention</h3>
      <p className="muted text-xs">
        Optional days-to-keep overrides keyed by MUDM <code className="mono">source_type</code>.
        Empty list means no per-type override (global events TTL from Search limits still applies).
      </p>

      {rows.length === 0 ? (
        <p className="muted text-xs settings-empty-hint">No per-type retention overrides yet.</p>
      ) : (
        <table className="data-table settings-table">
          <thead>
            <tr>
              <th>Source type</th>
              <th>Days</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.source_type}>
                <td className="mono text-xs">{row.source_type}</td>
                <td>
                  <input
                    type="number"
                    className="settings-inline-number"
                    min={1}
                    max={3650}
                    disabled={disabled || saving}
                    value={row.days}
                    onChange={(e) => {
                      const days = Number(e.target.value) || 1;
                      setRows((prev) =>
                        prev.map((r) =>
                          r.source_type === row.source_type ? { ...r, days } : r,
                        ),
                      );
                    }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Remove"
                    disabled={disabled || saving}
                    onClick={() =>
                      setRows((prev) => prev.filter((r) => r.source_type !== row.source_type))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="settings-inline-form">
        <input
          className="mono"
          placeholder="source_type"
          list="settings-retention-suggestions"
          value={draftType}
          disabled={disabled || saving}
          onChange={(e) => setDraftType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addRow();
            }
          }}
        />
        <datalist id="settings-retention-suggestions">
          {suggestions.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <label className="settings-datetime">
          <span className="muted text-xs">Days</span>
          <input
            type="number"
            min={1}
            max={3650}
            disabled={disabled || saving}
            value={draftDays}
            onChange={(e) => setDraftDays(Number(e.target.value) || 1)}
          />
        </label>
        <button
          type="button"
          className="btn btn-sm"
          disabled={disabled || saving}
          onClick={() => addRow()}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="settings-chip-row">
          {suggestions.map((t) => (
            <button
              key={t}
              type="button"
              className="btn btn-ghost btn-sm mono"
              disabled={disabled || saving}
              onClick={() => addRow(t, 90)}
            >
              + {t}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled || saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save retention"}
      </button>
    </div>
  );
}
