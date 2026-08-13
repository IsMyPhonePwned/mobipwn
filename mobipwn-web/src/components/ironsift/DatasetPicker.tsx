import { useMemo, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  buildIronSiftDatasetRows,
  type IronSiftDatasetRow,
  type IronSiftScopeOptions,
} from "@/lib/ironsift";

export type DatasetRow = IronSiftDatasetRow;

export function DatasetPicker({
  scopeOptions,
  selectedIds,
  onChange,
}: {
  scopeOptions: IronSiftScopeOptions | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useLocale();
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => buildIronSiftDatasetRows(scopeOptions), [scopeOptions]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.subtitle.toLowerCase().includes(q) ||
        r.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [rows, filter]);

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <div className="ironsift-dataset-picker">
      <div className="ironsift-dataset-picker__toolbar">
        <input
          type="search"
          className="mono"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("ironsift.datasetFilter")}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onChange(visible.map((r) => r.id))}
        >
          {t("ironsift.datasetSelectAll")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => onChange([])}>
          {t("ironsift.datasetClear")}
        </button>
        <span className="muted text-xs">
          {t("ironsift.datasetStats", { selected: selectedIds.length, total: rows.length })}
        </span>
      </div>
      <div className="ironsift-dataset-picker__list">
        {visible.length === 0 ? (
          <p className="muted">{t("ironsift.datasetEmpty")}</p>
        ) : (
          visible.map((row) => (
            <label key={`${row.kind}-${row.id}`} className="ironsift-dataset-row">
              <input
                type="checkbox"
                checked={selectedIds.includes(row.id)}
                onChange={() => toggle(row.id)}
              />
              <span className="ironsift-dataset-row__main">
                <span className="mono">{row.name}</span>
                <span className="muted text-xs">{row.subtitle}</span>
              </span>
              {row.tags.length > 0 && (
                <span className="ironsift-dataset-row__tags">
                  {row.tags.map((tag) => (
                    <span key={tag} className="pill">
                      {tag}
                    </span>
                  ))}
                </span>
              )}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

export function selectedSourcesFromIds(
  scope: IronSiftScopeOptions | null,
  ids: string[]
): { sources: string[]; caseId?: string } {
  if (!scope || ids.length === 0) return { sources: [] };
  const sources = new Set<string>();
  let caseId: string | undefined;
  for (const id of ids) {
    const src = scope.sources.find((s) => s.source === id);
    if (src) {
      sources.add(src.source);
      continue;
    }
    const c = scope.cases.find((x) => x.id === id);
    if (c?.ingest_source) sources.add(c.ingest_source);
    else if (c) caseId = c.id;
  }
  return { sources: [...sources], caseId };
}
