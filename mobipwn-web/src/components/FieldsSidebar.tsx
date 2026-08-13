import { useEffect, useMemo, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { apiFetch, apiPost } from "@/lib/api";
import { SectionHeader } from "./SectionHeader";

type FieldStat = { value: string; count: number };
type SavedQuery = { id: string; name: string; query: string; folder_id?: string | null };
type SavedQueryFolder = { id: string; name: string; parent_id?: string | null };

const PINNED_FIELDS = new Set([
  "platform",
  "parser",
  "source",
  "source_type",
  "severity",
  "data_type",
  "device_id",
  "bundle_id",
]);

const PINNED_ORDER = [...PINNED_FIELDS];

export type FieldsScope = {
  query: string;
  time_from?: string;
  time_to?: string;
};

export function FieldsSidebar({
  saved,
  folders = [],
  scope,
  fieldStats,
  fieldStatsError = "",
  selectedField,
  statsLoaded,
  onSelectField,
  onLoadQuery,
  onFilter,
}: {
  saved: SavedQuery[];
  folders?: SavedQueryFolder[];
  /** Current search + time window; drives which fields appear in the sidebar. */
  scope: FieldsScope;
  fieldStats: FieldStat[];
  fieldStatsError?: string;
  selectedField: string;
  /** True after the latest field-stats request finished (success or error). */
  statsLoaded: boolean;
  onSelectField: (f: string) => void;
  onLoadQuery: (q: string) => void;
  onFilter: (field: string, value: string, exclude: boolean) => void;
}) {
  const { log } = useActivityLog();
  const [scopedFields, setScopedFields] = useState<string[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => {
      setFieldsLoading(true);
      setFieldsError("");
      apiPost<{ fields?: string[] }>("/v1/search/fields-in-scope", {
        query: scope.query,
        time_from: scope.time_from,
        time_to: scope.time_to,
      })
        .then((data) => setScopedFields(data.fields ?? []))
        .catch(async (err) => {
          setScopedFields([]);
          const msg = String(err);
          setFieldsError(msg);
          log("warn", "Fields in scope failed", msg);
          try {
            const fallback = await apiFetch<string[]>("/v1/search/fields");
            if (fallback.length) setScopedFields(fallback);
          } catch {
            /* catalog unavailable too */
          }
        })
        .finally(() => setFieldsLoading(false));
    }, 400);
    return () => window.clearTimeout(t);
  }, [scope.query, scope.time_from, scope.time_to, log]);

  const { pinned, other } = useMemo(() => {
    const inScope = new Set(scopedFields);
    const pinned = PINNED_ORDER.filter((f) => inScope.has(f));
    const other = scopedFields.filter((f) => !PINNED_FIELDS.has(f));
    return { pinned, other };
  }, [scopedFields]);

  const groupedSaved = useMemo(() => {
    const byFolder = new Map<string | null, SavedQuery[]>();
    for (const q of saved) {
      const key = q.folder_id ?? null;
      byFolder.set(key, [...(byFolder.get(key) ?? []), q]);
    }
    const rootFolders = folders.filter((f) => !f.parent_id);
    return { byFolder, rootFolders, unfiled: byFolder.get(null) ?? [] };
  }, [folders, saved]);

  const renderSavedList = (items: SavedQuery[]) => (
    <ul className="field-list">
      {items.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              log("info", `Load saved search: ${s.name}`, s.query.slice(0, 200));
              onLoadQuery(s.query);
            }}
          >
            {s.name}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <aside className="card fields-panel">
      <SectionHeader
        label="Fields"
        meta={fieldsLoading ? "…" : scopedFields.length}
      />
      <p className="muted fields-hint">
        Field lists reflect your current query and time range. Click a field for top values; type in
        the search bar for autocomplete.
      </p>
      <div className="fields-panel-body">
        {(saved.length > 0 || folders.length > 0) && (
          <>
            <SectionHeader label="Saved" meta={saved.length} />
            {groupedSaved.rootFolders.map((folder) => {
              const items = groupedSaved.byFolder.get(folder.id) ?? [];
              if (!items.length) return null;
              return (
                <details key={folder.id} className="saved-folder" open>
                  <summary>{folder.name}</summary>
                  {renderSavedList(items)}
                </details>
              );
            })}
            {groupedSaved.unfiled.length > 0 && (
              <>
                {groupedSaved.rootFolders.length > 0 && (
                  <p className="muted fields-empty">Unfiled</p>
                )}
                {renderSavedList(groupedSaved.unfiled)}
              </>
            )}
            {saved.length > 0 &&
              groupedSaved.unfiled.length === 0 &&
              groupedSaved.rootFolders.every((f) => !(groupedSaved.byFolder.get(f.id)?.length ?? 0)) &&
              renderSavedList(saved)}
          </>
        )}
        <SectionHeader label="Pinned" meta={pinned.length} />
        <ul className="field-list">
          {pinned.map((f) => (
            <li key={f}>
              <button
                type="button"
                className={`field-row${selectedField === f ? " active" : ""}`}
                onClick={() => {
                  log("info", `Select field: ${f}`);
                  onSelectField(f);
                }}
              >
                <span className="chev">›</span>
                {f}
              </button>
            </li>
          ))}
        </ul>
        {fieldsError && (
          <p className="error fields-empty" style={{ fontSize: "0.85em" }}>
            {fieldsError.includes("404")
              ? "Restart mobipwn-api to enable scope-aware fields."
              : fieldsError}
          </p>
        )}
        {!fieldsLoading && !fieldsError && scopedFields.length === 0 && (
          <p className="muted fields-empty">
            No populated fields in this scope — run Search or widen time / simplify the query.
          </p>
        )}
        {other.length > 0 && (
          <>
            <SectionHeader label="All fields" meta={other.length} />
            <ul className="field-list">
              {other.map((f) => (
                <li key={f}>
                  <button
                    type="button"
                    className={`field-row${selectedField === f ? " active" : ""}`}
                    onClick={() => {
                      log("info", `Select field: ${f}`);
                      onSelectField(f);
                    }}
                  >
                    <span className="chev">›</span>
                    {f}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {fieldStatsError && (
          <p className="error fields-empty" style={{ fontSize: "0.85em" }}>
            {fieldStatsError}
          </p>
        )}
        {statsLoaded && !fieldStatsError && fieldStats.length === 0 && (
          <p className="muted fields-empty">
            No values for <strong>{selectedField}</strong> in this scope. Use{" "}
            <code className="mono">source="case-001"</code> (no extra 24h window), or set From/To /{" "}
            <code className="mono">last 90d</code>.
          </p>
        )}
        {fieldStats.length > 0 && (
          <>
            <SectionHeader
              label={selectedField}
              meta={
                <span className="hint" title="Shift+click to exclude">
                  click · ⇧ exclude
                </span>
              }
            />
            <ul className="field-values field-list">
              {fieldStats.map((s) => (
                <li key={s.value}>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={(e) => onFilter(selectedField, s.value, e.shiftKey)}
                  >
                    {s.value} <span className="muted">({s.count})</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
