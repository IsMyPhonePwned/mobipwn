import { RuleQueryPreview } from "./RuleQueryPreview";
import { useRulePreview } from "./useRulePreview";

export function RuleRowPreview({
  ruleId,
  query,
  mode,
  minHits,
  maxAlerts,
  active,
}: {
  ruleId: string;
  query: string;
  mode: string;
  minHits?: number;
  maxAlerts?: number;
  active: boolean;
}) {
  const { preview, previewQuery, loading, error, runPreview } = useRulePreview({
    ruleId,
    query,
    mode,
    enabled: active,
  });

  return (
    <RuleQueryPreview
      preview={preview}
      loading={loading}
      error={error}
      query={query}
      previewQuery={previewQuery}
      minHits={minHits}
      maxAlerts={maxAlerts}
      onRefresh={() => void runPreview(query)}
      compact
    />
  );
}
