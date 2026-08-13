import type { SeverityKey } from "./helpers";
import { SEV_META } from "./helpers";

export type RuleLifecycle = "staging" | "live" | "alerting";
export type RuleMode = "scheduled" | "realtime";

export type RuleEditorSectionTheme =
  | "identity"
  | "ownership"
  | "organization"
  | "detection"
  | "alerting"
  | "mitre";

export const RULE_EDITOR_SECTION_THEME: Record<
  RuleEditorSectionTheme,
  { accent: string; label: string }
> = {
  identity: { accent: "var(--accent-blue)", label: "Identity" },
  ownership: { accent: "var(--accent-cyan)", label: "Ownership" },
  organization: { accent: "var(--accent-purple)", label: "Organization" },
  detection: { accent: "var(--accent-green)", label: "Detection" },
  alerting: { accent: "var(--accent-orange)", label: "Alerting" },
  mitre: { accent: "var(--accent-pink, #ec4899)", label: "MITRE ATT&CK" },
};

export const LIFECYCLE_META: Record<
  RuleLifecycle,
  { label: string; badge: string; hint: string }
> = {
  staging: {
    label: "Staging",
    badge: "badge-staging",
    hint: "Draft — not promoted to production runs",
  },
  live: {
    label: "Live",
    badge: "badge-live",
    hint: "Runs on schedule but does not create alerts",
  },
  alerting: {
    label: "Alerting",
    badge: "badge-alerting",
    hint: "Production — creates alerts from hits",
  },
};

export const MODE_META: Record<RuleMode, { label: string; hint: string }> = {
  scheduled: {
    label: "Scheduled",
    hint: "Cron-driven batch detection",
  },
  realtime: {
    label: "Realtime",
    hint: "Evaluates on ingest stream",
  },
};

export function severityKey(value: string): SeverityKey {
  if (value === "informational") return "info";
  if (value in SEV_META) return value as SeverityKey;
  return "medium";
}

export function severityBadgeClass(value: string): string {
  const key = severityKey(value);
  if (key === "critical") return "badge-critical";
  if (key === "high") return "badge-alerting";
  if (key === "medium") return "badge-new";
  if (key === "low") return "badge-triaged";
  return "badge-staging";
}
