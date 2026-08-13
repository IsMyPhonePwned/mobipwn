import { useMemo } from "react";
import { Link } from "react-router-dom";
import { isEnrichmentColumn } from "@/lib/enrichment";
import { SectionHeader } from "./SectionHeader";

type Row = Record<string, unknown>;

const MUDM_KEYS = [
  "timestamp",
  "platform",
  "parser",
  "source",
  "source_type",
  "data_type",
  "event_time_binding",
  "severity",
  "message",
  "bundle_id",
  "app_name",
  "device_id",
  "device_model",
  "os_version",
  "process_name",
  "process_id",
  "user",
  "src_ip",
  "dest_ip",
  "ssid",
  "permission",
  "action",
  "file_hash",
  "installer",
];

const EXT_PRIORITY = [
  "installer",
  "installerPackageName",
  "initiatingPackageName",
  "originatingPackageName",
  "event_type",
  "firstInstallTime",
  "lastUpdateTime",
  "packageSource",
  "codePath",
  "file_path",
];

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function tryPrettyJsonString(s: string): string | null {
  const t = s.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try {
    return JSON.stringify(JSON.parse(t) as unknown, null, 2);
  } catch {
    return null;
  }
}

function formatDisplay(value: unknown): { text: string; multiline: boolean } {
  if (value === null || value === undefined) return { text: "", multiline: false };
  if (typeof value === "object") {
    return { text: JSON.stringify(value, null, 2), multiline: true };
  }
  const s = String(value);
  const pretty = tryPrettyJsonString(s);
  if (pretty) return { text: pretty, multiline: true };
  return { text: s, multiline: s.includes("\n") || s.length > 160 };
}

function isFullEventRow(row: Row): boolean {
  return (
    !isEmptyValue(row.message) ||
    !isEmptyValue(row.timestamp) ||
    !isEmptyValue(row.id)
  );
}

function sortExtKeys(keys: string[]): string[] {
  const pri = new Set(EXT_PRIORITY);
  const first = EXT_PRIORITY.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !pri.has(k)).sort((a, b) => a.localeCompare(b));
  return [...first, ...rest];
}

function InspectorRow({ label, value }: { label: string; value: unknown }) {
  if (isEmptyValue(value) && value !== 0) return null;
  const { text, multiline } = formatDisplay(value);
  if (!text && value !== 0) return null;
  return (
    <div className="inspector-row">
      <dt>{label}</dt>
      <dd>
        {multiline ? (
          <pre className="inspector-value-pre">{text}</pre>
        ) : (
          <span className="inspector-value-text">{text}</span>
        )}
      </dd>
    </div>
  );
}

export default function EventInspector({ row }: { row: Row }) {
  const ext = useMemo(() => {
    const raw = row.ext;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === "object") return raw as Record<string, unknown>;
    return null;
  }, [row]);

  const displayRow = useMemo(() => {
    const r = { ...row };
    if (isEmptyValue(r.installer) && ext) {
      const inst =
        ext.installer ??
        ext.installerPackageName ??
        ext.initiatingPackageName;
      if (!isEmptyValue(inst)) r.installer = inst;
    }
    return r;
  }, [row, ext]);

  const aggregated = !isFullEventRow(displayRow);
  const mudmShown = new Set([...MUDM_KEYS, "id", "stat"]);
  const resultColumns = Object.keys(displayRow).filter(
    (k) => !mudmShown.has(k) && k !== "ext" && !isEmptyValue(displayRow[k])
  );

  const mudmFilled = MUDM_KEYS.filter((k) => !isEmptyValue(displayRow[k]) || displayRow[k] === 0);
  const extKeys = ext ? sortExtKeys(Object.keys(ext).filter((k) => !isEmptyValue(ext[k]))) : [];
  const enrichmentKeys = Object.keys(displayRow).filter(
    (k) => isEnrichmentColumn(k) && !isEmptyValue(displayRow[k])
  );

  return (
    <div className="inspector-content">
      {aggregated && (
        <p className="inspector-aggregated-hint muted">
          Aggregated result row (e.g. <code className="mono">stats</code>) — not a full event.
          Remove <code className="mono">| stats …</code> or add <code className="mono">| head</code>{" "}
          without stats to inspect complete events.
        </p>
      )}

      {(row.stat !== undefined || resultColumns.length > 0) && (
        <>
          <SectionHeader label={aggregated ? "Result" : "Columns"} />
          <dl className="inspector-dl">
            <InspectorRow label="stat" value={displayRow.stat} />
            {resultColumns.map((k) => (
              <InspectorRow key={k} label={k} value={displayRow[k]} />
            ))}
          </dl>
        </>
      )}

      {mudmFilled.length > 0 && (
        <>
          <SectionHeader label="MUDM" />
          <dl className="inspector-dl">
            <InspectorRow label="id" value={displayRow.id} />
            {mudmFilled.map((k) => (
              <InspectorRow key={k} label={k} value={displayRow[k]} />
            ))}
          </dl>
        </>
      )}

      {enrichmentKeys.length > 0 && (
        <>
          <div style={{ marginTop: 10 }}>
            <SectionHeader label="Enrichments" meta="marketplace" />
          </div>
          <dl className="inspector-dl inspector-dl--enrich">
            {enrichmentKeys.map((k) => (
              <InspectorRow key={k} label={k} value={displayRow[k]} />
            ))}
          </dl>
          <p className="inspector-enrich-hint muted">
            From enabled{" "}
            <Link to="/marketplace">marketplace</Link> providers via{" "}
            <code className="mono">| lookup</code>.
          </p>
        </>
      )}

      {extKeys.length > 0 && (
        <>
          <div style={{ marginTop: 10 }}>
            <SectionHeader label="ext" meta={`${extKeys.length} fields`} />
          </div>
          <dl className="inspector-dl inspector-dl--ext">
            {extKeys.map((k) => (
              <InspectorRow key={k} label={k} value={ext![k]} />
            ))}
          </dl>
        </>
      )}

      {mudmFilled.length === 0 && resultColumns.length === 0 && row.stat === undefined && (
        <p className="muted">No fields in this row.</p>
      )}

      <details className="inspector-raw">
        <summary className="muted mono">RAW JSON</summary>
        <pre className="mono inspector-body">{JSON.stringify(row, null, 2)}</pre>
      </details>
    </div>
  );
}
