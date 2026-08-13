import { CheckCircle2, Loader2, Timer } from "lucide-react";

type Props = {
  isSearching: boolean;
  hasSearched: boolean;
  totalCount: number | null;
  elapsedMs: number | null;
};

function formatTime(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function SearchStatsBar({ isSearching, hasSearched, totalCount, elapsedMs }: Props) {
  if (!isSearching && !hasSearched) return null;

  return (
    <div className="search-stats-bar" role="status" aria-live="polite">
      {isSearching ? (
        <>
          <Loader2 className="search-stats-icon spin" aria-hidden />
          <span>Executing query…</span>
        </>
      ) : (
        <>
          <CheckCircle2 className="search-stats-icon" aria-hidden />
          <span>Query complete</span>
          {totalCount !== null && (
            <span className="search-stats-sep">·</span>
          )}
          {totalCount !== null && (
            <strong>
              {totalCount.toLocaleString()} hit{totalCount === 1 ? "" : "s"}
            </strong>
          )}
          {elapsedMs != null && (
            <>
              <span className="search-stats-sep">·</span>
              <span className="search-stats-timing">
                <Timer className="search-stats-icon-sm" aria-hidden />
                {formatTime(elapsedMs)}
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}
