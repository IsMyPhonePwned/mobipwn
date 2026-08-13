import {
  applyIronSiftTagScopeChange,
  type IronSiftScopeOptions,
} from "@/lib/ironsift";
import type { ScopeState } from "./ScopePanel";

export function mergeScopePatch(
  scopeOptions: IronSiftScopeOptions | null,
  prev: ScopeState,
  patch: Partial<ScopeState>
): { next: ScopeState; datasetIds?: string[] } {
  if (!("scopeTags" in patch)) {
    return { next: { ...prev, ...patch } };
  }
  const scopeTags = patch.scopeTags ?? prev.scopeTags;
  const auto = applyIronSiftTagScopeChange(scopeOptions, scopeTags);
  return {
    next: {
      ...prev,
      ...patch,
      scopeTags,
      selectedCaseId: auto.selectedCaseId,
      selectedSource: auto.selectedSource,
      selectedMachines: [],
    },
    datasetIds: auto.datasetIds,
  };
}
