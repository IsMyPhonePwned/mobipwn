import { useMemo } from "react";
import type { CSSProperties } from "react";
import { computeMitreCoverage } from "@/lib/mitreCoverage";
import type { Rule } from "./helpers";

type Props = {
  rules: Rule[];
  onSelectTactic?: (tactic: string) => void;
  activeTactic?: string;
};

export function MitreCoverageMap({ rules, onSelectTactic, activeTactic }: Props) {
  const coverage = useMemo(() => computeMitreCoverage(rules), [rules]);
  const maxRules = Math.max(1, ...coverage.map((c) => c.ruleCount));

  return (
    <section className="mitre-coverage-map card" aria-label="MITRE ATT&CK coverage">
      <header className="mitre-coverage-map__header">
        <h2 className="mitre-coverage-map__title">MITRE coverage</h2>
        <p className="muted mitre-coverage-map__hint">
          Rules mapped by technique ID prefix — click a tactic to filter the table.
        </p>
      </header>
      <div className="mitre-coverage-map__grid">
        {coverage.map((row) => {
          const intensity = row.ruleCount / maxRules;
          const active = activeTactic === row.tactic;
          const empty = row.ruleCount === 0;
          return (
            <button
              key={row.tactic}
              type="button"
              className={`mitre-coverage-cell${active ? " mitre-coverage-cell--active" : ""}${empty ? " mitre-coverage-cell--empty" : ""}`}
              style={{ "--mitre-intensity": String(intensity) } as CSSProperties}
              title={
                empty
                  ? `${row.tactic}: no rules`
                  : `${row.tactic}: ${row.ruleCount} rule(s), ${row.techniqueCount} technique tag(s)`
              }
              onClick={() => onSelectTactic?.(row.tactic)}
            >
              <span className="mitre-coverage-cell__tactic">{row.tactic}</span>
              <span className="mitre-coverage-cell__count">{row.ruleCount}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
