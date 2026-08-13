import { TACTIC_CHIPS } from "./tactics";

type Props = {
  value: string;
  onChange: (t: string) => void;
};

export function TacticChips({ value, onChange }: Props) {
  return (
    <div className="rules-tactic-chips" role="group" aria-label="MITRE tactic">
      {TACTIC_CHIPS.map((t) => (
        <button
          key={t}
          type="button"
          className={value === t ? "active" : undefined}
          onClick={() => onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
