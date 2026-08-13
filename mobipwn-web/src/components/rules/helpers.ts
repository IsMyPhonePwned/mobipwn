export type Rule = {
  id: string;
  name: string;
  lifecycle: string;
  mode: string;
  query: string;
  cron: string | null;
  severity: string;
  enabled?: boolean;
  muted_until?: string | null;
  mitre?: string[];
  version?: number;
  min_hits?: number;
  max_alerts_per_run?: number;
  prevalence_threshold?: number | null;
  repository_id?: string | null;
  folder_id?: string | null;
  tags?: string[];
  maintainer?: string | null;
};

export type RuleRunSummary = {
  last_run_at: string | null;
  last_hit_count: number;
  hits_24h: number;
  daily_hits: { date: string; count: number }[];
};

export type BandId = "firing" | "active" | "silent" | "staging" | "disabled";
export type SeverityKey = "critical" | "high" | "medium" | "low" | "info";

export const SEV_META: Record<SeverityKey, { color: string; label: string }> = {
  critical: { color: "var(--severity-critical, #ef4444)", label: "Critical" },
  high: { color: "var(--accent-orange, #e67e22)", label: "High" },
  medium: { color: "var(--accent-yellow, #eab308)", label: "Medium" },
  low: { color: "var(--accent-cyan, #22d3ee)", label: "Low" },
  info: { color: "var(--muted-foreground)", label: "Info" },
};

export const BANDS = [
  {
    id: "firing" as const,
    label: "Firing now",
    hint: "Hits in the last 24h",
    accent: "var(--accent-orange)",
    defaultOpen: true,
  },
  {
    id: "active" as const,
    label: "Active",
    hint: "Ran in the last 7 days",
    accent: "var(--accent-green, #22c55e)",
    defaultOpen: true,
  },
  {
    id: "silent" as const,
    label: "Silent",
    hint: "No recent runs — tune or validate",
    accent: "var(--accent-yellow)",
    defaultOpen: true,
  },
  {
    id: "staging" as const,
    label: "Staging",
    hint: "Not promoted to live/alerting",
    accent: "var(--primary)",
    defaultOpen: false,
  },
  {
    id: "disabled" as const,
    label: "Disabled",
    hint: "Off or muted",
    accent: "var(--muted-foreground)",
    defaultOpen: false,
  },
];

function parseUtc(ts?: string | null): Date | undefined {
  if (!ts) return undefined;
  const d = new Date(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function normSeverity(s: string): SeverityKey {
  if (s === "informational") return "info";
  if (s in SEV_META) return s as SeverityKey;
  return "medium";
}

export function bandOf(
  rule: Rule,
  summary: RuleRunSummary | undefined,
  now = new Date()
): BandId {
  if (rule.enabled === false) return "disabled";
  if (rule.muted_until && new Date(rule.muted_until) > now) return "disabled";
  if (rule.lifecycle === "staging") return "staging";

  const last = parseUtc(summary?.last_run_at);
  const hits24 = summary?.hits_24h ?? 0;
  if (hits24 > 0) return "firing";
  if (last) {
    const ageH = (now.getTime() - last.getTime()) / 36e5;
    if (ageH < 1 && (summary?.last_hit_count ?? 0) > 0) return "firing";
    if (ageH < 24 * 7) return "active";
  }
  return "silent";
}

export function formatLastMatch(d: Date | undefined, now = new Date()): string {
  if (!d) return "Never";
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

export function buildActivity(
  daily: { date: string; count: number }[] | undefined,
  hits24: number,
  days = 28
): number[] {
  const byDate = new Map((daily ?? []).map((d) => [d.date, d.count]));
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const out: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push(iso === todayStr ? hits24 : byDate.get(iso) ?? 0);
  }
  return out;
}

export function buildRuleView(
  rule: Rule,
  summary: RuleRunSummary | undefined
) {
  const hits24 = summary?.hits_24h ?? 0;
  return {
    raw: rule,
    id: rule.id,
    name: rule.name,
    severity: normSeverity(rule.severity),
    mode: rule.mode === "realtime" ? "real-time" : "scheduled",
    lifecycle: rule.lifecycle,
    lastMatch: parseUtc(summary?.last_run_at),
    today: hits24,
    activity: buildActivity(summary?.daily_hits, hits24),
    mitre: rule.mitre?.[0],
    query: rule.query,
    maintainer: rule.maintainer ?? null,
  };
}

export type RuleView = ReturnType<typeof buildRuleView>;

/** Column count for the rules fleet table (band headers + expanded rows). */
export const RULE_TABLE_COLUMN_COUNT = 9;
