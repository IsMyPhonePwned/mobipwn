export type RuleVersionChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  query: "Query",
  lifecycle: "Lifecycle",
  mode: "Mode",
  severity: "Severity",
  maintainer: "Maintainer",
  cron: "Schedule",
  enabled: "Enabled",
  min_hits: "Min hits",
  max_alerts_per_run: "Max alerts",
};

function formatFieldValue(field: string, value: string): string {
  if (!value) return "—";
  if (field === "enabled") return value === "true" ? "On" : "Off";
  if (field === "query") {
    const oneLine = value.replace(/\s+/g, " ").trim();
    return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
  }
  return value;
}

export function parseRuleVersionChanges(diff: string | null | undefined): RuleVersionChange[] {
  if (!diff?.trim()) return [];
  try {
    const parsed = JSON.parse(diff) as Record<string, { before?: string; after?: string }>;
    return Object.entries(parsed).map(([field, change]) => ({
      field,
      label: FIELD_LABELS[field] ?? field,
      before: change?.before ?? "",
      after: change?.after ?? "",
    }));
  } catch {
    return [];
  }
}

export function summarizeRuleVersionDiff(diff: string | null | undefined): string {
  const changes = parseRuleVersionChanges(diff);
  if (changes.length === 0) return "";
  if (changes.length === 1) {
    const c = changes[0]!;
    if (c.field === "query") return "Query updated";
    if (c.field === "maintainer") {
      return `Maintainer: ${formatFieldValue(c.field, c.before)} → ${formatFieldValue(c.field, c.after)}`;
    }
    return `${c.label} changed`;
  }
  return changes.map((c) => c.label).join(", ") + " changed";
}

export function formatRuleVersionChangeValue(field: string, value: string): string {
  return formatFieldValue(field, value);
}

export function ruleVersionHasQueryChange(version: {
  diff?: string | null;
  query_before?: string | null;
  query: string;
}): boolean {
  const fromDiff = parseRuleVersionChanges(version.diff).some((c) => c.field === "query");
  if (fromDiff) return true;
  return (
    version.query_before != null &&
    version.query_before.trim() !== version.query.trim()
  );
}
