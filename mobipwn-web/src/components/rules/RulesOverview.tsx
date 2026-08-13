import { useMemo } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { bandOf, SEV_META, type Rule, type RuleRunSummary, type SeverityKey } from "./helpers";

export type FleetHealth = {
  total: number;
  healthy: number;
  slow: number;
  errors: number;
};

export type VelocityBucket = { bucket_start: string; count: number };

function FleetMatrix({
  rules,
  summaries,
}: {
  rules: Rule[];
  summaries: Record<string, RuleRunSummary>;
}) {
  const ordered = useMemo(() => {
    const order: Record<string, number> = { firing: 0, active: 1, silent: 2, staging: 3, disabled: 4 };
    return [...rules].sort(
      (a, b) => order[bandOf(a, summaries[a.id])] - order[bandOf(b, summaries[b.id])]
    );
  }, [rules, summaries]);

  return (
    <div className="rules-overview-matrix">
      {ordered.slice(0, 120).map((r) => {
        const b = bandOf(r, summaries[r.id]);
        const alive = b === "firing" || b === "active";
        const sevKey = (
          r.severity === "informational" ? "info" : r.severity
        ) as SeverityKey;
        const sev = SEV_META[sevKey in SEV_META ? sevKey : "medium"];
        return (
          <span
            key={r.id}
            className="rules-overview-dot"
            title={`${r.name} · ${sev.label}`}
            style={{
              background: alive ? sev.color : "color-mix(in srgb, var(--foreground) 12%, transparent)",
              boxShadow: b === "firing" ? `0 0 4px ${sev.color}` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

function VelocitySpark({ buckets }: { buckets: VelocityBucket[] }) {
  const bars = useMemo(() => {
    if (!buckets.length) return Array(24).fill(0);
    return buckets.map((b) => b.count);
  }, [buckets]);
  const max = Math.max(...bars, 1);
  return (
    <div className="rules-velocity-spark" aria-hidden>
      {bars.map((v, i) => (
        <div
          key={i}
          className="rules-velocity-bar"
          style={{
            height: `${Math.max(8, (v / max) * 100)}%`,
            background:
              v >= max * 0.7
                ? "var(--primary)"
                : v > 0
                  ? "color-mix(in srgb, var(--primary) 50%, transparent)"
                  : "color-mix(in srgb, var(--foreground) 10%, transparent)",
          }}
          title={`${v} alert${v === 1 ? "" : "s"}`}
        />
      ))}
    </div>
  );
}

function FleetHealthCell({ fleetHealth }: { fleetHealth: FleetHealth | null | undefined }) {
  const total = fleetHealth?.total ?? 0;
  const healthy = fleetHealth?.healthy ?? 0;
  const slow = fleetHealth?.slow ?? 0;
  const errors = fleetHealth?.errors ?? 0;
  const hasData = fleetHealth != null && total > 0;
  const pct = hasData ? Math.round((healthy / total) * 100) : null;
  const healthyPct = hasData ? (healthy / total) * 100 : 0;
  const slowPct = hasData ? (slow / total) * 100 : 0;
  const errorPct = hasData ? (errors / total) * 100 : 0;

  const footer = !hasData
    ? "Scheduler health — no scheduled rules yet."
    : "Healthy: recent run on schedule. Slow: last run ≥ 5s. Errors: scheduler stuck.";

  return (
    <div className="rules-overview-cell">
      <div className="rules-overview-label">Fleet health</div>
      <div className="rules-overview-value">
        {pct == null ? "—" : pct}
        {pct != null && <span className="rules-overview-pct">%</span>}
        {hasData && (
          <span className="rules-overview-sub rules-overview-inline">
            · {total} scheduled
          </span>
        )}
      </div>
      <div className="rules-fleet-health-bar">
        {healthyPct > 0 && <div className="rules-fleet-health-seg healthy" style={{ width: `${healthyPct}%` }} />}
        {slowPct > 0 && <div className="rules-fleet-health-seg slow" style={{ width: `${slowPct}%` }} />}
        {errorPct > 0 && <div className="rules-fleet-health-seg error" style={{ width: `${errorPct}%` }} />}
      </div>
      <div className="rules-fleet-health-legend">
        <span>
          <span className="rules-fleet-health-dot healthy" /> Healthy{" "}
          <strong>{hasData ? healthy : "—"}</strong>
        </span>
        <span>
          <span className="rules-fleet-health-dot slow" /> Slow <strong>{hasData ? slow : "—"}</strong>
        </span>
        <span>
          <span className="rules-fleet-health-dot error" /> Errors{" "}
          <strong>{hasData ? errors : "—"}</strong>
        </span>
      </div>
      <p className="rules-overview-footnote">{footer}</p>
    </div>
  );
}

type Props = {
  rules: Rule[];
  summaries: Record<string, RuleRunSummary>;
  silentCount: number;
  alerts24h: number;
  fleetHealth?: FleetHealth | null;
  velocity?: VelocityBucket[];
  onReviewSilent?: () => void;
};

export function RulesOverview({
  rules,
  summaries,
  silentCount,
  alerts24h,
  fleetHealth,
  velocity = [],
  onReviewSilent,
}: Props) {
  const byBand = useMemo(() => {
    const acc = { firing: 0, active: 0, silent: 0, staging: 0, disabled: 0 };
    rules.forEach((r) => {
      acc[bandOf(r, summaries[r.id])]++;
    });
    return acc;
  }, [rules, summaries]);

  const bySev = useMemo(() => {
    const acc: Record<SeverityKey, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    rules.forEach((r) => {
      const k = (r.severity === "informational" ? "info" : r.severity) as SeverityKey;
      if (k in acc) acc[k]++;
    });
    return acc;
  }, [rules]);

  const live = rules.filter(
    (r) =>
      (r.lifecycle === "live" || r.lifecycle === "alerting") && r.enabled !== false
  ).length;
  const total = rules.length || 1;

  return (
    <div className="rules-overview">
      <div className="rules-overview-cell rules-overview-cell--fleet">
        <div className="rules-overview-label">Detection fleet</div>
        <div className="rules-overview-value">
          <strong>{live}</strong> live · {rules.length} total
        </div>
        <div className="rules-overview-sev-stack">
          {(["critical", "high", "medium", "low"] as SeverityKey[]).map((k) => {
            const pct = ((bySev[k] || 0) / total) * 100;
            if (pct === 0) return null;
            return (
              <div
                key={k}
                className="rules-overview-sev-seg"
                style={{ width: `${pct}%`, background: SEV_META[k].color }}
                title={`${SEV_META[k].label}: ${bySev[k]}`}
              />
            );
          })}
        </div>
        <div className="rules-overview-sev-legend">
          {(["critical", "high", "medium", "low"] as SeverityKey[]).map((k) => (
            <span key={k}>
              <span className="rules-seg-dot" style={{ background: SEV_META[k].color }} />
              {SEV_META[k].label} {bySev[k] || 0}
            </span>
          ))}
        </div>
        <FleetMatrix rules={rules} summaries={summaries} />
        <div className="rules-overview-sub">
          {byBand.firing + byBand.active} active · {byBand.silent} silent ·{" "}
          {byBand.staging + byBand.disabled} staged
        </div>
      </div>

      <div className="rules-overview-cell">
        <div className="rules-overview-label">Firing now</div>
        <div className="rules-overview-value accent">{byBand.firing}</div>
        <div className="rules-overview-sub">rules with hits (24h)</div>
        <VelocitySpark buckets={velocity} />
        <div className="rules-overview-metric-row">
          <span className="rules-overview-metric-label">last 24h alerts</span>
          <span className="rules-overview-metric-value">{alerts24h.toLocaleString()}</span>
        </div>
      </div>

      <div className="rules-overview-cell">
        <div className="rules-overview-label">
          <AlertTriangle className="rules-overview-warn-icon" />
          Needs review
        </div>
        <div className="rules-overview-value warn">{silentCount}</div>
        <div className="rules-overview-sub">silent rules</div>
        <p className="rules-overview-copy">
          No recent runs or hits. Review to confirm they are tuned, not broken.
        </p>
        {silentCount > 0 && onReviewSilent && (
          <button type="button" className="rules-review-link" onClick={onReviewSilent}>
            Review silent rules
            <ArrowRight className="icon" />
          </button>
        )}
      </div>

      <FleetHealthCell fleetHealth={fleetHealth} />
    </div>
  );
}
