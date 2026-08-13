export type RuleRunResult = {
  hit_count: number;
  alerts_created: number;
  duration_ms: number;
  skipped_min_hits?: boolean;
  suppressed?: boolean;
};

export async function executeRuleRun(
  ruleId: string,
  options: { createAlerts: boolean; queryOverride?: string },
): Promise<RuleRunResult> {
  const res = await fetch(`/api/v1/rules/${ruleId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      create_alerts: options.createAlerts,
      query_override: options.queryOverride,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(raw || `Run failed (HTTP ${res.status})`);
  }
  return JSON.parse(raw) as RuleRunResult;
}

export function formatRuleRunMessage(data: RuleRunResult, createAlerts: boolean): string {
  if (createAlerts) {
    return `Run complete: ${data.hit_count} hit(s), ${data.alerts_created} alert(s) created (${data.duration_ms} ms).`;
  }
  return `Dry run complete: ${data.hit_count} hit(s), no alerts created (${data.duration_ms} ms).`;
}
