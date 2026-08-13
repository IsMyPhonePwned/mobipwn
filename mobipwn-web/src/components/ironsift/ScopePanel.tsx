import { useMemo } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import type { IronSiftScopeOptions } from "@/lib/ironsift";
import { TagScopeChips } from "./TagScopeChips";

export type ScopeState = {
  selectedCaseId: string;
  selectedSource: string;
  scopeTags: string;
  selectedMachines: string[];
  baselineFrom: string;
  baselineTo: string;
  currentFrom: string;
  currentTo: string;
};

export function ScopePanel({
  scopeOptions,
  state,
  onChange,
  showTemporal,
}: {
  scopeOptions: IronSiftScopeOptions | null;
  state: ScopeState;
  onChange: (patch: Partial<ScopeState>) => void;
  showTemporal?: boolean;
}) {
  const { t } = useLocale();
  const machineOptions = useMemo(() => {
    let ids: string[] = [];
    if (state.selectedCaseId && scopeOptions) {
      const c = scopeOptions.cases.find((x) => x.id === state.selectedCaseId);
      if (c?.device_ids.length) ids = c.device_ids;
    } else if (state.selectedSource && scopeOptions) {
      const s = scopeOptions.sources.find((x) => x.source === state.selectedSource);
      if (s?.device_ids.length) ids = s.device_ids;
    } else {
      ids = scopeOptions?.sources.flatMap((s) => s.device_ids) ?? [];
    }
    return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  }, [scopeOptions, state.selectedCaseId, state.selectedSource]);

  const knownTags = scopeOptions?.tags ?? [];

  return (
    <div className="ironsift-scope-grid">
      <label>
        <span className="muted text-xs">{t("ironsift.scopeCase")}</span>
        <select
          className="mono"
          value={state.selectedCaseId}
          onChange={(e) =>
            onChange({ selectedCaseId: e.target.value, selectedMachines: [] })
          }
        >
          <option value="">{t("ironsift.scopeAllCases")}</option>
          {(scopeOptions?.cases ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} {c.ingest_source ? `(${c.ingest_source})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="muted text-xs">{t("ironsift.scopeSource")}</span>
        <select
          className="mono"
          value={state.selectedSource}
          onChange={(e) =>
            onChange({ selectedSource: e.target.value, selectedMachines: [] })
          }
        >
          <option value="">{t("ironsift.scopeAllSources")}</option>
          {(scopeOptions?.sources ?? []).map((s) => (
            <option key={s.source} value={s.source}>
              {s.source} ({s.device_ids.length} hosts)
            </option>
          ))}
        </select>
      </label>
      <div className="ironsift-scope-tags">
        <label className="ironsift-scope-tags__field">
          <span className="muted text-xs">{t("ironsift.scopeTags")}</span>
          <input
            className="mono"
            value={state.scopeTags}
            onChange={(e) => onChange({ scopeTags: e.target.value })}
            placeholder={t("ironsift.scopeTagsPlaceholder")}
          />
        </label>
        {knownTags.length > 0 && (
          <TagScopeChips
            knownTags={knownTags}
            selectedTags={state.scopeTags}
            onChange={(scopeTags) => onChange({ scopeTags })}
          />
        )}
        <p className="muted text-xs ironsift-scope-tags__hint">{t("ironsift.scopeTagsHint")}</p>
      </div>
      {showTemporal && (
        <>
          <label>
            <span className="muted text-xs">{t("ironsift.baselineFrom")}</span>
            <input
              type="datetime-local"
              className="mono"
              value={state.baselineFrom}
              onChange={(e) => onChange({ baselineFrom: e.target.value })}
            />
          </label>
          <label>
            <span className="muted text-xs">{t("ironsift.baselineTo")}</span>
            <input
              type="datetime-local"
              className="mono"
              value={state.baselineTo}
              onChange={(e) => onChange({ baselineTo: e.target.value })}
            />
          </label>
          <label>
            <span className="muted text-xs">{t("ironsift.currentFrom")}</span>
            <input
              type="datetime-local"
              className="mono"
              value={state.currentFrom}
              onChange={(e) => onChange({ currentFrom: e.target.value })}
            />
          </label>
          <label>
            <span className="muted text-xs">{t("ironsift.currentTo")}</span>
            <input
              type="datetime-local"
              className="mono"
              value={state.currentTo}
              onChange={(e) => onChange({ currentTo: e.target.value })}
            />
          </label>
        </>
      )}
      {machineOptions.length > 0 && (
        <div className="ironsift-scope-machines">
          <p className="muted text-xs">{t("ironsift.machinesTitle")}</p>
          <div className="ironsift-scope-machines__list">
            {machineOptions.map((m, index) => (
              <label key={`${m}-${index}`} className="btn btn-secondary ironsift-machine-chip">
                <input
                  type="checkbox"
                  checked={state.selectedMachines.includes(m)}
                  onChange={() =>
                    onChange({
                      selectedMachines: state.selectedMachines.includes(m)
                        ? state.selectedMachines.filter((x) => x !== m)
                        : [...state.selectedMachines, m],
                    })
                  }
                />
                <span className="mono">{m}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
