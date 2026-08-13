import { useMemo } from "react";
import { parseMplQueryStructure } from "@/lib/mplFormat";

function truncate(text: string, max = 72): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function RuleQueryStructure({ query }: { query: string }) {
  const { search, stages } = useMemo(() => parseMplQueryStructure(query), [query]);

  if (!search && stages.length === 0) return null;

  return (
    <div className="rules-editor-query-structure" aria-label="Query structure">
      {search ? (
        <span className="rules-editor-query-chip rules-editor-query-chip--search" title={search}>
          <span className="rules-editor-query-chip__label">Search</span>
          <span className="rules-editor-query-chip__value mono">{truncate(search, 96)}</span>
        </span>
      ) : null}
      {stages.map((stage, index) => (
        <span
          key={`${index}-${stage.slice(0, 24)}`}
          className="rules-editor-query-chip rules-editor-query-chip--stage"
          title={stage}
        >
          <span className="rules-editor-query-chip__label">| {index + 1}</span>
          <span className="rules-editor-query-chip__value mono">{truncate(stage, 48)}</span>
        </span>
      ))}
    </div>
  );
}
