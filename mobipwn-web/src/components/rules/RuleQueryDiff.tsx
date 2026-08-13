import { useMemo } from "react";
import {
  buildQueryInlineDiff,
  diffHasChanges,
  trimDiffSpans,
  type DiffSpan,
} from "@/lib/textDiff";

type Props = {
  before: string;
  after: string;
  label?: string;
};

function InlineDiffRow({
  label,
  spans,
  variant,
}: {
  label: string;
  spans: DiffSpan[];
  variant: "before" | "after";
}) {
  return (
    <div className={`rules-version-query-diff__row rules-version-query-diff__row--${variant}`}>
      <span className="rules-version-query-diff__row-label">{label}</span>
      <code className="rules-version-query-diff__inline mono">
        {spans.map((span, index) => (
          <span
            key={`${variant}-${index}-${span.kind}`}
            className={`rules-version-diff-span rules-version-diff-span--${span.kind}`}
          >
            {span.text}
          </span>
        ))}
      </code>
    </div>
  );
}

export function RuleQueryDiff({ before, after, label = "Diff" }: Props) {
  const diff = useMemo(() => {
    const raw = buildQueryInlineDiff(before, after);
    const totalLen = Math.max(before.length, after.length);
    const focused = totalLen > 120 ? trimDiffSpans(raw.before, raw.after) : raw;
    return focused;
  }, [before, after]);

  if (!diffHasChanges(diff)) return null;

  return (
    <div className="rules-version-query-diff">
      <div className="rules-version-query-diff__head">
        <span className="rules-version-query-diff__label">{label}</span>
        <span className="rules-version-query-diff__legend muted">
          <span className="rules-version-query-diff__legend-item rules-version-query-diff__legend-item--remove">
            removed
          </span>
          <span className="rules-version-query-diff__legend-item rules-version-query-diff__legend-item--add">
            added
          </span>
        </span>
      </div>
      <div className="rules-version-query-diff__body">
        <InlineDiffRow label="Before" spans={diff.before} variant="before" />
        <InlineDiffRow label="After" spans={diff.after} variant="after" />
      </div>
    </div>
  );
}
