import { useActivityLog } from "@/contexts/ActivityLogContext";
import { CASE_QUERY_TEMPLATE } from "@/lib/caseSource";
import { resolveExampleQuery, SEARCH_EXAMPLES } from "@/lib/searchExamples";

export function SearchExamples({
  caseSource = CASE_QUERY_TEMPLATE,
  onPick,
}: {
  caseSource?: string;
  onPick: (query: string) => void;
}) {
  const { log } = useActivityLog();

  const apply = (label: string, query: string) => {
    const resolved = resolveExampleQuery(query, caseSource);
    log("info", `Example query: ${label}`, resolved.slice(0, 200));
    onPick(resolved);
  };

  return (
    <div className="search-examples">
      <span className="search-examples-label muted">Examples</span>
      <div className="search-examples-chips">
        {SEARCH_EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            className="btn btn-ghost search-example-chip"
            title={ex.description}
            onClick={() => apply(ex.label, ex.query)}
          >
            {ex.label}
          </button>
        ))}
      </div>
      <p className="muted search-examples-hint">
        Scoped to <span className="mono">{caseSource}</span> — change{" "}
        <span className="mono">source="…"</span> in the query or open Search from Data. Ports:{" "}
        <span className="mono">local_port</span> / <span className="mono">remote_port</span> in ext, or{" "}
        <span className="mono">ip:port</span> in <span className="mono">message</span>.
      </p>
    </div>
  );
}
